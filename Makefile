.PHONY: build start stop web clean install dev restart reset deploy logs sessions test frontend dev-frontend

BIN_DIR      := $(shell pwd)/bin
DAEMON       := $(BIN_DIR)/agent-monitor-daemon
HOOK         := $(BIN_DIR)/agent-monitor-hook
SETUP        := $(BIN_DIR)/agent-monitor-setup
FRONTEND_DIR := $(shell pwd)/web/frontend
DASHBOARD    := http://localhost:5173
MONITOR_DIR  := $(HOME)/.agent-monitor
TOKEN        := $(shell cat $(MONITOR_DIR)/local-token 2>/dev/null)

default: build

build:
	@mkdir -p $(BIN_DIR)
	go build -o $(DAEMON) ./cmd/daemon
	go build -o $(HOOK)   ./cmd/hook
	go build -o $(SETUP)  ./cmd/setup
	@echo "✓ 构建完成"

# 前端: 安装依赖 + 构建 dist/
frontend:
	@cd $(FRONTEND_DIR) && npm install && npm run build
	@echo "✓ 前端构建完成 → $(FRONTEND_DIR)/dist/"

# 前端开发模式 (Vite dev server, :5173)
dev-frontend:
	@cd $(FRONTEND_DIR) && npm run dev

# 一键构建: 后端 + 前端
build-all: build frontend
	@echo "✓ 全部构建完成"

# 一键启动 (构建+初始化+注册hook+后台运行daemon)
start: build
	@echo "==> 1/4 初始化环境..."
	@if [ ! -f "$(MONITOR_DIR)/device-id" ] || [ ! -f "$(MONITOR_DIR)/local-token" ]; then \
		$(SETUP) init; \
	else \
		echo "    已初始化, 跳过"; \
	fi
	@echo ""
	@echo "==> 2/4 注册全部 agent hooks..."
	@$(SETUP) install --all
	@echo ""
	@echo "==> 3/4 停止旧 daemon (如有)..."
	@killall agent-monitor-daemon 2>/dev/null || true
	@sleep 0.5
	@echo ""
	@echo "==> 4/4 启动 daemon..."
	@nohup $(DAEMON) --listen 127.0.0.1:9101 > /tmp/agent-monitor-daemon.log 2>&1 &
	@sleep 1
	@if pgrep -f agent-monitor-daemon > /dev/null 2>&1; then \
		echo "✓ 全部启动完成 → $(DASHBOARD)"; \
	else \
		echo "✗ daemon 启动失败，查看日志: cat /tmp/agent-monitor-daemon.log"; \
	fi

# 查看运行状态
status:
	@echo "=== Daemon ==="
	@if pgrep -f agent-monitor-daemon > /dev/null 2>&1; then \
		echo "  ● 运行中 (PID: $$(pgrep -f agent-monitor-daemon))"; \
	else \
		echo "  ○ 未运行"; \
	fi
	@echo ""
	@echo "=== Hook 注册 ==="
	@$(BIN_DIR)/agent-monitor-setup status 2>/dev/null || go run ./cmd/setup status
	@echo ""
	@echo "=== Health ==="
	@if [ -f "$(MONITOR_DIR)/local-token" ]; then \
		curl -sf http://127.0.0.1:9101/health -H "X-Daemon-Token: $$(cat $(MONITOR_DIR)/local-token)" 2>/dev/null \
			&& echo "" || echo "  ✗ daemon 未响应"; \
	else \
		echo "  未初始化"; \
	fi
	@echo ""
	@echo "=== 最近事件 ==="
	@if [ -f "$(MONITOR_DIR)/events.jsonl" ]; then \
		tail -3 "$(MONITOR_DIR)/events.jsonl" 2>/dev/null | python3 -c "import sys,json; [print(f'  [{json.loads(l).get(\"event\",\"?\")}] {json.loads(l).get(\"agent_type\",\"?\")}/{json.loads(l).get(\"session_id\",\"?\")}') for l in sys.stdin if l.strip()]" 2>/dev/null || echo "  无事件"; \
	else \
		echo "  无事件文件"; \
	fi

