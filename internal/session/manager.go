package session

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/heybox/agent-monitor/internal/scanner"
)

// NotifyFunc is a callback that SessionManager calls when sessions change.
// Injected via SetNotify(), typically wired to WebSocket Hub for real-time
// dashboard updates.
//
// Parameters:
//   - eventType: "delta" (incremental change) or "session_added" (new session)
//   - data:      *Delta for "delta", *Session for "session_added"
type NotifyFunc func(eventType string, data interface{})

// SessionManager is the central state store for all agent sessions.
//
// It maintains an in-memory map of sessions keyed by SessionKey, protected
// by a sync.RWMutex for concurrent access from:
//   - EventWatcher goroutine (HandleEvent – hook events from agents)
//   - PID Scanner goroutine (HandlePidUpdate, MarkDisappeared, CheckIdleSessions)
//   - HTTP handlers (GetSessions, GetSession – REST API reads)
//   - WebSocket Hub (GetSnapshot – full state for new clients)
//
// All write operations also persist to SQLite to survive daemon restarts.
// Process-field-only updates use a lighter UpdateProcessFields() to avoid
// contention with hook event writes.
//
// The notification callback (SetNotify) bridges SessionManager to the WebSocket
// Hub without creating a circular dependency.
type SessionManager struct {
	mu       sync.RWMutex
	sessions map[string]*Session // map[SessionKey]*Session, the in-memory store
	store    *Store              // SQLite persistence layer (nil if not available)
	notify   NotifyFunc          // Callback for real-time updates (wired to WebSocket Hub)

	userID   string // User identifier (--user-id flag)
	deviceID string // Device identifier (UUID v4 from device-id file)
}

// NewSessionManager creates a new session manager with the given store and identity.
//
// After creation, call LoadFromStore() to restore persisted sessions,
// then call SetNotify() to wire up the notification callback.
func NewSessionManager(store *Store, userID, deviceID string) *SessionManager {
	return &SessionManager{
		sessions: make(map[string]*Session),
		store:    store,
		userID:   userID,
		deviceID: deviceID,
	}
}

// SetNotify registers a callback that fires on every session change.
//
// Called once during startup in main.go:
//
//	mgr.SetNotify(func(eventType string, data interface{}) {
//	    srv.GetHub().Notify(eventType, data)
//	})
//
// This decouples SessionManager from the WebSocket layer – SessionManager
// doesn't need to know how real-time updates are delivered.
func (sm *SessionManager) SetNotify(fn NotifyFunc) {
	sm.notify = fn
}

// LoadFromStore restores all sessions from SQLite into the in-memory map.
//
// Called once at startup after SQLite initialization.
// Skips duplicate sessions (same SessionKey) that already exist in memory.
// This is a full restore – all fields including process metrics and hook data
// are loaded. Sessions that were "active" or "idle" in the last run will be
// restored with those statuses; the PID Scanner will verify or update them.
func (sm *SessionManager) LoadFromStore() {
	sessions, err := sm.store.LoadAll()
	if err != nil {
		log.Printf("[session] load from store: %v", err)
		return
	}
	sm.mu.Lock()
	defer sm.mu.Unlock()
	for _, s := range sessions {
		if _, exists := sm.sessions[s.SessionKey]; !exists {
			sm.sessions[s.SessionKey] = s
		}
	}
	log.Printf("[session] loaded %d sessions from store", len(sessions))
}

