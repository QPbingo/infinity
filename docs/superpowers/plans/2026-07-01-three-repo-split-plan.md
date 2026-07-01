# Three-Repo Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Agent Monitor monorepo into three independent Git repositories — `agent-monitor-hook`, `agent-monitor-server`, `agent-monitor-web`.

**Architecture:** Three independent repos with one-way dependency: Frontend → Backend (HTTP/SSE) → Hook SDK (Go module). Hook binary communicates with Backend via filesystem (`events.jsonl`). Shared types are independently defined in each repo.

**Tech Stack:** Go 1.26.3, TypeScript + Vite, SQLite, fsnotify

## Global Constraints

- Each repo is fully independent — own go.mod/package.json, own Makefile, own CI
- No shared code between repos; shared contracts (HookEvent JSON) are independently defined
- SDK lives in hook repo, backend imports it as a Go module dependency
- Installer lives in hook repo
- HookEvent schema and token logic are duplicated (not shared) across repos
- All existing functionality must be preserved

---

## Repo Targets

| Repo | Module/Name | Binaries |
|------|------------|----------|
| `agent-monitor-hook` | `github.com/heybox/agent-monitor-hook` | `agent-monitor-hook`, `agent-monitor-setup` |
| `agent-monitor-server` | `github.com/heybox/agent-monitor-server` | `agent-monitor-daemon` |
| `agent-monitor-web` | `agent-monitor-web` (npm) | Static SPA |

### Phase 1: Hook Repository

### Task 1: Initialize Hook repository structure

**Files:**
- Create: `../agent-monitor-hook/go.mod`
- Create: `../agent-monitor-hook/Makefile`
- Create: `../agent-monitor-hook/README.md`

**Interfaces:**
- Produces: Go module `github.com/heybox/agent-monitor-hook` with subpackages `sdk`, `internal/installer`, `internal/token`

- [ ] **Step 1: Create directory and go.mod**

```bash
mkdir -p ../agent-monitor-hook
cd ../agent-monitor-hook
```

Write `go.mod`:
```
module github.com/heybox/agent-monitor-hook

go 1.26.3
```

- [ ] **Step 2: Write initial Makefile**

Write `Makefile`:
```makefile
BIN_DIR := $(shell pwd)/bin
HOOK    := $(BIN_DIR)/agent-monitor-hook
SETUP   := $(BIN_DIR)/agent-monitor-setup

.PHONY: build
build:
	@mkdir -p $(BIN_DIR)
	go build -o $(HOOK)  ./cmd/hook
	go build -o $(SETUP) ./cmd/setup
	@echo "✓ hook + setup built → $(BIN_DIR)/"

.PHONY: test
test:
	go test ./internal/... ./sdk/... -count=1

.PHONY: install
install: build
	@install -m 755 $(HOOK)  /usr/local/bin/agent-monitor-hook
	@install -m 755 $(SETUP) /usr/local/bin/agent-monitor-setup
	@echo "✓ installed to /usr/local/bin/"

.PHONY: clean
clean:
	@rm -rf $(BIN_DIR)
```

- [ ] **Step 3: Write README**

```bash
echo "# agent-monitor-hook

Agent Monitor hook binary and SDK. Captures AI coding agent lifecycle events and writes them to the agent-monitor event pipeline.

## Build
    make build

## Install
    make install

## Test
    make test
" > README.md
```

- [ ] **Step 4: Commit**

```bash
git init
git add go.mod Makefile README.md
git commit -m "init: agent-monitor-hook repository"
```

---

### Task 2: Copy hook and setup binaries

**Files:**
- Copy: `cmd/hook/main.go` → `../agent-monitor-hook/cmd/hook/main.go`
- Copy: `cmd/setup/main.go` → `../agent-monitor-hook/cmd/setup/main.go`

**Interfaces:**
- Consumes: go.mod from Task 1
- Produces: Two Go main packages under `cmd/hook/` and `cmd/setup/`

- [ ] **Step 1: Copy cmd/hook/main.go (no import changes needed)**

`cmd/hook/main.go` uses only Go standard library — zero internal imports. Copy verbatim:

