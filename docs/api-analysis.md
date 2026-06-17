# Agent Monitor — 前后端 API 交互分析报告

> v1 | 2026-06-18 | 为前后分离改造提供依据

---

## 0. 当前架构现状

**后端**：Go 单进程 Daemon，`internal/server/` 提供 REST API + WebSocket，监听 `127.0.0.1:9101`。

**前端**：单个 `web/dashboard.html`（999 行，HTML+CSS+JS 全内联），由后端 `GET /` 路由直接吐出（`serveDashboard` @ handlers.go:444）。

**耦合点**：
- 前端所有 `fetch` 使用相对路径（如 `/api/hierarchy`），依赖与后端同源。
- WebSocket 连接使用 `location.host`（dashboard.html:329）。
- 静态资源由后端 `http.ServeFile` 提供。

**核心结论**：前端与后端在同源服务下耦合。前后分离需将前端独立成 SPA，配置 API baseURL + CORS，并移除后端的静态资源路由。

---

## 1. 鉴权机制

| 类型 | 方式 | 适用范围 |
|------|------|---------|
| REST（旧） | `X-Daemon-Token` 头，常量时间比较 | `/health`、`/api/sessions*`、`/api/poll-input` |
| REST（新） | `Authorization: Bearer <token>` | `/api/hierarchy*`、`/api/permissions*`、`/api/users`、`/api/agent/*` |
| REST（兼容） | Bearer 优先，回退 X-Daemon-Token | `authMiddleware` @ handlers.go:83 |
| WebSocket | 首条消息 `{"type":"auth","token":"<bearer>"}` | `/ws` |

**中间件两套**：
- `authMiddleware` (handlers.go:83)：Bearer 或 X-Daemon-Token，用于旧 session/health 路由。
- `userMiddleware` (handlers.go:101)：强制 Bearer，注入 `auth.User` 到 context，用于 hierarchy/permissions/agent 路由。

**前端 token 管理**：登录成功后存 `localStorage.bearer_token` + `localStorage.current_user`，每次请求拼 `Authorization: Bearer <token>` 头。

---

## 2. REST API 路由清单（按模块）

### 2.1 认证模块（Auth）

| 方法 | 路径 | 鉴权 | 前端调用 | 请求体 | 成功响应 | 错误响应 |
|------|------|------|---------|--------|---------|---------|
| POST | `/api/auth/register` | 无 | `doRegister()` :274 | `{username, password}` | `200 {token, user}` | `400 {error}` / `409 {error}` |
| POST | `/api/auth/login` | 无 | `doLogin()` :290 | `{username, password}` | `200 {token, user}` | `400 / 401 {error}` |
| POST | `/api/auth/logout` | Bearer | `logout()` :313 | 无 | `204` | — |

**响应结构**：
```json
{ "token": "<string>", "user": { "id": 1, "username": "alice", "created_at": 1718000000 } }
```

---

### 2.2 层级管理模块（Hierarchy）

4 层结构：Workspace → Project → Topic → Story。前端通过 `GET /api/hierarchy` 一次性拉全树，CRUD 后调用 `refreshHierarchy()` 重新拉取。

| 方法 | 路径 | 前端调用 | 请求体/参数 | 成功响应 |
|------|------|---------|-----------|---------|
| GET | `/api/hierarchy` | `refreshHierarchy()` :783 | 无 | `200 HierarchyTree` |
| POST | `/api/workspaces` | `doCreate('workspace')` :765 | `{name, description}` | `201 Workspace` |
| PUT | `/api/workspaces/{id}` | **未使用** | `{name, description}` | `204` |
| DELETE | `/api/workspaces/{id}` | **未使用** | 无 | `204` |
| GET | `/api/workspaces/{wid}/projects` | **未使用** | path: wid | `200 []Project` |
| POST | `/api/workspaces/{wid}/projects` | `doCreate('project')` :766 | `{name, description}` | `201 Project` |
| PUT | `/api/workspaces/{wid}/projects/{id}` | **未使用** | `{name, description}` | `204` |
| DELETE | `/api/workspaces/{wid}/projects/{id}` | **未使用** | 无 | `204` |
| GET | `/api/workspaces/{wid}/projects/{pid}/topics` | **未使用** | path | `200 []Topic` |
| POST | `/api/workspaces/{wid}/projects/{pid}/topics` | `doCreate('topic')` :768 | `{name, description, agent_type}` | `201 Topic` |
| PUT | `/api/workspaces/{wid}/projects/{pid}/topics/{id}` | **未使用** | `{name, description}` | `204` |
| DELETE | `/api/workspaces/{wid}/projects/{pid}/topics/{id}` | **未使用** | 无 | `204` |
| GET | `.../topics/{tid}/stories` | **未使用** | path | `200 []Story` |
| POST | `.../topics/{tid}/stories` | `createStory()` :576 | `{name, description}` | `201 Story` |
| PUT | `/api/stories/{id}` | `editStory()` :588 | `{name, description}` | `204` |
| DELETE | `/api/stories/{id}` | `deleteStory()` :599 | 无 | `204` |

