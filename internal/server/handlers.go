package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/heybox/agent-monitor/internal/auth"
	"github.com/heybox/agent-monitor/internal/hierarchy"
	"github.com/heybox/agent-monitor/internal/session"
	"github.com/heybox/agent-monitor/sdk"
)

type Handlers struct {
	sessions  *session.SessionManager
	token     string
	sseHub    *SSEHub
	authStore *auth.Store
	hierStore *hierarchy.Store
	agentMgr  *sdk.AgentManager
}

func NewHandlers(s *session.SessionManager, tok string, sse *SSEHub, as *auth.Store, hs *hierarchy.Store, am *sdk.AgentManager) *Handlers {
	return &Handlers{sessions: s, token: tok, sseHub: sse, authStore: as, hierStore: hs, agentMgr: am}
}

// Register wires routes onto mux using a grouped layout with group-level
// auth middleware. This replaces the previous per-route manual wrapping and
// guarantees every web-facing API is authenticated.
//
// Groups:
//   - public:  /api/auth/{register,login}        — no auth
//   - machine: /health, /api/poll-input,
//              /api/sessions/{key}/pending-input — X-Daemon-Token (MachineAuth)
//   - web:     all other /api/* + /api/events/stream — cookie/Bearer (WebAuth)
//
// NOTE: logout is placed in the web group (requires valid token to revoke).
func (h *Handlers) Register(mux *http.ServeMux) {
	// ── Public group: registration & login (no auth) ──
	mux.HandleFunc("POST /api/auth/register", h.handleRegister)
	mux.HandleFunc("POST /api/auth/login", h.handleLogin)

	// ── Machine group: hooks / plugins (X-Daemon-Token) ──
	machine := http.NewServeMux()
	machine.HandleFunc("GET /health", h.handleHealth)
	machine.HandleFunc("GET /api/poll-input", h.handlePollInput)
	machine.HandleFunc("GET /api/sessions/{key}/pending-input", h.handlePendingInput)
	mux.Handle("/health", auth.MachineAuth(h.token)(machine))
	mux.Handle("/api/poll-input", auth.MachineAuth(h.token)(machine))
	mux.Handle("/api/sessions/{key}/pending-input", auth.MachineAuth(h.token)(machine))

	// ── Web group: all user-facing APIs + SSE stream (cookie/Bearer) ──
	web := http.NewServeMux()
	web.HandleFunc("POST /api/auth/logout", h.handleLogout)
	web.HandleFunc("GET /api/auth/me", h.handleMe)
	web.HandleFunc("GET /api/sessions", h.handleListSessions)
	web.HandleFunc("GET /api/sessions/{key}", h.handleGetSession)
	web.HandleFunc("POST /api/sessions/{key}/input", h.handleSendInput)
	web.HandleFunc("GET /api/events/stream", h.sseHub.HandleStream)

	web.HandleFunc("GET /api/hierarchy", h.handleGetHierarchy)
	web.HandleFunc("POST /api/workspaces", h.handleCreateWorkspace)
	web.HandleFunc("PUT /api/workspaces/{id}", h.handleUpdateWorkspace)
	web.HandleFunc("DELETE /api/workspaces/{id}", h.handleDeleteWorkspace)
	web.HandleFunc("GET /api/workspaces/{wid}/projects", h.handleListProjects)
	web.HandleFunc("POST /api/workspaces/{wid}/projects", h.handleCreateProject)
	web.HandleFunc("PUT /api/workspaces/{wid}/projects/{id}", h.handleUpdateProject)
	web.HandleFunc("DELETE /api/workspaces/{wid}/projects/{id}", h.handleDeleteProject)
	web.HandleFunc("GET /api/workspaces/{wid}/projects/{pid}/topics", h.handleListTopics)
	web.HandleFunc("POST /api/workspaces/{wid}/projects/{pid}/topics", h.handleCreateTopic)
	web.HandleFunc("PUT /api/workspaces/{wid}/projects/{pid}/topics/{id}", h.handleUpdateTopic)
	web.HandleFunc("DELETE /api/workspaces/{wid}/projects/{pid}/topics/{id}", h.handleDeleteTopic)
	web.HandleFunc("GET /api/workspaces/{wid}/projects/{pid}/topics/{tid}/stories", h.handleListStories)
	web.HandleFunc("POST /api/workspaces/{wid}/projects/{pid}/topics/{tid}/stories", h.handleCreateStory)
	web.HandleFunc("PUT /api/stories/{id}", h.handleUpdateStory)
	web.HandleFunc("DELETE /api/stories/{id}", h.handleDeleteStory)

	web.HandleFunc("GET /api/permissions/workspace/{id}", h.handleListWorkspacePerms)
	web.HandleFunc("PUT /api/permissions/workspace/{id}", h.handleSetWorkspacePerm)
	web.HandleFunc("DELETE /api/permissions/workspace/{id}/{uid}", h.handleRemoveWorkspacePerm)
	web.HandleFunc("GET /api/permissions/project/{id}", h.handleListProjectPerms)
	web.HandleFunc("PUT /api/permissions/project/{id}", h.handleSetProjectPerm)
	web.HandleFunc("DELETE /api/permissions/project/{id}/{uid}", h.handleRemoveProjectPerm)
	web.HandleFunc("GET /api/users", h.handleListUsers)

	// Agent SDK control
	web.HandleFunc("POST /api/agent/{type}/sessions", h.handleAgentCreateSession)
	web.HandleFunc("GET /api/agent/{type}/sessions", h.handleAgentListSessions)
	web.HandleFunc("POST /api/agent/{type}/sessions/{id}/prompt", h.handleAgentSendPrompt)
	web.HandleFunc("POST /api/agent/{type}/sessions/{id}/cancel", h.handleAgentCancel)
	web.HandleFunc("POST /api/agent/{type}/sessions/{id}/resume", h.handleAgentResume)
	web.HandleFunc("PUT /api/agent/{type}/sessions/{id}/rename", h.handleAgentRename)
	web.HandleFunc("PUT /api/agent/{type}/sessions/{id}/permissions", h.handleAgentSetPermissions)

	mux.Handle("/api/", auth.WebAuth(h.authStore)(web))
}

