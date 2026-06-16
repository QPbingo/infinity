package auth

import (
	"context"
	"net/http"
	"strings"
)

type contextKey string

const UserContextKey contextKey = "user"

// Middleware checks both X-Daemon-Token (existing) and Authorization: Bearer (new).
// If a valid bearer token is found, the user is injected into the request context.
// If only the daemon token matches, the request passes through without a user (legacy mode).
func Middleware(daemonToken string, store *Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Try bearer token first
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				rawToken := strings.TrimPrefix(authHeader, "Bearer ")
				user, err := store.ValidateToken(rawToken)
				if err == nil {
					ctx := context.WithValue(r.Context(), UserContextKey, user)
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
			}

			// Fall back to daemon token
			if daemonToken != "" {
				tokenHeader := r.Header.Get("X-Daemon-Token")
				if tokenHeader == daemonToken {
					next.ServeHTTP(w, r)
					return
				}
			}

			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		})
	}
}

// RequireAuth is a stricter middleware that requires a valid user context.
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := r.Context().Value(UserContextKey).(*User); !ok {
			http.Error(w, `{"error":"authentication required"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// GetUser extracts the authenticated user from the request context.
func GetUser(r *http.Request) *User {
	user, _ := r.Context().Value(UserContextKey).(*User)
	return user
}
