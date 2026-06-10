package scanner

import (
	"crypto/sha256"
	"encoding/hex"
	"log"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/process"
)

type Scanner struct {
	updater  SessionUpdater
	interval time.Duration
	detector *TerminalDetector
	stopCh   chan struct{}
}

func NewScanner(updater SessionUpdater, interval time.Duration) *Scanner {
	return &Scanner{
		updater:  updater,
		interval: interval,
		detector: NewTerminalDetector(),
		stopCh:   make(chan struct{}),
	}
}

func (s *Scanner) Start() {
	go s.loop()
}

func (s *Scanner) Stop() {
	close(s.stopCh)
}

func (s *Scanner) loop() {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			s.scan()
		}
	}
}

func (s *Scanner) scan() {
	// Collect all running sessions with known PIDs
	knownPIDs := s.updater.GetKnownPIDs()

	procs, err := process.Processes()
	if err != nil {
		log.Printf("[scanner] get processes: %v", err)
		return
	}

	seenPIDs := make(map[int32]bool)
	agentProcs := s.collectAgentProcesses(procs)

	log.Printf("[scanner] found %d agent processes, tracking %d sessions", len(agentProcs), len(knownPIDs))

	for pid, info := range agentProcs {
		seenPIDs[int32(pid)] = true

		key, isKnown := knownPIDs[pid]
		if isKnown {
			s.updater.HandlePidUpdate(key.SessionKey, info)
			continue
		}

		for _, known := range knownPIDs {
			if strings.EqualFold(known.AgentType, info.MatchedType) && known.CWD == info.CWD && known.CWD != "" {
				s.updater.HandlePidUpdate(known.SessionKey, info)
				break
			}
		}
	}

	for pid, known := range knownPIDs {
		if seenPIDs[int32(pid)] {
			continue
		}
		found := false
		for _, agentInfo := range agentProcs {
			if strings.EqualFold(known.AgentType, agentInfo.MatchedType) && known.CWD != "" && known.CWD == agentInfo.CWD {
				s.updater.HandlePidUpdate(known.SessionKey, agentInfo)
				found = true
				break
			}
		}
		if !found {
			s.updater.MarkDisappeared(known.SessionKey)
		}
	}

	s.updater.CheckIdleSessions()
}

func (s *Scanner) collectAgentProcesses(procs []*process.Process) map[int]*ProcessInfo {
	result := make(map[int]*ProcessInfo)
	for _, p := range procs {
		name, err := p.Name()
		if err != nil {
			continue
		}

		agentType := matchAgentProcess(name, p)
		if agentType == "" {
			continue
		}

		info := collectProcessInfo(p, s.detector)
		if info != nil {
			info.MatchedType = agentType
			result[int(p.Pid)] = info
		}
	}
	return result
}

// matchAgentProcess checks if a process belongs to a known AI agent.
// Matches exact binary names (opencode/claude/codex) and node processes
// with agent-specific command-line patterns.
func matchAgentProcess(name string, p *process.Process) string {
	nameLower := strings.ToLower(name)

	if nameLower == "opencode" {
		return "opencode"
	}
	if nameLower == "claude" {
		return "claude"
	}
	if nameLower == "codex" || strings.Contains(nameLower, "codex") {
		return "codex"
	}

	if nameLower == "node" {
		cmdline, err := p.Cmdline()
		if err != nil {
			return ""
		}
		cmdLower := strings.ToLower(cmdline)
		if strings.Contains(cmdLower, "@anthropic-ai/claude-code") {
			return "claude"
		}
		if strings.Contains(cmdLower, "opencode") {
			return "opencode"
		}
		if strings.Contains(cmdLower, "codex") {
			return "codex"
		}
	}

	return ""
}

func collectProcessInfo(p *process.Process, detector *TerminalDetector) *ProcessInfo {
	cwd, err := p.Cwd()
	if err != nil {
		cwd = ""
	}

	var memoryMB, cpuPercent float64
	memInfo, err := p.MemoryInfo()
	if err == nil {
		memoryMB = float64(memInfo.RSS) / (1024 * 1024)
	}
	cpu, err := p.CPUPercent()
	if err == nil {
		cpuPercent = cpu
	}

	createTimeMs := int64(0)
	ct, err := p.CreateTime()
	if err == nil {
		createTimeMs = ct
	}

	terminal := ""
	if detector != nil {
		terminal = detector.Detect(p.Pid)
	}

	return &ProcessInfo{
		PID:          p.Pid,
		Name:         terminal,
		CWD:          cwd,
		MemoryMB:     memoryMB,
		CPUPercent:   cpuPercent,
		CreateTimeMs: createTimeMs,
	}
}

func FindProcessBySession(agentType, agentSessionID, cwdHash string) *ProcessInfo {
	procs, err := process.Processes()
	if err != nil {
		return nil
	}

	for _, p := range procs {
		name, err := p.Name()
		if err != nil {
			continue
		}

		detectedType := matchAgentProcess(name, p)
		if detectedType != agentType {
			continue
		}

		cwd, err := p.Cwd()
		if err != nil {
			continue
		}

		if cwdHash != "" {
			h := sha256.Sum256([]byte(cwd))
			procCwdHash := hex.EncodeToString(h[:8])
			if procCwdHash != cwdHash {
				continue
			}
		}

		memInfo, _ := p.MemoryInfo()
		var memMB float64
		if memInfo != nil {
			memMB = float64(memInfo.RSS) / (1024 * 1024)
		}

		cpu, _ := p.CPUPercent()

		createTimeMs := int64(0)
		ct, _ := p.CreateTime()
		createTimeMs = ct

		return &ProcessInfo{
			PID:          p.Pid,
			Name:         name,
			CWD:          cwd,
			MemoryMB:     memMB,
			CPUPercent:   cpu,
			CreateTimeMs: createTimeMs,
		}
	}

	return nil
}