// ── Permission helpers ──

func (h *Handlers) curUser(w http.ResponseWriter, r *http.Request) *auth.User {
	u := auth.GetUser(r)
	if u == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "auth required"})
	}
	return u
}

func (h *Handlers) checkWSAdmin(w http.ResponseWriter, r *http.Request, wid int64) bool {
	if h.hierStore == nil { return true }
	u := h.curUser(w, r)
	if u == nil { return false }
	ok, _ := h.hierStore.CheckWorkspacePermission(u.ID, wid, hierarchy.LevelWorkspaceAdmin)
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "workspace admin required"})
	}
	return ok
}

func (h *Handlers) checkProjAdmin(w http.ResponseWriter, r *http.Request, pid int64) bool {
	if h.hierStore == nil { return true }
	u := h.curUser(w, r)
	if u == nil { return false }
	ok, _ := h.hierStore.CheckProjectPermission(u.ID, pid, hierarchy.LevelProjectAdmin)
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "project admin required"})
	}
	return ok
}

func (h *Handlers) projWS(pid int64) int64 {
	if p, _ := h.hierStore.GetProject(pid); p != nil { return p.WorkspaceID }; return 0
}
func (h *Handlers) topProj(tid int64) int64 {
	if t, _ := h.hierStore.GetTopic(tid); t != nil { return t.ProjectID }; return 0
}
func (h *Handlers) stoTop(sid int64) int64 {
	if s, _ := h.hierStore.GetStory(sid); s != nil { return s.TopicID }; return 0
}

// ── Auth ──

// isCrossOrigin reports whether the request's Origin header indicates a
// cross-origin caller (different scheme/host/port than the request's Host).
// Used to pick the cookie SameSite/Secure policy: cross-origin production
// needs SameSite=None; Secure, while same-origin dev uses Lax without Secure.
func isCrossOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	// Compare origin host to request host. A simple host match suffices for
	// the local daemon use case (no reverse-proxy host rewriting in dev).
	// Strip scheme from origin for comparison.
	host := r.Host
	originHost := origin
	for _, scheme := range []string{"https://", "http://"} {
		if strings.HasPrefix(originHost, scheme) {
			originHost = originHost[len(scheme):]
			break
		}
	}
	// Drop path/query if present.
	if i := strings.Index(originHost, "/"); i >= 0 {
		originHost = originHost[:i]
	}
	return originHost != host
}

