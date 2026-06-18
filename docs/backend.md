# 后端设计说明

> 本文件为后端模块的精炼索引与关键摘要，详细设计见末尾「详细文档」链接。

---

## 1. 架构总览

```
Agent Hook ──agent-monitor-hook──▶ events.jsonl ──fsnotify──▶ Daemon ──SSE──▶ 浏览器 (:9101)
                                       ▲
                PID Scanner (15s gopsutil) ──CPU/Memory/死亡检测──┘
                                       ▲
           Web 输入 ──REST──▶ Daemon ──poll──▶ OpenCode 插件 ──SDK──▶ Agent
```

**核心原则：**

| 原则 | 说明 |
|------|------|
| Hook 写文件 | agent-monitor-hook 构造合法 JSON 追加到 events.jsonl |
| Session 创建 | 只有 Hook 事件创建 session，PID Scanner 仅增强 + 检测死亡 |
| Fail-Open | Daemon 不在时事件不丢（文件持久化），agent 不受影响 |
| 字段兼容 | SessionKey = `hex(SHA256(user_id\|device_id\|agent_type\|agent_session_id))[:16]` |

---

## 2. 模块职责

```
┌─ Daemon ──────────────────────────────────────────────┐
│  EventWatcher ──fsnotify──▶ SessionManager             │
│  (events.jsonl)               │                        │
│  PID Scanner (15s) ───────────┤                        │
│  Terminal Detector            ▼                        │
│                       WebSocket Hub                     │
│  Session Recovery ────────────┘                        │
│  HTTP: /api/* /health /ws                              │
└────────────────────────────────────────────────────────┘
                            │
                            ▼
                       浏览器看板
```

| 模块 | 职责 | 源码位置 |
|------|------|---------|
| EventWatcher | fsnotify 监听 events.jsonl，解析 JSON，验证 token，产出 Event | `internal/hook/eventwatcher.go` |
| SessionManager | 维护 `map[SessionKey]*Session`，创建/更新字段，生成 Delta | `internal/session/manager.go` |
| PID Scanner | 15s gopsutil 扫描，更新 CPU/Memory，检测死亡/静默 | `internal/scanner/scanner.go` |
| Terminal Detector | PPID 链上溯 (≤10层) 识别终端 | `internal/scanner/terminal.go` |
| Session Recovery | 启动时扫描 transcript JSONL 恢复最近 24h session | `internal/session/recovery.go` |
| SSE Hub | 管理 SSE 连接，新连接推 Snapshot，实时广播 Delta/Agent 事件 | `internal/server/sse.go` |
| AuthStore | 用户 CRUD、bcrypt 认证、Cookie/Bearer Token + 自动续期 | `internal/auth/` |
| HierarchyStore | 4 层 CRUD + 权限表 | `internal/hierarchy/` |
| AgentManager | 多 agent 统一编排（Claude/OpenCode/Codex SDK） | `sdk/manager.go` |
| ExecutionStore | 执行记录持久化（跨重连恢复，上限 500） | `sdk/execution.go` |

---

## 3. 数据存储

### SQLite 表（`~/.agent-monitor/daemon.db`）

```sql
CREATE TABLE daemon_sessions (
    user_id, device_id, agent_type, agent_session_id, session_key TEXT,
    pid INTEGER, terminal, cwd, status TEXT,
    start_time_ms, last_event_time_ms INTEGER,
    last_event_type, last_file, last_command TEXT,
    memory_mb REAL, cpu_percent REAL,
    turn_count INTEGER, git_branch TEXT,
    created_at, updated_at INTEGER, ended_at INTEGER,
    PRIMARY KEY (user_id, device_id, agent_type, agent_session_id)
);
```

### 本地文件

| 文件 | 内容 | 权限 |
|------|------|------|
| `~/.agent-monitor/device-id` | UUID v4 | 0600 |
| `~/.agent-monitor/local-token` | 256bit Base64 | 0600 |
| `~/.agent-monitor/events.jsonl` | Hook 事件缓冲 | 0600 |
| `~/.agent-monitor/events.offset` | 消费偏移量 (int64) | 0600 |
| `~/.agent-monitor/daemon.db` | SQLite | 0600 |

---

## 4. HTTP API 概览

监听 `127.0.0.1:9101`。鉴权分三组（见 `internal/auth/middleware.go`）：

