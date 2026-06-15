package session

import "encoding/json"

// EventClass is the semantic classification of an event for turn building.
type EventClass int

const (
	ClassOther EventClass = iota
	ClassUserPrompt
	ClassPreTool
	ClassPostTool
	ClassPostToolFailure
)

// AgentHandler provides agent-specific event processing logic.
type AgentHandler interface {
	ClassifyEvent(event *HookEvent) EventClass
	ExtractToolName(payload json.RawMessage) string
	ExtractToolInput(payload json.RawMessage) string
	ExtractToolOutput(payload json.RawMessage) string
	ExtractUserPromptText(event *HookEvent) string
	IsTerminalEvent(event string) bool
	LifecycleStatus(event string) (Status, bool)
	OnEvent(sess *Session, event *HookEvent)
}

// ── Handler dispatch ──

var handlers = map[string]AgentHandler{
	"claude":   &ClaudeCodeHandler{},
	"codex":    &CodexHandler{},
	"opencode": &OpenCodeHandler{},
}

func getHandler(agentType string) AgentHandler {
	h, ok := handlers[agentType]
	if !ok {
		return &ClaudeCodeHandler{} // fallback
	}
	return h
}

// ── ClaudeCodeHandler ──

type ClaudeCodeHandler struct{}

func (h *ClaudeCodeHandler) ClassifyEvent(event *HookEvent) EventClass {
	switch event.Event {
	case "UserPromptSubmit":
		return ClassUserPrompt
	case "PreToolUse":
		return ClassPreTool
	case "PostToolUse":
		return ClassPostTool
	case "PostToolUseFailure":
		return ClassPostToolFailure
	}
	return ClassOther
}

func (h *ClaudeCodeHandler) ExtractToolName(payload json.RawMessage) string {
	return extractStringField(payload, "tool_name", "tool", "toolName")
}

func (h *ClaudeCodeHandler) ExtractToolInput(payload json.RawMessage) string {
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return ""
	}
	if input, ok := data["tool_input"].(map[string]interface{}); ok {
		if v := firstStringInMap(input, "command", "filePath", "file_path"); v != "" {
			return v
		}
	}
	if input, ok := data["input"].(map[string]interface{}); ok {
		if v := firstStringInMap(input, "command", "filePath", "file_path"); v != "" {
			return v
		}
	}
	return ""
}

func (h *ClaudeCodeHandler) ExtractToolOutput(payload json.RawMessage) string {
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return ""
	}
	if out, ok := data["tool_output"].(string); ok && out != "" {
		return out
	}
	if out, ok := data["output"].(string); ok && out != "" {
		return out
	}
	if out, ok := data["result"].(string); ok && out != "" {
		return out
	}
	if state, ok := data["state"].(map[string]interface{}); ok {
		if out, ok := state["output"].(string); ok && out != "" {
			return out
		}
	}
	return ""
}

func (h *ClaudeCodeHandler) ExtractUserPromptText(event *HookEvent) string {
	return extractStringField(event.Payload, "prompt", "user_input", "text", "message")
}

func (h *ClaudeCodeHandler) IsTerminalEvent(event string) bool {
	switch event {
	case "Stop", "session_end", "SessionEnd", "SessionClose", "SessionDeleted":
		return true
	}
	return false
}

func (h *ClaudeCodeHandler) LifecycleStatus(event string) (Status, bool) {
	switch event {
	case "SessionStart", "session_start":
		return StatusActive, true
	case "Stop", "session_end":
		return StatusStopped, true
	case "SessionError", "StopFailure", "session_error", "stop_failure":
		return StatusError, true
	case "SessionEnd", "SessionClose", "SessionDeleted", "session_close", "session_deleted":
		return StatusStopped, true
	}
	return "", false
}

