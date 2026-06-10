// agent-monitor-hook is called by each agent's hook system to record events.
// It reads the agent's hook payload from stdin, auto-detects session_id and
// event type, appends a JSON line to events.jsonl under a file lock.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

type hookOutput struct {
	Event       string          `json:"event"`
	AgentType   string          `json:"agent_type"`
	SessionID   string          `json:"session_id"`
	DaemonToken string          `json:"daemon_token"`
	PID         int             `json:"pid"`
	CWD         string          `json:"cwd"`
	TimestampMs int64           `json:"timestamp_ms"`
	Payload     json.RawMessage `json:"payload"`
}

func main() {
	agentType := flag.String("agent-type", "", "Agent type (opencode/codex/claude)")
	sessionID := flag.String("session-id", "", "Agent session ID (auto-detected from stdin if not set)")
	event := flag.String("event", "", "Event name (auto-detected from stdin if not set)")
	daemonToken := flag.String("daemon-token", "", "Daemon token (auto-read from ~/.agent-monitor/local-token if not set)")
	flag.Parse()

	if *agentType == "" {
		fmt.Fprintf(os.Stderr, "agent-monitor-hook: --agent-type is required\n")
		os.Exit(1)
	}

	payload, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintf(os.Stderr, "agent-monitor-hook: read stdin: %v\n", err)
		os.Exit(1)
	}
	if len(payload) == 0 {
		payload = []byte("{}")
	}

	if !json.Valid(payload) {
		fmt.Fprintf(os.Stderr, "agent-monitor-hook: stdin is not valid JSON, using raw text\n")
		payload = json.RawMessage(fmt.Sprintf(`{"raw": %q}`, string(payload)))
	}

	extracted := extractFromStdin(payload)

	finalSessionID := *sessionID
	if finalSessionID == "" {
		finalSessionID = extracted.sessionID
	}
	finalEvent := *event
	if finalEvent == "" {
		finalEvent = extracted.event
	}
	finalToken := *daemonToken
	if finalToken == "" {
		finalToken = readToken()
	}

	if finalSessionID == "" {
		fmt.Fprintf(os.Stderr, "agent-monitor-hook: session-id not provided and not found in stdin\n")
		os.Exit(1)
	}
	if finalEvent == "" {
		fmt.Fprintf(os.Stderr, "agent-monitor-hook: event not provided and not found in stdin\n")
		os.Exit(1)
	}
	if finalToken == "" {
		fmt.Fprintf(os.Stderr, "agent-monitor-hook: daemon-token not provided and local-token not found\n")
		os.Exit(1)
	}

	pid := os.Getppid()

	cwd, err := os.Getwd()
	if err != nil {
		cwd = ""
	}

	output := hookOutput{
		Event:       finalEvent,
		AgentType:   *agentType,
		SessionID:   finalSessionID,
		DaemonToken: finalToken,
		PID:         pid,
		CWD:         cwd,
		TimestampMs: time.Now().UnixMilli(),
		Payload:     json.RawMessage(payload),
	}

	line, err := json.Marshal(output)
	if err != nil {
		fmt.Fprintf(os.Stderr, "agent-monitor-hook: marshal JSON: %v\n", err)
		os.Exit(1)
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "agent-monitor-hook: get home dir: %v\n", err)
		os.Exit(1)
	}

	eventsPath := filepath.Join(homeDir, ".agent-monitor", "events.jsonl")
	if err := os.MkdirAll(filepath.Dir(eventsPath), 0700); err != nil {
		fmt.Fprintf(os.Stderr, "agent-monitor-hook: create dir: %v\n", err)
		os.Exit(1)
	}

	f, err := os.OpenFile(eventsPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		fmt.Fprintf(os.Stderr, "agent-monitor-hook: open events.jsonl: %v\n", err)
		os.Exit(1)
	}
	defer f.Close()

	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		fmt.Fprintf(os.Stderr, "agent-monitor-hook: lock file: %v\n", err)
		os.Exit(1)
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)

	if _, err := f.Write(line); err != nil {
		fmt.Fprintf(os.Stderr, "agent-monitor-hook: write: %v\n", err)
		os.Exit(1)
	}
	if _, err := f.Write([]byte("\n")); err != nil {
		fmt.Fprintf(os.Stderr, "agent-monitor-hook: write newline: %v\n", err)
		os.Exit(1)
	}
}

type stdinExtract struct {
	sessionID string
	event     string
}

func extractFromStdin(payload []byte) stdinExtract {
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return stdinExtract{}
	}

	return stdinExtract{
		sessionID: extractString(data, "session_id", "sessionId"),
		event:     extractString(data, "hook_event_name", "hookEventName", "event", "type"),
	}
}

func extractString(data map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if v, ok := data[k].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

func readToken() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(homeDir, ".agent-monitor", "local-token"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
