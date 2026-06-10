// Package hook implements the file-based event ingestion pipeline.
// EventWatcher uses fsnotify to monitor events.jsonl, parses each JSON line,
// validates the daemon token, and forwards valid events to SessionManager.
// Consumption offset is persisted in events.offset for crash recovery.
package hook

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/fsnotify/fsnotify"
	"github.com/heybox/agent-monitor/internal/session"
	"github.com/heybox/agent-monitor/internal/token"
)

type EventHandler interface {
	HandleEvent(event *session.HookEvent)
}

type EventWatcher struct {
	dir         string
	filePath    string
	offsetPath  string
	tokenValue  string
	handler     EventHandler
	watcher     *fsnotify.Watcher
	lastPos     int64
	done        chan struct{}
}

func NewEventWatcher(dir string, tokenValue string, handler EventHandler) (*EventWatcher, error) {
	filePath := filepath.Join(dir, "events.jsonl")

	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("create monitor dir: %w", err)
	}

	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_RDONLY, 0600)
	if err != nil {
		return nil, fmt.Errorf("open events.jsonl: %w", err)
	}
	f.Close()

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("create fsnotify watcher: %w", err)
	}

	return &EventWatcher{
		dir:        dir,
		filePath:   filePath,
		offsetPath: filepath.Join(dir, "events.offset"),
		tokenValue: tokenValue,
		handler:    handler,
		watcher:    w,
		done:       make(chan struct{}),
	}, nil
}

func (ew *EventWatcher) Start() error {
	if err := ew.watcher.Add(ew.filePath); err != nil {
		return fmt.Errorf("watch events.jsonl: %w", err)
	}

	ew.lastPos = ew.readOffset()
	if ew.lastPos < 0 {
		fi, err := os.Stat(ew.filePath)
		if err != nil {
			return fmt.Errorf("stat events.jsonl: %w", err)
		}
		ew.lastPos = fi.Size()
	}

	ew.handleNewLines()

	go ew.loop()
	return nil
}

func (ew *EventWatcher) Stop() {
	close(ew.done)
	ew.watcher.Close()
}

func (ew *EventWatcher) loop() {
	for {
		select {
		case <-ew.done:
			return
		case event, ok := <-ew.watcher.Events:
			if !ok {
				return
			}
			switch {
			case event.Has(fsnotify.Write):
				ew.handleNewLines()
			case event.Has(fsnotify.Create):
				ew.watcher.Remove(ew.filePath)
				ew.watcher.Add(ew.filePath)
				ew.lastPos = 0
				log.Printf("[eventwatcher] events.jsonl recreated, reset offset to 0")
			}
		case err, ok := <-ew.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("[eventwatcher] fsnotify error: %v", err)
		}
	}
}

func (ew *EventWatcher) handleNewLines() {
	f, err := os.Open(ew.filePath)
	if err != nil {
		log.Printf("[eventwatcher] open events.jsonl: %v", err)
		return
	}
	defer f.Close()

	if _, err := f.Seek(ew.lastPos, io.SeekStart); err != nil {
		log.Printf("[eventwatcher] seek to %d: %v", ew.lastPos, err)
		return
	}

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 2*1024*1024), 2*1024*1024)

	byteOffset := ew.lastPos
	for scanner.Scan() {
		line := scanner.Text()
		byteOffset += int64(len(scanner.Bytes()) + 1)

		if line == "" {
			continue
		}

		var hookEvent session.HookEvent
		if err := json.Unmarshal([]byte(line), &hookEvent); err != nil {
			log.Printf("[eventwatcher] parse JSON: %v", err)
			ew.saveOffset(byteOffset)
			continue
		}

		if hookEvent.DaemonToken == "" || !token.ConstantTimeCompare(hookEvent.DaemonToken, ew.tokenValue) {
			log.Printf("[eventwatcher] invalid token for event %s, dropped", hookEvent.Event)
			ew.saveOffset(byteOffset)
			continue
		}

		ew.handler.HandleEvent(&hookEvent)
		ew.saveOffset(byteOffset)
	}

	if scanner.Err() != nil {
		log.Printf("[eventwatcher] scan error: %v", scanner.Err())
		return
	}

	ew.lastPos = byteOffset
	ew.saveOffset(ew.lastPos)
}

func (ew *EventWatcher) readOffset() int64 {
	data, err := os.ReadFile(ew.offsetPath)
	if err != nil {
		return -1
	}
	offset, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	if err != nil {
		return -1
	}
	return offset
}

func (ew *EventWatcher) saveOffset(offset int64) {
	ew.lastPos = offset
	data := []byte(strconv.FormatInt(offset, 10))
	if err := os.WriteFile(ew.offsetPath, data, 0600); err != nil {
		log.Printf("[eventwatcher] write offset: %v", err)
	}
}
