# Agent Monitor

本地 AI 编程 Agent 实时监控系统。通过 Hook 机制采集 Claude Code / Codex / OpenCode 的会话事件，提供 Web 看板实时查看。

## 架构

```
Agent (Hook/Plugin) ──▶ agent-monitor-hook ──▶ events.jsonl ──fsnotify──▶ Daemon ──WS──▶ 浏览器 :9101
                                                    ▲
                              PID Scanner (15s) ────┘
                              (CPU / Memory / Terminal / 死亡检测)
```

## 目录结构

```
agent-monitor/
├── cmd/
│   ├── daemon/main.go      # Daemon 主进程入口
│   ├── hook/main.go         # agent-monitor-hook 二进制：被各 agent 的 hook 调用
│   └── setup/main.go        # agent-monitor-setup CLI：初始化 + hook 注册管理
├── internal/
│   ├── token/token.go       # Daemon 令牌生成 / 验证 / 常量时间比较
│   ├── hook/eventwatcher.go # fsnotify 监听 events.jsonl，解析 + 校验 + 转发
│   ├── session/
│   │   ├── types.go         # SessionKey / Session / Delta / HookEvent 等核心类型
│   │   ├── manager.go       # SessionManager：CRUD / Delta 计算 / 字段提取
│   │   ├── sqlite.go        # SQLite 持久化（modernc.org/sqlite 纯 Go）
│   │   └── recovery.go      # 启动时从 transcript JSONL 恢复最近 24h 的 session
│   ├── scanner/
│   │   ├── types.go         # ProcessInfo / SessionPIDInfo / SessionUpdater 接口
│   │   ├── scanner.go       # PID Scanner：15s gopsutil 扫描 + fallback 匹配
│   │   └── terminal.go      # Terminal Detector：PPID 链上溯识别终端
│   ├── server/
│   │   ├── server.go        # HTTP 服务启动 / 优雅关闭
│   │   ├── handlers.go      # REST API + X-Daemon-Token 鉴权中间件
│   │   └── websocket.go     # WebSocket Hub：注册 / 广播 / 心跳
│   └── installer/
│       ├── installer.go     # 通用接口 Installer / Manifest / 备份 / 托管标记
│       ├── claude.go        # Claude Code hook 安装到 ~/.claude/settings.json
│       ├── codex.go         # Codex hook 安装到 ~/.codex/hooks.json
│       └── opencode.go      # OpenCode JS Plugin 安装到 ~/.config/opencode/plugins/
├── web/dashboard.html       # Web 看板（单页 HTML，WS 实时更新）
├── Makefile                 # 一键构建 / 启动 / 停止
└── go.mod
```

## 核心模块

### 1. agent-monitor-hook

被各 Agent 的 hook 机制调用的轻量二进制。职责：
- 读取 stdin 中的 Agent hook 原始 JSON
- 自动提取 `session_id`、`hook_event_name`（参数未传时）
- 自动读取 `~/.agent-monitor/local-token`（参数未传时）
- 用 `flock` 文件锁原子追加 JSON 行到 `events.jsonl`

### 2. EventWatcher (internal/hook)

- fsnotify 监听 `events.jsonl` 的 `IN_MODIFY` 事件
- 通过 `events.offset` 持久化消费位点，实现断线续传
- 逐行解析 JSON → 校验 token（常量时间比较）→ 转给 SessionManager
- 启动时 catch-up 读取已写入但未消费的行

### 3. SessionManager (internal/session)

- 内存 `map[SessionKey]*Session` + SQLite 双写
- Hook 事件 → 创建 / 更新 session，提取 `user_input`、`session_title`、`agent_output`、`last_hook_event`
- PID Scanner 更新 → CPU / Memory / Terminal / CWD
- 状态机：`active` ↔ `idle` → `stopped` / `disappeared`（可复活）
- 变更时生成 Delta，通过 Notify 回调推送到 WebSocket Hub

### 4. PID Scanner (internal/scanner)

- 15s Ticker 驱动 gopsutil 全量扫描
- 进程名匹配：`opencode` / `claude` / `codex` + `node` cmdline 模糊匹配
- 已绑定 PID 的 session → 更新 CPU / Memory
- PID 消失 → `MarkDisappeared`
- PID fallback：记录 PID 找不到时，按 `agent_type + CWD` 搜索匹配

