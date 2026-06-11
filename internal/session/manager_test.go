package session

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func makePayload(fields map[string]interface{}) json.RawMessage {
	b, _ := json.Marshal(fields)
	return b
}

func TestBuildTurn_UserPrompt(t *testing.T) {
	s := &Session{}
	ev := &HookEvent{
		Event:       "UserPromptSubmit",
		AgentType:   "opencode",
		TimestampMs: 1000,
		Payload:     makePayload(map[string]interface{}{"prompt": "hello world"}),
	}
	s.applyEvent(ev)

	if len(s.Turns) != 1 {
		t.Fatalf("expected 1 turn, got %d", len(s.Turns))
	}
	turn := s.Turns[0]
	if turn.TurnIdx != 0 {
		t.Errorf("expected turn_idx 0, got %d", turn.TurnIdx)
	}
	if turn.UserInput != "hello world" {
		t.Errorf("expected user_input 'hello world', got %q", turn.UserInput)
	}
	if turn.UserTS != 1000 {
		t.Errorf("expected user_ts 1000, got %d", turn.UserTS)
	}
}

func TestBuildTurn_AssistantText(t *testing.T) {
	s := &Session{}
	s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserInput: "test", UserTS: 1000, Entries: []TurnEntry{}})
	ev := &HookEvent{
		Event:       "AssistantText",
		AgentType:   "opencode",
		TimestampMs: 2000,
		Payload:     makePayload(map[string]interface{}{"text": "I need to think about this"}),
	}
	s.applyEvent(ev)
	if len(s.Turns[0].Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(s.Turns[0].Entries))
	}
	e := s.Turns[0].Entries[0]
	if e.Event != "AssistantText" {
		t.Errorf("expected event AssistantText, got %q", e.Event)
	}
	if string(e.Payload) == "" {
		t.Error("expected non-empty payload")
	}
}

func TestBuildTurn_ReasoningPart(t *testing.T) {
	s := &Session{}
	s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserInput: "test", UserTS: 1000, Entries: []TurnEntry{}})
	ev := &HookEvent{
		Event:       "ReasoningPart",
		TimestampMs: 2000,
		Payload:     makePayload(map[string]interface{}{"text": "reasoning content"}),
	}
	s.applyEvent(ev)
	e := s.Turns[0].Entries[0]
	if e.Event != "ReasoningPart" {
		t.Errorf("expected event ReasoningPart, got %q", e.Event)
	}
	if len(e.Payload) == 0 {
		t.Error("expected non-empty payload")
	}
}

func TestBuildTurn_ToolCallSingle(t *testing.T) {
	s := &Session{}
	s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserInput: "test", UserTS: 1000, Entries: []TurnEntry{}})

	pre := &HookEvent{
		Event: "PreToolUse", TimestampMs: 2000,
		Payload: makePayload(map[string]interface{}{"tool_name": "Read", "tool_input": map[string]interface{}{"filePath": "/foo.go"}}),
	}
	s.applyEvent(pre)
	post := &HookEvent{
		Event: "PostToolUse", TimestampMs: 3000,
		Payload: makePayload(map[string]interface{}{"tool_name": "Read", "tool_output": "file content"}),
	}
	s.applyEvent(post)

	entry := s.Turns[0].Entries[0]
	if len(entry.Tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(entry.Tools))
	}
	if entry.Tools[0].Name != "Read" || entry.Tools[0].Status != "completed" {
		t.Errorf("tool mismatch: %+v", entry.Tools[0])
	}
	if entry.Tools[0].Output != "file content" {
		t.Errorf("expected output, got %q", entry.Tools[0].Output)
	}
}

func TestBuildTurn_ToolCallMultipleSameGroup(t *testing.T) {
	s := &Session{}
	s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserInput: "test", UserTS: 1000, Entries: []TurnEntry{}})
	s.applyEvent(&HookEvent{Event: "PreToolUse", TimestampMs: 2000, Payload: makePayload(map[string]interface{}{"tool_name": "Read", "tool_input": map[string]interface{}{"filePath": "/a.go"}})})
	s.applyEvent(&HookEvent{Event: "PostToolUse", TimestampMs: 2500, Payload: makePayload(map[string]interface{}{"tool_name": "Read", "tool_output": "a"})})
	s.applyEvent(&HookEvent{Event: "PreToolUse", TimestampMs: 2600, Payload: makePayload(map[string]interface{}{"tool_name": "Write", "tool_input": map[string]interface{}{"filePath": "/b.go"}})})
	s.applyEvent(&HookEvent{Event: "PostToolUse", TimestampMs: 3000, Payload: makePayload(map[string]interface{}{"tool_name": "Write", "tool_output": "b"})})

	entry := s.Turns[0].Entries[0]
	if len(entry.Tools) != 2 {
		t.Fatalf("expected 2 tools, got %d", len(entry.Tools))
	}
	if entry.Tools[0].Name != "Read" || entry.Tools[1].Name != "Write" {
		t.Errorf("tool names mismatch")
	}
}

