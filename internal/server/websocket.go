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

const (
	writeWait      = 10 * time.Second
	pongWait       = 30 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 4096
	sendBufSize    = 256
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type WSHub struct {
	mu       sync.RWMutex
	clients  map[*WSClient]struct{}
	token    string
	sessions *session.SessionManager

	register   chan *WSClient
	unregister chan *WSClient
	broadcast  chan []byte
}

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

func (h *WSHub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = struct{}{}
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

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

	go client.writePump()
	go client.readPump()
}

type WSClient struct {
	hub  *WSHub
	conn *websocket.Conn
	send chan []byte
}

func (c *WSClient) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

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

	c.sendJSON(map[string]string{"type": "auth_ok"})

	snapshot := c.hub.sessions.GetSnapshot()
	snapMsg := map[string]interface{}{
		"type":        "snapshot",
		"sessions":    snapshot.Sessions,
		"gen_time_ms": snapshot.GenTimeMs,
	}
	c.sendJSON(snapMsg)

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		var msg map[string]interface{}
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}
		if msgType, _ := msg["type"].(string); msgType == "ping" {
			c.sendJSON(map[string]string{"type": "pong"})
		}
	}
}

func (c *WSClient) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *WSClient) sendJSON(v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	c.conn.WriteMessage(websocket.TextMessage, data)
}