```bash
mkdir -p ../agent-monitor-hook/cmd/hook
cp cmd/hook/main.go ../agent-monitor-hook/cmd/hook/main.go
```

- [ ] **Step 2: Copy cmd/setup/main.go (update imports)**

The file needs import path changes. Copy then edit:

```bash
mkdir -p ../agent-monitor-hook/cmd/setup
cp cmd/setup/main.go ../agent-monitor-hook/cmd/setup/main.go
```

Replace in `../agent-monitor-hook/cmd/setup/main.go`:
- `"github.com/heybox/agent-monitor/internal/installer"` → `"github.com/heybox/agent-monitor-hook/internal/installer"`
- `"github.com/heybox/agent-monitor/internal/token"` → `"github.com/heybox/agent-monitor-hook/internal/token"`

- [ ] **Step 3: Commit**

```bash
cd ../agent-monitor-hook
git add cmd/
git commit -m "feat: add hook and setup binaries"
```

---

### Task 3: Copy internal/installer package

**Files:**
- Copy all from `internal/installer/` → `../agent-monitor-hook/internal/installer/`

**Interfaces:**
- Consumes: go.mod from Task 1
- Produces: `internal/installer` package — `Installer` interface, `FindHookBin()`, concrete installers for Claude/Codex/OpenCode

- [ ] **Step 1: Copy installer files**

The installer package has zero project-internal imports. Copy all files:

```bash
mkdir -p ../agent-monitor-hook/internal/installer
cp internal/installer/*.go internal/installer/*.js ../agent-monitor-hook/internal/installer/
```

- [ ] **Step 2: Commit**

```bash
cd ../agent-monitor-hook
git add internal/installer/
git commit -m "feat: add installer package (Claude, Codex, OpenCode)"
```

---

### Task 4: Create internal/token package (hook variant)

**Files:**
- Create: `../agent-monitor-hook/internal/token/token.go`

**Interfaces:**
- Produces: `token.Generate()`, `token.Read()`, `token.Write()` — the token functions needed by setup and hook binaries

- [ ] **Step 1: Write token.go**

