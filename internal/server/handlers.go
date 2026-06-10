package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/heybox/agent-monitor/internal/session"
	"github.com/heybox/agent-monitor/internal/token"
)

type Handlers struct {
	sessions *session.SessionManager
	token    string
	hub      *WSHub
}

func NewHandlers(sessions *session.SessionManager, tokenValue string, hub *WSHub) *Handlers {
	return &Handlers{
		sessions: sessions,
		token:    tokenValue,
		hub:      hub,
	}
}

func (h *Handlers) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /", h.serveDashboard)
	mux.HandleFunc("GET /health", h.authMiddleware(h.handleHealth))
	mux.HandleFunc("GET /api/sessions", h.authMiddleware(h.handleListSessions))
	mux.HandleFunc("GET /api/sessions/{key}", h.authMiddleware(h.handleGetSession))
	mux.HandleFunc("GET /ws", h.hub.HandleWS)
}

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

func (h *Handlers) handleListSessions(w http.ResponseWriter, r *http.Request) {
	sessions := h.sessions.GetSessions()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

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

func (h *Handlers) handleHealth(w http.ResponseWriter, r *http.Request) {
	sessions := h.sessions.GetSessions()
	health := map[string]interface{}{
		"version":     "1.0.0",
		"session_count": len(sessions),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(health)
}

func (h *Handlers) serveDashboard(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/") || r.URL.Path == "/" {
		http.ServeFile(w, r, "web/dashboard.html")
		return
	}
	http.NotFound(w, r)
}