// HandleEvent processes a hook event from the EventWatcher.
//
// This is the primary data ingestion method. It is called synchronously from
// the EventWatcher's goroutine for each valid event line in events.jsonl.
//
// Processing flow:
//
//	1. Map raw event name to standardized EventType (via HookToEventType).
//	   If the event name is not in the map, use the raw name as the type.
//
//	2. Compute SessionKey and look up (or create) the session in the in-memory map.
//
//	3. For a new session:
//	   a. Reject "Stop"/"session_end" events – a session_end without a prior
//	      session_start is a stale event, ignore it.
//	   b. Create a new Session with Status=active, set StartTimeMs to event time.
//	   c. Apply the event's data (user input, tool info, etc.) via applyEvent().
//	   d. Upsert to SQLite.
//	   e. Notify "session_added" to WebSocket clients.
//
//	4. For an existing session:
//	   a. Save a copy of the old state (old := *sess).
//	   b. Handle specific event types:
//	      - session_start: Reset status to Active, update CWD/PID/lastHookTime.
//	                        This handles session restart within the same agent process.
//	      - session_end:   Set Status to Stopped, extract model output from payload.
//	                        Stopped is terminal – only session_start can restart it.
//	      - default:       Apply event via applyEvent() (updates turns, tools, output).
//	   c. Upsert to SQLite.
//	   d. Compute delta (diff old vs. new) and notify "delta" if anything changed.
//
// Thread safety: Holds write lock for the entire duration to prevent races
// with PID Scanner operations.
func (sm *SessionManager) HandleEvent(event *HookEvent) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	// Normalize agent-specific event names to standardized EventType
	eventType, ok := HookToEventType[event.Event]
	if !ok {
		eventType = EventType(event.Event)
	}

	key := ComputeSessionKey(sm.userID, sm.deviceID, event.AgentType, event.SessionID)
	sess, exists := sm.sessions[key]

	// ── Case 1: New session (first time seeing this key) ────────────────
	if !exists {
		// Reject stale session_end events for unknown sessions
		if event.Event == "Stop" || event.Event == "session_end" {
			return
		}

		// Create brand-new session with initial state
		sess = &Session{
			UserID:         sm.userID,
			DeviceID:       sm.deviceID,
			AgentType:      event.AgentType,
			AgentSessionID: event.SessionID,
			SessionKey:     key,
			Status:         StatusActive,
			StartTimeMs:    event.TimestampMs,
			Payload:        event.Payload,
		}
		sm.sessions[key] = sess

		// Apply event data: extracts user input, tool info, model output
		// based on the event type (user_prompt, tool_use, notification).
		sess.applyEvent(event, eventType)

		// Persist to SQLite so this session survives daemon restart
		if sm.store != nil {
			if err := sm.store.Upsert(sess); err != nil {
				log.Printf("[session] upsert new session: %v", err)
			}
		}

		// Notify dashboard that a new session appeared
		// Payload is stripped from the clone for privacy/bandwidth
		if sm.notify != nil {
			clone := *sess
			clone.Payload = nil
			sm.notify("session_added", &clone)
		}
		return
	}

	// ── Case 2: Existing session – update state based on event type ─────
	old := *sess // snapshot before mutation for delta computation

	switch string(eventType) {
	case "session_start":
		sess.Status = StatusActive
		sess.StartTimeMs = event.TimestampMs
		sess.LastEventTimeMs = event.TimestampMs
		sess.LastEventType = string(eventType)
		sess.LastHookEvent = event.Event
		sess.CWD = event.CWD
		sess.PID = event.PID
		sess.lastHookTime = event.TimestampMs
		sess.Payload = event.Payload

	case "stop":
		sess.Status = StatusStopped
		sess.LastEventTimeMs = event.TimestampMs
		sess.LastEventType = string(eventType)
		sess.LastHookEvent = event.Event
		sess.lastHookTime = event.TimestampMs
		sess.extractModelOutput(event.Payload)
		finalText := extractStringField(event.Payload, "model_output", "output", "last_assistant_message", "text", "response")
		if finalText != "" && len(sess.Turns) > 0 {
			turn := &sess.Turns[len(sess.Turns)-1]
			turn.Entries = append(turn.Entries, TurnEntry{
				Type: "A_result",
				Text: finalText,
				TS:   event.TimestampMs,
			})
		}

	case "session_error", "stop_failure":
		sess.Status = StatusError
		sess.LastEventTimeMs = event.TimestampMs
		sess.LastEventType = string(eventType)
		sess.LastHookEvent = event.Event
		sess.lastHookTime = event.TimestampMs
		sess.applyEvent(event, eventType)

	case "session_close":
		sess.Status = StatusStopped
		sess.LastEventTimeMs = event.TimestampMs
		sess.LastEventType = string(eventType)
		sess.LastHookEvent = event.Event
		sess.lastHookTime = event.TimestampMs
		sess.applyEvent(event, eventType)

	default:
		sess.applyEvent(event, eventType)
	}

	// Persist the updated session state to SQLite
	if sm.store != nil {
		if err := sm.store.Upsert(sess); err != nil {
			log.Printf("[session] upsert session: %v", err)
		}
	}

	// Compute what changed and notify dashboards via WebSocket
	// computeDelta() returns nil if nothing changed (same field values)
	if sm.notify != nil {
		delta := sm.computeDelta(&old, sess)
		if delta != nil {
			sm.notify("delta", delta)
		}
	}
}

// applyEvent updates a Session's fields based on a hook event.
//
// Always updates: LastEventTimeMs, LastEventType, LastHookEvent, CWD, PID,
// lastHookTime, Payload, and sets Status to Active.
//
// Type-specific updates:
//
//	user_prompt:
//	  - Increments TurnCount
//	  - Extracts user input text from payload (searches for keys: prompt,
//	    user_input, text, message)
//	  - If SessionTitle is empty, sets it to the first user input
//
//	pre_tool_use / post_tool_use:
//	  - Extracts tool name and file path from payload
//	  - Extracts tool input (command, filePath) from payload
//	  - Appends a formatted line to AgentOutput: "[HH:MM:SS] <event> <tool> → <output>"
//
//	notification:
//	  - Extracts model output text from payload (searches for keys:
//	    last_assistant_message, model_output, output, text, response)
//	  - Appends to AgentOutput: "[model] <text>"
func (s *Session) applyEvent(event *HookEvent, eventType EventType) {
	// ── Always-updated fields ──────────────────────────────────────────
	s.LastEventTimeMs = event.TimestampMs
	s.LastEventType = string(eventType)
	s.LastHookEvent = event.Event
	s.CWD = event.CWD
	s.PID = event.PID
	s.lastHookTime = event.TimestampMs // for idle detection
	s.Payload = event.Payload

	// ── Turn building ─────────────────────────────────────────────────
	s.buildTurnEntry(event, eventType)

	// ── Type-specific field extraction ─────────────────────────────────
	switch eventType {
	case EventUserPrompt:
		s.TurnCount++
		s.extractUserInput(event.Payload)
		if s.SessionTitle == "" && s.UserInput != "" {
			s.SessionTitle = s.UserInput
		}

	case EventPostToolUse:
		s.extractToolInfo(event.Payload)
		s.appendAgentOutput(event.Payload)

	case EventPreToolUse:
		s.extractToolInfo(event.Payload)
		s.appendAgentOutput(event.Payload)

	case EventAssistantText:
		s.extractModelOutput(event.Payload)

	case EventSessionError, EventStopFailure:
		s.Status = StatusError
		return

	case EventSessionClose:
		s.Status = StatusStopped
		return
	}

	s.Status = StatusActive
}