**权限检查**：
- Workspace 级写操作需 `checkWSAdmin`（LevelWorkspaceAdmin=100）。
- Project/Topic/Story 级写操作需 `checkProjAdmin`（LevelProjectAdmin=100）。
- 创建 Workspace/Project 时自动给当前用户授予 Admin 权限。

**数据结构**：
```typescript
Workspace: { id: int64, name: string, description: string, status: string, created_at: int64, updated_at: int64 }
Project:   { id, workspace_id, name, description, status, created_at, updated_at }
Topic:     { id, project_id, name, description, agent_type?, status, created_at, updated_at }
Story:     { id, topic_id, name, description, session_key?, status, created_at, updated_at }

HierarchyTree: {
  workspaces: [{
    workspace: Workspace,
    projects: [{
      project: Project,
      topics: [{
        topic: Topic,
        stories: Story[]
      }]
    }]
  }]
}
```

**已知问题**：
- `createStory()` :576 硬编码 `/api/workspaces/1/projects/1/topics/{tid}/stories`，wid/pid 写死为 1。
- `doCreate('topic')` :768 硬编码 `/api/workspaces/1/projects/{pid}/topics`，wid 写死为 1。
- Workspace/Project/Topic 的 PUT/DELETE 端点前端未实现 UI。

---

### 2.3 权限模块（Permissions）

| 方法 | 路径 | 前端调用 | 请求体/参数 | 成功响应 |
|------|------|---------|-----------|---------|
| GET | `/api/permissions/workspace/{id}` | `loadPermissions()` :521 | path: id | `200 [{user_id, level}]` |
| GET | `/api/permissions/project/{id}` | `loadPermissions()` :521 | path: id | `200 [{user_id, level}]` |
| PUT | `/api/permissions/workspace/{id}` | `addPermission()` :554 | `{user_id: int, level: int}` | `204` |
| PUT | `/api/permissions/project/{id}` | `addPermission()` :554 | `{user_id: int, level: int}` | `204` |
| DELETE | `/api/permissions/workspace/{id}/{uid}` | `removePermission()` :564 | path: id, uid | `204` |
| DELETE | `/api/permissions/project/{id}/{uid}` | `removePermission()` :564 | path: id, uid | `204` |
| GET | `/api/users` | `loadUsersForSelect()` :540 | 无 | `200 []User` |

`level`：`100` = Admin，`10` = Viewer。

前端通过 `showPermissionModal(type, id)` 弹窗，`type` 参数拼接 URL 区分 workspace/project。

---

### 2.4 Session 查询模块（REST，前端未直接使用）

这些端点主要给插件/外部用，前端通过 WebSocket 获取 session 数据。

| 方法 | 路径 | 鉴权 | 说明 | 响应 |
|------|------|------|------|------|
| GET | `/health` | authMiddleware | 健康检查 | `200 {version, session_count}` |
| GET | `/api/sessions` | authMiddleware | 全部 session | `200 []*Session` |
| GET | `/api/sessions/{key}` | authMiddleware | 单个 session | `200 Session` / `404` |
| GET | `/api/sessions/{key}/pending-input` | authMiddleware | 待注入输入 | `200 {text}` / `204` |
| GET | `/api/poll-input?agent_type=&agent_session_id=` | authMiddleware | 插件轮询 | `200 {text}` / `204` |

