package server

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/heybox/agent-monitor/internal/auth"
	"github.com/heybox/agent-monitor/internal/hierarchy"
	"github.com/heybox/agent-monitor/internal/session"
	"github.com/heybox/agent-monitor/sdk"
)

// SSE heartbeat interval. The server sends a `: ping` SSE comment line every
// ssePingPeriod to keep the connection alive and allow the client to detect
// a dead connection within ~60s (client-side timeout).
const (
	ssePingPeriod   = 25 * time.Second
	sseSendBufSize  = 256
)

// SSEHub manages all SSE client connections and broadcasts server-pushed
// events to them. It is the SSE replacement for the former WSHub.
//
// Architecture mirrors WSHub: a single Run() event loop processes register /
// unregister / broadcast channels, so client-set mutations are race-free.
//
// Key correctness invariants (vs. the old WS implementation):
//
//	A. Per-client write mutex — snapshot delivery and delta broadcast never
//	   interleave on the same ResponseWriter, which would corrupt the SSE
//	   byte stream and drop messages.
//	B. Register-before-snapshot — a client joins the broadcast set BEFORE its
//	   initial snapshot is sent, so deltas produced during snapshot delivery
//	   are not lost (the client receives them after the snapshot).
func NewSSEHub(sessions *session.SessionManager, hierStore *hierarchy.Store, authStore *auth.Store, agentMgr *sdk.AgentManager) *SSEHub {
	return &SSEHub{
		clients:    make(map[*SSEClient]struct{}),
		sessions:   sessions,
		hierStore:  hierStore,
		authStore:  authStore,
		agentMgr:   agentMgr,
		register:   make(chan *SSEClient),
		unregister: make(chan *SSEClient),
		broadcast:  make(chan []byte, 256),
	}
}

type SSEHub struct {
	mu         sync.Mutex
	clients    map[*SSEClient]struct{}
	sessions   *session.SessionManager
	hierStore  *hierarchy.Store
	authStore  *auth.Store
	agentMgr   *sdk.AgentManager
	register   chan *SSEClient
	unregister chan *SSEClient
	broadcast  chan []byte
}

// Run is the hub event loop. Must run in its own goroutine.
func (h *SSEHub) Run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = struct{}{}
			h.mu.Unlock()
		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
			}
			h.mu.Unlock()
		case msg := <-h.broadcast:
			h.mu.Lock()
			for c := range h.clients {
				select {
				case c.send <- msg:
				default:
					// Slow consumer: drop it to avoid unbounded memory.
					close(c.send)
					delete(h.clients, c)
				}
			}
			h.mu.Unlock()
		}
	}
}

// Notify serializes a session/hierarchy event and broadcasts it to all clients.
// Called by SessionManager via SetNotify / SetHierarchyNotify.
func (h *SSEHub) Notify(eventType string, data interface{}) {
	var msg map[string]interface{}
	switch eventType {
	case "delta":
		d, ok := data.(*session.Delta)
		if !ok {
			return
		}
		msg = map[string]interface{}{
			"type":         "delta",
			"session_key":  d.SessionKey,
			"changes":      d.Changes,
			"timestamp_ms": d.TimestampMs,
		}
	case "session_added":
		s, ok := data.(*session.Session)
		if !ok {
			return
		}
		msg = map[string]interface{}{"type": "session_added", "session": s}
	case "hierarchy_updated":
		msg = map[string]interface{}{"type": "hierarchy_updated", "hierarchy": data}
	default:
		return
	}
	b, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[sse] marshal notify: %v", err)
		return
	}
	h.broadcast <- b
}

// BroadcastAgent sends an agent-execution event (agent_exec_started /
// agent_message / agent_error / agent_cancelled / agent_session_created) to
// every connected client. Used by the REST agent-prompt handler so that all
// dashboards observe the live execution stream (cross-client broadcast).
func (h *SSEHub) BroadcastAgent(payload map[string]interface{}) {
	b, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[sse] marshal agent: %v", err)
		return
	}
	h.broadcast <- b
}

