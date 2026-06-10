// Package scanner implements PID scanning and terminal detection.
// Scanner periodically discovers agent processes via gopsutil, matches them
// to known sessions, updates resource metrics, and detects process death.
package scanner

type ProcessInfo struct {
	PID          int32
	PPID         int32
	Name         string
	CWD          string
	MemoryMB     float64
	CPUPercent   float64
	CreateTimeMs int64
	MatchedType  string
}

type SessionPIDInfo struct {
	SessionKey string
	PID        int
	AgentType  string
	CWD        string
}

type SessionUpdater interface {
	HandlePidUpdate(key string, info *ProcessInfo)
	MarkDisappeared(key string)
	CheckIdleSessions()
	GetKnownPIDs() map[int]SessionPIDInfo
}
