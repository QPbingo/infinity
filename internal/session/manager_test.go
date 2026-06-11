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
	s.applyEvent(ev, EventUserPrompt)

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
	if s.TurnCount != 1 {
		t.Errorf("expected TurnCount 1, got %d", s.TurnCount)
	}
}

func TestBuildTurn_AssistantTextThinking(t *testing.T) {
	s := &Session{}
	s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserInput: "test", UserTS: 1000, Entries: []TurnEntry{}})

	ev := &HookEvent{
		Event:       "AssistantText",
		AgentType:   "opencode",
		TimestampMs: 2000,
		Payload:     makePayload(map[string]interface{}{"type": "A_thinking", "text": "I need to think about this"}),
	}
	s.applyEvent(ev, EventAssistantText)

	if len(s.Turns) != 1 {
		t.Fatalf("expected 1 turn, got %d", len(s.Turns))
	}
	turn := s.Turns[0]
	if len(turn.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(turn.Entries))
	}
	e := turn.Entries[0]
	if e.Type != "A_thinking" {
		t.Errorf("expected type A_thinking, got %q", e.Type)
	}
	if e.Text != "I need to think about this" {
		t.Errorf("expected text, got %q", e.Text)
	}
	if e.TS != 2000 {
		t.Errorf("expected ts 2000, got %d", e.TS)
	}
}

func TestBuildTurn_AssistantTextResult(t *testing.T) {
	s := &Session{}
	s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserInput: "test", UserTS: 1000, Entries: []TurnEntry{}})

	ev := &HookEvent{
		Event:       "AssistantText",
		AgentType:   "opencode",
		TimestampMs: 3000,
		Payload:     makePayload(map[string]interface{}{"type": "A_result", "text": "here is the code"}),
	}
	s.applyEvent(ev, EventAssistantText)

	e := s.Turns[0].Entries[0]
	if e.Type != "A_result" {
		t.Errorf("expected type A_result, got %q", e.Type)
	}
}

func TestBuildTurn_AssistantTextDefaultResult(t *testing.T) {
	s := &Session{}
	s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserInput: "test", UserTS: 1000, Entries: []TurnEntry{}})

	ev := &HookEvent{
		Event:       "AssistantText",
		TimestampMs: 3000,
		Payload:     makePayload(map[string]interface{}{"text": "some output"}),
	}
	s.applyEvent(ev, EventAssistantText)

	e := s.Turns[0].Entries[0]
	if e.Type != "A_result" {
		t.Errorf("expected default type A_result, got %q", e.Type)
	}
}

func TestBuildTurn_AssistantTextNoTurns(t *testing.T) {
	s := &Session{}
	ev := &HookEvent{
		Event:       "AssistantText",
		TimestampMs: 1000,
		Payload:     makePayload(map[string]interface{}{"type": "A_thinking", "text": "thinking"}),
	}
	s.applyEvent(ev, EventAssistantText)

	if len(s.Turns) != 1 {
		t.Fatalf("expected 1 auto-created turn, got %d", len(s.Turns))
	}
}

func TestBuildTurn_ToolCallSingle(t *testing.T) {
	s := &Session{}
	s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserInput: "test", UserTS: 1000, Entries: []TurnEntry{}})

	pre := &HookEvent{
		Event:       "PreToolUse",
		TimestampMs: 2000,
		Payload:     makePayload(map[string]interface{}{"tool_name": "Read", "tool_input": map[string]interface{}{"filePath": "/foo.go"}}),
	}
	s.applyEvent(pre, EventPreToolUse)

	if len(s.Turns[0].Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(s.Turns[0].Entries))
	}
	grp := s.Turns[0].Entries[0]
	if grp.Type != "B_tool_group" {
		t.Errorf("expected B_tool_group, got %q", grp.Type)
	}
	if len(grp.Tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(grp.Tools))
	}
	tc := grp.Tools[0]
	if tc.Name != "Read" {
		t.Errorf("expected tool Read, got %q", tc.Name)
	}
	if tc.Status != "running" {
		t.Errorf("expected status running, got %q", tc.Status)
	}
	if tc.Input != "/foo.go" {
		t.Errorf("expected input /foo.go, got %q", tc.Input)
	}

	post := &HookEvent{
		Event:       "PostToolUse",
		TimestampMs: 3000,
		Payload:     makePayload(map[string]interface{}{"tool_name": "Read", "tool_output": "file content here"}),
	}
	s.applyEvent(post, EventPostToolUse)

	tc = s.Turns[0].Entries[0].Tools[0]
	if tc.Status != "completed" {
		t.Errorf("expected status completed, got %q", tc.Status)
	}
	if tc.Output != "file content here" {
		t.Errorf("expected output, got %q", tc.Output)
	}
	if tc.EndTS != 3000 {
		t.Errorf("expected end_ts 3000, got %d", tc.EndTS)
	}
}