// buildTurnEntry constructs Turn entries from hook events.
//
// Turn lifecycle:
//   UserPromptSubmit → starts a new turn with user_input
//   Notification(type=thinking) → adds A_thinking entry
//   PreToolUse → opens or adds to B_tool_group entry
//   PostToolUse → completes tool in B_tool_group entry
//   Notification(type=result) → adds A_result entry
func (s *Session) buildTurnEntry(event *HookEvent, eventType EventType) {
	switch eventType {
	case EventUserPrompt:
		input := extractStringField(event.Payload, "prompt", "user_input", "text", "message")
		s.Turns = append(s.Turns, Turn{
			TurnIdx:   len(s.Turns),
			UserInput: input,
			UserTS:    event.TimestampMs,
			Entries:   []TurnEntry{},
		})

	case EventAssistantText:
		s.addNotificationToTurn(event)

	case EventPreToolUse:
		s.addToolRunning(event)

	case EventPostToolUse:
		s.completeTool(event)

	case EventToolFailure:
		s.failTool(event)

	case EventPermission:
		s.addPermissionEntry(event)

	case EventSubagent:
		s.addSubagentEntry(event)

	case EventCompact:
		s.addCompactEntry(event)

	case EventSessionError, EventStopFailure:
		s.addErrorEntry(event)

	case EventPostToolBatch:
		s.addInfoEntry(event, "PostToolBatch")

	case EventInfo:
		s.addInfoEntry(event, event.Event)
	}
}

func (s *Session) ensureTurn() *Turn {
	if len(s.Turns) == 0 {
		s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserTS: 0, Entries: []TurnEntry{}})
	}
	return &s.Turns[len(s.Turns)-1]
}

func (s *Session) failTool(event *HookEvent) {
	toolName := extractStringField(event.Payload, "tool_name", "tool", "toolName")
	toolOutput := extractToolOutput(event.Payload)
	reason := extractStringField(event.Payload, "reason", "error", "message")
	if toolName == "" {
		return
	}
	s.ensureTurn()
	turn := s.ensureTurn()
	found := false
	for i := len(turn.Entries) - 1; i >= 0; i-- {
		if turn.Entries[i].Type == "B_tool_group" {
			for j := len(turn.Entries[i].Tools) - 1; j >= 0; j-- {
				if turn.Entries[i].Tools[j].Status == "running" && turn.Entries[i].Tools[j].Name == toolName {
					turn.Entries[i].Tools[j].Status = "error"
					turn.Entries[i].Tools[j].Output = reason
					if toolOutput != "" {
						turn.Entries[i].Tools[j].Output = toolOutput
					}
					turn.Entries[i].Tools[j].EndTS = event.TimestampMs
					found = true
					break
				}
			}
			if found {
				break
			}
		}
	}
	if !found {
		tc := ToolCall{
			Name:    toolName,
			Status:  "error",
			Output:  firstNonEmpty(reason, toolOutput),
			StartTS: event.TimestampMs,
			EndTS:   event.TimestampMs,
		}
		addToolToGroup(turn, tc, event.TimestampMs)
	}
}

func (s *Session) addPermissionEntry(event *HookEvent) {
	subtype := event.Event
	text := buildPermissionText(event)
	if text == "" {
		return
	}
	s.ensureTurn()
	turn := s.ensureTurn()
	turn.Entries = append(turn.Entries, TurnEntry{
		Type:    "B_permission",
		Subtype: subtype,
		Text:    text,
		TS:      event.TimestampMs,
	})
}

func buildPermissionText(event *HookEvent) string {
	toolName := extractStringField(event.Payload, "tool_name", "tool", "toolName")
	reason := extractStringField(event.Payload, "reason", "permissionDecisionReason", "message", "decisionReason")
	decision := extractStringField(event.Payload, "permissionDecision", "decision", "behavior")
	if toolName != "" && decision != "" {
		return toolName + ": " + decision + (map[bool]string{true: " — " + reason, false: ""}[reason != ""])
	}
	if toolName != "" {
		return toolName
	}
	if reason != "" {
		return reason
	}
	return extractStringField(event.Payload, "text", "message", "description")
}

func (s *Session) addSubagentEntry(event *HookEvent) {
	agentType := extractStringField(event.Payload, "agent_type", "agentType", "type")
	agentID := extractStringField(event.Payload, "agent_id", "agentId", "id")
	text := agentType
	if agentID != "" {
		text = agentType + " (" + agentID + ")"
	}
	if text == "" {
		text = event.Event
	}
	s.ensureTurn()
	turn := s.ensureTurn()
	turn.Entries = append(turn.Entries, TurnEntry{
		Type:    "B_subagent",
		Subtype: event.Event,
		Text:    text,
		TS:      event.TimestampMs,
	})
}

func (s *Session) addCompactEntry(event *HookEvent) {
	trigger := extractStringField(event.Payload, "trigger", "source", "reason")
	text := "Context compacted"
	if trigger != "" {
		text += " (" + trigger + ")"
	}
	s.ensureTurn()
	turn := s.ensureTurn()
	turn.Entries = append(turn.Entries, TurnEntry{
		Type:    "B_compact",
		Subtype: event.Event,
		Text:    text,
		TS:      event.TimestampMs,
	})
}