**Session 结构**（session/types.go:38）：
```typescript
Session: {
  user_id, device_id, agent_type, agent_session_id, session_key: string,
  pid: int, terminal, cwd: string, memory_mb, cpu_percent: float,
  status: "active"|"idle"|"stopped"|"disappeared"|"error",
  start_time_ms, last_event_time_ms: int64,
  last_event_type, last_file, last_command: string,
  turn_count: int, git_branch: string,
  user_input, agent_output, session_title, last_hook_event: string,
  turns: Turn[],
  story_id?: int64,
  payload?: json.RawMessage,
  process_create_time_ms?: int64
}
Turn: { turn_idx: int, user_input: string, user_ts: int64, entries: TurnEntry[] }
TurnEntry: { event: string, ts: int64, payload?: json, tools?: ToolCall[], start_ts?: int64 }
ToolCall: { name, input, output, status: string, start_ts: int64, end_ts?: int64 }
```

---

### 2.5 Agent SDK 控制模块（REST 端点存在，前端走 WS）

后端在 handlers.go:69-75 注册了完整 REST 端点，但**前端未调用任何 REST agent 端点**，全部通过 WebSocket 实现。REST 端点供外部编程控制用。

| 方法 | 路径 | 请求体 | 响应 |
|------|------|--------|------|
| POST | `/api/agent/{type}/sessions` | `{cwd, model, permission_mode, allowed_tools, max_turns, title}` | `201 Session` |
| GET | `/api/agent/{type}/sessions?dir=` | query: dir | `200 []SessionInfo` |
| POST | `/api/agent/{type}/sessions/{id}/prompt` | `{prompt}` | **SSE 流**：`data: {Message}\n\n` |
| POST | `/api/agent/{type}/sessions/{id}/cancel` | 无 | `204` |
| POST | `/api/agent/{type}/sessions/{id}/resume` | 无 | `200 Session` |
| PUT | `/api/agent/{type}/sessions/{id}/rename` | `{title}` | `204` |
| PUT | `/api/agent/{type}/sessions/{id}/permissions` | `{mode}` | `204` |

`{type}` = `claude` / `opencode` / `codex`

**Session（SDK）结构**（sdk/sdk.go:61）：
```typescript
Session: { id: string, agent_type: string, title: string, cwd: string, created_at: Time }
SessionInfo: { id, title, summary, cwd?, last_modified: Time, turn_count? }
Message: { type: "text"|"tool_use"|"tool_result"|"error"|"result"|"system"|"thinking",
            session_id?, content?, tool_name?, tool_input?, is_final?, error? }
```

**PermissionMode 合法值**：`""` / `default` / `acceptEdits` / `bypassPermissions` / `plan` / `readOnly` / `auto`

---

## 3. WebSocket 消息协议（`/ws`）

**连接**：`ws(s)://host/ws`，首条消息必须为 `{"type":"auth","token":"<bearer>"}`，否则收到 `auth_error` 并断开。

**前端函数**：`connectWS()` :327，`handleMessage()` :335。

### 3.1 Client → Server

| type | 前端函数 | 字段 | 说明 |
|------|---------|------|------|
| `auth` | `connectWS` :330 | `{type:"auth", token}` | 鉴权，首条消息 |
| `send_input` | `sendInput()` :950 | `{type, session_key, text}` | 向 agent 注入 prompt |
| `agent_prompt` | `sendAgentPrompt()` :629 | `{type, agent_type, session_id, prompt, timeout_minutes}` | 发送 prompt 启动执行 |
| `agent_cancel` | `cancelAgent()` :644 | `{type, agent_type, session_id, exec_id?}` | 取消执行 |
| `ping` | 浏览器自动 | `{type:"ping"}` | 心跳（实际心跳由 WS 协议层 ping/pong 处理，这是应用层） |

**timeout_minutes**：可选 5/10/30/60/120，默认 10，上限 120。
**session_id**：为空时后端自动创建会话并回传 `agent_session_created`。

### 3.2 Server → Client