| 组 | 方法 | 路径 | 鉴权 |
|------|------|------|------|
| 公开 | POST | `/api/auth/{register,login}` | 无 |
| 机器 | GET | `/health`, `/api/poll-input`, `/api/sessions/{key}/pending-input` | X-Daemon-Token (MachineAuth) |
| Web | GET/POST/PUT/DELETE | `/api/workspaces*`, `/api/stories/{id}`, `/api/permissions/*`, `/api/users`, `/api/sessions*`, `/api/agent/*` | HttpOnly Cookie 或 Bearer (WebAuth) |
| Web | POST | `/api/sessions/{key}/input` | Cookie/Bearer |
| Web | GET | `/api/events/stream` (SSE) | Cookie/Bearer |
| Web | POST | `/api/auth/logout` | Cookie/Bearer |

CORS 中间件（`internal/server/cors.go`）：`--cors-origins` 白名单回显 origin，`Allow-Credentials: true`（cookie 模式禁止 `*`）。

---

## 5. SSE 协议概览

**连接**：`GET /api/events/stream`，带 HttpOnly Cookie 鉴权（EventSource 自动携带）。

连接后依次收到：
1. `snapshot` — 全量 session 快照
2. `hierarchy_snapshot` — 层级树
3. `agent_executions` — 执行历史（重连恢复）

之后持续推送增量：

| type | 说明 |
|------|------|
| `delta` | 增量更新 `{session_key, changes}` |
| `session_added` | 新 session |
| `hierarchy_updated` | 层级树更新（session 自动挂载时） |
| `agent_exec_started` | Agent 执行启动（全局广播） |
| `agent_session_created` | 自动创建 session（全局广播） |
| `agent_message` | Agent 流式消息（全局广播） |
| `agent_error` / `agent_cancelled` | 执行错误/取消 |

保活：服务端每 25s 推 `: ping` SSE 注释行；客户端 60s 无消息判定断连重连。

**关键约束**：每客户端 `sync.Mutex` 保护写入（约束 A），连接先 register 再发 snapshot（约束 B，delta 不丢）。

---

## 6. Session 状态机

```
不存在 ──Hook session_start──▶ active
不存在 ──Recovery────────────▶ unknown
unknown ──Hook/PID匹配──▶ active
unknown ──PID不匹配────▶ stopped
active ──session_end──▶ stopped
active ──PID消失────▶ disappeared
active ──无hook>5min──▶ idle
idle ──Hook事件──▶ active
idle ──PID消失────▶ disappeared
disappeared/stopped ──Hook重启──▶ active
```

---

## 7. Agent SDK

统一接口（8 方法）：`CreateSession` / `SendPrompt` / `ResumeSession` / `CancelExecution` / `RenameSession` / `ListSessions` / `SetPermissionMode` / `Close`

| Agent | 通信方式 | 会话连续性 |
|-------|---------|-----------|
| Claude | `claude -p "..." --output-format stream-json` | `--resume <id>` |
| OpenCode | `opencode acp` JSON-RPC 2.0 stdio | `session/load` |
| Codex | `codex exec --json "..."` | `--resume <id>` |

执行与 WS 连接解耦：关闭浏览器 agent 继续后台运行，重连后 `agent_executions` 恢复全部历史。超时可选 5/10/30/60/120 分钟。

---

## 8. Daemon 参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--listen` | `127.0.0.1:9101` | HTTP 监听 |
| `--scan-interval` | `15` | PID 扫描间隔(秒) |
| `--user-id` | `"local"` | 用户标识 |
| `--cors-origins` | `http://localhost:5173` | 允许的 CORS 源（逗号分隔，前端源） |

---

## 9. 项目结构

```
├── cmd/
│   ├── daemon/main.go      # Daemon 入口
│   ├── hook/main.go         # agent-monitor-hook
│   └── setup/main.go        # 初始化 + hook 注册 CLI
├── internal/
│   ├── auth/                # 用户/Token/Cookie/WebAuth/MachineAuth 中间件
│   ├── hierarchy/           # 4层CRUD + 权限
│   ├── hook/                # EventWatcher
│   ├── session/             # SessionManager + SQLite + Recovery
│   ├── scanner/             # PID Scanner + Terminal Detector
│   ├── server/              # HTTP + SSE Hub + CORS
│   ├── installer/           # 各 Agent hook 安装
│   └── token/               # Daemon Token
├── sdk/                     # Agent SDK (Claude/OpenCode/Codex)
└── web/frontend/            # 前端独立工程 (Vite + vanilla TS)
```

---

## 详细文档

- 本地 Daemon 架构说明书：[backend_local.md](./backend_local.md)
- Hook 完整执行流程：[hood_describe.md](./hood_describe.md)
- API 交互分析报告：[api-analysis.md](./api-analysis.md)
