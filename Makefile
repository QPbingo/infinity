# ═══════════════════════════════════════════════════════════════════
# Agent Monitor — Makefile
#
# 生命周期三件套（启动 / 重置 / 结束）走同一套 helper，避免重复代码：
#   make start      构建并后台启动（保留已有数据）
#   make restart    改完代码一键重启 daemon（保留数据）
#   make reset      清空 daemon 数据 + hook 配置 → 干净重装 + 启动
#   make stop       仅终止 daemon
#   make deploy     改完 OpenCode 插件 → 重装 + 重启
#
# 顶层目标用 `| _helper` 声明顺序依赖（保证先停后启、原子性）。
# ═══════════════════════════════════════════════════════════════════

# ─── 路径与可执行 ──────────────────────────────────────────────────
BIN_DIR      := $(shell pwd)/bin
DAEMON       := $(BIN_DIR)/agent-monitor-daemon
HOOK         := $(BIN_DIR)/agent-monitor-hook
SETUP        := $(BIN_DIR)/agent-monitor-setup
FRONTEND_DIR := $(shell pwd)/web/frontend
MONITOR_DIR  := $(HOME)/.agent-monitor
TOKEN        := $(shell cat $(MONITOR_DIR)/local-token 2>/dev/null)

# ─── 启动参数（可由命令行覆盖） ──────────────────────────────────────
#   make start LISTEN_ADDR=0.0.0.0:9101
#   make restart CORS_ORIGINS=https://app.example.com
LISTEN_ADDR   ?= 127.0.0.1:9101
LOG_FILE      ?= /tmp/agent-monitor-daemon.log
CORS_ORIGINS  ?=                                       # 空表示用 daemon 默认 (http://localhost:5173)
DAEMON_FLAGS  := --listen $(LISTEN_ADDR)$(if $(CORS_ORIGINS), --cors-origins=$(CORS_ORIGINS),)
DASHBOARD     := http://localhost:5173
# 本地 curl 必须绕开任何系统级 http_proxy（如 127.0.0.1:7897 会高概率
# 把 localhost:9101 抢走，使 status / sessions / test-hook 全部空响应）。
CURL          := curl --noproxy '*' -sf

# ─── 元信息 ─────────────────────────────────────────────────────────
.DEFAULT_GOAL := help

.PHONY: help
help: ## 显示本帮助
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z][a-zA-Z0-9_-]*:.*?## / { printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST) | sort -u

# ═══════════════════════════════════════════════════════════════════
# 内部 helper（以 `_` 开头，不出现在 help 列表）
# ═══════════════════════════════════════════════════════════════════

.PHONY: _stop-daemon
_stop-daemon: ## [helper] 停止 daemon（幂等）
	@killall agent-monitor-daemon 2>/dev/null \
		&& echo "✓ 已停止旧 daemon" \
		|| echo "○ 无运行中的 daemon"

.PHONY: _start-daemon
_start-daemon: ## [helper] 后台启动 daemon 并验证存活
	@nohup $(DAEMON) $(DAEMON_FLAGS) > $(LOG_FILE) 2>&1 &
	@sleep 1
	@if pgrep -f agent-monitor-daemon > /dev/null 2>&1; then \
		echo "✓ daemon 已启动 → http://$(LISTEN_ADDR)"; \
	else \
		echo "✗ daemon 启动失败，查看日志: tail -f $(LOG_FILE)"; \
		exit 1; \
	fi

.PHONY: _init-env
_init-env: ## [helper] 初始化 device-id/local-token（已存在则跳过）
	@if [ ! -f "$(MONITOR_DIR)/device-id" ] || [ ! -f "$(MONITOR_DIR)/local-token" ]; then \
		$(SETUP) init; \
	else \
		echo "○ 环境已初始化，跳过"; \
	fi

.PHONY: _install-hooks
_install-hooks: ## [helper] 注册全部 agent hooks
	@$(SETUP) install --all

.PHONY: _uninstall-hooks
_uninstall-hooks: ## [helper] 卸载全部 agent hooks
	@-$(SETUP) uninstall --all 2>/dev/null || true

.PHONY: _report
_report: ## [helper] 启动后打印接下来该去哪看
	@echo ""
	@echo "  Web  : $(DASHBOARD)"
	@echo "  Log  : tail -f $(LOG_FILE)"
	@echo "  令牌 : $(shell head -c 16 $(MONITOR_DIR)/local-token 2>/dev/null)..."

# ═══════════════════════════════════════════════════════════════════
# 构建
# ═══════════════════════════════════════════════════════════════════

