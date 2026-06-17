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
│   ├── auth/
│   │   ├── types.go          # User, TokenInfo 类型
│   │   ├── store.go          # 用户 CRUD、bcrypt 认证、Bearer Token
│   │   └── middleware.go     # Auth 中间件（兼容 X-Daemon-Token + Bearer）
│   ├── hierarchy/
│   │   ├── types.go          # Workspace/Project/Topic/Story/HierarchyTree 类型
│   │   ├── store.go          # 完整 CRUD + EnsureInspiration
│   │   └── permissions.go    # 权限表 + CheckProjectPermission 等检查函数
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
├── web/dashboard.html       # Web 看板（时间线 + Agent 控制台 + 层级管理）
├── sdk/
│   ├── sdk.go               # AgentSDK 统一接口 + 公共类型
│   ├── claude.go             # ClaudeSDK — CLI 子进程 (--output-format stream-json)
│   ├── opencode.go           # OpenCodeSDK — ACP JSON-RPC 2.0 (opencode acp)
│   ├── codex.go              # CodexSDK — CLI 子进程 (codex exec --json)
│   ├── manager.go            # AgentManager — 多 agent 统一编排
│   └── execution.go          # ExecutionStore — 执行记录持久化（跨重连恢复）
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

### 6. Agent SDK — 编程控制 Agent

通过 SDK 可从 Web 端或 API 直接创建/控制 AI 编程 Agent（Claude Code / OpenCode / Codex）。

#### AgentSDK 统一接口（8 个方法）

| 方法 | 说明 |
|------|------|
| `CreateSession(ctx, opts)` | 创建会话 |
| `SendPrompt(ctx, sessionID, prompt)` | 发送 prompt，返回 `<-chan Message` 流式消息 |
| `ResumeSession(ctx, sessionID)` | 恢复已有 session |
| `CancelExecution(ctx, sessionID)` | 取消该 session 下所有运行中的执行 |
| `RenameSession(ctx, sessionID, title)` | 重命名 |
| `ListSessions(ctx, dir)` | 列出会话 |
| `SetPermissionMode(sessionID, mode)` | 设置权限模式 |
| `Close()` | 清理子进程资源 |

#### 三端实现方式

| Agent | 通信方式 | 会话连续性 |
|-------|---------|-----------|
| ClaudeSDK | `claude -p "..." --output-format stream-json` | `--resume <id>` |
| OpenCodeSDK | `opencode acp` JSON-RPC 2.0 stdio | `session/load` |
| CodexSDK | `codex exec --json "..."` | `--resume <id>` |

#### Agent API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/agent/{type}/sessions` | 创建 agent 会话 |
| `GET` | `/api/agent/{type}/sessions` | 列出会话 |
| `POST` | `/api/agent/{type}/sessions/{id}/prompt` | 发送 prompt（SSE 流式返回） |
| `POST` | `/api/agent/{type}/sessions/{id}/cancel` | 取消该 session 所有执行 |
| `POST` | `/api/agent/{type}/sessions/{id}/resume` | 恢复会话 |
| `PUT` | `/api/agent/{type}/sessions/{id}/rename` | 重命名 |
| `PUT` | `/api/agent/{type}/sessions/{id}/permissions` | 设置权限模式 |

`{type}` = `claude` / `opencode` / `codex`

#### 后台执行 + 重连恢复

Agent 执行与 WebSocket 连接解耦：

```
用户提交 prompt → daemon 创建 ExecutionRecord → 后台 goroutine 执行 agent CLI
                                               → 消息写入 ExecutionStore（内存）
                                               → WS 实时推送（如果连接存活）

用户关闭浏览器 → agent 继续在后台运行
用户重连浏览器 → WebSocket 发送 agent_executions 快照 → 全部历史执行恢复
```

- 超时时间可自选：5m / 10m / 30m / 1h / 2h（默认 10m，上限 120m）
- 执行历史上限 500 条，超出逐出最旧记录
- 同一 session 支持多个并发执行（各自独立 execID，互不干扰）

#### WebSocket 消息（Agent 控制）

| 方向 | type | 说明 |
|------|------|------|
| C→S | `agent_prompt` | 发送 prompt `{agent_type, session_id, prompt, timeout_minutes}` |
| C→S | `agent_cancel` | 取消执行 `{agent_type, session_id, exec_id}` |
| S→C | `agent_executions` | 重连时全量执行历史 |
| S→C | `agent_exec_started` | 新执行开始通知 |
| S→C | `agent_message` | 流式消息 `{exec_id, msg_type, content, is_final}` |
| S→C | `agent_session_created` | 自动创建 session 的 ID 返回 |
| S→C | `agent_error` | 执行错误 |

### 7. Hook 注册

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
| S→C | `hierarchy_snapshot` | 全量层级树（workspace→project→topic→story） |
| S→C | `hierarchy_updated` | 层级变更增量 |
| S→C | `agent_executions` | 重连时全量执行历史 |
| S→C | `agent_message` | Agent 流式消息 `{exec_id, msg_type, content}` |
| C→S | `agent_prompt` | 发送 prompt 给 agent |
| C→S | `agent_cancel` | 取消 agent 执行 |
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

## Web 渲染数据字段层级

以下是从 Go 结构体 → JSON → WebSocket → 浏览器 DOM 的完整字段映射：

