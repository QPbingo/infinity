# 后端设计说明

> 本文件为后端模块的精炼索引与关键摘要，详细设计见末尾「详细文档」链接。

---

## 1. 架构总览

```
Agent Hook ──agent-monitor-hook──▶ events.jsonl ──fsnotify──▶ Daemon ──WS──▶ 浏览器 (:9101)
                                      ▲
               PID Scanner (15s gopsutil) ──CPU/Memory/死亡检测──┘
                                      ▲
          Web 输入 ──WS──▶ Daemon ──poll──▶ OpenCode 插件 ──SDK──▶ Agent
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
| WebSocket Hub | 管理 WS 连接，新连接推 Snapshot，实时广播 Delta | `internal/server/websocket.go` |
| AuthStore | 用户 CRUD、bcrypt 认证、Bearer Token | `internal/auth/` |
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

监听 `127.0.0.1:9101`。

| 模块 | 方法 | 路径 | 鉴权 |
|------|------|------|------|
| 认证 | POST | `/api/auth/{register,login,logout}` | register/login 无，logout Bearer |
| 层级 | GET/POST/PUT/DELETE | `/api/workspaces*`, `/api/stories/{id}` | Bearer |
| 权限 | GET/PUT/DELETE | `/api/permissions/{workspace,project}/{id}` | Bearer |
| Session 查询 | GET | `/api/sessions`, `/api/sessions/{key}` | X-Daemon-Token 或 Bearer |
| 插件轮询 | GET | `/api/poll-input` | X-Daemon-Token |
| Agent SDK | POST/GET/PUT | `/api/agent/{type}/sessions*` | Bearer |
| 健康检查 | GET | `/health` | X-Daemon-Token |
| WebSocket | GET | `/ws` | 首条消息 auth |

---

## 5. WebSocket 协议概览

**连接**：`ws(s)://host/ws`，首条消息必须为 `{"type":"auth","token":"<bearer>"}`。

| 方向 | type | 说明 |
|------|------|------|
| C→S | `auth` | 鉴权 |
| S→C | `auth_ok`/`auth_error` | 鉴权结果 |
| S→C | `snapshot` | 全量 session 快照 |
| S→C | `delta` | 增量更新 `{session_key, changes}` |
| S→C | `session_added` | 新 session |
| S→C | `hierarchy_snapshot`/`hierarchy_updated` | 层级树 |
| S→C | `agent_executions` | 重连时全量执行历史 |
| S→C | `agent_exec_started`/`agent_message`/`agent_error`/`agent_cancelled` | Agent 执行流 |
| C→S | `send_input` | Web 输入注入 |
| C→S | `agent_prompt`/`agent_cancel` | Agent 控制 |
| C→S | `ping` / S→C `pong` | 心跳 |

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
| `--cors-origins` | `*` | 允许的 CORS 源（逗号分隔） |

---

## 9. 项目结构

```
├── cmd/
│   ├── daemon/main.go      # Daemon 入口
│   ├── hook/main.go         # agent-monitor-hook
│   └── setup/main.go        # 初始化 + hook 注册 CLI
├── internal/
│   ├── auth/                # 用户/Token/中间件
│   ├── hierarchy/           # 4层CRUD + 权限
│   ├── hook/                # EventWatcher
│   ├── session/             # SessionManager + SQLite + Recovery
│   ├── scanner/             # PID Scanner + Terminal Detector
│   ├── server/              # HTTP + WebSocket Hub
│   ├── installer/           # 各 Agent hook 安装
│   └── token/               # Daemon Token
├── sdk/                     # Agent SDK (Claude/OpenCode/Codex)
└── web/dashboard.html       # 旧版看板（分离后删除）
```

---

## 详细文档

- 本地 Daemon 架构说明书：[backend_local.md](./backend_local.md)
- Hook 完整执行流程：[hood_describe.md](./hood_describe.md)
- API 交互分析报告：[api-analysis.md](./api-analysis.md)
