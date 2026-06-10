.PHONY: build start stop web clean install dev

BIN_DIR      := $(shell pwd)/bin
DAEMON       := $(BIN_DIR)/agent-monitor-daemon
HOOK         := $(BIN_DIR)/agent-monitor-hook
SETUP        := $(BIN_DIR)/agent-monitor-setup
DASHBOARD    := http://127.0.0.1:9101
MONITOR_DIR  := $(HOME)/.agent-monitor

default: build

build:
	@mkdir -p $(BIN_DIR)
	go build -o $(DAEMON) ./cmd/daemon
	go build -o $(HOOK)   ./cmd/hook
	go build -o $(SETUP)  ./cmd/setup
	@echo "✓ 构建完成"

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

# 打开 web 看板
web:
	@if ! pgrep -f agent-monitor-daemon > /dev/null 2>&1; then \
		echo "==> daemon 未运行，先启动..."; \
		$(MAKE) --no-print-directory start; \
	fi
	@echo "==> 打开看板 $(DASHBOARD)"
	@open $(DASHBOARD) 2>/dev/null || xdg-open $(DASHBOARD) 2>/dev/null || \
		echo "请手动打开: $(DASHBOARD)"

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