func TestBuildTurn_ToolFailure(t *testing.T) {
	s := &Session{}
	s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserInput: "test", UserTS: 1000, Entries: []TurnEntry{}})
	s.applyEvent(&HookEvent{Event: "PreToolUse", TimestampMs: 2000, Payload: makePayload(map[string]interface{}{"tool_name": "Bash", "tool_input": map[string]interface{}{"command": "rm -rf /"}})})
	s.applyEvent(&HookEvent{Event: "PostToolUseFailure", TimestampMs: 2500, Payload: makePayload(map[string]interface{}{"tool_name": "Bash", "reason": "blocked"})})

	if len(s.Turns[0].Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(s.Turns[0].Entries))
	}
	tc := s.Turns[0].Entries[0].Tools[0]
	if tc.Status != "error" || tc.Output != "blocked" {
		t.Errorf("expected error tool, got status=%s output=%s", tc.Status, tc.Output)
	}
}

func TestBuildTurn_FullTurnFlow(t *testing.T) {
	s := &Session{}
	s.applyEvent(&HookEvent{Event: "UserPromptSubmit", TimestampMs: 1000, Payload: makePayload(map[string]interface{}{"prompt": "sort"})})
	s.applyEvent(&HookEvent{Event: "ReasoningPart", TimestampMs: 1500, Payload: makePayload(map[string]interface{}{"text": "I should use quicksort"})})
	s.applyEvent(&HookEvent{Event: "PreToolUse", TimestampMs: 2000, Payload: makePayload(map[string]interface{}{"tool_name": "Read", "tool_input": map[string]interface{}{"filePath": "/main.go"}})})
	s.applyEvent(&HookEvent{Event: "PostToolUse", TimestampMs: 2500, Payload: makePayload(map[string]interface{}{"tool_name": "Read", "tool_output": "pkg main"})})
	s.applyEvent(&HookEvent{Event: "AssistantText", TimestampMs: 3500, Payload: makePayload(map[string]interface{}{"text": "I wrote sort to /main.go"})})

	if len(s.Turns) != 1 {
		t.Fatalf("expected 1 turn, got %d", len(s.Turns))
	}
	turn := s.Turns[0]
	if len(turn.Entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(turn.Entries))
	}
	if turn.Entries[0].Event != "ReasoningPart" {
		t.Errorf("expected ReasoningPart, got %s", turn.Entries[0].Event)
	}
	if len(turn.Entries[1].Tools) != 1 {
		t.Errorf("expected 1 tool in entry 1")
	}
	if turn.Entries[2].Event != "AssistantText" {
		t.Errorf("expected AssistantText, got %s", turn.Entries[2].Event)
	}
}

func TestBuildTurn_MultipleTurns(t *testing.T) {
	s := &Session{}
	s.applyEvent(&HookEvent{Event: "UserPromptSubmit", TimestampMs: 1000, Payload: makePayload(map[string]interface{}{"prompt": "first"})})
	s.applyEvent(&HookEvent{Event: "AssistantText", TimestampMs: 1500, Payload: makePayload(map[string]interface{}{"text": "first response"})})
	s.applyEvent(&HookEvent{Event: "UserPromptSubmit", TimestampMs: 2000, Payload: makePayload(map[string]interface{}{"prompt": "second"})})
	s.applyEvent(&HookEvent{Event: "AssistantText", TimestampMs: 2500, Payload: makePayload(map[string]interface{}{"text": "second response"})})

	if len(s.Turns) != 2 {
		t.Fatalf("expected 2 turns, got %d", len(s.Turns))
	}
}

func TestBuildTurn_GenericInfoEvents(t *testing.T) {
	s := &Session{}
	s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserInput: "test", UserTS: 1000, Entries: []TurnEntry{}})
	// Any non-structural event should create a generic entry
	s.applyEvent(&HookEvent{Event: "ConfigChange", TimestampMs: 2000, Payload: makePayload(map[string]interface{}{"source": "user_settings"})})
	s.applyEvent(&HookEvent{Event: "FileEdited", TimestampMs: 3000, Payload: makePayload(map[string]interface{}{"filePath": "/test.go"})})
	s.applyEvent(&HookEvent{Event: "PermissionAsked", TimestampMs: 4000, Payload: makePayload(map[string]interface{}{"tool_name": "Bash", "message": "allow?"})})

	if len(s.Turns[0].Entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(s.Turns[0].Entries))
	}
	// Each entry preserves its native event name
	if s.Turns[0].Entries[0].Event != "ConfigChange" {
		t.Errorf("expected ConfigChange, got %s", s.Turns[0].Entries[0].Event)
	}
	if s.Turns[0].Entries[1].Event != "FileEdited" {
		t.Errorf("expected FileEdited, got %s", s.Turns[0].Entries[1].Event)
	}
	if s.Turns[0].Entries[2].Event != "PermissionAsked" {
		t.Errorf("expected PermissionAsked, got %s", s.Turns[0].Entries[2].Event)
	}
}

