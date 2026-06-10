// agent-monitor-daemon is the main daemon process.
// It watches hook events from agent-monitor-hook, tracks sessions,
// scans running agent processes, and serves a WebSocket-enabled HTTP API.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/heybox/agent-monitor/internal/hook"
	"github.com/heybox/agent-monitor/internal/scanner"
	"github.com/heybox/agent-monitor/internal/server"
	"github.com/heybox/agent-monitor/internal/session"
	"github.com/heybox/agent-monitor/internal/token"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:9101", "HTTP listen address")
	scanInterval := flag.Int("scan-interval", 15, "PID scan interval in seconds")
	userID := flag.String("user-id", "local", "User identifier")
	flag.Parse()

	homeDir, err := os.UserHomeDir()
	if err != nil {
		log.Fatalf("get home dir: %v", err)
	}

	monitorDir := filepath.Join(homeDir, ".agent-monitor")

	if err := os.MkdirAll(monitorDir, 0700); err != nil {
		log.Fatalf("create monitor dir: %v", err)
	}

	deviceID := readOrCreateDeviceID(monitorDir)
	log.Printf("device-id: %s", deviceID)

	tok := readOrCreateToken(monitorDir)
	log.Printf("daemon token: %s", tok[:8]+"...")

	dbPath := filepath.Join(monitorDir, "daemon.db")
	store, err := session.NewStore(dbPath)
	if err != nil {
		log.Fatalf("init sqlite: %v", err)
	}
	defer store.Close()

	mgr := session.NewSessionManager(store, *userID, deviceID)
	mgr.LoadFromStore()

	recovery := session.NewRecovery(*userID, deviceID, mgr)
	recovery.Run()

	ew, err := hook.NewEventWatcher(monitorDir, tok, mgr)
	if err != nil {
		log.Fatalf("init event watcher: %v", err)
	}
	if err := ew.Start(); err != nil {
		log.Fatalf("start event watcher: %v", err)
	}
	defer ew.Stop()

	scanIntervalDur := time.Duration(*scanInterval) * time.Second
	pidScanner := scanner.NewScanner(mgr, scanIntervalDur)
	pidScanner.Start()
	defer pidScanner.Stop()

	srv := server.New(*listen, mgr, tok)

	mgr.SetNotify(func(eventType string, data interface{}) {
		srv.GetHub().Notify(eventType, data)
	})

	if err := srv.Start(); err != nil {
		log.Fatalf("start server: %v", err)
	}

	log.Printf("agent-monitor-daemon started on %s", *listen)
	log.Printf("Dashboard: http://%s", *listen)

	fmt.Println("[daemon] ready")

	server.WaitForSignal()

	log.Println("shutting down...")
	srv.Shutdown()
}

func readOrCreateDeviceID(dir string) string {
	path := filepath.Join(dir, "device-id")
	data, err := os.ReadFile(path)
	if err == nil && len(data) > 0 {
		return string(data)
	}

	u := make([]byte, 16)
	rand.Read(u)
	u[6] = (u[6] & 0x0f) | 0x40
	u[8] = (u[8] & 0x3f) | 0x80
	id := fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(u[0:4]),
		hex.EncodeToString(u[4:6]),
		hex.EncodeToString(u[6:8]),
		hex.EncodeToString(u[8:10]),
		hex.EncodeToString(u[10:16]),
	)
	os.WriteFile(path, []byte(id), 0600)
	return id
}

func readOrCreateToken(dir string) string {
	tok, err := token.Read(dir)
	if err == nil && tok != "" {
		return tok
	}

	tok, err = token.Generate()
	if err != nil {
		log.Fatalf("generate token: %v", err)
	}
	if err := token.Write(dir, tok); err != nil {
		log.Fatalf("write token: %v", err)
	}
	return tok
}
