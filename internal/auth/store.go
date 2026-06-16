package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

func (s *Store) EnsureTables() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			username   TEXT NOT NULL UNIQUE,
			password   TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS auth_tokens (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id    INTEGER NOT NULL REFERENCES users(id),
			token      TEXT NOT NULL UNIQUE,
			expires_at INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		);
	`)
	return err
}

func (s *Store) Register(username, password string) (*User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	now := time.Now().UnixMilli()
	res, err := s.db.Exec(
		`INSERT INTO users (username, password, created_at) VALUES (?, ?, ?)`,
		username, string(hash), now,
	)
	if err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}

	id, _ := res.LastInsertId()
	return &User{ID: id, Username: username, CreatedAt: now}, nil
}

var ErrInvalidCredentials = errors.New("invalid username or password")

func (s *Store) Login(username, password string) (*User, error) {
	var user User
	var hash string
	err := s.db.QueryRow(
		`SELECT id, username, password, created_at FROM users WHERE username = ?`,
		username,
	).Scan(&user.ID, &user.Username, &hash, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, fmt.Errorf("query user: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	return &user, nil
}

func (s *Store) CreateToken(userID int64) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	rawToken := hex.EncodeToString(raw)

	hashed := sha256.Sum256([]byte(rawToken))
	hashedToken := hex.EncodeToString(hashed[:])

	now := time.Now().UnixMilli()
	expiresAt := now + 24*60*60*1000

	_, err := s.db.Exec(
		`INSERT INTO auth_tokens (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		userID, hashedToken, expiresAt, now,
	)
	if err != nil {
		return "", fmt.Errorf("insert token: %w", err)
	}

	return rawToken, nil
}

var ErrTokenInvalid = errors.New("invalid or expired token")

func (s *Store) ValidateToken(rawToken string) (*User, error) {
	hashed := sha256.Sum256([]byte(rawToken))
	hashedToken := hex.EncodeToString(hashed[:])

	var user User
	var expiresAt int64
	err := s.db.QueryRow(
		`SELECT u.id, u.username, u.created_at, t.expires_at
		 FROM auth_tokens t JOIN users u ON t.user_id = u.id
		 WHERE t.token = ?`,
		hashedToken,
	).Scan(&user.ID, &user.Username, &user.CreatedAt, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrTokenInvalid
	}
	if err != nil {
		return nil, fmt.Errorf("query token: %w", err)
	}

	if time.Now().UnixMilli() > expiresAt {
		s.db.Exec(`DELETE FROM auth_tokens WHERE token = ?`, hashedToken)
		return nil, ErrTokenInvalid
	}

	return &user, nil
}

func (s *Store) RevokeToken(rawToken string) error {
	hashed := sha256.Sum256([]byte(rawToken))
	hashedToken := hex.EncodeToString(hashed[:])
	_, err := s.db.Exec(`DELETE FROM auth_tokens WHERE token = ?`, hashedToken)
	return err
}

func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(`SELECT id, username, created_at FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (s *Store) UserCount() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}