func (h *Handlers) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req struct{ Username, Password string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Username == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username and password required"}); return
	}
	u, err := h.authStore.Register(req.Username, req.Password)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()}); return
	}
	tok, _ := h.authStore.CreateToken(u.ID)
	auth.SetSessionCookie(w, tok, isCrossOrigin(r))
	writeJSON(w, http.StatusOK, map[string]interface{}{"token": tok, "user": u})
}

func (h *Handlers) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct{ Username, Password string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"}); return
	}
	u, err := h.authStore.Login(req.Username, req.Password)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"}); return
	}
	tok, _ := h.authStore.CreateToken(u.ID)
	auth.SetSessionCookie(w, tok, isCrossOrigin(r))
	writeJSON(w, http.StatusOK, map[string]interface{}{"token": tok, "user": u})
}

func (h *Handlers) handleLogout(w http.ResponseWriter, r *http.Request) {
	// Revoke the token from either cookie or Bearer header, then clear cookie.
	// WebAuth already validated the token before reaching here, so revoking is
	// safe. We check both sources so scripts using Bearer can also log out.
	if c, err := r.Cookie(auth.SessionCookieName); err == nil && c.Value != "" {
		h.authStore.RevokeToken(c.Value)
	} else if ah := r.Header.Get("Authorization"); strings.HasPrefix(ah, "Bearer ") {
		h.authStore.RevokeToken(strings.TrimPrefix(ah, "Bearer "))
	}
	auth.ClearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// handleMe returns the currently authenticated user. Used by the SPA to
// restore the username on page reload when the HttpOnly cookie is still valid
// (replaces the old "User" placeholder). Requires WebAuth (injected via the
// web route group).
func (h *Handlers) handleMe(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	if u == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"user": u})
}

// ── Hierarchy ──

func (h *Handlers) handleGetHierarchy(w http.ResponseWriter, r *http.Request) {
	if h.hierStore == nil {
		writeJSON(w, http.StatusOK, &hierarchy.HierarchyTree{}); return
	}
	tree, _ := h.hierStore.GetFullHierarchy()
	writeJSON(w, http.StatusOK, tree)
}

func (h *Handlers) handleCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	var req struct{ Name, Description string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"}); return
	}
	if req.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name required"}); return
	}
	ws, err := h.hierStore.CreateWorkspace(req.Name, req.Description)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}); return
	}
	h.hierStore.EnsureWorkspaceInspiration(ws.ID)
	if u := auth.GetUser(r); u != nil {
		h.hierStore.SetPermission(u.ID, "workspace", ws.ID, hierarchy.LevelWorkspaceAdmin, u.ID)
	}
	writeJSON(w, http.StatusCreated, ws)
}

func (h *Handlers) handleUpdateWorkspace(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if !h.checkWSAdmin(w, r, id) { return }
	var req struct{ Name, Description string }
	json.NewDecoder(r.Body).Decode(&req)
	h.hierStore.UpdateWorkspace(id, req.Name, req.Description)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handleDeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if !h.checkWSAdmin(w, r, id) { return }
	h.hierStore.DeleteWorkspace(id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handleListProjects(w http.ResponseWriter, r *http.Request) {
	wid, _ := strconv.ParseInt(r.PathValue("wid"), 10, 64)
	projects, _ := h.hierStore.ListProjects(wid)
	writeJSON(w, http.StatusOK, projects)
}

func (h *Handlers) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	wid, _ := strconv.ParseInt(r.PathValue("wid"), 10, 64)
	if !h.checkWSAdmin(w, r, wid) { return }
	var req struct{ Name, Description string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"}); return
	}
	if req.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name required"}); return
	}
	proj, err := h.hierStore.CreateProject(wid, req.Name, req.Description)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}); return
	}
	if u := auth.GetUser(r); u != nil {
		h.hierStore.SetPermission(u.ID, "project", proj.ID, hierarchy.LevelProjectAdmin, u.ID)
	}
	writeJSON(w, http.StatusCreated, proj)
}