# 发送测试 hook 事件
test-hook:
	@if [ -z "$(SESSION)" ]; then \
		echo "Usage: make test-hook SESSION=my-session"; \
		exit 1; \
	fi
	@echo '{"session_id":"$(SESSION)","hook_event_name":"SessionStart","cwd":"'$$(pwd)'"}' \
		| $(BIN_DIR)/agent-monitor-hook --agent-type claude
	@echo '{"session_id":"$(SESSION)","hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"echo test"}}' \
		| $(BIN_DIR)/agent-monitor-hook --agent-type claude
	@echo "✓ 事件已发送"
	@TOKEN=$$(cat $(MONITOR_DIR)/local-token); \
	curl -sf http://127.0.0.1:9101/api/sessions -H "X-Daemon-Token: $$TOKEN" | python3 -m json.tool 2>/dev/null
	@echo "==> 停止 agent-monitor-daemon..."
	@killall agent-monitor-daemon 2>/dev/null && echo "✓ 已停止" || echo "! 未找到运行中的 daemon"

# 打开 web 看板 (前端 dev server :5173, 需后端 :9101 运行)
web:
	@if ! pgrep -f agent-monitor-daemon > /dev/null 2>&1; then \
		echo "==> daemon 未运行，先启动..."; \
		$(MAKE) --no-print-directory start; \
	fi
	@echo "==> 启动前端 dev server $(DASHBOARD)"
	@cd $(FRONTEND_DIR) && npm run dev

# 开发模式: 构建 + 前台运行 (Ctrl+C 停止)
dev: build
	go build -o $(SETUP) ./cmd/setup
	@if [ ! -f "$(MONITOR_DIR)/local-token" ]; then $(SETUP) init; fi
	@$(SETUP) install --all 2>/dev/null || true
	@echo "==> 开发模式 (Ctrl+C 停止)..."
	$(DAEMON) --listen 127.0.0.1:9101

# 安装到系统路径
install: build
	@install -m 755 $(DAEMON) /usr/local/bin/agent-monitor-daemon
	@install -m 755 $(HOOK)   /usr/local/bin/agent-monitor-hook
	@install -m 755 $(SETUP)  /usr/local/bin/agent-monitor-setup
	@echo "✓ 已安装到 /usr/local/bin/"

# 清理
clean:
	@echo "==> 清理..."
	@killall agent-monitor-daemon 2>/dev/null || true
	@rm -rf $(BIN_DIR)
	@echo "✓ 清理完成"

# 重启 daemon (保留数据)
restart: build
	@echo "==> 停止旧 daemon..."
	@killall agent-monitor-daemon 2>/dev/null || true
	@sleep 0.5
	@echo "==> 启动 daemon..."
	@nohup $(DAEMON) --listen 127.0.0.1:9101 > /tmp/agent-monitor-daemon.log 2>&1 &
	@sleep 1
	@if pgrep -f agent-monitor-daemon > /dev/null 2>&1; then \
		echo "✓ 已重启 → $(DASHBOARD)"; \
	else \
		echo "✗ 启动失败，查看日志: cat /tmp/agent-monitor-daemon.log"; \
	fi

# 完全重置 (清空所有 hook 配置 + daemon 数据 + 重建 + 重启)
reset: build
	@echo "==> 1/6 停止旧 daemon..."
	@killall agent-monitor-daemon 2>/dev/null || true
	@sleep 0.5
	@echo ""
	@echo "==> 2/6 卸载全部 agent hooks..."
	@-$(SETUP) uninstall --all 2>/dev/null
	@echo ""
	@echo "==> 3/6 清空 daemon 数据..."
	@rm -f $(MONITOR_DIR)/daemon.db $(MONITOR_DIR)/daemon.db-wal $(MONITOR_DIR)/daemon.db-shm
	@rm -f $(MONITOR_DIR)/events.jsonl $(MONITOR_DIR)/events.offset
	@echo ""
	@echo "==> 4/6 重新初始化环境..."
	@$(SETUP) init
	@echo ""
	@echo "==> 5/6 重新注册全部 agent hooks..."
	@$(SETUP) install --all
	@echo ""
	@echo "==> 6/6 启动 daemon..."
	@nohup $(DAEMON) --listen 127.0.0.1:9101 > /tmp/agent-monitor-daemon.log 2>&1 &
	@sleep 1
	@echo ""
	@if pgrep -f agent-monitor-daemon > /dev/null 2>&1; then \
		echo "✓ 全部重置完成 → $(DASHBOARD)"; \
		echo ""; \
		echo "  Token: $$(cat $(MONITOR_DIR)/local-token)"; \
	else \
		echo "✗ daemon 启动失败，查看日志: cat /tmp/agent-monitor-daemon.log"; \
	fi

