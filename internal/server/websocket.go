package server

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/heybox/agent-monitor/internal/session"
)

// WebSocket constants control connection behavior and heartbeat timing.
//
// Heartbeat mechanism:
//
//	Client → Server: pong (sent in response to our ping)
//	Server → Client: ping (sent every pingPeriod)
//
// If the server doesn't receive a pong within pongWait of sending a ping,
// the connection is considered dead and closed by the readPump.
//
//	pongWait = 30s   – Maximum time to wait for a pong response.
//	pingPeriod = 27s – Send a ping every 27s (9/10 of pongWait).
//	writeWait = 10s  – Maximum time to wait for a write to complete.
//
//	sendBufSize = 256 – Maximum number of pending messages per client.
//	                    If exceeded, the client is disconnected to prevent
//	                    memory buildup from slow consumers.
const (
	writeWait      = 10 * time.Second
	pongWait       = 30 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 4096
	sendBufSize    = 256
)

// upgrader configures the WebSocket upgrade from HTTP.
//
// CheckOrigin allows all origins (returns true) because the daemon is
// accessed locally (127.0.0.1) and authentication is handled at the
// WebSocket protocol level (first message auth), not at the HTTP level.
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// WSHub manages all WebSocket client connections and message broadcasting.
//
// Architecture:
//
//	WSHub (single goroutine)
//	  │
//	  ├── register channel    ← new clients from HandleWS()
//	  ├── unregister channel  ← closing clients from readPump()
//	  └── broadcast channel   ← session updates from Notify()
//	        │
//	        └── for each client: send via client.send channel
//
// The hub uses the classic register/unregister/broadcast channel pattern
// for thread-safe client management without mutex contention.
//
// Broadcast behavior:
//   - Messages are sent to all connected clients.
//   - If a client's send buffer is full (256 messages), it is disconnected
//     to prevent unbounded memory growth from slow consumers.
//   - The broadcast channel itself is also buffered (256) to prevent the
//     SessionManager from blocking on WebSocket delivery.
type WSHub struct {
	mu       sync.RWMutex
	clients  map[*WSClient]struct{} // Set of connected WebSocket clients
	token    string                  // Daemon auth token for client verification
	sessions *session.SessionManager // Reference for full snapshots on connect

	// Channels for the event loop (Run goroutine)
	register   chan *WSClient // New client connected
	unregister chan *WSClient // Client disconnected
	broadcast  chan []byte    // Message to broadcast to all clients
}

// NewWSHub creates a new WebSocket Hub.
//
// Channel buffers:
//   - broadcast: 256  – buffer session updates so SessionManager doesn't block.
//   - register/unregister: unbuffered – synchronous, lightweight operations.
func NewWSHub(token string, sessions *session.SessionManager) *WSHub {
	return &WSHub{
		clients:    make(map[*WSClient]struct{}),
		token:      token,
		sessions:   sessions,
		register:   make(chan *WSClient),
		unregister: make(chan *WSClient),
		broadcast:  make(chan []byte, 256),
	}
}

// Run is the Hub's main event loop, running in its own goroutine.
//
// This is a single-threaded event loop that processes three types of events:
//
//	register:   A new client connected via WebSocket. Add to the clients set.
//	            The client has already passed auth by this point.
//
//	unregister: A client disconnected (readPump exited). Remove from the
//	            clients set and close its send channel to stop writePump.
//
//	broadcast:  A session update message from Notify(). Send the serialized
//	            JSON to every connected client's send channel. If a client's
//	            send buffer is full (slow consumer), disconnect it.
//
// Thread safety: All client set mutations happen in this single goroutine,
// eliminating the need for locks on the common path.
func (h *WSHub) Run() {
	for {
		select {
		case client := <-h.register:
			// New client connected (auth already passed in readPump)
			h.mu.Lock()
			h.clients[client] = struct{}{}
			h.mu.Unlock()

		case client := <-h.unregister:
			// Client disconnected or errored
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send) // stop writePump
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			// Broadcast a session update to all connected clients
			// Non-blocking send: if client buffer is full, disconnect it
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
					// Message delivered to writePump
				default:
					// Client is too slow – disconnect to prevent memory leak
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Notify sends a session update to all connected WebSocket clients.
//
// Called by SessionManager via the SetNotify callback whenever a session
// is created or modified.
//
// Handles two event types:
//
//	"delta":
//	  An existing session changed. Serializes to:
//	  {"type":"delta","session_key":"...","changes":{...},"timestamp_ms":...}
//
//	"session_added":
//	  A brand-new session appeared. Serializes to:
//	  {"type":"session_added","session":{...}}
//
// The serialized JSON is sent to the broadcast channel, which the Hub's
// Run() goroutine will distribute to all clients.
func (h *WSHub) Notify(eventType string, data interface{}) {
	var msg map[string]interface{}

	switch eventType {
	case "delta":
		delta, ok := data.(*session.Delta)
		if !ok {
			return
		}
		msg = map[string]interface{}{
			"type":         "delta",
			"session_key":  delta.SessionKey,
			"changes":      delta.Changes,
			"timestamp_ms": delta.TimestampMs,
		}

	case "session_added":
		sess, ok := data.(*session.Session)
		if !ok {
			return
		}
		msg = map[string]interface{}{
			"type":    "session_added",
			"session": sess,
		}

	default:
		return
	}

	jsonBytes, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[ws] marshal notify: %v", err)
		return
	}

	h.broadcast <- jsonBytes
}

// HandleWS handles the HTTP→WebSocket upgrade request.
//
// Called by the HTTP router for GET /ws requests.
//
// Per-connection lifecycle:
//
//	1. Upgrade HTTP connection to WebSocket.
//	2. Create WSClient with send buffer (256 messages).
//	3. Register client with the Hub (Hub's Run goroutine adds to clients set).
//	4. Launch readPump goroutine – handles auth, then reads client messages.
//	5. Launch writePump goroutine – sends messages from client.send channel.
//
// The connection stays alive until either:
//   - readPump exits (auth failure, read error, or client close).
//   - writePump exits (write error or send channel closed).
//
// When either goroutine exits, it triggers unregister via defer, which
// cleans up the client in the Hub.
func (h *WSHub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ws] upgrade: %v", err)
		return
	}

	client := &WSClient{
		hub:  h,
		conn: conn,
		send: make(chan []byte, sendBufSize),
	}
	h.register <- client

	// Launch two goroutines per client:
	//   - readPump:  reads messages from WebSocket (auth, ping/pong)
	//   - writePump: writes messages to WebSocket (delta updates, heartbeat)
	go client.writePump()
	go client.readPump()
}

