# Agent Monitor

本地 AI 编程 Agent 实时监控系统。通过 Hook 机制采集 Claude Code / Codex / OpenCode 的会话事件，提供 Web 看板实时查看。支持从 Web 页面向 OpenCode session 注入 prompt。

## 架构

```
Agent (Hook/Plugin) ──▶ agent-monitor-hook ──▶ events.jsonl ──fsnotify──▶ Daemon ──WS──▶ 浏览器 :9101
        ▲                                              ▲
        │                          PID Scanner (15s) ───┘
        │                          (CPU / Memory / Terminal / 死亡检测)
        │
   Web 输入 ──WS──▶ Daemon ──poll──▶ OpenCode 插件 ──SDK──▶ Agent 执行
```

## 快速开始

```bash
make start      # 一键启动 (构建 + 初始化 + 注册 hook + daemon 后台)
make web        # 打开 Web 看板
make status     # 查看运行状态
make stop       # 停止 daemon
make test       # 运行测试
```

### 开发常用

```bash
make restart    # 重建 + 重启 daemon (保留数据)
make reset      # 重建 + 清空所有数据 + 重启 (完全干净)
make deploy     # 重建 + 重装 OpenCode 插件 + 重启 daemon
make logs       # 查看 daemon 日志
make sessions   # 列出所有 session
```

### 测试

```bash
make test-hook SESSION=test-001   # 发送测试事件
```

## 目录结构

```
├── cmd/
│   ├── daemon/main.go      # Daemon 主进程入口
│   ├── hook/main.go         # agent-monitor-hook 二进制：被各 agent 的 hook 调用
│   └── setup/main.go        # agent-monitor-setup CLI：初始化 + hook 注册管理
├── internal/
│   ├── token/token.go       # Daemon 令牌生成 / 验证 / 常量时间比较
│   ├── hook/eventwatcher.go # fsnotify 监听 events.jsonl，解析 + 校验 + 转发
│   ├── session/
│   │   ├── types.go         # SessionKey / Session / Turn / Delta / HookEvent 等类型
│   │   ├── manager.go       # SessionManager：事件处理 / Turn 构建 / Delta 计算
│   │   ├── sqlite.go        # SQLite 持久化（modernc.org/sqlite 纯 Go）
│   │   └── recovery.go      # 启动时从 transcript JSONL 恢复 session
│   ├── scanner/
│   │   ├── types.go         # ProcessInfo / SessionPIDInfo 等类型
│   │   ├── scanner.go       # PID Scanner：15s gopsutil 扫描 + fallback 匹配
│   │   └── terminal.go      # Terminal Detector：PPID 链上溯识别终端
│   ├── server/
│   │   ├── server.go        # HTTP 服务启动 / 优雅关闭
│   │   ├── handlers.go      # REST API + X-Daemon-Token 鉴权中间件
│   │   └── websocket.go     # WebSocket Hub：注册 / 广播 / 心跳 / send_input
│   └── installer/
│       ├── installer.go     # 通用接口 Installer / Manifest / 备份
│       ├── claude.go        # Claude Code hook 安装到 ~/.claude/settings.json
│       ├── codex.go         # Codex hook 安装到 ~/.codex/hooks.json
│       └── opencode.go      # OpenCode JS Plugin + 轮询注入
├── web/dashboard.html       # Web 看板（时间线 + Web 输入）
├── Makefile                 # 一键构建 / 启动 / 部署 / 测试
└── go.mod
```

## 核心模块

### 1. agent-monitor-hook

被各 Agent 的 hook 机制调用的轻量二进制：
- 读取 stdin 中的 Agent hook 原始 JSON
- 自动提取 `session_id`、`hook_event_name`
- 用 `flock` 文件锁原子追加 JSON 行到 `events.jsonl`
- 完整保留原始 payload

### 2. EventWatcher

- fsnotify 监听 `events.jsonl` 的 `IN_MODIFY` 事件
- `events.offset` 持久化消费位点，断线续传
- 逐行解析 → token 校验 → 转给 SessionManager

### 3. SessionManager

- 内存 `map[SessionKey]*Session` + SQLite 双写
- 每个 hook 事件 → TurnEntry{Event, Payload}，完整保留原始数据
- 事件名在 web 端原样展示，不做分类映射
- Web 输入 → 新 Turn → 存入 pending 队列 → OpenCode 插件轮询注入
- PID Scanner 更新 CPU/Memory/Terminal/CWD
- 状态机：`active` ↔ `idle` → `stopped` / `disappeared` / `error`

### 4. Web 看板

- 时间线展示：Turn 按时间倒序，最新在最上
- 每个事件显示原生事件名 + 完整 payload 字段
- Turn 折叠：最新 Turn 默认展开，其余折叠
- 工具组折叠：多个 tool 合并显示，展开查看 input/output
- Web 输入：session card 底部输入框，Send 发送 prompt
- 长文本 Result 可折叠（>200 字符或 >3 行）
- Token 持久化到 localStorage，按状态筛选

### 5. Terminal Detector

- 从 Agent PID 沿 PPID 链上溯 ≤10 层
- 白名单：Ghostty / iTerm2 / Terminal / Warp / kitty / Alacritty / wezterm-gui / VS Code / Cursor / hyper

### 6. Hook 注册

| Agent | 配置文件 | 事件数 |
|-------|---------|--------|
| Claude Code | `~/.claude/settings.json` | 30 |
| Codex CLI | `~/.codex/hooks.json` | 10 |
| OpenCode | `~/.config/opencode/plugins/agent-monitor.js` | 29 原生 + 12 Part 类型 |

## 数据存储

| 文件 | 用途 |
|------|------|
| `~/.agent-monitor/device-id` | UUID v4 设备标识 |
| `~/.agent-monitor/local-token` | 256bit Base64 令牌 |
| `~/.agent-monitor/events.jsonl` | Hook 事件缓冲 |
| `~/.agent-monitor/events.offset` | 消费位点 |
| `~/.agent-monitor/daemon.db` | SQLite 持久化 (含 turns JSON) |

## HTTP API

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/sessions` | X-Daemon-Token | 全部 session |
| GET | `/api/sessions/:key` | X-Daemon-Token | 单个 session |
| GET | `/api/sessions/:key/pending-input` | X-Daemon-Token | 获取待注入输入 (200) 或无 (204) |
| GET | `/api/poll-input?agent_type=x&agent_session_id=x` | X-Daemon-Token | 插件轮询端点 |
| GET | `/health` | X-Daemon-Token | 健康检查 |
| GET | `/ws` | WS 首条消息 token | WebSocket |
| GET | `/` | 无 | 看板页面 |

## WebSocket 消息

| 方向 | type | 说明 |
|------|------|------|
| C→S | `auth` | 鉴权 `{type, token}` |
| S→C | `auth_ok` / `auth_error` | 鉴权结果 |
| S→C | `snapshot` | 全量 session 快照 |
| S→C | `delta` | 增量更新 `{session_key, changes}` |
| S→C | `session_added` | 新 session 出现 |
| C→S | `send_input` | Web 输入 `{session_key, text}` |
| C→S | `ping` | 心跳 |
| S→C | `pong` | 心跳回复 |

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
| 内容 | user_input, session_title, agent_output, turns | Hook 提取 |
| 状态 | turn_count, git_branch | Hook |

## SessionKey 计算

```
SessionKey = hex(SHA256(user_id|device_id|agent_type|agent_session_id))[:16]
```