func (s *Session) addErrorEntry(event *HookEvent) {
	reason := extractStringField(event.Payload, "reason", "error", "message", "text", "model_output")
	errorType := extractStringField(event.Payload, "error_type", "type", "status")
	text := event.Event
	if errorType != "" {
		text += ": " + errorType
	}
	if reason != "" {
		text += " — " + reason
	}
	s.ensureTurn()
	turn := s.ensureTurn()
	turn.Entries = append(turn.Entries, TurnEntry{
		Type:    "error",
		Subtype: event.Event,
		Text:    text,
		TS:      event.TimestampMs,
	})
}

func (s *Session) addInfoEntry(event *HookEvent, label string) {
	text := buildInfoText(event, label)
	if text == "" {
		return
	}
	s.ensureTurn()
	turn := s.ensureTurn()
	turn.Entries = append(turn.Entries, TurnEntry{
		Type:    "info",
		Subtype: event.Event,
		Text:    text,
		TS:      event.TimestampMs,
	})
}

func buildInfoText(event *HookEvent, label string) string {
	parts := []string{label}
	if file := extractStringField(event.Payload, "filePath", "file_path", "file", "path", "filename"); file != "" {
		parts = append(parts, file)
	}
	if cwd := extractStringField(event.Payload, "cwd", "directory"); cwd != "" {
		parts = append(parts, cwd)
	}
	if cmd := extractStringField(event.Payload, "command", "tool_name", "tool"); cmd != "" {
		parts = append(parts, cmd)
	}
	if src := extractStringField(event.Payload, "source", "trigger", "reason", "notification_type"); src != "" {
		parts = append(parts, src)
	}
	if text := extractStringField(event.Payload, "text", "message", "description"); text != "" {
		parts = append(parts, text)
	}
	if len(parts) == 1 {
		return label
	}
	return joinNonEmpty(parts, " | ")
}

func addToolToGroup(turn *Turn, tc ToolCall, ts int64) {
	for i := len(turn.Entries) - 1; i >= 0; i-- {
		if turn.Entries[i].Type == "B_tool_group" {
			turn.Entries[i].Tools = append(turn.Entries[i].Tools, tc)
			return
		}
	}
	turn.Entries = append(turn.Entries, TurnEntry{
		Type:    "B_tool_group",
		Tools:   []ToolCall{tc},
		StartTS: ts,
	})
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func joinNonEmpty(parts []string, sep string) string {
	var out []string
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return ""
	}
	result := out[0]
	for i := 1; i < len(out); i++ {
		result += sep + out[i]
	}
	return result
}

// addNotificationToTurn adds an A_thinking or A_result entry to the current turn.
func (s *Session) addNotificationToTurn(event *HookEvent) {
	entryType := extractStringField(event.Payload, "type")
	if entryType == "" {
		entryType = "A_result"
	}
	text := extractStringField(event.Payload, "text", "last_assistant_message", "model_output", "output", "response", "message")
	if text == "" {
		return
	}
	if len(s.Turns) == 0 {
		s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserTS: event.TimestampMs, Entries: []TurnEntry{}})
	}
	turn := &s.Turns[len(s.Turns)-1]
	entry := TurnEntry{
		Type: entryType,
		Text: text,
		TS:   event.TimestampMs,
	}
	turn.Entries = append(turn.Entries, entry)
}

// addToolRunning opens a tool call in a B_tool_group entry (or creates a new group).
func (s *Session) addToolRunning(event *HookEvent) {
	toolName := extractStringField(event.Payload, "tool_name", "tool", "toolName")
	toolInput := extractToolInput(event.Payload)
	if toolName == "" {
		return
	}
	if len(s.Turns) == 0 {
		s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserTS: event.TimestampMs, Entries: []TurnEntry{}})
	}
	turn := &s.Turns[len(s.Turns)-1]
	tc := ToolCall{
		Name:    toolName,
		Input:   toolInput,
		Status:  "running",
		StartTS: event.TimestampMs,
	}
	var group *TurnEntry
	for i := len(turn.Entries) - 1; i >= 0; i-- {
		if turn.Entries[i].Type == "B_tool_group" {
			group = &turn.Entries[i]
			break
		}
	}
	if group == nil {
		turn.Entries = append(turn.Entries, TurnEntry{
			Type:    "B_tool_group",
			Tools:   []ToolCall{tc},
			StartTS: event.TimestampMs,
		})
	} else {
		group.Tools = append(group.Tools, tc)
	}
}

// completeTool finds the running tool in the current turn and marks it completed.
func (s *Session) completeTool(event *HookEvent) {
	toolName := extractStringField(event.Payload, "tool_name", "tool", "toolName")
	toolOutput := extractToolOutput(event.Payload)
	status := extractStringField(event.Payload, "status")
	if status == "" {
		status = "completed"
	}
	if len(s.Turns) == 0 {
		return
	}
	turn := &s.Turns[len(s.Turns)-1]
	for i := len(turn.Entries) - 1; i >= 0; i-- {
		if turn.Entries[i].Type == "B_tool_group" {
			group := &turn.Entries[i]
			for j := len(group.Tools) - 1; j >= 0; j-- {
				tc := &group.Tools[j]
				if tc.Status == "running" && (toolName == "" || tc.Name == toolName) {
					tc.Status = status
					tc.Output = toolOutput
					tc.EndTS = event.TimestampMs
					return
				}
			}
		}
	}
}

