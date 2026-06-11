// Package session defines types and logic for agent sessions.
package session

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

type Status string

const (
	StatusActive      Status = "active"
	StatusIdle        Status = "idle"
	StatusStopped     Status = "stopped"
	StatusUnknown     Status = "unknown"
	StatusDisappeared Status = "disappeared"
	StatusError       Status = "error"
)

// EventType classifies raw hook event names into standardized categories.
//
// Mapping philosophy:
//   - Events common to all agents (SessionStart, UserPromptSubmit, PreToolUse,
//     PostToolUse, Stop) share the same raw names → mapped to their own EventType.
//   - Agent-specific events use their own raw names → mapped to the closest
//     semantic EventType, or fall through to default.
//
// All 69 events across OpenCode (29), Claude Code (30), Codex (10) are covered.
type EventType string

const (
	// ── Core session/turn events (all agents) ───────────────────────
	EventSessionStart  EventType = "session_start"
	EventUserPrompt    EventType = "user_prompt"
	EventPreToolUse    EventType = "pre_tool_use"
	EventPostToolUse   EventType = "post_tool_use"
	EventStop          EventType = "stop"
	EventAssistantText EventType = "assistant_text"

	// ── Error / failure events ──────────────────────────────────────
	EventSessionError  EventType = "session_error"
	EventStopFailure   EventType = "stop_failure"
	EventToolFailure   EventType = "tool_failure"

	// ── Permission events ───────────────────────────────────────────
	EventPermission EventType = "permission"

	// ── Subagent events ─────────────────────────────────────────────
	EventSubagent EventType = "subagent"

	// ── Compaction events ───────────────────────────────────────────
	EventCompact EventType = "compact"

	// ── Session lifecycle events ────────────────────────────────────
	EventSessionClose   EventType = "session_close"
	EventSessionDeleted EventType = "session_deleted"

	// ── Batch events ────────────────────────────────────────────────
	EventPostToolBatch EventType = "post_tool_batch"

	// ── Informational events ────────────────────────────────────────
	EventInfo EventType = "info"
)

// HookToEventType maps every raw hook event name (from any agent) to a
// standardized EventType. Covers all 69 events across OpenCode, Claude Code, and Codex.
var HookToEventType = map[string]EventType{
	// ── Common / all agents ─────────────────────────────────────────
	"SessionStart":     EventSessionStart,
	"UserPromptSubmit": EventUserPrompt,
	"PreToolUse":       EventPreToolUse,
	"PostToolUse":      EventPostToolUse,
	"Stop":             EventStop,

	// ── OpenCode custom ─────────────────────────────────────────────
	"AssistantText": EventAssistantText,

	// ── OpenCode: session lifecycle ─────────────────────────────────
	"SessionError":   EventSessionError,
	"SessionClose":   EventSessionClose,
	"SessionCompacted": EventCompact,
	"SessionDeleted": EventSessionDeleted,
	"SessionDiff":    EventInfo,
	"SessionStatus":  EventInfo,
	"SessionUpdated": EventInfo,

	// ── OpenCode: message ───────────────────────────────────────────
	"MessagePartRemoved": EventInfo,
	"MessageRemoved":     EventInfo,
	"MessageUpdated":     EventInfo,

	// ── OpenCode: tool ──────────────────────────────────────────────
	"ToolExecuteBefore": EventInfo,
	"ToolExecuteAfter":  EventInfo,

	// ── OpenCode: permission ────────────────────────────────────────
	"PermissionAsked":  EventPermission,
	"PermissionReplied": EventPermission,

	// ── OpenCode: command ───────────────────────────────────────────
	"CommandExecuted": EventInfo,

	// ── OpenCode: file ──────────────────────────────────────────────
	"FileEdited":        EventInfo,
	"FileWatcherUpdated": EventInfo,

	// ── OpenCode: LSP ───────────────────────────────────────────────
	"LspClientDiagnostics": EventInfo,
	"LspUpdated":           EventInfo,

	// ── OpenCode: server ────────────────────────────────────────────
	"ServerConnected": EventInfo,

	// ── OpenCode: installation ──────────────────────────────────────
	"InstallationUpdated": EventInfo,

	// ── OpenCode: shell ─────────────────────────────────────────────
	"ShellEnv": EventInfo,

	// ── OpenCode: todo ──────────────────────────────────────────────
	"TodoUpdated": EventInfo,

	// ── OpenCode: TUI ───────────────────────────────────────────────
	"TuiPromptAppend":  EventInfo,
	"TuiCommandExecute": EventInfo,
	"TuiToastShow":     EventInfo,

	// ── OpenCode: experimental ──────────────────────────────────────
	"ExperimentalSessionCompacting": EventCompact,

	// ── Claude Code: session ────────────────────────────────────────
	"Setup":       EventInfo,
	"SessionEnd":  EventSessionClose,
	"StopFailure": EventStopFailure,

	// ── Claude Code: tool ───────────────────────────────────────────
	"PostToolUseFailure": EventToolFailure,
	"PostToolBatch":      EventPostToolBatch,

	// ── Claude Code: permission ─────────────────────────────────────
	"PermissionRequest": EventPermission,
	"PermissionDenied":  EventPermission,

	// ── Claude Code: subagent ───────────────────────────────────────
	"SubagentStart": EventSubagent,
	"SubagentStop":  EventSubagent,

	// ── Claude Code: task ───────────────────────────────────────────
	"TaskCreated":   EventInfo,
	"TaskCompleted": EventInfo,

	// ── Claude Code: display ────────────────────────────────────────
	"MessageDisplay": EventAssistantText,

	// ── Claude Code: team ───────────────────────────────────────────
	"TeammateIdle": EventInfo,

	// ── Claude Code: instructions ───────────────────────────────────
	"InstructionsLoaded": EventInfo,

	// ── Claude Code: config / env ───────────────────────────────────
	"ConfigChange": EventInfo,
	"CwdChanged":   EventInfo,
	"FileChanged":  EventInfo,

	// ── Claude Code: worktree ───────────────────────────────────────
	"WorktreeCreate": EventInfo,
	"WorktreeRemove": EventInfo,

	// ── Claude Code: compaction ─────────────────────────────────────
	"PreCompact":  EventCompact,
	"PostCompact": EventCompact,

	// ── Claude Code: elicitation ────────────────────────────────────
	"Elicitation":       EventPermission,
	"ElicitationResult": EventPermission,

	// ── Claude Code: prompt expansion ───────────────────────────────
	"UserPromptExpansion": EventInfo,

	// ── Claude Code: notification (system alerts, not model output) ─
	"Notification": EventInfo,

	// ── Codex: subagent ─────────────────────────────────────────────
	// (SubagentStart / SubagentStop already mapped above)
	// ── Codex: permission ───────────────────────────────────────────
	// (PermissionRequest already mapped above)
	// ── Codex: compaction ───────────────────────────────────────────
	// (PreCompact / PostCompact already mapped above)
}

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

