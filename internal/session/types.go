// Package session defines types and logic for agent sessions.
// Core types: Session (in-memory/sqlite), HookEvent (from events.jsonl),
// Delta (incremental WS updates), Snapshot (full state for new WS clients).
// SessionKey = hex(SHA256(user_id|device_id|agent_type|agent_session_id))[:16]
package session

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

type Status string

const (
	StatusActive       Status = "active"
	StatusIdle         Status = "idle"
	StatusStopped      Status = "stopped"
	StatusUnknown      Status = "unknown"
	StatusDisappeared  Status = "disappeared"
)

type EventType string

const (
	EventSessionStart  EventType = "session_start"
	EventUserPrompt    EventType = "user_prompt"
	EventPreToolUse    EventType = "pre_tool_use"
	EventPostToolUse   EventType = "post_tool_use"
	EventSessionEnd    EventType = "session_end"
	EventNotification  EventType = "notification"
)

var HookToEventType = map[string]EventType{
	"SessionStart":    EventSessionStart,
	"UserPromptSubmit": EventUserPrompt,
	"PreToolUse":      EventPreToolUse,
	"PostToolUse":     EventPostToolUse,
	"Stop":            EventSessionEnd,
	"Notification":    EventNotification,
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
	Payload         json.RawMessage `json:"payload,omitempty"`

	ProcessCreateTimeMs int64 `json:"process_create_time_ms,omitempty"`

	lastHookTime int64
	dbID         int64
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
