package session

import "encoding/json"

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