func TestBuildTurn_ToolCallMultipleSameGroup(t *testing.T) {
	s := &Session{}
	s.Turns = append(s.Turns, Turn{TurnIdx: 0, UserInput: "test", UserTS: 1000, Entries: []TurnEntry{}})

	s.applyEvent(&HookEvent{Event: "PreToolUse", TimestampMs: 2000, Payload: makePayload(map[string]interface{}{"tool_name": "Read", "tool_input": map[string]interface{}{"filePath": "/a.go"}})}, EventPreToolUse)
	s.applyEvent(&HookEvent{Event: "PostToolUse", TimestampMs: 2500, Payload: makePayload(map[string]interface{}{"tool_name": "Read", "tool_output": "content a"})}, EventPostToolUse)
	s.applyEvent(&HookEvent{Event: "PreToolUse", TimestampMs: 2600, Payload: makePayload(map[string]interface{}{"tool_name": "Write", "tool_input": map[string]interface{}{"filePath": "/b.go"}})}, EventPreToolUse)
	s.applyEvent(&HookEvent{Event: "PostToolUse", TimestampMs: 3000, Payload: makePayload(map[string]interface{}{"tool_name": "Write", "tool_output": "written"})}, EventPostToolUse)

	grp := s.Turns[0].Entries[0]
	if grp.Type != "B_tool_group" {
		t.Errorf("expected B_tool_group, got %q", grp.Type)
	}
	if len(grp.Tools) != 2 {
		t.Fatalf("expected 2 tools in one group, got %d", len(grp.Tools))
	}
	if grp.Tools[0].Name != "Read" {
		t.Errorf("expected first tool Read, got %q", grp.Tools[0].Name)
	}
	if grp.Tools[1].Name != "Write" {
		t.Errorf("expected second tool Write, got %q", grp.Tools[1].Name)
	}
}

func TestBuildTurn_FullTurnFlow(t *testing.T) {
	s := &Session{}

	// User prompt
	s.applyEvent(&HookEvent{Event: "UserPromptSubmit", TimestampMs: 1000, Payload: makePayload(map[string]interface{}{"prompt": "sort this array"})}, EventUserPrompt)

	// Thinking
	s.applyEvent(&HookEvent{Event: "AssistantText", TimestampMs: 1500, Payload: makePayload(map[string]interface{}{"type": "A_thinking", "text": "I should use quicksort"})}, EventAssistantText)

	// Tool calls
	s.applyEvent(&HookEvent{Event: "PreToolUse", TimestampMs: 2000, Payload: makePayload(map[string]interface{}{"tool_name": "Read", "tool_input": map[string]interface{}{"filePath": "/src/main.go"}})}, EventPreToolUse)
	s.applyEvent(&HookEvent{Event: "PostToolUse", TimestampMs: 2500, Payload: makePayload(map[string]interface{}{"tool_name": "Read", "tool_output": "package main..."})}, EventPostToolUse)
	s.applyEvent(&HookEvent{Event: "PreToolUse", TimestampMs: 2600, Payload: makePayload(map[string]interface{}{"tool_name": "Write", "tool_input": map[string]interface{}{"filePath": "/src/sort.go"}})}, EventPreToolUse)
	s.applyEvent(&HookEvent{Event: "PostToolUse", TimestampMs: 3000, Payload: makePayload(map[string]interface{}{"tool_name": "Write", "tool_output": "func sort..."})}, EventPostToolUse)

	// Result
	s.applyEvent(&HookEvent{Event: "AssistantText", TimestampMs: 3500, Payload: makePayload(map[string]interface{}{"type": "A_result", "text": "I wrote the sort function to /src/sort.go"})}, EventAssistantText)

	if len(s.Turns) != 1 {
		t.Fatalf("expected 1 turn, got %d", len(s.Turns))
	}
	turn := s.Turns[0]
	if turn.UserInput != "sort this array" {
		t.Errorf("unexpected user input: %q", turn.UserInput)
	}
	if len(turn.Entries) != 3 {
		t.Fatalf("expected 3 entries (thinking, tool_group, result), got %d", len(turn.Entries))
	}
	if turn.Entries[0].Type != "A_thinking" {
		t.Errorf("expected entry 0 = A_thinking, got %q", turn.Entries[0].Type)
	}
	if turn.Entries[1].Type != "B_tool_group" {
		t.Errorf("expected entry 1 = B_tool_group, got %q", turn.Entries[1].Type)
	}
	if len(turn.Entries[1].Tools) != 2 {
		t.Errorf("expected 2 tools in group, got %d", len(turn.Entries[1].Tools))
	}
	if turn.Entries[2].Type != "A_result" {
		t.Errorf("expected entry 2 = A_result, got %q", turn.Entries[2].Type)
	}
}