| type | 触发时机 | 字段 | 前端处理 |
|------|---------|------|---------|
| `auth_ok` | 鉴权成功 | `{type}` | 无操作 |
| `auth_error` | 鉴权失败 | `{type}` | `logout()` |
| `snapshot` | 连接后全量 | `{type, sessions:[], gen_time_ms}` | 重置 sessions，render |
| `session_added` | 新会话创建 | `{type, session}` | 增量加入 sessions |
| `delta` | 会话字段变更 | `{type, session_key, changes:{}, timestamp_ms}` | `Object.assign` 增量更新 |
| `hierarchy_snapshot` | 连接后全量层级 | `{type, hierarchy}` | 设置 hierarchy，renderTree |
| `hierarchy_updated` | 层级变更 | `{type, hierarchy}` | 更新 hierarchy，renderTree + render |
| `agent_executions` | 重连时全量执行历史 | `{type, executions:[]}` | 替换 executionHistory |
| `agent_exec_started` | 新执行开始 | `{type, exec_id, agent_type, session_id, prompt}` | 插入 executionHistory |
| `agent_session_created` | 自动创建会话 | `{type, agent_type, session_id, exec_id}` | 回填 session_id 输入框 |
| `agent_message` | 流式消息 | `{type, exec_id, agent_type, session_id, msg_type, content, tool_name, tool_input, is_final, error}` | 追加到执行记录 + 实时显示 |
| `agent_error` | 执行错误 | `{type, error}` | 显示错误 |
| `agent_cancelled` | 取消完成 | `{type, session_id}` | — |
| `pong` | 心跳回复 | `{type}` | — |

**ExecutionRecord 结构**（前端使用）：
```typescript
{ id: string, agent_type: string, session_id: string, prompt: string,
  status: "running"|"completed"|"error", messages: Message[], created_at: ISO string }
```

---

## 4. 前端模块与 API 调用映射

| 前端模块 | REST 调用 | WebSocket 消息 |
|---------|----------|---------------|
| 登录/注册 | register, login, logout | auth |
| 侧边栏层级树 | `/api/hierarchy`, workspaces/projects/topics/stories CRUD | hierarchy_snapshot, hierarchy_updated |
| 权限管理弹窗 | permissions GET/PUT/DELETE, `/api/users` | — |
| Session 卡片列表 | （无，用 WS） | snapshot, session_added, delta |
| Session 时间线 | （无） | 同上（含 turns 字段） |
| Web 输入框 | （无） | send_input |
| Agent 控制面板 | （无，REST 端点未用） | agent_prompt, agent_cancel, agent_message, agent_executions, agent_exec_started, agent_session_created, agent_error |

---

## 5. 前后分离需关注的问题

1. **硬编码 ID**：`createStory()` :576 和 `doCreate('topic')` :768 把 `wid=1, pid=1` 写死，分离后必须改为动态传入当前选中 workspace/project。
2. **CORS**：后端 `upgrader.CheckOrigin` 已放行所有来源（websocket.go:53），但 REST 路由无 CORS 中间件，跨域部署需新增。
3. **静态资源**：`serveDashboard` :445 直接 `http.ServeFile` 读本地文件，分离后可移除 `GET /` 路由。
4. **WS 鉴权**：当前用首条消息传 token，跨域 WS 保留此机制即可（不能用 HTTP Header 鉴权 WS）。
5. **API baseURL**：前端所有 fetch 为相对路径，分离后需统一注入 baseURL（环境变量/构建时配置）。
6. **双套 Agent 控制接口**：REST（SSE 流）和 WebSocket 两套并存。前端只用 WS。分离后建议统一选一套——推荐 WS（已实现重连恢复 + 执行历史持久化）。
7. **未使用的 REST 路由**：Workspace/Project/Topic 的 PUT/DELETE、Agent REST 端点、Session 查询端点前端均未调用。分离重构时可决定补全 UI 或删除后端死代码。
8. **Token 存储**：当前用 localStorage，分离 SPA 后需考虑 XSS 防护（httpOnly cookie 或内存存储 + 刷新机制）。
9. **WS 重连**：前端 `ws.onclose` :332 已实现 3 秒自动重连，分离后保留此逻辑，重连后通过 `snapshot` + `agent_executions` 恢复全状态。