```
Session                              ← 顶层，对应一个 agent 会话
├── session_key:    string          卡片唯一标识，用于展开/折叠/delta 匹配
├── agent_type:     string          卡片头部左侧标签 (claude/codex/opencode)
├── session_title:  string          卡片头部标题 (fallback: agent_session_id)
├── agent_session_id: string        卡片展开后的 "Session" 字段 (截断到 12 字符)
├── status:         string          状态徽章 (active/idle/stopped/disappeared/error)
├── last_hook_event: string         事件徽章，显示最近一次 hook 事件名
├── terminal:       string          终端模拟器名称
├── cpu_percent:    float64         CPU 占用百分比
├── memory_mb:      float64         内存 MB
├── turn_count:     int             Turn 计数 (T3 = 3 轮)
├── pid:            int             进程 PID
├── cwd:            string          工作目录 (截断到 30 字符)
├── start_time_ms:  int64           (内部使用，未直接展示)
├── last_event_time_ms: int64       排序依据 (最新事件排最前)
├── last_event_type: string         (内部记录)
├── last_file:      string          (内部记录)
├── last_command:   string          (内部记录)
├── git_branch:     string          (内部记录，未直接展示)
├── user_input:     string          (最后一次用户输入，legacy 展示用)
├── agent_output:   string          (最后一次 agent 输出，legacy 展示用)
├── payload:        json.RawMessage 卡片底部 "Raw Payload" 折叠区 (原始 JSON)
│
├── turns: []Turn                   时间线，按事件分组
│   └── Turn
│       ├── turn_idx:   int         展示为 "Turn 1", "Turn 2" ...
│       ├── user_input: string      用户输入文本 (展示在 turn header + 正文)
│       ├── user_ts:    int64       时间戳
│       └── entries: []TurnEntry    该 turn 内的所有事件条目
│           └── TurnEntry
│               ├── event:   string          事件名 (展示为标签，如 PreToolUse)
│               ├── ts:      int64           时间戳
│               ├── start_ts: int64          工具组起始时间
│               ├── payload: json.RawMessage 事件原始 payload
│               │   └── 通过 formatPayloadDisplay 渲染为 key: value 文本
│               │       跳过字段: daemon_token, _role
│               └── tools: []ToolCall         工具调用列表 (仅 PreToolUse/PostToolUse)
│                   └── ToolCall
│                       ├── name:    string   工具名 (Bash, Read, Write ...)
│                       ├── status:  string   状态 (running / completed / error)
│                       ├── input:   string   输入 (截断到 120 字符)
│                       ├── output:  string   输出 (截断到 200 字符)
│                       ├── start_ts: int64   开始时间
│                       └── end_ts:  int64    结束时间
```

### WebSocket 消息到达前端的 3 种路径

| 消息 type | 触发时机 | 前端处理 |
|-----------|---------|---------|
| `snapshot` | WebSocket 连接建立后 | 全量替换 `sessions`，渲染全部卡片 |
| `session_added` | 新会话创建 | `sessions[key] = msg.session`，增量渲染 |
| `delta` | 会话字段变更 | `Object.assign(sessions[key], msg.changes)`，增量更新 |

### 前端数据流

```
WebSocket 消息
    │
    ▼
handleMessage(msg)
    ├── snapshot   → sessions = {} → 逐条赋值 → render()
    ├── session_added → sessions[key] = msg.session → render()
    └── delta      → Object.assign(sessions[key], msg.changes) → render()
                        │
                        ▼
                   render()
                     ├── 按 status 筛选
                     ├── 按 last_event_time_ms 降序排序
                     └── 逐 session 渲染卡片
                           ├── 卡片头部: agent_type + title + badges + metrics
                           ├── 卡片展开区:
                           │     ├── info-grid (Session/PID/Terminal/CWD/Turns)
                           │     ├── renderTimeline(turns) 或 renderLegacy()
                           │     ├── Raw Payload 折叠区
                           │     └── Web 输入框
                           └── renderTimeline(turns)
                                 ├── Turn 按时间倒序 (最新在最上)
                                 ├── 最新 Turn 默认展开，其余折叠
                                 ├── 每个 TurnEntry:
                                 │     ├── 有 tools → 工具组 (折叠/展开 + input/output)
                                 │     └── 无 tools → formatPayloadDisplay() 渲染文本
                                 └── 长文本 (>200字符或>3行) 可折叠
```

## 更新日志

### 2026-06-17 — Agent SDK + 多用户权限 + 层级管理

**新增：**
- `sdk/` 包：统一 AgentSDK 接口，Claude/OpenCode/Codex 三端实现
- `internal/auth/`：用户注册/登录，bcrypt + Bearer Token
- `internal/hierarchy/`：Workspace → Project → Topic → Story 4 层管理 + 权限表
- Agent 控制面板（Web UI）：选择 agent，输入 prompt，流式查看输出
- 后台执行 + 重连恢复：关闭浏览器不影响 agent 运行，重连后历史执行可见
- 每个 workspace 自动创建 Inspiration project（含 claude/codex/opencode topic）
- Session 自动归类：新 session 按 agent_type 归入对应 topic 的 story

**修复：**
- WebSocket 并发写入保护（writeMu）
- Hub.Run 广播使用写锁而非读锁
- SDK sessions map 加互斥锁
- ExecutionStore 上限 500 条防 OOM
- active map 改用 execID 为 key，修复同 session 并发发送导致的孤儿进程
- CLI 非零退出码正确标记 IsFinal
- OpenCode readLoop 退出时重置 running 状态以支持重连
- Cancel 取消路径同时调用 ExecutionStore.Cancel
- ListSessions 加读锁防数据竞争
- writePump 所有写操作加 writeMu
