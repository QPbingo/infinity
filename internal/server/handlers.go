package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/heybox/agent-monitor/internal/session"
	"github.com/heybox/agent-monitor/internal/token"
)

// Handlers implements the HTTP API endpoints for the daemon.
//
// Route table:
//
//	GET /                  → serveDashboard       (no auth)
//	GET /health            → authMiddleware → handleHealth
//	GET /api/sessions      → authMiddleware → handleListSessions
//	GET /api/sessions/{key} → authMiddleware → handleGetSession
//	GET /ws                → hub.HandleWS         (WebSocket, auth via first message)
//
// All API endpoints (except / and /ws) require the X-Daemon-Token header.
// The WebSocket endpoint authenticates via its first message protocol.
type Handlers struct {
	sessions *session.SessionManager // Session data store
	token    string                  // Daemon auth token
	hub      *WSHub                  // WebSocket Hub (for /ws handler)
}

// NewHandlers creates a new Handlers instance.
func NewHandlers(sessions *session.SessionManager, tokenValue string, hub *WSHub) *Handlers {
	return &Handlers{
		sessions: sessions,
		token:    tokenValue,
		hub:      hub,
	}
}

// Register registers all HTTP routes on the given ServeMux.
//
// Uses Go 1.22+ enhanced ServeMux pattern matching:
//   - "GET /" matches only GET requests to /.
//   - "GET /api/sessions/{key}" extracts {key} from the path.
func (h *Handlers) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /", h.serveDashboard)
	mux.HandleFunc("GET /health", h.authMiddleware(h.handleHealth))
	mux.HandleFunc("GET /api/sessions", h.authMiddleware(h.handleListSessions))
	mux.HandleFunc("GET /api/sessions/{key}", h.authMiddleware(h.handleGetSession))
	mux.HandleFunc("GET /api/sessions/{key}/pending-input", h.authMiddleware(h.handlePendingInput))
	mux.HandleFunc("GET /api/poll-input", h.authMiddleware(h.handlePollInput))
	mux.HandleFunc("GET /ws", h.hub.HandleWS)
}

// authMiddleware wraps an HTTP handler with X-Daemon-Token authentication.
//
// Checks the X-Daemon-Token request header. If the token is missing or
// doesn't match the daemon's local token, returns 403 Forbidden with a
// JSON error body.
//
// Uses constant-time comparison to prevent timing side-channel attacks
// that could leak the token value.
func (h *Handlers) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("X-Daemon-Token")
		if authHeader == "" || !token.ConstantTimeCompare(authHeader, h.token) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"error": "forbidden"})
			return
		}
		next(w, r)
	}
}

// handleListSessions returns all tracked sessions as a JSON array.
//
// GET /api/sessions
//
// Response: JSON array of Session objects (each shallow-copied for thread safety).
// Empty array if no sessions are tracked.
func (h *Handlers) handleListSessions(w http.ResponseWriter, r *http.Request) {
	sessions := h.sessions.GetSessions()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

// handleGetSession returns a single session by its SessionKey.
//
// GET /api/sessions/{key}
//
// Response:
//   - 200 OK + Session JSON if found.
//   - 404 Not Found + {"error":"session not found"} if the key doesn't match
//     any tracked session.
func (h *Handlers) handleGetSession(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	sess := h.sessions.GetSession(key)
	if sess == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "session not found"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sess)
}

// handleHealth returns daemon health information.
//
// GET /health
//
// Response:
//
//	{
//	  "version": "1.0.0",
//	  "session_count": 3
//	}
//
// Version is hardcoded. session_count is the number of currently tracked
// sessions (all statuses).
func (h *Handlers) handleHealth(w http.ResponseWriter, r *http.Request) {
	sessions := h.sessions.GetSessions()
	health := map[string]interface{}{
		"version":     "1.0.0",
		"session_count": len(sessions),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(health)
}

// serveDashboard serves the dashboard HTML page.
//
// GET /
//
// Serves web/dashboard.html from the local filesystem. No authentication
// required – the dashboard page itself is public, but all its API calls
// require authentication (token or WebSocket auth).
//
// The dashboard is a single-page application that opens a WebSocket
// connection to /ws for real-time updates.
func (h *Handlers) serveDashboard(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/") || r.URL.Path == "/" {
		http.ServeFile(w, r, "web/dashboard.html")
		return
	}
	http.NotFound(w, r)
}

// handlePendingInput returns and clears the pending web input for a session.
// Polled by the OpenCode plugin to pick up user prompts sent from the dashboard.
//
// GET /api/sessions/{key}/pending-input
func (h *Handlers) handlePendingInput(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	text := h.sessions.GetPendingInput(key)
	if text == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"text": text})
}

// handlePollInput is a simplified polling endpoint for agent plugins.
// Accepts agent_type + agent_session_id as query params, computes the
// session key internally.
//
// GET /api/poll-input?agent_type=opencode&agent_session_id=xxx
func (h *Handlers) handlePollInput(w http.ResponseWriter, r *http.Request) {
	agentType := r.URL.Query().Get("agent_type")
	agentSessionID := r.URL.Query().Get("agent_session_id")
	if agentType == "" || agentSessionID == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	key := session.ComputeSessionKey(h.sessions.UserID(), h.sessions.DeviceID(), agentType, agentSessionID)
	text := h.sessions.GetPendingInput(key)
	if text == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"text": text})
}
