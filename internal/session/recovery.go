// Recovery implements session recovery from agent transcript files.
// On daemon startup, scans transcript JSONL files (last 24h) to restore sessions
// that may have been active while the daemon was offline.
package session

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/heybox/agent-monitor/internal/scanner"
)

type Recovery struct {
	userID   string
	deviceID string
	manager  *SessionManager
}

func NewRecovery(userID, deviceID string, manager *SessionManager) *Recovery {
	return &Recovery{
		userID:   userID,
		deviceID: deviceID,
		manager:  manager,
	}
}

func (r *Recovery) Run() {
	now := time.Now()
	cutoff := now.Add(-24 * time.Hour)

	candidates := r.scanAllTranscripts(cutoff)

	for _, c := range candidates {
		key := ComputeSessionKey(r.userID, r.deviceID, c.AgentType, c.AgentSessionID)
		if r.manager.HasSession(key) {
			continue
		}

		sess := &Session{
			UserID:         r.userID,
			DeviceID:       r.deviceID,
			AgentType:      c.AgentType,
			AgentSessionID: c.AgentSessionID,
			SessionKey:     key,
			Status:         StatusUnknown,
			StartTimeMs:    c.StartTimeMs,
			LastEventTimeMs: c.StartTimeMs,
			LastEventType:  c.LastEventType,
			LastFile:       c.LastFile,
			LastCommand:    c.LastCommand,
			TurnCount:      c.TurnCount,
			GitBranch:      c.GitBranch,
			CWD:            c.CWD,
			PID:            c.PID,
			Terminal:       c.Terminal,
			lastHookTime:   c.StartTimeMs,
		}

		r.manager.AddRecoveredSession(sess)

		if c.AgentSessionID != "" {
			info := scanner.FindProcessBySession(c.AgentType, c.AgentSessionID, c.CWDHash)
			if info != nil {
				r.manager.BindPIDToSession(key, info)
				log.Printf("[recovery] matched session %s with running PID %d (%s)", key, info.PID, info.Name)
			}
		}
	}

	log.Printf("[recovery] recovered %d sessions from transcript files", len(candidates))
}

func (r *Recovery) scanAllTranscripts(cutoff time.Time) []RecoveryCandidate {
	var candidates []RecoveryCandidate

	candidates = append(candidates, r.scanOpenCodeTranscripts(cutoff)...)
	candidates = append(candidates, r.scanClaudeTranscripts(cutoff)...)
	candidates = append(candidates, r.scanCodexTranscripts(cutoff)...)

	return candidates
}

func (r *Recovery) scanOpenCodeTranscripts(cutoff time.Time) []RecoveryCandidate {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil
	}

	dir := filepath.Join(homeDir, ".config", "opencode", "sessions")
	return r.scanTranscriptDir(dir, "opencode", cutoff)
}

func (r *Recovery) scanClaudeTranscripts(cutoff time.Time) []RecoveryCandidate {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil
	}

	var candidates []RecoveryCandidate
	projectsDir := filepath.Join(homeDir, ".claude", "projects")
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		return candidates
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		projectDir := filepath.Join(projectsDir, entry.Name())
		filepath.Walk(projectDir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}
			if !strings.HasSuffix(info.Name(), ".jsonl") {
				return nil
			}
			cands := r.scanTranscriptFile(path, "codex", cutoff)
			candidates = append(candidates, cands...)
			return nil
		})
	}

	return candidates
}

func (r *Recovery) scanCodexTranscripts(cutoff time.Time) []RecoveryCandidate {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil
	}

	var candidates []RecoveryCandidate
	codexDir := filepath.Join(homeDir, ".codex", "sessions")
	filepath.Walk(codexDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if !strings.HasPrefix(info.Name(), "rollout-") || !strings.HasSuffix(info.Name(), ".jsonl") {
			return nil
		}
		cands := r.scanTranscriptFile(path, "codex", cutoff)
		candidates = append(candidates, cands...)
		return nil
	})

	return candidates
}

func (r *Recovery) scanTranscriptDir(dir, agentType string, cutoff time.Time) []RecoveryCandidate {
	var candidates []RecoveryCandidate
	entries, err := os.ReadDir(dir)
	if err != nil {
		return candidates
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		cands := r.scanTranscriptFile(path, agentType, cutoff)
		candidates = append(candidates, cands...)
	}

	return candidates
}

func (r *Recovery) scanTranscriptFile(path, agentType string, cutoff time.Time) []RecoveryCandidate {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var candidates []RecoveryCandidate
	seenSessions := make(map[string]bool)
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 2*1024*1024), 2*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var entry map[string]interface{}
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}

		sessionID, _ := entry["session_id"].(string)
		if sessionID == "" {
			sessionID, _ = entry["sessionId"].(string)
		}
		if sessionID == "" || seenSessions[sessionID] {
			continue
		}

		ts := extractTimestamp(entry)
		if ts < cutoff.UnixMilli() {
			continue
		}

		cwd, _ := entry["cwd"].(string)
		cwdHash := ""
		if cwd != "" {
			h := sha256.Sum256([]byte(cwd))
			cwdHash = hex.EncodeToString(h[:8])
		}

		eventType, _ := entry["type"].(string)
		lastFile := extractLastFile(entry)
		lastCommand := extractLastCommand(entry)

		turnCount := 0
		if tc, ok := entry["turn_count"].(float64); ok {
			turnCount = int(tc)
		}

		gitBranch, _ := entry["git_branch"].(string)

		terminal := ""
		pid := 0
		if p, ok := entry["pid"].(float64); ok {
			pid = int(p)
		}

		candidates = append(candidates, RecoveryCandidate{
			AgentType:      agentType,
			AgentSessionID: sessionID,
			CWDHash:        cwdHash,
			StartTimeMs:    ts,
			LastEventType:  eventType,
			LastFile:       lastFile,
			LastCommand:    lastCommand,
			TurnCount:      turnCount,
			GitBranch:      gitBranch,
			Terminal:       terminal,
			PID:            pid,
			CWD:            cwd,
			TranscriptPath: path,
		})

		seenSessions[sessionID] = true
	}

	return candidates
}

func extractTimestamp(entry map[string]interface{}) int64 {
	fields := []string{"timestamp_ms", "timestampMs", "ts", "timestamp", "start_time_ms", "time"}
	for _, f := range fields {
		switch v := entry[f].(type) {
		case float64:
			ts := int64(v)
			if ts > 1e15 {
				ts /= 1000
			}
			return ts
		case string:
			var ts int64
			fmt.Sscanf(v, "%d", &ts)
			if ts > 0 {
				if ts > 1e15 {
					ts /= 1000
				}
				return ts
			}
		}
	}
	return 0
}

func extractLastFile(entry map[string]interface{}) string {
	fields := []string{"filePath", "file_path", "file", "last_file"}
	for _, f := range fields {
		if v, ok := entry[f].(string); ok {
			return v
		}
	}
	if input, ok := entry["input"].(map[string]interface{}); ok {
		if fp, ok := input["filePath"].(string); ok {
			return fp
		}
		if fp, ok := input["file_path"].(string); ok {
			return fp
		}
	}
	return ""
}

func extractLastCommand(entry map[string]interface{}) string {
	fields := []string{"tool", "tool_name", "command", "last_command", "type"}
	for _, f := range fields {
		if v, ok := entry[f].(string); ok {
			return v
		}
	}
	return ""
}