func (h *ClaudeCodeHandler) OnEvent(sess *Session, event *HookEvent) {
	switch event.Event {
	case "UserPromptSubmit":
		sess.TurnCount++
		sess.extractUserInput(event.Payload)
		if sess.SessionTitle == "" && sess.UserInput != "" {
			sess.SessionTitle = sess.UserInput
		}
	case "PreToolUse", "PostToolUse":
		sess.extractToolInfo(event.Payload)
		sess.appendAgentOutput(event.Payload)
	case "AssistantText", "ReasoningPart":
		sess.extractModelOutput(event.Payload)
	case "VcsBranchUpdated":
		sess.extractBranchInfo(event.Payload)
	}
}

// ── CodexHandler ──

type CodexHandler struct{}

func (h *CodexHandler) ClassifyEvent(event *HookEvent) EventClass {
	switch event.Event {
	case "UserPromptSubmit":
		return ClassUserPrompt
	case "PreToolUse":
		return ClassPreTool
	case "PostToolUse":
		return ClassPostTool
	case "PostToolUseFailure":
		return ClassPostToolFailure
	}
	return ClassOther
}

func (h *CodexHandler) ExtractToolName(payload json.RawMessage) string {
	return extractStringField(payload, "tool_name", "tool", "toolName")
}

func (h *CodexHandler) ExtractToolInput(payload json.RawMessage) string {
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return ""
	}
	if input, ok := data["tool_input"].(map[string]interface{}); ok {
		if v := firstStringInMap(input, "command", "filePath", "file_path"); v != "" {
			return v
		}
	}
	if input, ok := data["input"].(map[string]interface{}); ok {
		if v := firstStringInMap(input, "command", "filePath", "file_path"); v != "" {
			return v
		}
	}
	return ""
}

func (h *CodexHandler) ExtractToolOutput(payload json.RawMessage) string {
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return ""
	}
	if out, ok := data["tool_output"].(string); ok && out != "" {
		return out
	}
	if out, ok := data["output"].(string); ok && out != "" {
		return out
	}
	if out, ok := data["result"].(string); ok && out != "" {
		return out
	}
	if state, ok := data["state"].(map[string]interface{}); ok {
		if out, ok := state["output"].(string); ok && out != "" {
			return out
		}
	}
	return ""
}

func (h *CodexHandler) ExtractUserPromptText(event *HookEvent) string {
	return extractStringField(event.Payload, "prompt", "user_input", "text", "message")
}

func (h *CodexHandler) IsTerminalEvent(event string) bool {
	switch event {
	case "Stop", "session_end", "SessionEnd", "SessionClose", "SessionDeleted":
		return true
	}
	return false
}

func (h *CodexHandler) LifecycleStatus(event string) (Status, bool) {
	switch event {
	case "SessionStart", "session_start":
		return StatusActive, true
	case "Stop", "session_end":
		return StatusStopped, true
	case "SessionError", "StopFailure", "session_error", "stop_failure":
		return StatusError, true
	case "SessionEnd", "SessionClose", "SessionDeleted", "session_close", "session_deleted":
		return StatusStopped, true
	}
	return "", false
}

func (h *CodexHandler) OnEvent(sess *Session, event *HookEvent) {
	switch event.Event {
	case "UserPromptSubmit":
		sess.TurnCount++
		sess.extractUserInput(event.Payload)
		if sess.SessionTitle == "" && sess.UserInput != "" {
			sess.SessionTitle = sess.UserInput
		}
	case "PreToolUse", "PostToolUse":
		sess.extractToolInfo(event.Payload)
		sess.appendAgentOutput(event.Payload)
	case "AssistantText", "ReasoningPart":
		sess.extractModelOutput(event.Payload)
	case "VcsBranchUpdated":
		sess.extractBranchInfo(event.Payload)
	}
}

// ── OpenCodeHandler ──

type OpenCodeHandler struct{}

func (h *OpenCodeHandler) ClassifyEvent(event *HookEvent) EventClass {
	switch event.Event {
	case "tool.execute.before":
		return ClassPreTool
	case "tool.execute.after":
		return ClassPostTool
	case "message.part.updated":
		partType, status, role := parsePartPayload(event.Payload)
		if partType == "text" && role == "user" {
			return ClassUserPrompt
		}
		if partType == "tool" {
			switch status {
			case "running", "pending":
				return ClassPreTool
			case "completed":
				return ClassPostTool
			case "error":
				return ClassPostToolFailure
			}
		}
	}
	return ClassOther
}