.PHONY: build
build: ## 编译三个 Go 二进制 → bin/
	@mkdir -p $(BIN_DIR)
	go build -o $(DAEMON) ./cmd/daemon
	go build -o $(HOOK)   ./cmd/hook
	go build -o $(SETUP)  ./cmd/setup
	@echo "✓ 构建完成"

.PHONY: frontend
frontend: ## 前端：npm install + npm run build → dist/
	@cd $(FRONTEND_DIR) && npm install && npm run build
	@echo "✓ 前端构建完成 → $(FRONTEND_DIR)/dist/"

.PHONY: dev-frontend
dev-frontend: ## 前端 dev server (Vite, :5173, 不构后端)
	@cd $(FRONTEND_DIR) && npm run dev

.PHONY: build-all
build-all: build frontend ## 后端 + 前端一键构建

.PHONY: install
install: build ## 把三件套拷到 /usr/local/bin/
	@install -m 755 $(DAEMON) /usr/local/bin/agent-monitor-daemon
	@install -m 755 $(HOOK)   /usr/local/bin/agent-monitor-hook
	@install -m 755 $(SETUP)  /usr/local/bin/agent-monitor-setup
	@echo "✓ 已安装到 /usr/local/bin/"

# ═══════════════════════════════════════════════════════════════════
# 生命周期：启动 / 停止 / 重启 / 重置 / 部署
# ═══════════════════════════════════════════════════════════════════

.PHONY: start
start: build ## 构建并后台启动（保留已有数据 + 重新注册 hooks）
	@echo "==> 1/4 初始化环境"
	@$(MAKE) --no-print-directory _init-env
	@echo ""
	@echo "==> 2/4 注册 agent hooks"
	@$(MAKE) --no-print-directory _install-hooks
	@echo ""
	@echo "==> 3/4 停止旧 daemon (如有)"
	@$(MAKE) --no-print-directory _stop-daemon
	@echo ""
	@echo "==> 4/4 启动 daemon"
	@$(MAKE) --no-print-directory _start-daemon
	@$(MAKE) --no-print-directory _report

.PHONY: stop
stop: ## 停止 daemon（data 不动）
	@$(MAKE) --no-print-directory _stop-daemon

.PHONY: restart
restart: build ## 重新构建 + 重启 daemon（保留数据）
	@echo "==> 重启 daemon (保留数据)"
	@$(MAKE) --no-print-directory _stop-daemon
	@$(MAKE) --no-print-directory _start-daemon
	@$(MAKE) --no-print-directory _report

.PHONY: reset
reset: build ## 彻底重置：卸 hooks + 删数据 + 初始化 + 重启
	@echo "==> 1/6 停止旧 daemon"
	@$(MAKE) --no-print-directory _stop-daemon
	@echo ""
	@echo "==> 2/6 卸载全部 agent hooks"
	@$(MAKE) --no-print-directory _uninstall-hooks
	@echo ""
	@echo "==> 3/6 清空 daemon 数据 (sqlite + events)"
	@rm -f $(MONITOR_DIR)/daemon.db $(MONITOR_DIR)/daemon.db-wal $(MONITOR_DIR)/daemon.db-shm
	@rm -f $(MONITOR_DIR)/events.jsonl $(MONITOR_DIR)/events.offset
	@echo "  ✓ 数据已清空"
	@echo ""
	@echo "==> 4/6 重新初始化环境"
	@$(SETUP) init
	@echo ""
	@echo "==> 5/6 重新注册 agent hooks"
	@$(MAKE) --no-print-directory _install-hooks
	@echo ""
	@echo "==> 6/6 启动 daemon"
	@$(MAKE) --no-print-directory _start-daemon
	@$(MAKE) --no-print-directory _report

.PHONY: deploy
deploy: build ## 改完 OpenCode 插件之后一键重装 + 重启
	@echo "==> 重新安装 OpenCode 插件"
	@$(SETUP) uninstall --opencode 2>/dev/null || true
	@$(SETUP) install --opencode
	@echo ""
	@echo "==> 重启 daemon"
	@$(MAKE) --no-print-directory _stop-daemon
	@$(MAKE) --no-print-directory _start-daemon
	@$(MAKE) --no-print-directory _report
	@echo "  ⚠ 还需重启 OpenCode 使新插件生效"

.PHONY: dev
dev: build ## 前台运行 daemon（Ctrl+C 停止，方便看日志）
	@$(MAKE) --no-print-directory _init-env
	@$(MAKE) --no-print-directory _install-hooks 2>/dev/null || true
	@echo "==> 前台开发模式 (Ctrl+C 停止)"
	$(DAEMON) $(DAEMON_FLAGS)