func (h *Handlers) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if !h.checkProjAdmin(w, r, id) { return }
	var req struct{ Name, Description string }
	json.NewDecoder(r.Body).Decode(&req)
	h.hierStore.UpdateProject(id, req.Name, req.Description)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if !h.checkWSAdmin(w, r, h.projWS(id)) { return }
	h.hierStore.DeleteProject(id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handleListTopics(w http.ResponseWriter, r *http.Request) {
	pid, _ := strconv.ParseInt(r.PathValue("pid"), 10, 64)
	topics, _ := h.hierStore.ListTopics(pid)
	writeJSON(w, http.StatusOK, topics)
}

func (h *Handlers) handleCreateTopic(w http.ResponseWriter, r *http.Request) {
	pid, _ := strconv.ParseInt(r.PathValue("pid"), 10, 64)
	if !h.checkProjAdmin(w, r, pid) { return }
	var req struct {
		Name, Description, AgentType string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"}); return
	}
	if req.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name required"}); return
	}
	topic, err := h.hierStore.CreateTopic(pid, req.Name, req.Description, req.AgentType)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}); return
	}
	writeJSON(w, http.StatusCreated, topic)
}

func (h *Handlers) handleUpdateTopic(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if !h.checkProjAdmin(w, r, h.topProj(id)) { return }
	var req struct{ Name, Description string }
	json.NewDecoder(r.Body).Decode(&req)
	h.hierStore.UpdateTopic(id, req.Name, req.Description)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handleDeleteTopic(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if !h.checkProjAdmin(w, r, h.topProj(id)) { return }
	h.hierStore.DeleteTopic(id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handleListStories(w http.ResponseWriter, r *http.Request) {
	tid, _ := strconv.ParseInt(r.PathValue("tid"), 10, 64)
	stories, _ := h.hierStore.ListStories(tid)
	writeJSON(w, http.StatusOK, stories)
}

func (h *Handlers) handleCreateStory(w http.ResponseWriter, r *http.Request) {
	pid, _ := strconv.ParseInt(r.PathValue("pid"), 10, 64)
	tid, _ := strconv.ParseInt(r.PathValue("tid"), 10, 64)
	if !h.checkProjAdmin(w, r, pid) { return }
	var req struct{ Name, Description string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"}); return
	}
	if req.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name required"}); return
	}
	story, err := h.hierStore.CreateStory(tid, req.Name, req.Description)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}); return
	}
	writeJSON(w, http.StatusCreated, story)
}

func (h *Handlers) handleUpdateStory(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if !h.checkProjAdmin(w, r, h.topProj(h.stoTop(id))) { return }
	var req struct{ Name, Description string }
	json.NewDecoder(r.Body).Decode(&req)
	h.hierStore.UpdateStory(id, req.Name, req.Description)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handleDeleteStory(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if !h.checkProjAdmin(w, r, h.topProj(h.stoTop(id))) { return }
	h.hierStore.DeleteStory(id)
	w.WriteHeader(http.StatusNoContent)
}

// ── Permissions ──

func (h *Handlers) handleListWorkspacePerms(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	perms, _ := h.hierStore.ListPermissions("workspace", id)
	writeJSON(w, http.StatusOK, perms)
}

func (h *Handlers) handleSetWorkspacePerm(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if !h.checkWSAdmin(w, r, id) { return }
	var req struct {
		UserID int64 `json:"user_id"`
		Level  int   `json:"level"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	h.hierStore.SetPermission(req.UserID, "workspace", id, req.Level, 0)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handleRemoveWorkspacePerm(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	uid, _ := strconv.ParseInt(r.PathValue("uid"), 10, 64)
	if !h.checkWSAdmin(w, r, id) { return }
	h.hierStore.RemovePermission(uid, "workspace", id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handleListProjectPerms(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	perms, _ := h.hierStore.ListPermissions("project", id)
	writeJSON(w, http.StatusOK, perms)
}

func (h *Handlers) handleSetProjectPerm(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if !h.checkProjAdmin(w, r, id) { return }
	var req struct {
		UserID int64 `json:"user_id"`
		Level  int   `json:"level"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	h.hierStore.SetPermission(req.UserID, "project", id, req.Level, 0)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handleRemoveProjectPerm(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	uid, _ := strconv.ParseInt(r.PathValue("uid"), 10, 64)
	if !h.checkProjAdmin(w, r, id) { return }
	h.hierStore.RemovePermission(uid, "project", id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, _ := h.authStore.ListUsers()
	writeJSON(w, http.StatusOK, users)
}

// ── Sessions ──

func (h *Handlers) handleListSessions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.sessions.GetSessions())
}

func (h *Handlers) handleGetSession(w http.ResponseWriter, r *http.Request) {
	sess := h.sessions.GetSession(r.PathValue("key"))
	if sess == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

func (h *Handlers) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"version": "1.0.0", "session_count": len(h.sessions.GetSessions()),
	})
}