The hook repo only needs `Generate`, `Read`, `Write` — NOT `ConstantTimeCompare` (that's backend-only).

Write `../agent-monitor-hook/internal/token/token.go`:
```go
// Package token manages the daemon authentication token.
// Token is a 256-bit random value stored as Base64 in ~/.agent-monitor/local-token.
package token

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
)

const (
	TokenFileName = "local-token"
	TokenSize     = 32
)

func Generate() (string, error) {
	b := make([]byte, TokenSize)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

func Read(dir string) (string, error) {
	data, err := os.ReadFile(filepath.Join(dir, TokenFileName))
	if err != nil {
		return "", fmt.Errorf("read token: %w", err)
	}
	return string(data), nil
}

func Write(dir string, token string) error {
	path := filepath.Join(dir, TokenFileName)
	return os.WriteFile(path, []byte(token), 0600)
}
```

- [ ] **Step 2: Commit**

```bash
cd ../agent-monitor-hook
git add internal/token/
git commit -m "feat: add token package (generate, read, write)"
```

---

### Task 5: Copy sdk/ package

**Files:**
- Copy all from `sdk/` → `../agent-monitor-hook/sdk/`

**Interfaces:**
- Consumes: go.mod from Task 1
- Produces: `sdk` package — `AgentClient` interface, `AgentConfig`, `ExecutionManager`, Claude/Codex/OpenCode implementations

- [ ] **Step 1: Copy sdk files**

The sdk package has zero project-internal imports. Copy verbatim:

```bash
mkdir -p ../agent-monitor-hook/sdk
cp sdk/*.go ../agent-monitor-hook/sdk/
```

- [ ] **Step 2: Verify sdk compiles**

```bash
cd ../agent-monitor-hook
go build ./sdk/...
```

Expected: builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add sdk/
git commit -m "feat: add agent SDK library"
```

---

### Task 6: Hook repo — final build verification

- [ ] **Step 1: Full build**

```bash
cd ../agent-monitor-hook
go build ./...
```

Expected: all packages compile, no errors.

- [ ] **Step 2: Run tests**

```bash
go test ./internal/... ./sdk/... -count=1
```

Expected: all tests pass.

- [ ] **Step 3: Verify produced binaries**

```bash
make build
ls -la bin/
```

Expected: `agent-monitor-hook` and `agent-monitor-setup` binaries exist.

- [ ] **Step 4: Commit Makefile updates if any**

```bash
git add -A && git commit -m "chore: finalize hook repo build"
```

---

### Phase 2: Backend Repository

### Task 7: Initialize Backend repository structure

**Files:**
- Create: `../agent-monitor-server/go.mod`
- Create: `../agent-monitor-server/Makefile`
- Create: `../agent-monitor-server/README.md`

**Interfaces:**
- Produces: Go module `github.com/heybox/agent-monitor-server`
- Consumes: Hook repo SDK via `replace` directive (local path for now)

- [ ] **Step 1: Create directory and go.mod**

```bash
mkdir -p ../agent-monitor-server/cmd/daemon
mkdir -p ../agent-monitor-server/internal
```

Write `go.mod`:
```
module github.com/heybox/agent-monitor-server

go 1.26.3

require (
	github.com/fsnotify/fsnotify v1.10.1
	github.com/heybox/agent-monitor-hook v0.0.0
	github.com/shirou/gopsutil/v3 v3.24.5
	golang.org/x/crypto v0.53.0
	modernc.org/sqlite v1.52.0
)

replace github.com/heybox/agent-monitor-hook => ../agent-monitor-hook
```

- [ ] **Step 2: Download dependencies**

```bash
cd ../agent-monitor-server
go mod tidy
```

- [ ] **Step 3: Write Makefile**

```makefile
BIN_DIR := $(shell pwd)/bin
DAEMON  := $(BIN_DIR)/agent-monitor-daemon
MONITOR_DIR := $(HOME)/.agent-monitor
LISTEN_ADDR ?= 127.0.0.1:9101
LOG_FILE    ?= /tmp/agent-monitor-daemon.log

.PHONY: build
build:
	@mkdir -p $(BIN_DIR)
	go build -o $(DAEMON) ./cmd/daemon
	@echo "✓ daemon built → $(DAEMON)"

.PHONY: test
test:
	go test ./internal/... -count=1

.PHONY: run
run: build
	$(DAEMON) --listen $(LISTEN_ADDR)

.PHONY: dev
dev: build
	@echo "==> 前台开发模式 (Ctrl+C 停止)"
	$(DAEMON) --listen $(LISTEN_ADDR)

.PHONY: stop
stop:
	@killall agent-monitor-daemon 2>/dev/null \
		&& echo "✓ daemon stopped" \
		|| echo "○ no running daemon"

.PHONY: clean
clean:
	@$(MAKE) --no-print-directory stop
	@rm -rf $(BIN_DIR)
```

- [ ] **Step 4: Write README**

```bash
echo "# agent-monitor-server

Agent Monitor backend daemon. Watches agent lifecycle events, manages sessions in SQLite, serves real-time dashboard via HTTP/SSE.

## Build & Run
    make build
    make dev

## Test
    make test
" > README.md
```

- [ ] **Step 5: Commit**

```bash
cd ../agent-monitor-server
git init
git add go.mod go.sum Makefile README.md
git commit -m "init: agent-monitor-server repository"
```

---

### Task 8: Copy backend internal packages

**Files:**
- Copy: `cmd/daemon/` → `../agent-monitor-server/cmd/daemon/`
- Copy: `internal/auth/` → `../agent-monitor-server/internal/auth/`
- Copy: `internal/hierarchy/` → `../agent-monitor-server/internal/hierarchy/`
- Copy: `internal/hook/` → `../agent-monitor-server/internal/hook/`
- Copy: `internal/scanner/` → `../agent-monitor-server/internal/scanner/`
- Copy: `internal/server/` → `../agent-monitor-server/internal/server/`
- Copy: `internal/session/` → `../agent-monitor-server/internal/session/`
- Copy: `internal/token/` → `../agent-monitor-server/internal/token/`

**Interfaces:**
- Consumes: go.mod from Task 7
- Produces: All backend packages with updated import paths

- [ ] **Step 1: Copy all backend source files**

```bash
cp cmd/daemon/main.go ../agent-monitor-server/cmd/daemon/main.go
cp -r internal/auth/     ../agent-monitor-server/internal/auth/
cp -r internal/hierarchy/ ../agent-monitor-server/internal/hierarchy/
cp -r internal/hook/     ../agent-monitor-server/internal/hook/
cp -r internal/scanner/  ../agent-monitor-server/internal/scanner/
cp -r internal/server/   ../agent-monitor-server/internal/server/
cp -r internal/session/  ../agent-monitor-server/internal/session/
cp -r internal/token/    ../agent-monitor-server/internal/token/
```

Note: `internal/installer/` is NOT copied — it moved to the hook repo.

- [ ] **Step 2: Update all import paths**

Find and replace across all `.go` files in `../agent-monitor-server/`:

**Pattern 1** — Internal imports:
```
github.com/heybox/agent-monitor/internal/auth      → github.com/heybox/agent-monitor-server/internal/auth
github.com/heybox/agent-monitor/internal/hierarchy  → github.com/heybox/agent-monitor-server/internal/hierarchy
github.com/heybox/agent-monitor/internal/hook       → github.com/heybox/agent-monitor-server/internal/hook
github.com/heybox/agent-monitor/internal/scanner    → github.com/heybox/agent-monitor-server/internal/scanner
github.com/heybox/agent-monitor/internal/server     → github.com/heybox/agent-monitor-server/internal/server
github.com/heybox/agent-monitor/internal/session    → github.com/heybox/agent-monitor-server/internal/session
github.com/heybox/agent-monitor/internal/token      → github.com/heybox/agent-monitor-server/internal/token
```

**Pattern 2** — SDK import:
```
github.com/heybox/agent-monitor/sdk → github.com/heybox/agent-monitor-hook/sdk
```

Execute:
```bash
cd ../agent-monitor-server
find . -name '*.go' -exec sed -i '' 's|github.com/heybox/agent-monitor/internal/|github.com/heybox/agent-monitor-server/internal/|g' {} +
find . -name '*.go' -exec sed -i '' 's|github.com/heybox/agent-monitor/sdk|github.com/heybox/agent-monitor-hook/sdk|g' {} +
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add backend daemon and internal packages"
```

---

### Task 9: Backend repo — build verification

- [ ] **Step 1: Build all packages**

```bash
cd ../agent-monitor-server
go build ./...
```

Expected: all packages compile. If `go mod tidy` is needed:
```bash
go mod tidy
go build ./...
```

- [ ] **Step 2: Run tests**

```bash
go test ./internal/... -count=1
```

Expected: all tests pass.

- [ ] **Step 3: Build daemon binary**

```bash
make build
ls -la bin/agent-monitor-daemon
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: finalize backend repo build"
```

---

### Phase 3: Frontend Repository

### Task 10: Initialize Frontend repository

**Files:**
- Copy: `web/frontend/*` → `../agent-monitor-web/`
- Copy: `ui/` → `../agent-monitor-web/ui/`
- Create: `../agent-monitor-web/README.md`
- Create: `../agent-monitor-web/Makefile`

**Interfaces:**
- Produces: Vite + TypeScript SPA, communicates with backend at `localhost:9101`

- [ ] **Step 1: Copy frontend source**

```bash
mkdir -p ../agent-monitor-web
cp -r web/frontend/* ../agent-monitor-web/
```

- [ ] **Step 2: Copy UI prototypes**

```bash
cp -r ui ../agent-monitor-web/ui
```

- [ ] **Step 3: Write Makefile**

```makefile
.PHONY: install
install:
	npm install

.PHONY: dev
dev:
	npm run dev

.PHONY: build
build:
	npm run build

.PHONY: test
test:
	npm run test

.PHONY: clean
clean:
	rm -rf dist/ node_modules/
```

- [ ] **Step 4: Write README**

```bash
echo "# agent-monitor-web

Agent Monitor web dashboard. Real-time monitoring UI for AI coding agents.

## Dev
    npm install
    npm run dev

## Build
    npm run build

## Test
    npm run test
" > ../agent-monitor-web/README.md
```

- [ ] **Step 5: Install dependencies and verify**

```bash
cd ../agent-monitor-web
npm install
npm run build
```

Expected: TypeScript compiles, Vite builds to `dist/`.

- [ ] **Step 6: Run tests**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 7: Init git and commit**

```bash
git init
git add -A
git commit -m "init: agent-monitor-web repository"
```

---

### Phase 4: Cleanup Original Repository

### Task 11: Clean up monorepo

**Files:**
- Modify: `README.md`
- Delete: `cmd/`, `internal/`, `sdk/`, `web/frontend/`, `ui/`, `dev.sh`, `go.mod`, `go.sum`, `Makefile`, `NONONOAGENT.md`

- [ ] **Step 1: Update README to point to new repos**

Replace README content:
```markdown
# Agent Monitor (Infinity) — Archived Monorepo

This repository has been split into three independent repositories:

| Repository | Purpose |
|------------|---------|
| [agent-monitor-hook](https://github.com/heybox/agent-monitor-hook) | Hook binary, installer, agent SDK |
| [agent-monitor-server](https://github.com/heybox/agent-monitor-server) | Backend daemon, session management, HTTP/SSE API |
| [agent-monitor-web](https://github.com/heybox/agent-monitor-web) | Web dashboard frontend |

See the [design doc](docs/superpowers/specs/2026-07-01-three-repo-split-design.md) for architecture details.
```

- [ ] **Step 2: Remove migrated code**

```bash
rm -rf cmd/ internal/ sdk/ web/frontend/ ui/ dev.sh go.mod go.sum Makefile NONONOAGENT.md
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: archive monorepo — split into agent-monitor-hook, agent-monitor-server, agent-monitor-web"
```

---

### Phase 5: End-to-End Verification

### Task 12: Full integration test

- [ ] **Step 1: Build all three repos**

```bash
# Hook
cd ../agent-monitor-hook && make build

# Backend
cd ../agent-monitor-server && make build

# Frontend
cd ../agent-monitor-web && make build
```

- [ ] **Step 2: Install hook + setup binaries**

```bash
cd ../agent-monitor-hook && make install
```

- [ ] **Step 3: Initialize environment and install hooks**

```bash
agent-monitor-setup init
agent-monitor-setup install --all
```

- [ ] **Step 4: Start backend daemon**

```bash
cd ../agent-monitor-server
make dev &
sleep 1
```

- [ ] **Step 5: Send a test hook event**

```bash
echo '{"session_id":"e2e-test","hook_event_name":"SessionStart","cwd":"'$(pwd)'"}' \
  | agent-monitor-hook --agent-type claude
```

- [ ] **Step 6: Verify event was ingested**

```bash
curl --noproxy '*' -sf http://127.0.0.1:9101/health \
  -H "X-Daemon-Token: $(cat ~/.agent-monitor/local-token)"
```

Expected: `{"status":"ok"}` with non-zero session count.

- [ ] **Step 7: Start frontend dev server and verify dashboard loads**

```bash
cd ../agent-monitor-web
npm run dev &
sleep 2
curl --noproxy '*' -sf http://localhost:5173 | head -20
```

Expected: HTML page loads.

- [ ] **Step 8: Stop all processes**

```bash
killall agent-monitor-daemon 2>/dev/null
killall node 2>/dev/null  # Vite dev server
```

---

## Verification Checklist

After all tasks complete:
- [ ] `agent-monitor-hook`: `go build ./... && go test ./internal/... ./sdk/...` passes
- [ ] `agent-monitor-server`: `go build ./... && go test ./internal/...` passes
- [ ] `agent-monitor-web`: `npm run build && npm run test` passes
- [ ] End-to-end: hook writes event → daemon ingests → frontend displays
- [ ] Original repo is archived with updated README