// extractStringField pulls a string value from a JSON payload by trying multiple keys.
func extractStringField(payload json.RawMessage, keys ...string) string {
	if len(payload) == 0 {
		return ""
	}
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return ""
	}
	for _, k := range keys {
		if v, ok := data[k].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

// extractToolInput extracts the tool input from a payload (command, filePath, or first key).
func extractToolInput(payload json.RawMessage) string {
	if len(payload) == 0 {
		return ""
	}
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return ""
	}
	if input, ok := data["tool_input"].(map[string]interface{}); ok {
		if cmd, ok := input["command"].(string); ok {
			return cmd
		}
		if fp, ok := input["filePath"].(string); ok {
			return fp
		}
		if fp, ok := input["file_path"].(string); ok {
			return fp
		}
		for k := range input {
			if v, ok := input[k].(string); ok {
				return v
			}
		}
	}
	if input, ok := data["input"].(map[string]interface{}); ok {
		if cmd, ok := input["command"].(string); ok {
			return cmd
		}
		if fp, ok := input["filePath"].(string); ok {
			return fp
		}
		if fp, ok := input["file_path"].(string); ok {
			return fp
		}
	}
	return ""
}

// extractToolOutput extracts the tool output from a payload.
func extractToolOutput(payload json.RawMessage) string {
	if len(payload) == 0 {
		return ""
	}
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

// extractUserInput extracts user prompt text from the event payload.
//
// Searches for common key names used across different agents:
//   - "prompt" (opencode)
//   - "user_input" (claude code)
//   - "text" (generic)
//   - "message" (generic)
//
// The first non-empty string value found is stored in s.UserInput.
func (s *Session) extractUserInput(payload json.RawMessage) {
	if len(payload) == 0 {
		return
	}
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}
	for _, k := range []string{"prompt", "user_input", "text", "message"} {
		if v, ok := data[k].(string); ok && v != "" {
			s.UserInput = v
			return
		}
	}
}

// appendAgentOutput extracts tool invocation info from the event payload
// and appends a formatted log line to AgentOutput.
//
// Format: "[HH:MM:SS] <hook_event> <tool_name> → <tool_output/command/file>"
//
// Examples:
//
//	"[14:25:03] PreToolUse Bash → ls -la"
//	"[14:25:05] PostToolUse Read → /path/to/file.go"
//	"[14:26:01] PreToolUse Write → main.go"
//
// The tool name is extracted from "tool_name" or "tool" keys.
// The tool output/command is extracted from:
//   - "tool_output" or "output" keys (direct output)
//   - "tool_input.command" (shell commands from bash tool)
//   - "tool_input.filePath"/"file_path"/"path" (file operations)
//   - If only tool_input with no recognizable keys, shows first key name
//
// AgentOutput accumulates across events, separated by newlines.
func (s *Session) appendAgentOutput(payload json.RawMessage) {
	if len(payload) == 0 {
		return
	}
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}

	// Extract tool name from "tool_name" or "tool" keys
	toolName, _ := data["tool_name"].(string)
	if toolName == "" {
		toolName, _ = data["tool"].(string)
	}

	// Extract tool output from various possible locations
	output, _ := data["tool_output"].(string)
	if output == "" {
		output, _ = data["output"].(string)
	}
	// If no direct output, try to extract from tool_input sub-object
	if output == "" {
		if toolInput, ok := data["tool_input"].(map[string]interface{}); ok {
			if cmd, ok := toolInput["command"].(string); ok {
				output = cmd
			} else if fp, ok := toolInput["filePath"].(string); ok {
				output = fp
			} else if fp, ok := toolInput["file_path"].(string); ok {
				output = fp
			} else if fp, ok := toolInput["path"].(string); ok {
				output = fp
			} else {
				// Unknown tool input structure – show the first key name
				keys := make([]string, 0, len(toolInput))
				for k := range toolInput {
					keys = append(keys, k)
				}
				if len(keys) > 0 {
					output = "(" + keys[0] + "...)"
				}
			}
		}
	}

	// Build the log line: tool name or output is required
	line := ""
	if toolName != "" {
		line = "[" + toolName + "]"
	}
	if output != "" {
		if line != "" {
			line += " "
		}
		line += output
	}
	if line == "" {
		return
	}

	// Format: "[HH:MM:SS] <event_type> <tool_name> → <output>"
	ts := time.Now().Format("15:04:05")
	if s.AgentOutput != "" {
		s.AgentOutput += "\n"
	}
	s.AgentOutput += "[" + ts + "] "
	if s.LastHookEvent != "" {
		s.AgentOutput += s.LastHookEvent + " "
	}
	if toolName != "" {
		s.AgentOutput += toolName
	}
	if output != "" {
		s.AgentOutput += " → " + output
	}
}

// extractModelOutput extracts the model's textual response from the payload.
//
// Searches for common key names across agents:
//   - "last_assistant_message" (opencode)
//   - "model_output" (claude code)
//   - "output" (generic)
//   - "text" (generic)
//   - "response" (generic)
//
// Appends to AgentOutput as: "[model] <model response text>"
func (s *Session) extractModelOutput(payload json.RawMessage) {
	if len(payload) == 0 {
		return
	}
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}
	for _, k := range []string{"last_assistant_message", "model_output", "output", "text", "response"} {
		if v, ok := data[k].(string); ok && v != "" {
			if s.AgentOutput != "" {
				s.AgentOutput += "\n"
			}
			s.AgentOutput += "[model] " + v
			return
		}
	}
}