func ComputeSessionKey(userID, deviceID, agentType, agentSessionID string) string {
	data := fmt.Sprintf("%s|%s|%s|%s", userID, deviceID, agentType, agentSessionID)
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:8])
}

type Session struct {
	UserID         string `json:"user_id"`
	DeviceID       string `json:"device_id"`
	AgentType      string `json:"agent_type"`
	AgentSessionID string `json:"agent_session_id"`
	SessionKey     string `json:"session_key"`

	PID        int     `json:"pid"`
	Terminal   string  `json:"terminal"`
	CWD        string  `json:"cwd"`
	MemoryMB   float64 `json:"memory_mb"`
	CPUPercent float64 `json:"cpu_percent"`

	Status          Status          `json:"status"`
	StartTimeMs     int64           `json:"start_time_ms"`
	LastEventTimeMs int64           `json:"last_event_time_ms"`
	LastEventType   string          `json:"last_event_type"`
	LastFile        string          `json:"last_file"`
	LastCommand     string          `json:"last_command"`
	TurnCount       int             `json:"turn_count"`
	GitBranch       string          `json:"git_branch"`
	UserInput       string          `json:"user_input"`
	AgentOutput     string          `json:"agent_output"`
	SessionTitle    string          `json:"session_title"`
	LastHookEvent   string          `json:"last_hook_event"`
	Turns           []Turn          `json:"turns"`
	Payload         json.RawMessage `json:"payload,omitempty"`

	ProcessCreateTimeMs int64 `json:"process_create_time_ms,omitempty"`

	lastHookTime int64
	dbID         int64
}

// Turn represents a single user→agent interaction round.
type Turn struct {
	TurnIdx   int         `json:"turn_idx"`
	UserInput string      `json:"user_input"`
	UserTS    int64       `json:"user_ts"`
	Entries   []TurnEntry `json:"entries"`
}

// TurnEntry is a single entry within a Turn.
//
// Type determines rendering style:
//
//	"A_thinking"   – blue [A] badge, model internal reasoning
//	"A_result"     – green [A] badge, model final response
//	"B_tool_group" – yellow [B] badge, tool call group (collapsible)
//	"B_permission" – orange [B] badge, permission request/decision
//	"B_subagent"   – purple [B] badge, subagent lifecycle
//	"B_compact"    – gray [B] badge, context compaction
//	"error"        – red, error/failure events
//	"info"         – dim gray, general informational events
type TurnEntry struct {
	Type    string     `json:"type"`
	Subtype string     `json:"subtype,omitempty"`
	Text    string     `json:"text,omitempty"`
	TS      int64      `json:"ts"`
	Tools   []ToolCall `json:"tools,omitempty"`
	StartTS int64      `json:"start_ts,omitempty"`
	Meta    string     `json:"meta,omitempty"`
}

type ToolCall struct {
	Name    string `json:"name"`
	Input   string `json:"input"`
	Output  string `json:"output"`
	Status  string `json:"status"`
	StartTS int64  `json:"start_ts"`
	EndTS   int64  `json:"end_ts,omitempty"`
}

type Delta struct {
	SessionKey  string                 `json:"session_key"`
	Changes     map[string]interface{} `json:"changes"`
	TimestampMs int64                  `json:"timestamp_ms"`
}

type Snapshot struct {
	Sessions  []*Session `json:"sessions"`
	GenTimeMs int64      `json:"gen_time_ms"`
}

type RecoveryCandidate struct {
	AgentType      string `json:"agent_type"`
	AgentSessionID string `json:"agent_session_id"`
	CWDHash        string `json:"cwd_hash"`
	StartTimeMs    int64  `json:"start_time_ms"`
	LastEventType  string `json:"last_event_type"`
	LastFile       string `json:"last_file"`
	LastCommand    string `json:"last_command"`
	TurnCount      int    `json:"turn_count"`
	GitBranch      string `json:"git_branch"`
	Terminal       string `json:"terminal"`
	PID            int    `json:"pid"`
	CWD            string `json:"cwd"`
	TranscriptPath string `json:"transcript_path"`
}