### 5. Terminal Detector (internal/scanner)

- 从 Agent PID 出发，沿 PPID 链上溯 ≤10 层
- 白名单匹配：Ghostty / iTerm2 / Terminal / Warp / kitty / Alacritty / wezterm-gui / VS Code / Cursor / hyper

### 6. WebSocket Hub (internal/server)

- WS 连接首条消息携带 token 鉴权
- 鉴权通过 → 推全量 Snapshot → 后续实时广播 Delta
- 心跳：30s pong，写超时 10s，buffer 满自动断开

### 7. Hook 注册 (internal/installer)

| Agent | 配置文件 | 注册方式 |
|-------|---------|---------|
| Claude Code | `~/.claude/settings.json` | 写入 `hooks` 节点，exec form |
| Codex CLI | `~/.codex/hooks.json` + `config.toml` | 写入 `hooks` + `[features] hooks=true`，shell form |
| OpenCode | `~/.config/opencode/plugins/agent-monitor.js` | JS Plugin，使用官方 `event` handler 模式 |

- **托管标记**：`"name": "agent-monitor"` 或命令匹配，卸载时只删自身
- **幂等安装**：重复 install 自动跳过
- **备份**：修改前备份 `.backup.xxxx` 文件

### 8. Session Recovery

启动时扫描各 Agent 的 transcript JSONL：
- OpenCode：`~/.config/opencode/sessions/*.jsonl`
- Claude Code：`~/.claude/projects/*/*.jsonl`
- Codex：`~/.codex/sessions/**/rollout-*.jsonl`

恢复后立即用 `(agent_type, cwd_hash)` 匹配运行中进程。

### 9. Web 看板

- 单页 HTML，WS 连接 daemon 获取实时数据
- 卡片式布局，展开显示：标题 / 用户输入 / Agent 输出时间线 / 终端 / 原始 Payload
- Token 持久化到 localStorage
- 按状态筛选：Active / Idle / Stopped / Disappeared

## 快速开始

```bash
# 一键启动（构建 + 初始化 + 注册所有 agent hook + daemon 后台运行）
make start

# 打开 Web 看板
make web

# 查看运行状态
make status

# 停止 daemon
make stop

# 手动发送测试事件验证链路
make test-hook SESSION=test-001
```

## 数据存储

| 文件 | 用途 | 权限 |
|------|------|------|
| `~/.agent-monitor/device-id` | UUID v4 设备标识 | 0600 |
| `~/.agent-monitor/local-token` | 256bit Base64 令牌 | 0600 |
| `~/.agent-monitor/events.jsonl` | Hook 事件缓冲 | 0600 |
| `~/.agent-monitor/events.offset` | 消费位点 (int64) | 0600 |
| `~/.agent-monitor/daemon.db` | SQLite 持久化 | 0600 |

## HTTP API

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/sessions` | X-Daemon-Token | 全部 session |
| GET | `/api/sessions/:key` | X-Daemon-Token | 单个 session |
| GET | `/health` | X-Daemon-Token | 健康检查 |
| GET | `/ws` | WS 首条消息携 token | WebSocket |
| GET | `/` | 无 | 看板页面 |

## Daemon 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--listen` | `127.0.0.1:9101` | HTTP 监听地址 |
| `--scan-interval` | `15` | PID 扫描间隔(秒) |
| `--user-id` | `"local"` | 用户标识 |

## Session 字段

| 分组 | 字段 | 来源 |
|------|------|------|
| 标识 | user_id, device_id, agent_type, agent_session_id, session_key | Hook |
| 进程 | pid, terminal, cwd, memory_mb, cpu_percent | PID Scanner |
| 事件 | status, start_time_ms, last_event_time_ms, last_event_type, last_hook_event | Hook |
| 内容 | user_input, session_title, agent_output, last_file, last_command, payload | Hook 提取 |
| 状态 | turn_count, git_branch | Hook |

## SessionKey 计算

```
SessionKey = hex(SHA256(user_id|device_id|agent_type|agent_session_id))[:16]
```