// extractToolInfo extracts the tool name and file path from an event payload.
//
// Separates tool identification into:
//   - LastCommand: the tool/command name (e.g. "Bash", "Read", "Edit")
//     Sources: "tool", "tool_name", "command"
//   - LastFile: the file path being operated on (e.g. "/path/to/file.go")
//     Sources: payload direct "filePath"/"file"/"file" keys,
//              or nested "input.filePath"/"input.file_path"/"input.path"
//
// This provides the dashboard with quick context on what the agent is doing.
func (s *Session) extractToolInfo(payload json.RawMessage) {
	if len(payload) == 0 {
		return
	}
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}

	// Extract tool/command name
	if tool, ok := data["tool"].(string); ok {
		s.LastCommand = tool
	} else if tool, ok := data["tool_name"].(string); ok {
		s.LastCommand = tool
	} else if tool, ok := data["command"].(string); ok {
		s.LastCommand = tool
	}

	// Extract file path from input sub-object
	if input, ok := data["input"].(map[string]interface{}); ok {
		if fp, ok := input["filePath"].(string); ok {
			s.LastFile = fp
		} else if fp, ok := input["file_path"].(string); ok {
			s.LastFile = fp
		} else if fp, ok := input["path"].(string); ok {
			s.LastFile = fp
		}
	}

	// Extract file path from top-level payload (higher priority)
	if file, ok := data["filePath"].(string); ok {
		s.LastFile = file
	} else if file, ok := data["file"].(string); ok {
		s.LastFile = file
	}
}

// HandlePidUpdate is called by PID Scanner when an agent process is found alive.
//
// This is the primary way process-level metrics flow into the session manager.
// Only updates fields that changed meaningfully to avoid unnecessary notifications
// and database writes.
//
// Update thresholds (avoid noisy updates for floating values):
//   - CPU:     change must exceed 0.1 percentage points
//   - Memory:  change must exceed 0.5 MB
//
// Special behavior:
//   - If session status is Disappeared, resurrects it to Active.
//     This handles the case where a process briefly vanished from the process
//     table (e.g., during fork/exec) but is actually still running.
//
// Uses the lighter UpdateProcessFields() SQLite method (only writes process
// fields, not full session data) to reduce write contention with hook events.
func (sm *SessionManager) HandlePidUpdate(key string, info *scanner.ProcessInfo) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sess, ok := sm.sessions[key]
	if !ok {
		return
	}

	changed := false

	// Update PID if it changed (e.g., agent restarted with new PID but same CWD)
	if sess.PID != int(info.PID) {
		sess.PID = int(info.PID)
		changed = true
	}

	// Update CWD if the process moved directories (unusual but possible via os.Chdir)
	if sess.CWD != info.CWD && info.CWD != "" {
		sess.CWD = info.CWD
		changed = true
	}

	// Update CPU percentage only if change exceeds noise threshold (0.15%)
	if diff := abs(sess.CPUPercent - info.CPUPercent); diff > 0.1 {
		sess.CPUPercent = info.CPUPercent
		changed = true
	}

	// Update memory only if change exceeds noise threshold (0.5MB)
	if diff := abs(sess.MemoryMB - info.MemoryMB); diff > 0.5 {
		sess.MemoryMB = info.MemoryMB
		changed = true
	}

	// Always store process creation time (set once, doesn't change)
	if info.CreateTimeMs > 0 {
		sess.ProcessCreateTimeMs = info.CreateTimeMs
	}

	// Update terminal emulator name if it changed
	if info.Name != "" && sess.Terminal != info.Name {
		sess.Terminal = info.Name
		changed = true
	}

	// Resurrection: if process was marked disappeared but we found it again,
	// revive it to active status and refresh the hook timer
	if sess.Status == StatusDisappeared {
		sess.Status = StatusActive
		sess.lastHookTime = time.Now().UnixMilli()
		changed = true
	}

	if !changed {
		return
	}

	// Lighter persistence: only update process-related fields
	// Uses a targeted UPDATE rather than full ON CONFLICT UPSERT
	if sm.store != nil {
		if err := sm.store.UpdateProcessFields(sess); err != nil {
			log.Printf("[session] update process fields: %v", err)
		}
	}

	// Notify WebSocket clients of process-level changes
	// Uses a simplified changes map (only process fields that dashboard needs)
	if sm.notify != nil {
		changes := map[string]interface{}{
			"pid":        sess.PID,
			"cwd":        sess.CWD,
			"cpu_percent": sess.CPUPercent,
			"memory_mb":  sess.MemoryMB,
		}
		if info.CreateTimeMs > 0 {
			changes["process_create_time_ms"] = info.CreateTimeMs
		}
		delta := &Delta{
			SessionKey:  key,
			Changes:     changes,
			TimestampMs: time.Now().UnixMilli(),
		}
		sm.notify("delta", delta)
	}
}

