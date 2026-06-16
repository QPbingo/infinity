package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/heybox/agent-monitor/internal/auth"
	"github.com/heybox/agent-monitor/internal/hierarchy"
	"github.com/heybox/agent-monitor/internal/session"
	"github.com/heybox/agent-monitor/internal/token"
)

type Handlers struct {
	sessions  *session.SessionManager
	token     string
	hub       *WSHub
	authStore *auth.Store
	hierStore *hierarchy.Store
}

func NewHandlers(s *session.SessionManager, tok string, hub *WSHub, as *auth.Store, hs *hierarchy.Store) *Handlers {
	return &Handlers{sessions: s, token: tok, hub: hub, authStore: as, hierStore: hs}
}

func (h *Handlers) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /", h.serveDashboard)
	mux.HandleFunc("POST /api/auth/register", h.handleRegister)
	mux.HandleFunc("POST /api/auth/login", h.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", h.handleLogout)

	mux.HandleFunc("GET /health", h.authMiddleware(h.handleHealth))
	mux.HandleFunc("GET /api/sessions", h.authMiddleware(h.handleListSessions))
	mux.HandleFunc("GET /api/sessions/{key}", h.authMiddleware(h.handleGetSession))
	mux.HandleFunc("GET /api/sessions/{key}/pending-input", h.authMiddleware(h.handlePendingInput))
	mux.HandleFunc("GET /api/poll-input", h.authMiddleware(h.handlePollInput))

	mux.HandleFunc("GET /api/hierarchy", h.userMiddleware(h.handleGetHierarchy))
	mux.HandleFunc("POST /api/workspaces", h.userMiddleware(h.handleCreateWorkspace))
	mux.HandleFunc("PUT /api/workspaces/{id}", h.userMiddleware(h.handleUpdateWorkspace))
	mux.HandleFunc("DELETE /api/workspaces/{id}", h.userMiddleware(h.handleDeleteWorkspace))
	mux.HandleFunc("GET /api/workspaces/{wid}/projects", h.userMiddleware(h.handleListProjects))
	mux.HandleFunc("POST /api/workspaces/{wid}/projects", h.userMiddleware(h.handleCreateProject))
	mux.HandleFunc("PUT /api/workspaces/{wid}/projects/{id}", h.userMiddleware(h.handleUpdateProject))
	mux.HandleFunc("DELETE /api/workspaces/{wid}/projects/{id}", h.userMiddleware(h.handleDeleteProject))
	mux.HandleFunc("GET /api/workspaces/{wid}/projects/{pid}/topics", h.userMiddleware(h.handleListTopics))
	mux.HandleFunc("POST /api/workspaces/{wid}/projects/{pid}/topics", h.userMiddleware(h.handleCreateTopic))
	mux.HandleFunc("PUT /api/workspaces/{wid}/projects/{pid}/topics/{id}", h.userMiddleware(h.handleUpdateTopic))
	mux.HandleFunc("DELETE /api/workspaces/{wid}/projects/{pid}/topics/{id}", h.userMiddleware(h.handleDeleteTopic))
	mux.HandleFunc("GET /api/workspaces/{wid}/projects/{pid}/topics/{tid}/stories", h.userMiddleware(h.handleListStories))
	mux.HandleFunc("POST /api/workspaces/{wid}/projects/{pid}/topics/{tid}/stories", h.userMiddleware(h.handleCreateStory))
	mux.HandleFunc("PUT /api/stories/{id}", h.userMiddleware(h.handleUpdateStory))
	mux.HandleFunc("DELETE /api/stories/{id}", h.userMiddleware(h.handleDeleteStory))

	mux.HandleFunc("GET /api/permissions/workspace/{id}", h.userMiddleware(h.handleListWorkspacePerms))
	mux.HandleFunc("PUT /api/permissions/workspace/{id}", h.userMiddleware(h.handleSetWorkspacePerm))
	mux.HandleFunc("DELETE /api/permissions/workspace/{id}/{uid}", h.userMiddleware(h.handleRemoveWorkspacePerm))
	mux.HandleFunc("GET /api/permissions/project/{id}", h.userMiddleware(h.handleListProjectPerms))
	mux.HandleFunc("PUT /api/permissions/project/{id}", h.userMiddleware(h.handleSetProjectPerm))
	mux.HandleFunc("DELETE /api/permissions/project/{id}/{uid}", h.userMiddleware(h.handleRemoveProjectPerm))
	mux.HandleFunc("GET /api/users", h.userMiddleware(h.handleListUsers))

	mux.HandleFunc("GET /ws", h.hub.HandleWS)
}

// ── Middleware ──

func (h *Handlers) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ah := r.Header.Get("Authorization"); strings.HasPrefix(ah, "Bearer ") {
			if h.authStore != nil {
				if _, err := h.authStore.ValidateToken(strings.TrimPrefix(ah, "Bearer ")); err == nil {
					next(w, r); return
				}
			}
		}
		if h.token != "" {
			if tok := r.Header.Get("X-Daemon-Token"); tok != "" && token.ConstantTimeCompare(tok, h.token) {
				next(w, r); return
			}
		}
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
	}
}

func (h *Handlers) userMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ah := r.Header.Get("Authorization")
		if !strings.HasPrefix(ah, "Bearer ") {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "auth required"}); return
		}
		if h.authStore == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "auth not configured"}); return
		}
		u, err := h.authStore.ValidateToken(strings.TrimPrefix(ah, "Bearer "))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid token"}); return
		}
		ctx := context.WithValue(r.Context(), auth.UserContextKey, u)
		next(w, r.WithContext(ctx))
	}
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
	writeJSON(w, http.StatusOK, map[string]interface{}{"token": tok, "user": u})
}

func (h *Handlers) handleLogout(w http.ResponseWriter, r *http.Request) {
	if ah := r.Header.Get("Authorization"); strings.HasPrefix(ah, "Bearer ") {
		h.authStore.RevokeToken(strings.TrimPrefix(ah, "Bearer "))
	}
	w.WriteHeader(http.StatusNoContent)
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

func (h *Handlers) serveDashboard(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "web/dashboard.html")
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

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
