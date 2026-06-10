package session

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

const createTableSQL = `
CREATE TABLE IF NOT EXISTS daemon_sessions (
    user_id          TEXT NOT NULL,
    device_id        TEXT NOT NULL,
    agent_type       TEXT NOT NULL,
    agent_session_id TEXT NOT NULL,
    session_key      TEXT NOT NULL,
    pid              INTEGER DEFAULT 0,
    terminal         TEXT DEFAULT '',
    cwd              TEXT DEFAULT '',
    status           TEXT DEFAULT 'active',
    start_time_ms    INTEGER NOT NULL,
    last_event_time_ms INTEGER DEFAULT 0,
    last_event_type  TEXT DEFAULT '',
    last_file        TEXT DEFAULT '',
    last_command     TEXT DEFAULT '',
    user_input       TEXT DEFAULT '',
    agent_output     TEXT DEFAULT '',
    session_title    TEXT DEFAULT '',
    payload          TEXT DEFAULT '',
    last_hook_event  TEXT DEFAULT '',
    memory_mb        REAL DEFAULT 0,
    cpu_percent      REAL DEFAULT 0,
    turn_count       INTEGER DEFAULT 0,
    git_branch       TEXT DEFAULT '',
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    ended_at         INTEGER,
    PRIMARY KEY (user_id, device_id, agent_type, agent_session_id)
);
`

const migrationSQL = `
ALTER TABLE daemon_sessions ADD COLUMN user_input TEXT DEFAULT '';
ALTER TABLE daemon_sessions ADD COLUMN agent_output TEXT DEFAULT '';
ALTER TABLE daemon_sessions ADD COLUMN session_title TEXT DEFAULT '';
ALTER TABLE daemon_sessions ADD COLUMN payload TEXT DEFAULT '';
ALTER TABLE daemon_sessions ADD COLUMN last_hook_event TEXT DEFAULT '';
`

type Store struct {
	db *sql.DB
}

func NewStore(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	db.SetMaxOpenConns(1)

	if _, err := db.Exec(createTableSQL); err != nil {
		db.Close()
		return nil, fmt.Errorf("create table: %w", err)
	}

	db.Exec(migrationSQL)

	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Upsert(sess *Session) error {
	now := time.Now().UnixMilli()
	endedAt := interface{}(nil)
	if sess.Status == StatusStopped || sess.Status == StatusDisappeared {
		endedAt = now
	}

	payload := string(sess.Payload)
	if payload == "null" {
		payload = ""
	}

	_, err := s.db.Exec(`
		INSERT INTO daemon_sessions (
			user_id, device_id, agent_type, agent_session_id, session_key,
			pid, terminal, cwd, status, start_time_ms,
			last_event_time_ms, last_event_type, last_file, last_command,
			user_input, agent_output, session_title, payload, last_hook_event,
			memory_mb, cpu_percent, turn_count, git_branch,
			created_at, updated_at, ended_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, device_id, agent_type, agent_session_id) DO UPDATE SET
			session_key = excluded.session_key,
			pid = excluded.pid,
			terminal = excluded.terminal,
			cwd = excluded.cwd,
			status = excluded.status,
			start_time_ms = excluded.start_time_ms,
			last_event_time_ms = excluded.last_event_time_ms,
			last_event_type = excluded.last_event_type,
			last_file = excluded.last_file,
			last_command = excluded.last_command,
			user_input = excluded.user_input,
			agent_output = excluded.agent_output,
			session_title = excluded.session_title,
			payload = excluded.payload,
			last_hook_event = excluded.last_hook_event,
			memory_mb = excluded.memory_mb,
			cpu_percent = excluded.cpu_percent,
			turn_count = excluded.turn_count,
			git_branch = excluded.git_branch,
			updated_at = excluded.updated_at,
			ended_at = excluded.ended_at
	`,
		sess.UserID, sess.DeviceID, sess.AgentType, sess.AgentSessionID, sess.SessionKey,
		sess.PID, sess.Terminal, sess.CWD, string(sess.Status), sess.StartTimeMs,
		sess.LastEventTimeMs, sess.LastEventType, sess.LastFile, sess.LastCommand,
		sess.UserInput, sess.AgentOutput, sess.SessionTitle, payload, sess.LastHookEvent,
		sess.MemoryMB, sess.CPUPercent, sess.TurnCount, sess.GitBranch,
		now, now, endedAt,
	)
	return err
}

func (s *Store) UpdateProcessFields(sess *Session) error {
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(`
		UPDATE daemon_sessions SET
			pid = ?, terminal = ?, cwd = ?, memory_mb = ?, cpu_percent = ?,
			updated_at = ?
		WHERE user_id = ? AND device_id = ? AND agent_type = ? AND agent_session_id = ?
	`,
		sess.PID, sess.Terminal, sess.CWD, sess.MemoryMB, sess.CPUPercent,
		now,
		sess.UserID, sess.DeviceID, sess.AgentType, sess.AgentSessionID,
	)
	return err
}

func (s *Store) LoadAll() ([]*Session, error) {
	rows, err := s.db.Query(`
		SELECT user_id, device_id, agent_type, agent_session_id, session_key,
			pid, terminal, cwd, status, start_time_ms,
			last_event_time_ms, last_event_type, last_file, last_command,
			user_input, agent_output, session_title, payload,
			memory_mb, cpu_percent, turn_count, git_branch,
			created_at, updated_at
		FROM daemon_sessions
		ORDER BY start_time_ms DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []*Session
	for rows.Next() {
		var s Session
		var userInput, agentOutput, sessionTitle, payload, lastHookEvent string
		if err := rows.Scan(
			&s.UserID, &s.DeviceID, &s.AgentType, &s.AgentSessionID, &s.SessionKey,
			&s.PID, &s.Terminal, &s.CWD, &s.Status, &s.StartTimeMs,
			&s.LastEventTimeMs, &s.LastEventType, &s.LastFile, &s.LastCommand,
			&userInput, &agentOutput, &sessionTitle, &payload, &lastHookEvent,
			&s.MemoryMB, &s.CPUPercent, &s.TurnCount, &s.GitBranch,
			new(int64), new(int64),
		); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}
		s.UserInput = userInput
		s.AgentOutput = agentOutput
		s.SessionTitle = sessionTitle
		s.LastHookEvent = lastHookEvent
		if payload != "" {
			s.Payload = []byte(payload)
		}
		s.lastHookTime = s.LastEventTimeMs
		sessions = append(sessions, &s)
	}

	return sessions, rows.Err()
}
