// Package session defines types and logic for agent sessions.
//
// Core concepts:
//
// Session:
//   An AI coding agent session represents a single conversation instance.
//   It tracks both hook-driven content (user input, agent output, tool usage)
//   and process-level metrics (CPU, memory, terminal, PID).
//   Sessions exist in memory (map[SessionKey]*Session) and are persisted to SQLite.
//
// SessionKey:
//   hex(SHA256(userID|deviceID|agentType|agentSessionID))[:16]
//   A 16-character hex string that uniquely identifies a session across
//   the combination of user, device, agent type, and agent's internal session ID.
//
// Session Lifecycle State Machine:
//
//	                    ┌──────────┐
//	            ┌──────▶│  active   │◀────────┐
//	            │       └─────┬─────┘         │
//	            │ hook事件     │ 5分钟无hook    │ PID重新出现
//	            │ 重新激活     ▼               │ (复活)
//	            │       ┌──────────┐   PID消失 │
//	            └───────│   idle    │──────────┤
//	                    └─────┬─────┘          │
//	                          │ PID消失         ▼
//	                          │          ┌──────────────┐
//	                          └─────────▶│ disappeared  │
//	                                     └──────────────┘
//
//	  hook session_start ──▶ active ──▶ hook session_end ──▶ stopped (终态，不可逆)
//	  recovery ──▶ unknown ──▶ PID绑定成功 ──▶ active
//
// HookEvent:
//   A single event emitted by agent hooks, written as one JSON line to events.jsonl.
//   Fields: event (hook event name), agent_type, session_id, daemon_token,
//           pid, cwd, timestamp_ms, payload (JSON blob with event-specific data).
//
// Delta:
//   Incremental update sent to WebSocket clients. Contains only the fields
//   that changed between two session snapshots, minimizing network traffic.
//
// Snapshot:
//   Full state dump sent to new WebSocket clients on connect.
//   Contains all sessions with Payload stripped for privacy.
package session

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// Session status constants defining the lifecycle states.
// The state machine transitions are governed by:
//   - Hook events (session_start, session_end, all other hook events)
//   - PID scanner (process alive → active, process dead → disappeared)
//   - Idle timeout (5 minutes without hook events → idle)
//   - Session recovery (matched a running process → active)
type Status string

const (
	StatusActive      Status = "active"      // Agent is running and actively emitting hook events
	StatusIdle        Status = "idle"         // Agent process is running but hasn't emitted hooks for >5 min
	StatusStopped     Status = "stopped"      // Hook session_end received, terminal state (can only restart via new session_start)
	StatusUnknown     Status = "unknown"      // Recovered from transcript files, not yet matched to a running process
	StatusDisappeared Status = "disappeared"  // Agent process disappeared from process table, may be resurrected
)

// EventType classifies raw hook event names into standardized categories.
// Each agent (opencode/claude/codex) may use different event names,
// but they are normalized into these standard types via HookToEventType.
type EventType string

const (
	EventSessionStart  EventType = "session_start"  // Agent conversation started
	EventUserPrompt    EventType = "user_prompt"    // User submitted a prompt/input
	EventPreToolUse    EventType = "pre_tool_use"   // Agent about to execute a tool
	EventPostToolUse   EventType = "post_tool_use"  // Agent completed a tool execution
	EventSessionEnd    EventType = "session_end"    // Agent conversation ended
	EventNotification  EventType = "notification"   // Agent sent a notification (model output, status update)
)

// HookToEventType maps raw hook event names (from agent hooks) to standardized EventType.
// The hook binary (agent-monitor-hook) writes events with agent-specific event names.
// This mapping normalizes them so SessionManager can handle all agents uniformly.
var HookToEventType = map[string]EventType{
	"SessionStart":    EventSessionStart,
	"UserPromptSubmit": EventUserPrompt,
	"PreToolUse":      EventPreToolUse,
	"PostToolUse":     EventPostToolUse,
	"Stop":            EventSessionEnd,
	"Notification":    EventNotification,
}