.PHONY: web
web: ## 启动前端 Vite dev server；daemon 没跑就先 make start
	@if ! pgrep -f agent-monitor-daemon > /dev/null 2>&1; then \
		echo "==> daemon 未运行，先 make start..."; \
		$(MAKE) --no-print-directory start; \
	fi
	@echo "==> 启动前端 dev server $(DASHBOARD)"
	@cd $(FRONTEND_DIR) && npm run dev

# ═══════════════════════════════════════════════════════════════════
# 诊断 / 日志 / 状态
# ═══════════════════════════════════════════════════════════════════

.PHONY: status
status: ## 运行状态：daemon / hooks / health / 最近事件
	@echo "=== Daemon ==="
	@if pgrep -f agent-monitor-daemon > /dev/null 2>&1; then \
		echo "  ● 运行中 (PID: $$(pgrep -f agent-monitor-daemon))"; \
	else \
		echo "  ○ 未运行 — 请运行 make start"; \
	fi
	@echo ""
	@echo "=== Hook 注册 ==="
	@$(SETUP) status 2>/dev/null || go run ./cmd/setup status
	@echo ""
	@echo "=== Health ==="
	@if [ -f "$(MONITOR_DIR)/local-token" ]; then \
		$(CURL) http://$(LISTEN_ADDR)/health -H "X-Daemon-Token: $$(cat $(MONITOR_DIR)/local-token)" 2>/dev/null \
			&& echo "" || echo "  ✗ daemon 未响应"; \
	else \
		echo "  未初始化 — 请运行 make reset"; \
	fi
	@echo ""
	@echo "=== 最近事件 (events.jsonl) ==="
	@if [ -f "$(MONITOR_DIR)/events.jsonl" ]; then \
		tail -3 "$(MONITOR_DIR)/events.jsonl" 2>/dev/null \
			| python3 -c "import sys,json; [print(f'  [{json.loads(l).get(\"event\",\"?\")}] {json.loads(l).get(\"agent_type\",\"?\")}/{json.loads(l).get(\"session_id\",\"?\")}') for l in sys.stdin if l.strip()]" 2>/dev/null \
			|| echo "  (解析失败)"; \
	else \
		echo "  无事件文件"; \
	fi

.PHONY: logs
logs: ## 打印最近 30 行 daemon 日志（一次性）
	@tail -30 $(LOG_FILE) 2>/dev/null || echo "无日志文件"

.PHONY: logs-follow
logs-follow: ## 实时跟踪 daemon 日志（Ctrl+C 退出）
	@tail -f $(LOG_FILE) 2>/dev/null || echo "无日志文件"

.PHONY: sessions
sessions: ## 列出 daemon 已知 sessions（直连 :9101，需从浏览器复制的 session_token）
	@if [ -z "$(COOKIE)" ]; then \
		echo "用法: make sessions COOKIE='session_token=<value>'"; \
		echo "  从浏览器 DevTools → Application → Cookies 复制 session_token"; \
		echo "  （/api/sessions 走 WebAuth，daemon token 不能用）"; \
		exit 1; \
	fi
	@$(CURL) http://$(LISTEN_ADDR)/api/sessions \
		-H "Cookie: $(COOKIE)" \
		| python3 -c 'import sys,json; [print(f"{s[\"agent_type\"]:10s} {s[\"status\"]:12s} sid={s[\"agent_session_id\"][:30]:30s} turns={len(s.get(\"turns\",[]))}") for s in json.load(sys.stdin)]' 2>/dev/null \
		|| echo "daemon 未响应 (cookie 失效? 重新登录获取新 session_token)"

