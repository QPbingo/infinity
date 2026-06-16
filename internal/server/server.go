// Package server provides the HTTP and WebSocket API for the agent-monitor daemon.
//
// The server exposes:
//
//	GET /                  – Dashboard HTML page (no auth required)
//	GET /health            – Health check with version + session count (auth required)
//	GET /api/sessions      – List all sessions as JSON (auth required)
//	GET /api/sessions/{key} – Get a single session by SessionKey (auth required)
//	GET /ws                – WebSocket upgrade for real-time dashboard updates
//
// HTTP authentication uses the X-Daemon-Token header with constant-time comparison
// to prevent timing attacks.
//
// WebSocket authentication uses the first client message:
//
//	{"type":"auth","token":"<token>"}
//
// On successful auth, the client receives:
//
//	1. {"type":"auth_ok"} – authentication confirmation
//	2. {"type":"snapshot","sessions":[...],"gen_time_ms":...} – full state
//	3. {"type":"delta",...} – incremental updates as sessions change
//
// The server maintains a WebSocket Hub that manages client connections and
// broadcasts session updates to all connected dashboards.
//
// Architecture:
//
//	HTTP Server (goroutine)
//	  ├── ServeMux → Handlers
//	  │     ├── /              → serveDashboard (no auth)
//	  │     ├── /health        → authMiddleware → handleHealth
//	  │     ├── /api/sessions  → authMiddleware → handleListSessions
//	  │     ├── /api/sessions/{key} → authMiddleware → handleGetSession
//	  │     └── /ws            → WSHub.HandleWS (WebSocket upgrade)
//	  │
//	  WebSocket Hub (goroutine)
//	    └── Register/Unregister/Broadcast event loop
//	          ├── Register client → add to clients map
//	          ├── Unregister client → remove + close send channel
//	          └── Broadcast → send to all clients
//	                │
//	                ├── Client readPump (goroutine per client)
//	                │     Auth → read ping/pong
//	                │
//	                └── Client writePump (goroutine per client)
//	                      Send messages + heartbeat pings
package server

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/heybox/agent-monitor/internal/auth"
	"github.com/heybox/agent-monitor/internal/hierarchy"
	"github.com/heybox/agent-monitor/internal/session"
)

// Server wraps the HTTP server and WebSocket Hub.
//
// Lifecycle:
//  1. New()     – creates the server, hub, and route handlers.
//  2. Start()   – launches hub and HTTP listener goroutines.
//  3. Shutdown() – gracefully stops the HTTP server with a 5s timeout.
type Server struct {
	addr    string
	httpSrv *http.Server
	hub     *WSHub
}

// New creates a new server with all routes registered.
//
// Parameters:
//   - addr:     HTTP listen address (e.g. "127.0.0.1:9101").
//   - sessions: SessionManager instance (shared with EventWatcher and PID Scanner).
//   - token:    Daemon auth token for API authentication.
//
// Routes are registered immediately on the ServeMux. The server doesn't
// start listening until Start() is called.
func New(addr string, sessions *session.SessionManager, token string, authStore *auth.Store, hierStore *hierarchy.Store) *Server {
	// Create the WebSocket Hub (manages all connected dashboard clients)
	hub := NewWSHub(token, sessions, hierStore, authStore)

	// Create HTTP route handlers
	handlers := NewHandlers(sessions, token, hub, authStore, hierStore)

	// Register all routes on the ServeMux
	mux := http.NewServeMux()
	handlers.Register(mux)

	return &Server{
		addr: addr,
		httpSrv: &http.Server{
			Addr:    addr,
			Handler: mux,
		},
		hub: hub,
	}
}

// Start launches the server's background goroutines.
//
// Starts two goroutines:
//  1. go hub.Run() – WebSocket Hub event loop (register/unregister/broadcast).
//  2. go ListenAndServe() – HTTP listener that blocks until shutdown.
//
// The HTTP goroutine calls log.Fatalf if it encounters an error other than
// http.ErrServerClosed (which is expected during shutdown).
//
// Returns nil immediately – the goroutines run in the background.
// Errors from ListenAndServe are only reported after the server is running.
func (s *Server) Start() error {
	// Start the WebSocket Hub event loop (blocking select on channels)
	go s.hub.Run()

	// Start the HTTP listener (blocks indefinitely)
	go func() {
		log.Printf("[server] listening on %s", s.addr)
		if err := s.httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[server] listen: %v", err)
		}
	}()

	return nil
}

// GetHub returns the WebSocket Hub for wiring SessionManager notifications.
//
// Used in main.go to bridge SessionManager to WebSocket broadcasts:
//
//	mgr.SetNotify(func(eventType string, data interface{}) {
//	    srv.GetHub().Notify(eventType, data)
//	})
func (s *Server) GetHub() *WSHub {
	return s.hub
}

// Shutdown gracefully stops the HTTP server.
//
// Uses http.Server.Shutdown() with a 5-second timeout:
//   - Stops accepting new connections.
//   - Waits for existing requests to complete (up to 5 seconds).
//   - Returns when all connections are drained or timeout expires.
//
// After Shutdown returns, the defers in main() execute to clean up
// the PID Scanner, EventWatcher, and SQLite store.
func (s *Server) Shutdown() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.httpSrv.Shutdown(ctx); err != nil {
		log.Printf("[server] shutdown: %v", err)
	}
}

// WaitForSignal blocks the calling goroutine until SIGINT or SIGTERM is received.
//
// Called in main() after all components are started. The main goroutine
// blocks here, allowing all background goroutines to run.
//
// When a signal is received, control returns to main() which calls srv.Shutdown()
// and then executes the deferred cleanup functions.
func WaitForSignal() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	fmt.Fprintf(os.Stderr, "\nReceived signal: %v, shutting down...\n", sig)
}