// HookEvent represents a single hook event read from events.jsonl.
//
// Each event is one JSON object per line, written by the agent-monitor-hook binary.
// The hook binary captures the agent's PID, CWD, and event payload then appends it.
//
// Field details:
//
//	Event       – Raw hook event name (e.g. "SessionStart", "PreToolUse", "Stop")
//	AgentType   – Which agent emitted this: "opencode", "claude", or "codex"
//	SessionID   – Agent's internal session identifier (used in SessionKey computation)
//	DaemonToken – Auth token copied from ~/.agent-monitor/local-token by hook binary
//	              Validated with constant-time comparison before processing
//	PID         – Process ID of the agent that emitted this event
//	CWD         – Current working directory of the agent process when event occurred
//	TimestampMs – Unix timestamp in milliseconds when the event was emitted
//	Payload     – JSON blob with event-specific data (user input, tool output, model response, etc.)
type HookEvent struct {
	Event       string          `json:"event"`
	AgentType   string          `json:"agent_type"`
	SessionID   string          `json:"session_id"`
	DaemonToken string          `json:"daemon_token"`
	PID         int             `json:"pid"`
	CWD         string          `json:"cwd"`
	TimestampMs int64           `json:"timestamp_ms"`
	Payload     json.RawMessage `json:"payload"`
}

// ComputeSessionKey generates a 16-character hex session key from the quadruple of
// (userID, deviceID, agentType, agentSessionID).
//
// Algorithm: hex(SHA256("userID|deviceID|agentType|agentSessionID"))[:16]
//
// This ensures:
//   - Same user on same device with same agent session → same key (idempotent)
//   - Different user/device/agent/session → different key (no collisions)
//   - 16 hex chars = 64 bits of entropy, collision probability ~1/2^32 for 4B sessions
func ComputeSessionKey(userID, deviceID, agentType, agentSessionID string) string {
	data := fmt.Sprintf("%s|%s|%s|%s", userID, deviceID, agentType, agentSessionID)
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:8])
}

// Session is the core data structure representing a single AI agent conversation.
//
// Fields are organized into two categories:
//
//  1. Hook-driven fields – updated by EventWatcher when hooks fire:
//     UserID, DeviceID, AgentType, AgentSessionID, SessionKey, Status,
//     StartTimeMs, LastEventTimeMs, LastEventType, LastHookEvent,
//     LastFile, LastCommand, TurnCount, GitBranch,
//     UserInput, AgentOutput, SessionTitle, Payload
//
//  2. Process-driven fields – updated by PID Scanner on each cycle:
//     PID, Terminal, CWD, MemoryMB, CPUPercent, ProcessCreateTimeMs
//
// Internal fields (not persisted, not sent to clients):
//
//	lastHookTime – milliseconds timestamp of the most recent hook event.
//	               Used by CheckIdleSessions() to detect idle sessions (>5min no activity).
//	dbID         – internal SQLite row ID (unused currently).
type Session struct {
	// ── Identity fields (set once, never change) ────────────────────────
	UserID         string `json:"user_id"`          // User identifier (--user-id flag)
	DeviceID       string `json:"device_id"`        // Machine identifier (UUID v4)
	AgentType      string `json:"agent_type"`       // "opencode", "claude", or "codex"
	AgentSessionID string `json:"agent_session_id"` // Agent's internal session ID
	SessionKey     string `json:"session_key"`      // ComputeSessionKey(userID, deviceID, agentType, agentSessionID)

	// ── Process fields (updated by PID Scanner) ─────────────────────────
	PID        int     `json:"pid"`         // OS process ID of the agent
	Terminal   string  `json:"terminal"`    // Terminal emulator name (e.g. "iTerm2", "ghostty")
	CWD        string  `json:"cwd"`         // Current working directory of the agent process
	MemoryMB   float64 `json:"memory_mb"`   // Resident Set Size in megabytes
	CPUPercent float64 `json:"cpu_percent"` // CPU usage percentage (capped at 100% per core)

	// ── Session state fields ────────────────────────────────────────────
	Status          Status          `json:"status"`            // Current lifecycle status (active/idle/stopped/...)
	StartTimeMs     int64           `json:"start_time_ms"`     // Timestamp when session was first observed (ms)
	LastEventTimeMs int64           `json:"last_event_time_ms"`// Timestamp of the most recent hook event (ms)
	LastEventType   string          `json:"last_event_type"`   // Standardized type of the last event (e.g. "user_prompt")
	LastFile        string          `json:"last_file"`         // File path from the most recent tool use
	LastCommand     string          `json:"last_command"`      // Tool name or command from the most recent tool use
	TurnCount       int             `json:"turn_count"`        // Number of user→agent interaction turns
	GitBranch       string          `json:"git_branch"`        // Git branch of the agent's working directory
	UserInput       string          `json:"user_input"`        // The last user prompt text
	AgentOutput     string          `json:"agent_output"`      // Accumulated agent output log (tool calls + model responses)
	SessionTitle    string          `json:"session_title"`     // Title derived from the first user input
	LastHookEvent   string          `json:"last_hook_event"`   // Raw event name of the last hook event (e.g. "PreToolUse")
	Payload         json.RawMessage `json:"payload,omitempty"` // Raw payload of the most recent hook event (stripped in snapshots)

	// ── Extended process info ───────────────────────────────────────────
	ProcessCreateTimeMs int64 `json:"process_create_time_ms,omitempty"` // Agent process creation time (ms since epoch)

	// ── Internal fields (not serialized to clients) ─────────────────────
	lastHookTime int64 // Timestamp of last hook event in ms, for idle detection
	dbID         int64 // SQLite row ID for potential future use
}