func TestBuildTurn_WebInputActive(t *testing.T) {
	s := &Session{webInputActive: true}
	s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserInput: "web input", UserTS: 1000, Entries: []TurnEntry{}})
	s.applyEvent(&HookEvent{Event: "UserPromptSubmit", TimestampMs: 2000, Payload: makePayload(map[string]interface{}{"prompt": "duplicate"})})
	// Should NOT create a new turn
	if len(s.Turns) != 1 {
		t.Fatalf("expected 1 turn, got %d", len(s.Turns))
	}
	if s.webInputActive {
		t.Error("expected webInputActive to be cleared")
	}
}

func TestSessionEndAddsResult(t *testing.T) {
	sm := &SessionManager{
		sessions: make(map[string]*Session), userID: "u1", deviceID: "d1",
	}
	key := ComputeSessionKey("u1", "d1", "opencode", "sid1")
	s := &Session{
		UserID: "u1", DeviceID: "d1", AgentType: "opencode",
		AgentSessionID: "sid1", SessionKey: key,
		Turns: []Turn{{TurnIdx: 0, UserInput: "test", UserTS: 1000, Entries: []TurnEntry{}}},
	}
	sm.sessions[key] = s
	ev := &HookEvent{Event: "Stop", AgentType: "opencode", SessionID: "sid1", TimestampMs: 5000,
		Payload: makePayload(map[string]interface{}{"model_output": "final"})}
	sm.HandleEvent(ev)

	turn := s.Turns[0]
	if len(turn.Entries) == 0 || turn.Entries[len(turn.Entries)-1].Event != "Stop" {
		t.Errorf("expected Stop entry, got %d entries", len(turn.Entries))
	}
}

func TestComputeDelta_Turns(t *testing.T) {
	sm := &SessionManager{}
	old := &Session{Turns: []Turn{{TurnIdx: 0, UserInput: "a", Entries: []TurnEntry{}}}}
	new := &Session{Turns: []Turn{{TurnIdx: 0, UserInput: "a", Entries: []TurnEntry{{Event: "AssistantText", TS: 100}}}}}
	delta := sm.computeDelta(old, new)
	if delta == nil {
		t.Fatal("expected delta")
	}
	if _, ok := delta.Changes["turns"]; !ok {
		t.Error("expected turns in delta")
	}
}

func TestExtractStringField(t *testing.T) {
	p := makePayload(map[string]interface{}{"foo": "bar"})
	if v := extractStringField(p, "foo"); v != "bar" {
		t.Errorf("expected bar, got %q", v)
	}
}

func TestExtractToolInput(t *testing.T) {
	p := makePayload(map[string]interface{}{"tool_input": map[string]interface{}{"command": "ls"}})
	if v := extractToolInput(p); v != "ls" {
		t.Errorf("expected ls, got %q", v)
	}
}

func TestExtractToolOutput(t *testing.T) {
	p := makePayload(map[string]interface{}{"tool_output": "done"})
	if v := extractToolOutput(p); v != "done" {
		t.Errorf("expected done, got %q", v)
	}
}

func TestStoreTurnsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	sess := &Session{
		UserID: "u1", DeviceID: "d1", AgentType: "opencode",
		AgentSessionID: "sid1", SessionKey: "key1",
		Status: StatusActive, StartTimeMs: 1000,
		Turns: []Turn{{
			TurnIdx: 0, UserInput: "hello", UserTS: 1000,
			Entries: []TurnEntry{
				{Event: "ReasoningPart", TS: 1100, Payload: json.RawMessage(`{"text":"thinking..."}`)},
				{Event: "PreToolUse", Tools: []ToolCall{{Name: "Read", Input: "/f.go", Output: "c", Status: "completed", StartTS: 1200, EndTS: 1300}}, StartTS: 1200, Payload: json.RawMessage(`{"tool_name":"Read"}`)},
				{Event: "AssistantText", TS: 1400, Payload: json.RawMessage(`{"text":"response"}`)},
			},
		}},
	}
	if err := store.Upsert(sess); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	sessions, err := store.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	loaded := sessions[0]
	if len(loaded.Turns) != 1 {
		t.Fatalf("expected 1 turn, got %d", len(loaded.Turns))
	}
	if len(loaded.Turns[0].Entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(loaded.Turns[0].Entries))
	}
	if loaded.Turns[0].Entries[0].Event != "ReasoningPart" {
		t.Errorf("expected ReasoningPart, got %s", loaded.Turns[0].Entries[0].Event)
	}
	if loaded.Turns[0].Entries[1].Tools[0].Name != "Read" {
		t.Errorf("expected tool Read, got %s", loaded.Turns[0].Entries[1].Tools[0].Name)
	}
	if loaded.Turns[0].Entries[2].Event != "AssistantText" {
		t.Errorf("expected AssistantText, got %s", loaded.Turns[0].Entries[2].Event)
	}
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}
