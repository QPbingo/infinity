package session

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/heybox/agent-monitor/internal/scanner"
)

type NotifyFunc func(eventType string, data interface{})

type SessionManager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	store    *Store
	notify   NotifyFunc

	userID   string
	deviceID string
}

func NewSessionManager(store *Store, userID, deviceID string) *SessionManager {
	return &SessionManager{
		sessions: make(map[string]*Session),
		store:    store,
		userID:   userID,
		deviceID: deviceID,
	}
}

func (sm *SessionManager) SetNotify(fn NotifyFunc) {
	sm.notify = fn
}

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

func (sm *SessionManager) HandleEvent(event *HookEvent) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	eventType, ok := HookToEventType[event.Event]
	if !ok {
		eventType = EventType(event.Event)
	}

	key := ComputeSessionKey(sm.userID, sm.deviceID, event.AgentType, event.SessionID)
	sess, exists := sm.sessions[key]

	if !exists {
		if event.Event == "Stop" || event.Event == "session_end" {
			return
		}

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

		sess.applyEvent(event, eventType)

		if sm.store != nil {
			if err := sm.store.Upsert(sess); err != nil {
				log.Printf("[session] upsert new session: %v", err)
			}
		}

		if sm.notify != nil {
			clone := *sess
			clone.Payload = nil
			sm.notify("session_added", &clone)
		}
		return
	}

	old := *sess

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

	case "session_end":
		sess.Status = StatusStopped
		sess.LastEventTimeMs = event.TimestampMs
		sess.LastEventType = string(eventType)
		sess.LastHookEvent = event.Event
		sess.lastHookTime = event.TimestampMs
		sess.extractModelOutput(event.Payload)

	default:
		sess.applyEvent(event, eventType)
	}

	if sm.store != nil {
		if err := sm.store.Upsert(sess); err != nil {
			log.Printf("[session] upsert session: %v", err)
		}
	}

	if sm.notify != nil {
		delta := sm.computeDelta(&old, sess)
		if delta != nil {
			sm.notify("delta", delta)
		}
	}
}

func (s *Session) applyEvent(event *HookEvent, eventType EventType) {
	s.LastEventTimeMs = event.TimestampMs
	s.LastEventType = string(eventType)
	s.LastHookEvent = event.Event
	s.CWD = event.CWD
	s.PID = event.PID
	s.lastHookTime = event.TimestampMs
	s.Payload = event.Payload

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

	case EventNotification:
		s.extractModelOutput(event.Payload)
	}

	s.Status = StatusActive
}

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

func (s *Session) appendAgentOutput(payload json.RawMessage) {
	if len(payload) == 0 {
		return
	}
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}

	toolName, _ := data["tool_name"].(string)
	if toolName == "" {
		toolName, _ = data["tool"].(string)
	}

	output, _ := data["tool_output"].(string)
	if output == "" {
		output, _ = data["output"].(string)
	}
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

func (s *Session) extractToolInfo(payload json.RawMessage) {
	if len(payload) == 0 {
		return
	}
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}
	if tool, ok := data["tool"].(string); ok {
		s.LastCommand = tool
	} else if tool, ok := data["tool_name"].(string); ok {
		s.LastCommand = tool
	} else if tool, ok := data["command"].(string); ok {
		s.LastCommand = tool
	}
	if input, ok := data["input"].(map[string]interface{}); ok {
		if fp, ok := input["filePath"].(string); ok {
			s.LastFile = fp
		} else if fp, ok := input["file_path"].(string); ok {
			s.LastFile = fp
		} else if fp, ok := input["path"].(string); ok {
			s.LastFile = fp
		}
	}
	if file, ok := data["filePath"].(string); ok {
		s.LastFile = file
	} else if file, ok := data["file"].(string); ok {
		s.LastFile = file
	}
}

// HandlePidUpdate is called by PID Scanner when an agent process is found alive.
// Updates CPU/Memory/CWD/Terminal, resurrects disappeared sessions.
func (sm *SessionManager) HandlePidUpdate(key string, info *scanner.ProcessInfo) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sess, ok := sm.sessions[key]
	if !ok {
		return
	}

	changed := false
	if sess.PID != int(info.PID) {
		sess.PID = int(info.PID)
		changed = true
	}
	if sess.CWD != info.CWD && info.CWD != "" {
		sess.CWD = info.CWD
		changed = true
	}
	if diff := abs(sess.CPUPercent - info.CPUPercent); diff > 0.1 {
		sess.CPUPercent = info.CPUPercent
		changed = true
	}
	if diff := abs(sess.MemoryMB - info.MemoryMB); diff > 0.5 {
		sess.MemoryMB = info.MemoryMB
		changed = true
	}
	if info.CreateTimeMs > 0 {
		sess.ProcessCreateTimeMs = info.CreateTimeMs
	}

	if info.Name != "" && sess.Terminal != info.Name {
		sess.Terminal = info.Name
		changed = true
	}

	if sess.Status == StatusDisappeared {
		sess.Status = StatusActive
		sess.lastHookTime = time.Now().UnixMilli()
		changed = true
	}

	if !changed {
		return
	}

	if sm.store != nil {
		if err := sm.store.UpdateProcessFields(sess); err != nil {
			log.Printf("[session] update process fields: %v", err)
		}
	}

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

func (sm *SessionManager) MarkDisappeared(key string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sess, ok := sm.sessions[key]
	if !ok {
		return
	}

	if sess.Status == StatusStopped || sess.Status == StatusDisappeared {
		return
	}

	sess.Status = StatusDisappeared

	if sm.store != nil {
		if err := sm.store.Upsert(sess); err != nil {
			log.Printf("[session] mark disappeared: %v", err)
		}
	}

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

func (sm *SessionManager) CheckIdleSessions() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	now := time.Now().UnixMilli()
	idleThreshold := int64(5 * 60 * 1000)

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

func (sm *SessionManager) GetSnapshot() *Snapshot {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	sessions := make([]*Session, 0, len(sm.sessions))
	for _, s := range sm.sessions {
		clone := *s
		clone.Payload = nil
		sessions = append(sessions, &clone)
	}

	return &Snapshot{
		Sessions:  sessions,
		GenTimeMs: time.Now().UnixMilli(),
	}
}

func (sm *SessionManager) GetSessionsForRecovery() map[string]*Session {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	result := make(map[string]*Session, len(sm.sessions))
	for k, v := range sm.sessions {
		result[k] = v
	}
	return result
}

func (sm *SessionManager) HasSession(key string) bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	_, ok := sm.sessions[key]
	return ok
}

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

// computeDelta compares old and new session state, returning only changed fields.
// Returns nil if nothing changed.
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

	if len(changes) == 0 {
		return nil
	}

	return &Delta{
		SessionKey:  new.SessionKey,
		Changes:     changes,
		TimestampMs: time.Now().UnixMilli(),
	}
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}