// handleSendInput accepts web input for a session, replacing the former
// WebSocket send_input message. The input is enqueued for the agent plugin
// to poll via GET /api/poll-input, and a delta is broadcast via SSE.
func (h *Handlers) handleSendInput(w http.ResponseWriter, r *http.Request) {
	var req struct{ Text string `json:"text"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"}); return
	}
	if req.Text == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "text required"}); return
	}
	key := r.PathValue("key")
	if !h.sessions.HandleWebInput(key, req.Text) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"}); return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handlePendingInput(w http.ResponseWriter, r *http.Request) {
	if text := h.sessions.GetPendingInput(r.PathValue("key")); text != "" {
		writeJSON(w, http.StatusOK, map[string]string{"text": text})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handlePollInput(w http.ResponseWriter, r *http.Request) {
	at := r.URL.Query().Get("agent_type")
	sid := r.URL.Query().Get("agent_session_id")
	if at == "" || sid == "" {
		w.WriteHeader(http.StatusNoContent); return
	}
	key := session.ComputeSessionKey(h.sessions.UserID(), h.sessions.DeviceID(), at, sid)
	if text := h.sessions.GetPendingInput(key); text != "" {
		writeJSON(w, http.StatusOK, map[string]string{"text": text})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Agent SDK control ──

var validPermissionModes = map[string]bool{
	"": true, "default": true, "acceptEdits": true, "bypassPermissions": true,
	"plan": true, "readOnly": true, "auto": true,
}

func isValidPermissionMode(mode string) bool {
	return validPermissionModes[mode]
}

func (h *Handlers) agentType(r *http.Request) sdk.AgentType {
	return sdk.AgentType(r.PathValue("type"))
}

func (h *Handlers) handleAgentCreateSession(w http.ResponseWriter, r *http.Request) {
	if h.agentMgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent manager not configured"}); return
	}
	var req struct {
		CWD            string   `json:"cwd"`
		Model          string   `json:"model"`
		PermissionMode string   `json:"permission_mode"`
		AllowedTools   []string `json:"allowed_tools"`
		MaxTurns       int      `json:"max_turns"`
		Title          string   `json:"title"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	sess, err := h.agentMgr.CreateSession(r.Context(), h.agentType(r), sdk.SessionOptions{
		CWD: req.CWD, Model: req.Model, PermissionMode: sdk.PermissionMode(req.PermissionMode),
		AllowedTools: req.AllowedTools, MaxTurns: req.MaxTurns, Title: req.Title,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}); return
	}
	writeJSON(w, http.StatusCreated, sess)
}

func (h *Handlers) handleAgentListSessions(w http.ResponseWriter, r *http.Request) {
	if h.agentMgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent manager not configured"}); return
	}
	list, err := h.agentMgr.ListSessions(r.Context(), h.agentType(r), r.URL.Query().Get("dir"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}); return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleAgentSendPrompt starts an agent execution and returns immediately with