.PHONY: diagnose
diagnose: ## 端到端事件管线诊断（独立运行，自带测试事件）
	@echo "=== 1. Daemon 进程 ==="
	@if pgrep -f agent-monitor-daemon > /dev/null 2>&1; then \
		echo "  ● 运行中 (PID: $$(pgrep -f agent-monitor-daemon))"; \
	else \
		echo "  ○ 未运行 — 请先执行 make start"; \
	fi
	@echo ""
	@echo "=== 2. Token ==="
	@if [ -f "$(MONITOR_DIR)/local-token" ]; then \
		echo "  ● 存在: $$(head -c 16 $(MONITOR_DIR)/local-token)..."; \
	else \
		echo "  ○ 缺失 — 请执行 make reset"; \
	fi
	@echo ""
	@echo "=== 3. Hook 安装状态 ==="
	@$(SETUP) status 2>/dev/null || echo "  (需要先 make build)"
	@echo ""
	@echo "=== 4. 最近事件 (events.jsonl) ==="
	@if [ -f "$(MONITOR_DIR)/events.jsonl" ]; then \
		lines=$$(wc -l < "$(MONITOR_DIR)/events.jsonl" 2>/dev/null); \
		echo "  总行数: $$lines"; \
		echo "  最近 5 条:"; \
		tail -5 "$(MONITOR_DIR)/events.jsonl" 2>/dev/null \
			| python3 -c "import sys,json; [print(f'    [{json.loads(l).get(\"event\",\"?\")}] agent={json.loads(l).get(\"agent_type\",\"?\")} session={json.loads(l).get(\"session_id\",\"?\")[:20]}') for l in sys.stdin if l.strip()]" 2>/dev/null \
			|| echo "    (解析失败)"; \
	else \
		echo "  ○ 文件不存在 — 尚无 hook 事件写入"; \
	fi
	@echo ""
	@echo "=== 5. Hook 调试日志 (最近 10 行) ==="
	@if [ -f /tmp/agent-monitor-hook.log ]; then \
		tail -10 /tmp/agent-monitor-hook.log; \
	else \
		echo "  ○ 暂无调试日志"; \
	fi
	@echo ""
	@echo "=== 6. 发送测试事件 (SessionStart) ==="
	@echo '{"session_id":"diagnose-test","hook_event_name":"SessionStart","cwd":"'$$(pwd)'"}' \
		| $(HOOK) --agent-type claude 2>&1 || true
	@sleep 0.2
	@echo ""
	@echo "=== 7. 验证事件已写入 ==="
	@if [ -f "$(MONITOR_DIR)/events.jsonl" ]; then \
		tail -1 "$(MONITOR_DIR)/events.jsonl" 2>/dev/null \
			| python3 -c "import sys,json; l=json.loads(sys.stdin.read()); print(f'  [{l[\"event\"]}] agent={l[\"agent_type\"]} session={l[\"session_id\"]}')" 2>/dev/null \
			|| echo "  ✗ 验证失败"; \
	fi
	@echo ""
	@echo "=== 8. Daemon 健康检查 ==="
	@if [ -f "$(MONITOR_DIR)/local-token" ]; then \
		$(CURL) http://$(LISTEN_ADDR)/health -H "X-Daemon-Token: $$(cat $(MONITOR_DIR)/local-token)" 2>/dev/null \
			&& echo "" || echo "  ✗ daemon 未响应"; \
	fi

# ═══════════════════════════════════════════════════════════════════
# 测试
# ═══════════════════════════════════════════════════════════════════

.PHONY: test
test: ## 后端 Go + 前端 Vitest
	go test ./internal/... -count=1
	@cd $(FRONTEND_DIR) && npm run test 2>/dev/null || echo "(前端测试跳过: 未安装依赖)"

.PHONY: test-hook
test-hook: build ## 对当前 daemon 发一个测试 hook 事件。用法: make test-hook SESSION=foo
	@if [ -z "$(SESSION)" ]; then \
		echo "用法: make test-hook SESSION=<my-session-id>"; \
		exit 1; \
	fi
	@echo "==> 发送 SessionStart + PostToolUse 给 $(SESSION)..."
	@echo '{"session_id":"$(SESSION)","hook_event_name":"SessionStart","cwd":"'$$(pwd)'"}' \
		| $(HOOK) --agent-type claude
	@echo '{"session_id":"$(SESSION)","hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"echo test"}}' \
		| $(HOOK) --agent-type claude
	@sleep 0.3
	@echo "✓ 事件已发送"
	@echo "==> daemon 健康检查:"
	@TOKEN=$$(cat $(MONITOR_DIR)/local-token); \
		$(CURL) http://$(LISTEN_ADDR)/health -H "X-Daemon-Token: $$TOKEN" \
			&& echo "  (✓ 已收到测试事件)" || echo "  ✗ daemon 未响应"

# ═══════════════════════════════════════════════════════════════════
# 清理
# ═══════════════════════════════════════════════════════════════════

.PHONY: clean
clean: ## 停 daemon + 删 bin/（不动 ~/.agent-monitor 数据）
	@echo "==> 清理..."
	@$(MAKE) --no-print-directory _stop-daemon
	@rm -rf $(BIN_DIR)
	@echo "✓ 清理完成 (bin/ 已删, ~/.agent-monitor 数据保留)"