func TestBuildTurn_MultipleTurns(t *testing.T) {
	s := &Session{}

	s.applyEvent(&HookEvent{Event: "UserPromptSubmit", TimestampMs: 1000, Payload: makePayload(map[string]interface{}{"prompt": "first"})}, EventUserPrompt)
	s.applyEvent(&HookEvent{Event: "AssistantText", TimestampMs: 1500, Payload: makePayload(map[string]interface{}{"type": "A_result", "text": "first response"})}, EventAssistantText)

	s.applyEvent(&HookEvent{Event: "UserPromptSubmit", TimestampMs: 2000, Payload: makePayload(map[string]interface{}{"prompt": "second"})}, EventUserPrompt)
	s.applyEvent(&HookEvent{Event: "AssistantText", TimestampMs: 2500, Payload: makePayload(map[string]interface{}{"type": "A_result", "text": "second response"})}, EventAssistantText)

	if len(s.Turns) != 2 {
		t.Fatalf("expected 2 turns, got %d", len(s.Turns))
	}
	if s.Turns[0].TurnIdx != 0 || s.Turns[0].UserInput != "first" {
		t.Errorf("turn 0 incorrect")
	}
	if s.Turns[1].TurnIdx != 1 || s.Turns[1].UserInput != "second" {
		t.Errorf("turn 1 incorrect")
	}
	if s.TurnCount != 2 {
		t.Errorf("expected TurnCount 2, got %d", s.TurnCount)
	}
}

func TestBuildTurn_SessionEndAddsResult(t *testing.T) {
	sm := &SessionManager{
		sessions: make(map[string]*Session),
		userID:   "u1",
		deviceID: "d1",
	}
	key := ComputeSessionKey("u1", "d1", "opencode", "sid1")
	s := &Session{
		UserID:         "u1",
		DeviceID:       "d1",
		AgentType:      "opencode",
		AgentSessionID: "sid1",
		SessionKey:     key,
		Turns: []Turn{
			{TurnIdx: 0, UserInput: "test", UserTS: 1000, Entries: []TurnEntry{}},
		},
	}
	sm.sessions[key] = s

	ev := &HookEvent{
		Event:       "Stop",
		AgentType:   "opencode",
		SessionID:   "sid1",
		TimestampMs: 5000,
		Payload:     makePayload(map[string]interface{}{"model_output": "final output text"}),
	}
	sm.HandleEvent(ev)

	if len(s.Turns) != 1 {
		t.Fatalf("expected 1 turn, got %d", len(s.Turns))
	}
	lastEntry := s.Turns[0].Entries[len(s.Turns[0].Entries)-1]
	if lastEntry.Type != "A_result" {
		t.Errorf("expected final A_result from session_end, got %q", lastEntry.Type)
	}
	if lastEntry.Text != "final output text" {
		t.Errorf("expected final output text, got %q", lastEntry.Text)
	}
}

func TestComputeDelta_Turns(t *testing.T) {
	sm := &SessionManager{}
	old := &Session{Turns: []Turn{{TurnIdx: 0, UserInput: "a", Entries: []TurnEntry{}}}}
	new := &Session{Turns: []Turn{{TurnIdx: 0, UserInput: "a", Entries: []TurnEntry{{Type: "A_result", Text: "resp", TS: 100}}}}}

	delta := sm.computeDelta(old, new)
	if delta == nil {
		t.Fatal("expected non-nil delta")
	}
	if _, ok := delta.Changes["turns"]; !ok {
		t.Error("expected turns in delta changes")
	}
}

func TestComputeDelta_TurnsNoChange(t *testing.T) {
	sm := &SessionManager{}
	turns := []Turn{{TurnIdx: 0, UserInput: "a", Entries: []TurnEntry{}}}
	old := &Session{SessionKey: "k1", Turns: turns}
	new := &Session{SessionKey: "k1", Turns: turns}

	delta := sm.computeDelta(old, new)
	if delta != nil {
		t.Error("expected nil delta when turns unchanged")
	}
}

func TestTurnsEqual(t *testing.T) {
	a := []Turn{{TurnIdx: 0, UserInput: "hi", UserTS: 100, Entries: []TurnEntry{}}}
	b := []Turn{{TurnIdx: 0, UserInput: "hi", UserTS: 100, Entries: []TurnEntry{}}}
	if !turnsEqual(a, b) {
		t.Error("expected equal turns")
	}
}