// BroadcastExecutions sends the full execution history to a single client
// (used on reconnect). Sent directly to the client, not broadcast.
func (h *SSEHub) executionsPayload() map[string]interface{} {
	if h.agentMgr == nil {
		return nil
	}
	return map[string]interface{}{
		"type":       "agent_executions",
		"executions": h.agentMgr.Executions.List(),
	}
}

// HandleStream handles GET /api/events/stream — the SSE endpoint.
//
// Flow (enforces invariants A & B):
//  1. Validate cookie/bearer auth. (Auth is performed by the WebAuth
//     middleware before this handler runs, so here we only send the stream.)
//  2. Set SSE headers and flush them.
//  3. Create the client and REGISTER it with the hub (B: register first).
//  4. Send initial snapshot + hierarchy + executions to this client only.
//  5. Launch the write loop: read from send channel, write under per-client
//     mutex (A), flush after each write. A ticker sends `: ping` comments.
//  6. On request context cancellation, unregister and return.
func (h *SSEHub) HandleStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, `{"error":"streaming unsupported"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// X-Accel-Buffering: no — disable Nginx buffering so events flush promptly.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	client := &SSEClient{
		w:       w,
		flusher: flusher,
		send:    make(chan []byte, sseSendBufSize),
	}

	// B: register BEFORE sending the initial snapshot so deltas produced
	// during snapshot delivery are queued for this client.
	h.register <- client

	// Send the initial full state to this client only (not broadcast).
	h.sendInitial(client)

	// Write loop + heartbeat. Runs until the client disconnects.
	ticker := time.NewTicker(ssePingPeriod)
	defer func() {
		ticker.Stop()
		h.unregister <- client
	}()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-client.send:
			if !ok {
				return
			}
			if !client.write(msg) {
				return
			}
		case <-ticker.C:
			// SSE comment line — keeps proxies alive without emitting a
			// client-visible event.
			if !client.writeComment(": ping") {
				return
			}
		}
	}
}

// sendInitial delivers the snapshot / hierarchy / executions to a newly
// connected client. Each message is written under the client's mutex.
func (h *SSEHub) sendInitial(c *SSEClient) {
	// Session snapshot
	snap := h.sessions.GetSnapshot()
	c.writeJSON(map[string]interface{}{
		"type":        "snapshot",
		"sessions":    snap.Sessions,
		"gen_time_ms": snap.GenTimeMs,
	})

	// Hierarchy snapshot
	if h.hierStore != nil {
		if tree, err := h.hierStore.GetFullHierarchy(); err == nil {
			c.writeJSON(map[string]interface{}{
				"type":      "hierarchy_snapshot",
				"hierarchy": tree,
			})
		}
	}

	// Execution history (survives reconnects)
	if payload := h.executionsPayload(); payload != nil {
		c.writeJSON(payload)
	}
}

// SSEClient is a single SSE connection. The writeMu mutex (invariant A)
// guarantees that snapshot writes and broadcast writes never interleave on
// the same ResponseWriter, which would corrupt the SSE byte stream.
type SSEClient struct {
	w       http.ResponseWriter
	flusher http.Flusher
	send    chan []byte
	writeMu sync.Mutex
}

// write writes a raw SSE event payload (already JSON) under the mutex and
// flushes. Returns false if the write failed (client gone).
func (c *SSEClient) write(data []byte) bool {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if _, err := fmt.Fprintf(c.w, "data: %s\n\n", data); err != nil {
		return false
	}
	c.flusher.Flush()
	return true
}

// writeJSON marshals v and writes it as an SSE data event.
func (c *SSEClient) writeJSON(v interface{}) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.write(b)
}

// writeComment writes an SSE comment line (ignored by the client but keeps
// the connection alive). Returns false if the write failed.
func (c *SSEClient) writeComment(line string) bool {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if _, err := fmt.Fprintf(c.w, "%s\n\n", line); err != nil {
		return false
	}
	c.flusher.Flush()
	return true
}
