package scanner

import (
	"strings"

	"github.com/shirou/gopsutil/v3/process"
)

var TerminalWhitelist = map[string]bool{
	"ghostty":      true,
	"iterm2":        true,
	"terminal":     true,
	"warp":         true,
	"kitty":        true,
	"alacritty":    true,
	"wezterm-gui":  true,
	"code":         true,
	"cursor":       true,
	"hyper":        true,
}

type TerminalDetector struct{}

func NewTerminalDetector() *TerminalDetector {
	return &TerminalDetector{}
}

func (td *TerminalDetector) Detect(agentPID int32) string {
	if agentPID <= 1 {
		return "Unknown"
	}

	currentPID := agentPID
	for i := 0; i < 10; i++ {
		proc, err := process.NewProcess(currentPID)
		if err != nil {
			return "Unknown"
		}

		ppid, err := proc.Ppid()
		if err != nil || ppid <= 1 {
			return "Unknown"
		}

		parentProc, err := process.NewProcess(ppid)
		if err != nil {
			return "Unknown"
		}

		parentName, err := parentProc.Name()
		if err != nil {
			return "Unknown"
		}

		parentNameLower := strings.ToLower(parentName)
		if TerminalWhitelist[parentNameLower] {
			return parentName
		}

		currentPID = ppid
	}

	return "Unknown"
}