func TestTurnsEqual_Different(t *testing.T) {
	a := []Turn{{TurnIdx: 0, UserInput: "hi", Entries: []TurnEntry{}}}
	b := []Turn{{TurnIdx: 0, UserInput: "bye", Entries: []TurnEntry{}}}
	if turnsEqual(a, b) {
		t.Error("expected different turns")
	}
}

func TestTurnsEqual_DifferentLength(t *testing.T) {
	a := []Turn{{TurnIdx: 0}}
	b := []Turn{{TurnIdx: 0}, {TurnIdx: 1}}
	if turnsEqual(a, b) {
		t.Error("expected different length turns to not be equal")
	}
}

func TestTurnsEqual_DifferentEntries(t *testing.T) {
	a := []Turn{{TurnIdx: 0, Entries: []TurnEntry{{Type: "A_thinking", Text: "x"}}}}
	b := []Turn{{TurnIdx: 0, Entries: []TurnEntry{{Type: "A_thinking", Text: "y"}}}}
	if turnsEqual(a, b) {
		t.Error("expected different entries to not be equal")
	}
}

func TestExtractStringField(t *testing.T) {
	payload := makePayload(map[string]interface{}{"foo": "bar", "baz": "qux"})
	if v := extractStringField(payload, "foo"); v != "bar" {
		t.Errorf("expected bar, got %q", v)
	}
	if v := extractStringField(payload, "nonexistent"); v != "" {
		t.Errorf("expected empty, got %q", v)
	}
}

func TestExtractToolInput(t *testing.T) {
	payload := makePayload(map[string]interface{}{
		"tool_input": map[string]interface{}{"command": "ls -la"},
	})
	if v := extractToolInput(payload); v != "ls -la" {
		t.Errorf("expected 'ls -la', got %q", v)
	}

	payload2 := makePayload(map[string]interface{}{
		"tool_input": map[string]interface{}{"filePath": "/foo/bar.go"},
	})
	if v := extractToolInput(payload2); v != "/foo/bar.go" {
		t.Errorf("expected '/foo/bar.go', got %q", v)
	}
}

func TestExtractToolOutput(t *testing.T) {
	payload := makePayload(map[string]interface{}{"tool_output": "done"})
	if v := extractToolOutput(payload); v != "done" {
		t.Errorf("expected 'done', got %q", v)
	}
}

// ── SQLite turns round-trip ──

func TestStoreTurnsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")

	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	sess := &Session{
		UserID:         "u1",
		DeviceID:       "d1",
		AgentType:      "opencode",
		AgentSessionID: "sid1",
		SessionKey:     "key1",
		Status:         StatusActive,
		StartTimeMs:    1000,
		Turns: []Turn{
			{
				TurnIdx:   0,
				UserInput: "hello",
				UserTS:    1000,
				Entries: []TurnEntry{
					{Type: "A_thinking", Text: "thinking...", TS: 1100},
					{Type: "B_tool_group", Tools: []ToolCall{
						{Name: "Read", Input: "/f.go", Output: "content", Status: "completed", StartTS: 1200, EndTS: 1300},
					}, StartTS: 1200},
					{Type: "A_result", Text: "response", TS: 1400},
				},
			},
		},
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
		t.Fatalf("expected 1 turn after reload, got %d", len(loaded.Turns))
	}
	turn := loaded.Turns[0]
	if turn.UserInput != "hello" {
		t.Errorf("expected user_input 'hello', got %q", turn.UserInput)
	}
	if len(turn.Entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(turn.Entries))
	}
	if turn.Entries[0].Type != "A_thinking" {
		t.Errorf("expected A_thinking, got %q", turn.Entries[0].Type)
	}
	if turn.Entries[1].Type != "B_tool_group" {
		t.Errorf("expected B_tool_group, got %q", turn.Entries[1].Type)
	}
	if len(turn.Entries[1].Tools) != 1 {
		t.Errorf("expected 1 tool, got %d", len(turn.Entries[1].Tools))
	}
	tc := turn.Entries[1].Tools[0]
	if tc.Name != "Read" || tc.Input != "/f.go" || tc.Output != "content" || tc.Status != "completed" {
		t.Errorf("tool data mismatch: %+v", tc)
	}
	if turn.Entries[2].Type != "A_result" {
		t.Errorf("expected A_result, got %q", turn.Entries[2].Type)
	}
}

func TestStoreEmptyTurns(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")

	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	sess := &Session{
		UserID:         "u1",
		DeviceID:       "d1",
		AgentType:      "opencode",
		AgentSessionID: "sid1",
		SessionKey:     "key1",
		Status:         StatusActive,
		StartTimeMs:    1000,
		Turns:          nil,
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
	if len(sessions[0].Turns) != 0 {
		t.Errorf("expected 0 turns for nil Turns, got %d", len(sessions[0].Turns))
	}
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}