// the exec_id. The execution runs in the background; its messages are
// broadcast to ALL connected dashboards via the SSEHub (cross-client
// broadcast, AG-10). This replaces the former per-request SSE streaming so
// that every open dashboard observes the live execution, and reconnecting
// clients recover the full history via the `agent_executions` snapshot.
//
// Constraint C (from T002 design): the REST response MUST contain exec_id so
// the initiating client can correlate subsequent SSE `agent_message` events
// with the execution it started — even if the SSE event arrives slightly
// later than the REST response.
func (h *Handlers) handleAgentSendPrompt(w http.ResponseWriter, r *http.Request) {
	if h.agentMgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent manager not configured"}); return
	}
	var req struct {
		Prompt         string `json:"prompt"`
		SessionID      string `json:"session_id"`
		TimeoutMinutes int    `json:"timeout_minutes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"}); return
	}
	if req.Prompt == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "prompt required"}); return
	}

	agentType := h.agentType(r)
	sessionID := req.SessionID

	// Parse timeout — default 10m, cap 120m (AG-08).
	timeoutMin := 10
	if req.TimeoutMinutes > 0 {
		timeoutMin = req.TimeoutMinutes
		if timeoutMin > 120 {
			timeoutMin = 120
		}
	}

	execID := generateExecID()
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMin)*time.Minute)

	// Auto-create a session if none was provided (AG-01).
	if sessionID == "" {
		sess, err := h.agentMgr.CreateSession(ctx, agentType, sdk.SessionOptions{Title: truncatePrompt(req.Prompt, 60)})
		if err != nil {
			cancel()
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}); return
		}
		sessionID = sess.ID
		// Inform all clients (including the initiator) of the new session id.
		h.sseHub.BroadcastAgent(map[string]interface{}{
			"type": "agent_session_created", "agent_type": string(agentType),
			"session_id": sessionID, "exec_id": execID,
		})
	}

	// Register in the execution store so reconnecting clients see it (AG-06).
	h.agentMgr.Executions.Create(execID, sessionID, agentType, req.Prompt, cancel)

	// Broadcast exec_started to every dashboard (AG-02/AG-10).
	h.sseHub.BroadcastAgent(map[string]interface{}{
		"type": "agent_exec_started", "exec_id": execID,
		"agent_type": string(agentType), "session_id": sessionID, "prompt": req.Prompt,
	})

	// Respond immediately with exec_id (constraint C). The execution continues
	// in the background; messages flow over the global SSE stream.
	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"exec_id":    execID,
		"session_id": sessionID,
	})

	// Launch the execution. Detached from the HTTP request so it survives the
	// client closing the tab (AG-05).
	go func() {
		defer cancel()
		ch, err := h.agentMgr.SendPrompt(ctx, agentType, sessionID, req.Prompt)
		if err != nil {
			h.agentMgr.Executions.Fail(execID, err.Error())
			h.sseHub.BroadcastAgent(map[string]interface{}{
				"type": "agent_error", "exec_id": execID, "error": err.Error(),
			})
			return
		}
		for msg := range ch {
			h.agentMgr.Executions.AppendMessage(execID, msg)
			h.sseHub.BroadcastAgent(map[string]interface{}{
				"type": "agent_message", "exec_id": execID,
				"agent_type": string(agentType), "session_id": sessionID,
				"msg_type": string(msg.Type), "content": msg.Content,
				"tool_name": msg.ToolName, "tool_input": msg.ToolInput,
				"is_final": msg.IsFinal, "error": msg.Error,
			})
			if msg.Type == sdk.MessageTypeError && msg.IsFinal {
				h.agentMgr.Executions.Fail(execID, msg.Error)
				return
			}
		}
		h.agentMgr.Executions.Complete(execID)
	}()
}

// handleAgentCancel cancels a running execution and broadcasts agent_cancelled
// to all dashboards via SSE (AG-07).
func (h *Handlers) handleAgentCancel(w http.ResponseWriter, r *http.Request) {
	if h.agentMgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent manager not configured"}); return
	}
	agentType := h.agentType(r)
	sessionID := r.PathValue("id")
	// exec_id may be passed as a query param so the store can cancel the
	// specific execution's context.
	execID := r.URL.Query().Get("exec_id")
	if execID != "" {
		h.agentMgr.Executions.Cancel(execID)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := h.agentMgr.CancelExecution(ctx, agentType, sessionID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}); return
	}
	h.sseHub.BroadcastAgent(map[string]interface{}{
		"type": "agent_cancelled", "exec_id": execID, "session_id": sessionID,
	})
	w.WriteHeader(http.StatusNoContent)
}

func generateExecID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "exec_" + hex.EncodeToString(b)
}

func truncatePrompt(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

func (h *Handlers) handleAgentResume(w http.ResponseWriter, r *http.Request) {
	if h.agentMgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent manager not configured"}); return
	}
	sess, err := h.agentMgr.ResumeSession(r.Context(), h.agentType(r), r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}); return
	}
	writeJSON(w, http.StatusOK, sess)
}

func (h *Handlers) handleAgentRename(w http.ResponseWriter, r *http.Request) {
	if h.agentMgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent manager not configured"}); return
	}
	var req struct{ Title string `json:"title"` }
	json.NewDecoder(r.Body).Decode(&req)
	if err := h.agentMgr.RenameSession(r.Context(), h.agentType(r), r.PathValue("id"), req.Title); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}); return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) handleAgentSetPermissions(w http.ResponseWriter, r *http.Request) {
	if h.agentMgr == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent manager not configured"}); return
	}
	var req struct{ Mode string `json:"mode"` }
	json.NewDecoder(r.Body).Decode(&req)
	if err := h.agentMgr.SetPermissionMode(h.agentType(r), r.PathValue("id"), sdk.PermissionMode(req.Mode)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()}); return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