// MarkDisappeared is called by PID Scanner when a known agent process
// is no longer found in the OS process table.
//
// Only marks sessions that are not already in a terminal state:
//   - Stopped:     already ended via hook event, skip (terminal state)
//   - Disappeared: already marked, skip (idempotent)
//   - Active/Idle: transition to Disappeared
//
// A disappeared session can be resurrected if the process reappears
// in a subsequent PID scan (HandlePidUpdate will detect it and revive).
func (sm *SessionManager) MarkDisappeared(key string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sess, ok := sm.sessions[key]
	if !ok {
		return
	}

	// Don't re-mark sessions already in terminal states
	if sess.Status == StatusStopped || sess.Status == StatusDisappeared {
		return
	}

	sess.Status = StatusDisappeared

	// Persist the status change
	if sm.store != nil {
		if err := sm.store.Upsert(sess); err != nil {
			log.Printf("[session] mark disappeared: %v", err)
		}
	}

	// Notify dashboard of the status change
	if sm.notify != nil {
		changes := map[string]interface{}{"status": string(StatusDisappeared)}
		delta := &Delta{
			SessionKey:  key,
			Changes:     changes,
			TimestampMs: time.Now().UnixMilli(),
		}
		sm.notify("delta", delta)
	}
}

// CheckIdleSessions marks active sessions as idle if no hook events have
// been received for more than 5 minutes.
//
// Called by PID Scanner at the end of each scan cycle.
// Only considers sessions with Status=Active or Status=Idle.
// Sessions with zero lastHookTime (never received a hook event) are skipped.
//
// An idle session becomes active again as soon as any hook event arrives
// (applyEvent sets Status=Active on every event).
//
// Note: idle marking does NOT persist to SQLite – it's a transient display
// state that doesn't need crash recovery.
func (sm *SessionManager) CheckIdleSessions() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	now := time.Now().UnixMilli()
	idleThreshold := int64(5 * 60 * 1000) // 5 minutes in milliseconds

	for key, sess := range sm.sessions {
		if sess.Status != StatusActive && sess.Status != StatusIdle {
			continue
		}
		if sess.lastHookTime == 0 {
			continue
		}
		if now-sess.lastHookTime > idleThreshold {
			if sess.Status != StatusIdle {
				sess.Status = StatusIdle
				if sm.notify != nil {
					changes := map[string]interface{}{"status": string(StatusIdle)}
					delta := &Delta{
						SessionKey:  key,
						Changes:     changes,
						TimestampMs: now,
					}
					sm.notify("delta", delta)
				}
			}
		}
	}
}

// GetSessions returns a copy of all sessions for the REST API.
//
// Each session is shallow-copied (the struct is copied, but Payload
// is raw JSON which is safe for concurrent reads).
// Returns an empty slice (not nil) if no sessions exist.
func (sm *SessionManager) GetSessions() []*Session {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	result := make([]*Session, 0, len(sm.sessions))
	for _, s := range sm.sessions {
		clone := *s
		result = append(result, &clone)
	}
	return result
}

// GetSession returns a copy of a single session by its SessionKey.
//
// Returns nil if the session is not found.
// The session is shallow-copied for thread safety.
func (sm *SessionManager) GetSession(key string) *Session {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	s, ok := sm.sessions[key]
	if !ok {
		return nil
	}
	clone := *s
	return &clone
}

// GetKnownPIDs returns all session→PID mappings for the PID Scanner.
//
// Called at the beginning of each PID scan cycle. The scanner uses this
// to match discovered OS processes to their corresponding sessions.
//
// Returns a map of PID → SessionPIDInfo containing:
//   - SessionKey: for session lookup during HandlePidUpdate/MarkDisappeared
//   - PID:        the process ID to match against
//   - AgentType:  for fallback matching when PID doesn't match directly
//   - CWD:        for fallback matching when PID doesn't match directly
//
// Only sessions with PID > 0 (i.e., have been matched to a process) are included.
func (sm *SessionManager) GetKnownPIDs() map[int]scanner.SessionPIDInfo {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	result := make(map[int]scanner.SessionPIDInfo)
	for _, sess := range sm.sessions {
		if sess.PID > 0 {
			result[sess.PID] = scanner.SessionPIDInfo{
				SessionKey: sess.SessionKey,
				PID:        sess.PID,
				AgentType:  sess.AgentType,
				CWD:        sess.CWD,
			}
		}
	}
	return result
}

// GetSnapshot returns a full copy of all sessions for new WebSocket clients.
//
// Called when a WebSocket client successfully authenticates. The snapshot
// gives the client a complete initial state, after which only incremental
// Delta messages are sent.
//
// Payload fields are stripped from each session copy – the raw hook payload
// can be large and is not needed for dashboard display.
func (sm *SessionManager) GetSnapshot() *Snapshot {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	sessions := make([]*Session, 0, len(sm.sessions))
	for _, s := range sm.sessions {
		clone := *s
		clone.Payload = nil // strip raw payload for bandwidth/privacy
		sessions = append(sessions, &clone)
	}

	return &Snapshot{
		Sessions:  sessions,
		GenTimeMs: time.Now().UnixMilli(),
	}
}

// GetSessionsForRecovery returns the internal session map for use during
// session recovery at startup.
//
// Recovery uses this to check for existing sessions before creating
// recovered ones, avoiding duplicates.
func (sm *SessionManager) GetSessionsForRecovery() map[string]*Session {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	result := make(map[string]*Session, len(sm.sessions))
	for k, v := range sm.sessions {
		result[k] = v
	}
	return result
}

// HasSession checks whether a session with the given key exists.
//
// Used by Recovery to skip transcript sessions that are already tracked.
func (sm *SessionManager) HasSession(key string) bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	_, ok := sm.sessions[key]
	return ok
}

