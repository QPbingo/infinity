// Package server provides the HTTP and WebSocket API for the agent-monitor daemon.
// HTTP endpoints are protected by X-Daemon-Token; WebSocket auth uses the
// first message. The dashboard page (/) is served without auth.
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

	"github.com/heybox/agent-monitor/internal/session"
)

type Server struct {
	addr    string
	httpSrv *http.Server
	hub     *WSHub
}

func New(addr string, sessions *session.SessionManager, token string) *Server {
	hub := NewWSHub(token, sessions)
	handlers := NewHandlers(sessions, token, hub)

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

func (s *Server) Start() error {
	go s.hub.Run()

	go func() {
		log.Printf("[server] listening on %s", s.addr)
		if err := s.httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[server] listen: %v", err)
		}
	}()

	return nil
}

func (s *Server) GetHub() *WSHub {
	return s.hub
}

func (s *Server) Shutdown() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.httpSrv.Shutdown(ctx); err != nil {
		log.Printf("[server] shutdown: %v", err)
	}
}

func WaitForSignal() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	fmt.Fprintf(os.Stderr, "\nReceived signal: %v, shutting down...\n", sig)
}