# 部署插件 + 重启 (开发用: 改完代码一键生效)
deploy: build
	@echo "==> 重新安装 OpenCode 插件..."
	@$(SETUP) uninstall --opencode 2>/dev/null || true
	@$(SETUP) install --opencode
	@echo "==> 重启 daemon..."
	@killall agent-monitor-daemon 2>/dev/null || true
	@sleep 0.5
	@nohup $(DAEMON) --listen 127.0.0.1:9101 > /tmp/agent-monitor-daemon.log 2>&1 &
	@sleep 1
	@echo "✓ 部署完成 → $(DASHBOARD)"
	@echo "  ⚠ 还需重启 OpenCode 使新插件生效"

# 查看 daemon 日志
logs:
	@tail -30 /tmp/agent-monitor-daemon.log 2>/dev/null || echo "无日志文件"

# 诊断事件管线
diagnose:
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
		tail -5 "$(MONITOR_DIR)/events.jsonl" 2>/dev/null | python3 -c "import sys,json; [print(f'    [{json.loads(l).get(\"event\",\"?\")}] agent={json.loads(l).get(\"agent_type\",\"?\")} session={json.loads(l).get(\"session_id\",\"?\")[:20]}') for l in sys.stdin if l.strip()]" 2>/dev/null || echo "    (解析失败)"; \
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
	@echo "=== 6. 发送测试事件 ==="
	@echo '{"session_id":"diagnose-test","hook_event_name":"SessionStart","cwd":"'$$(pwd)'"}' \
		| $(HOOK) --agent-type claude 2>&1 || true
	@sleep 0.2
	@echo ""
	@echo "=== 7. 验证测试事件是否写入 ==="
	@if [ -f "$(MONITOR_DIR)/events.jsonl" ]; then \
		tail -1 "$(MONITOR_DIR)/events.jsonl" 2>/dev/null | python3 -c "import sys,json; l=json.loads(sys.stdin.read()); print(f'  [{l[\"event\"]}] agent={l[\"agent_type\"]} session={l[\"session_id\"]}')" 2>/dev/null || echo "  ✗ 验证失败"; \
	fi
	@echo ""
	@echo "=== 8. Daemon 健康检查 ==="
	@if [ -f "$(MONITOR_DIR)/local-token" ]; then \
		curl -sf http://127.0.0.1:9101/health -H "X-Daemon-Token: $$(cat $(MONITOR_DIR)/local-token)" 2>/dev/null && echo "" || echo "  ✗ daemon 未响应"; \
	fi

# 查看所有 session
sessions:
	@if [ -z "$(TOKEN)" ]; then echo "未初始化，先运行 make start"; exit 1; fi
	@curl -sf $(DASHBOARD)/api/sessions -H "X-Daemon-Token: $(TOKEN)" | python3 -c 'import sys,json; [print(f"{s[\"agent_type\"]:10s} {s[\"status\"]:12s} sid={s[\"agent_session_id\"][:30]:30s} turns={len(s.get(\"turns\",[]))}") for s in json.load(sys.stdin)]' 2>/dev/null || echo "daemon 未响应"

# 运行测试 (后端 Go + 前端 Vitest)
test:
	go test ./internal/... -count=1
	@cd $(FRONTEND_DIR) && npm run test 2>/dev/null || echo "(前端测试跳过: 未安装依赖)"