// AddRecoveredSession adds a session recovered from transcript files.
//
// Only adds if the session doesn't already exist (idempotent).
// Recovered sessions typically have Status=unknown until the PID Scanner
// matches them to a running process via BindPIDToSession().
func (sm *SessionManager) AddRecoveredSession(sess *Session) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	key := sess.SessionKey
	if _, exists := sm.sessions[key]; exists {
		return
	}

	sm.sessions[key] = sess

	if sm.store != nil {
		if err := sm.store.Upsert(sess); err != nil {
			log.Printf("[session] upsert recovered session: %v", err)
		}
	}
}

// BindPIDToSession binds a recovered session to a running OS process.
//
// Called during recovery after FindProcessBySession() successfully matches
// a transcript session to a currently running agent process.
//
// Updates all process-level fields (PID, Terminal, CWD, CPU%, Memory) and
// promotes the session status from Unknown to Active.
//
// Sets lastHookTime to current time so the session won't immediately be
// marked idle after recovery.
func (sm *SessionManager) BindPIDToSession(key string, info *scanner.ProcessInfo) {

	sm.mu.Lock()
	defer sm.mu.Unlock()

	sess, ok := sm.sessions[key]
	if !ok {
		return
	}

	sess.PID = int(info.PID)
	sess.Terminal = info.Name
	sess.CWD = info.CWD
	sess.CPUPercent = info.CPUPercent
	sess.MemoryMB = info.MemoryMB
	sess.ProcessCreateTimeMs = info.CreateTimeMs
	sess.Status = StatusActive
	sess.lastHookTime = time.Now().UnixMilli()

	if sm.store != nil {
		if err := sm.store.Upsert(sess); err != nil {
			log.Printf("[session] bind pid: %v", err)
		}
	}
}

// computeDelta compares an old and new Session state, returning only the
// fields that changed.
//
// This enables efficient WebSocket updates: instead of sending the full
// session object on every change, only the modified fields are sent.
// The dashboard client applies these changes incrementally to its local state.
//
// Returns nil if no fields changed (no notification is sent in that case).
//
// Comparison logic:
//   - Compares old vs. new for each mutable field
//   - Adds changed field to the changes map with its new value
//   - JSON field names are used as map keys (matching the Session struct tags)
func (sm *SessionManager) computeDelta(old, new *Session) *Delta {
	changes := make(map[string]interface{})
	if old.PID != new.PID {
		changes["pid"] = new.PID
	}
	if old.CWD != new.CWD {
		changes["cwd"] = new.CWD
	}
	if old.Status != new.Status {
		changes["status"] = string(new.Status)
	}
	if old.LastEventTimeMs != new.LastEventTimeMs {
		changes["last_event_time_ms"] = new.LastEventTimeMs
	}
	if old.LastEventType != new.LastEventType {
		changes["last_event_type"] = new.LastEventType
	}
	if old.LastFile != new.LastFile {
		changes["last_file"] = new.LastFile
	}
	if old.LastCommand != new.LastCommand {
		changes["last_command"] = new.LastCommand
	}
	if old.TurnCount != new.TurnCount {
		changes["turn_count"] = new.TurnCount
	}
	if old.Terminal != new.Terminal {
		changes["terminal"] = new.Terminal
	}
	if old.ProcessCreateTimeMs != new.ProcessCreateTimeMs {
		changes["process_create_time_ms"] = new.ProcessCreateTimeMs
	}
	if old.GitBranch != new.GitBranch {
		changes["git_branch"] = new.GitBranch
	}
	if old.UserInput != new.UserInput {
		changes["user_input"] = new.UserInput
	}
	if old.AgentOutput != new.AgentOutput {
		changes["agent_output"] = new.AgentOutput
	}
	if old.SessionTitle != new.SessionTitle {
		changes["session_title"] = new.SessionTitle
	}
	if old.LastHookEvent != new.LastHookEvent {
		changes["last_hook_event"] = new.LastHookEvent
	}
	if !turnsEqual(old.Turns, new.Turns) {
		changes["turns"] = new.Turns
	}

	if len(changes) == 0 {
		return nil
	}

	return &Delta{
		SessionKey:  new.SessionKey,
		Changes:     changes,
		TimestampMs: time.Now().UnixMilli(),
	}
}

func turnsEqual(a, b []Turn) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].TurnIdx != b[i].TurnIdx || a[i].UserInput != b[i].UserInput || a[i].UserTS != b[i].UserTS {
			return false
		}
		if len(a[i].Entries) != len(b[i].Entries) {
			return false
		}
		for j := range a[i].Entries {
			ea, eb := a[i].Entries[j], b[i].Entries[j]
			if ea.Type != eb.Type || ea.Subtype != eb.Subtype || ea.Text != eb.Text || ea.TS != eb.TS || ea.StartTS != eb.StartTS || ea.Meta != eb.Meta {
				return false
			}
			if len(ea.Tools) != len(eb.Tools) {
				return false
			}
			for k := range ea.Tools {
				ta, tb := ea.Tools[k], eb.Tools[k]
				if ta.Name != tb.Name || ta.Input != tb.Input || ta.Output != tb.Output || ta.Status != tb.Status || ta.StartTS != tb.StartTS || ta.EndTS != tb.EndTS {
					return false
				}
			}
		}
	}
	return true
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}