func (h *OpenCodeHandler) ExtractToolName(payload json.RawMessage) string {
	if name := extractStringField(payload, "tool"); name != "" {
		return name
	}
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return ""
	}
	if part, ok := data["part"].(map[string]interface{}); ok {
		if tn, ok := part["tool"].(string); ok {
			return tn
		}
	}
	return ""
}

func (h *OpenCodeHandler) ExtractToolInput(payload json.RawMessage) string {
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return ""
	}
	if args, ok := data["args"].(string); ok && args != "" {
		return args
	}
	if args, ok := data["args"].(map[string]interface{}); ok {
		if cmd, ok := args["command"].(string); ok {
			return cmd
		}
	}
	if part, ok := data["part"].(map[string]interface{}); ok {
		if state, ok := part["state"].(map[string]interface{}); ok {
			if input, ok := state["input"]; ok {
				switch v := input.(type) {
				case string:
					return v
				case map[string]interface{}:
					if cmd, ok := v["command"].(string); ok {
						return cmd
					}
				}
			}
		}
	}
	return ""
}

func (h *OpenCodeHandler) ExtractToolOutput(payload json.RawMessage) string {
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return ""
	}
	if out, ok := data["output"].(string); ok && out != "" {
		return out
	}
	if out, ok := data["result"].(string); ok && out != "" {
		return out
	}
	if state, ok := data["state"].(map[string]interface{}); ok {
		if out, ok := state["output"].(string); ok && out != "" {
			return out
		}
	}
	if part, ok := data["part"].(map[string]interface{}); ok {
		if state, ok := part["state"].(map[string]interface{}); ok {
			if out, ok := state["output"]; ok {
				switch v := out.(type) {
				case string:
					return v
				default:
					b, _ := json.Marshal(v)
					return string(b)
				}
			}
		}
	}
	return ""
}

func (h *OpenCodeHandler) ExtractUserPromptText(event *HookEvent) string {
	var data map[string]interface{}
	if err := json.Unmarshal(event.Payload, &data); err != nil {
		return ""
	}
	if part, ok := data["part"].(map[string]interface{}); ok {
		if text, ok := part["text"].(string); ok {
			return text
		}
	}
	return ""
}

func (h *OpenCodeHandler) IsTerminalEvent(event string) bool {
	switch event {
	case "session.idle", "session.deleted":
		return true
	}
	return false
}

func (h *OpenCodeHandler) LifecycleStatus(event string) (Status, bool) {
	switch event {
	case "session.created":
		return StatusActive, true
	case "session.idle":
		return StatusStopped, true
	case "session.error":
		return StatusError, true
	case "session.deleted":
		return StatusStopped, true
	}
	return "", false
}

func (h *OpenCodeHandler) OnEvent(sess *Session, event *HookEvent) {
	switch event.Event {
	case "message.part.updated":
		partType, _, _ := parsePartPayload(event.Payload)
		switch partType {
		case "text":
			sess.extractModelOutput(event.Payload)
		case "tool":
			sess.extractToolInfo(event.Payload)
			sess.appendAgentOutput(event.Payload)
		}
	case "tool.execute.before", "tool.execute.after":
		sess.extractToolInfo(event.Payload)
		sess.appendAgentOutput(event.Payload)
	case "vcs.branch.updated":
		sess.extractBranchInfo(event.Payload)
	}
}

// ── Shared helpers ──

func parsePartPayload(payload json.RawMessage) (partType, status, role string) {
	if len(payload) == 0 {
		return
	}
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}
	if r, ok := data["_role"].(string); ok {
		role = r
	}
	part, _ := data["part"].(map[string]interface{})
	if part == nil {
		return
	}
	partType, _ = part["type"].(string)
	if state, ok := part["state"].(map[string]interface{}); ok {
		status, _ = state["status"].(string)
	}
	return
}

func firstStringInMap(m map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k].(string); ok && v != "" {
			return v
		}
	}
	for _, v := range m {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