// WSClient represents a single WebSocket connection.
//
// Each client has:
//   - A reference to the Hub (for unregister on disconnect).
//   - The WebSocket connection (for read/write).
//   - A send channel (buffered, 256 messages) for the Hub to push updates.
//
// Two goroutines operate on each client:
//   - readPump:  Reads from conn → Hub actions (auth, ping/pong).
//   - writePump: Reads from send channel → writes to conn.
type WSClient struct {
	hub  *WSHub
	conn *websocket.Conn
	send chan []byte
}

// readPump reads messages from the WebSocket connection.
//
// Authentication flow:
//
//	1. Set initial read deadline to pongWait.
//	2. Set pong handler to refresh deadline on each pong.
//	3. Read the first message – must be {"type":"auth","token":"<token>"}.
//	   - If not a valid auth message → send auth_error and close.
//	   - If token doesn't match → send auth_error and close.
//	4. Send auth_ok confirmation.
//	5. Send full snapshot of all sessions (initial state).
//	6. Enter read loop – only handles "ping" messages (responds with "pong").
//
// All other message types are ignored. Session updates only flow
// server→client (via Hub broadcast → writePump).
//
// On any error or client close, readPump exits and defers unregister
// and connection close.
func (c *WSClient) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	// Configure read limits and timeout
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// ── Read and validate auth message ─────────────────────────────────
	_, message, err := c.conn.ReadMessage()
	if err != nil {
		return
	}

	var authMsg struct {
		Type  string `json:"type"`
		Token string `json:"token"`
	}
	if err := json.Unmarshal(message, &authMsg); err != nil || authMsg.Type != "auth" {
		c.sendJSON(map[string]string{"type": "auth_error"})
		return
	}

	if authMsg.Token != c.hub.token {
		c.sendJSON(map[string]string{"type": "auth_error"})
		return
	}

	// ── Auth successful – send confirmation + full state ───────────────
	c.sendJSON(map[string]string{"type": "auth_ok"})

	// Send full session snapshot for initial dashboard state
	snapshot := c.hub.sessions.GetSnapshot()
	snapMsg := map[string]interface{}{
		"type":        "snapshot",
		"sessions":    snapshot.Sessions,
		"gen_time_ms": snapshot.GenTimeMs,
	}
	c.sendJSON(snapMsg)

	// ── Read loop – handle ping and send_input messages ─────────────────
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		var msg map[string]interface{}
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}
		msgType, _ := msg["type"].(string)
		switch msgType {
		case "ping":
			c.sendJSON(map[string]string{"type": "pong"})
		case "send_input":
			key, _ := msg["session_key"].(string)
			text, _ := msg["text"].(string)
			if key != "" && text != "" {
				c.hub.sessions.HandleWebInput(key, text)
			}
		}
	}
}

// writePump writes messages to the WebSocket connection.
//
// Two sources of messages:
//
//	1. c.send channel ← Hub broadcasts (session delta updates).
//	   Writes as WebSocket TextMessage (JSON).
//
//	2. ticker.C ← Periodic heartbeat.
//	   Writes as WebSocket PingMessage (control frame, not JSON).
//	   Client's browser/WS library automatically responds with Pong.
//
// On any write error or closed send channel, writePump exits.
//
// Write deadline is set before each write to detect slow/stuck clients.
func (c *WSClient) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			// Send a session update (delta or session_added)
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the send channel (client disconnected)
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			// Send server-initiated ping (WebSocket control frame)
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// sendJSON marshals a value to JSON and writes it directly to the WebSocket.
//
// Used for auth responses (auth_ok, auth_error) and the initial snapshot.
// These are sent synchronously before the readPump enters its message loop.
//
// Errors from marshal or write are silently ignored – if we can't send the
// auth response, the readPump's defer will clean up the connection anyway.
func (c *WSClient) sendJSON(v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	c.conn.WriteMessage(websocket.TextMessage, data)
}