// Delta represents an incremental update to a session, sent via WebSocket.
//
// Instead of sending the entire session on every change, the daemon computes
// only the fields that changed since the last update. This minimizes WebSocket
// message size and reduces client-side rendering work.
//
// Changes map keys are JSON field names (e.g. "status", "cpu_percent", "pid").
// Values are the new field values.
type Delta struct {
	SessionKey  string                 `json:"session_key"`  // Which session changed
	Changes     map[string]interface{} `json:"changes"`      // Only the fields that changed
	TimestampMs int64                  `json:"timestamp_ms"` // When the change was detected
}

// Snapshot is a full state dump sent to new WebSocket clients on connect.
//
// Sent immediately after auth_ok, giving the client the complete current state
// of all sessions. After this, only Delta messages are sent.
//
// Payload fields are stripped from sessions to avoid sending potentially
// large amounts of raw event data to every new client.
type Snapshot struct {
	Sessions  []*Session `json:"sessions"`    // All tracked sessions (Payload stripped)
	GenTimeMs int64      `json:"gen_time_ms"` // Snapshot generation timestamp
}

// RecoveryCandidate is extracted from agent transcript JSONL files during
// session recovery at daemon startup.
//
// When the daemon starts, it scans transcript files from the last 24 hours
// to find sessions that were active while the daemon was offline.
// Each candidate is then matched against running OS processes.
type RecoveryCandidate struct {
	AgentType      string `json:"agent_type"`       // "opencode", "claude", or "codex"
	AgentSessionID string `json:"agent_session_id"` // Agent's internal session ID from transcript
	CWDHash        string `json:"cwd_hash"`         // SHA256[:8] of CWD for process matching
	StartTimeMs    int64  `json:"start_time_ms"`    // Earliest timestamp in this transcript
	LastEventType  string `json:"last_event_type"`  // Type of the last event in transcript
	LastFile       string `json:"last_file"`        // Most recent file referenced
	LastCommand    string `json:"last_command"`      // Most recent command/tool used
	TurnCount      int    `json:"turn_count"`       // Number of user↔agent turns
	GitBranch      string `json:"git_branch"`       // Git branch from transcript
	Terminal       string `json:"terminal"`         // Terminal from transcript
	PID            int    `json:"pid"`              // PID from transcript
	CWD            string `json:"cwd"`              // Working directory from transcript
	TranscriptPath string `json:"transcript_path"` // Path to the transcript file
}
