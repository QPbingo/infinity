# Agent Monitor — 前后分离测试用例（SSE + Cookie + vanilla TS）

> v2 | 2026-06-18 | 由 T002 方案推导的验收基线（替代 v1 WS/Vue 用例）

配套文档：
- 任务清单：`docs/task/task.json`（T002 + 6 子任务）
- 后端设计：`docs/backend.md`
- 前端设计：`docs/frontend.md`

---

## 0. 测试分层与标注

| 标注 | 含义 | 框架 |
|------|------|------|
| `[B]` | 后端 Go 测试 | `go test` |
| `[F]` | 前端测试 | Vitest + jsdom |
| `[BF]` | 双层均需覆盖 | 后端验证契约，前端验证状态处理 |

**原则**：
- `[B]` 验证 HTTP/SSE 契约与权限边界，进 Go 测试套件。
- `[F]` 验证 TS 模块对 SSE 消息的处理和 api/client 鉴权注入，进 Vitest。
- `[BF]` 两层都要测：后端保证语义，前端保证状态正确。

---

## 1. 测试建模依据

### 1.1 用户角色（Actor）

| Actor | 凭证 | 可访问范围 |
|-------|------|-----------|
| A1 访客 | 无 | 仅 `POST /api/auth/{register,login}` |
| A2 认证用户 | HttpOnly Cookie（或 Bearer 兼容） | 所有 WebAuth 组路由 + SSE |
| A3 Agent 插件 | X-Daemon-Token | `/api/poll-input`、`/api/sessions/*`、`/health` |

A2 按资源权限运行时细分：

| 子角色 | 判定 | 能力 |
|--------|------|------|
| A2.x 无权限 | 无 perm 记录 | 仅读 hierarchy |
| A2.v Viewer | `level=10` | 读 + 看 sessions；写操作 → 403 |
| A2.wa Workspace Admin | 对 ws `level=100` | 管理 ws 下所有 + 授权他人 |
| A2.pa Project Admin | 对 project `level=100` | 管理 project 下 topic/story |

### 1.2 权限规则（测试边界依据）

- 创建 Workspace/Project 时**自动**给创建者授予 Admin。
- 删除 Project 需要 **Workspace Admin**。
- 删除 Topic/Story 需要 **Project Admin**。
- 权限**不继承**：对 ws 有 admin 不自动对 project 有 admin。

### 1.3 关键状态机

- **Session**：`active ↔ idle → stopped/disappeared/error`
- **SSE 连接（前端）**：`disconnected → connecting → connected → disconnected(自动重连)` + 401→`closed+登录框`
- **Execution**：`created → running → completed/error/cancelled`

---

## 2. 测试用例

### 2.1 前后分离部署与 CORS（阶段 P0）

| ID | 层 | 场景 | 输入 | 期望 |
|----|----|------|------|------|
| DEP-01 | `[B]` | CORS 预检通过 | `OPTIONS /api/*` from allowed origin | 200 + `Access-Control-Allow-Origin` 回显 + 允许方法/头 |
| DEP-02 | `[B]` | CORS 拒绝非允许源 | `OPTIONS` from `evil.com`（origins 不含它） | 无 CORS 头 |
| DEP-03 | `[F]` | baseURL 注入 | `VITE_API_BASE=https://api.example.com` | fetch 前缀正确拼接 |
| DEP-04 | `[B]` | 移除 GET / 静态路由 | `GET /` | 404 |
| DEP-05 | `[F]` | Vite proxy 转发 | dev `/api/*` → `:9101` | 请求成功 |
| DEP-06 | `[B]` | SSE 跨域鉴权保持 | SSE from different origin（带 cookie） | 鉴权通过收到 snapshot |
| DEP-07 | `[B]` | `--cors-origins` 参数 | 启动带 `--cors-origins=https://a.com,https://b.com` | 仅这两个源被允许 |
| DEP-08 | `[F]` | SSE URL 拼接 baseURL | 生产 `VITE_API_BASE=https://api.example.com` | EventSource 连 `https://api.example.com/api/events/stream` |

---

### 2.2 鉴权中间件（阶段 P0）

| ID | 层 | 场景 | 输入 | 期望 |
|----|----|------|------|------|
| AUTH-MID-01 | `[B]` | WebAuth 分组统一鉴权 | 未鉴权访问任意 web 组路由 | 401 |
| AUTH-MID-02 | `[B]` | MachineAuth 机器端点 | `/health` 带 daemon token → 200；无 → 401 | 机器端点保持 X-Daemon-Token |
| AUTH-MID-03 | `[B]` | 公开组不鉴权 | `POST /api/auth/register` 无凭证 | 不被中间件拦截 |
| AUTH-MID-04 | `[B]` | WebAuth 注入 user | 有效 cookie 访问 web 路由 | `auth.GetUser(r)` 返回正确 user |

---

### 2.3 认证模块（阶段 P1）

| ID | 层 | 场景 | 输入 | 期望 |
|----|----|------|------|------|
| AUTH-01 | `[B]` | 注册成功 | `POST /api/auth/register {username,password}` | 200 + `Set-Cookie: session_token=...; HttpOnly; Max-Age=604800` + `user.username` 正确 |
| AUTH-02 | `[B]` | 重复注册 | 已存在 username | 409 |
| AUTH-03 | `[B]` | 缺字段 | `{username:""}` | 400 |
| AUTH-04 | `[B]` | 登录成功 | 正确凭证 | 200 + `Set-Cookie` |
| AUTH-05 | `[B]` | 错误密码 | 错误密码 | 401 |
| AUTH-06 | `[B]` | logout 使 token 失效 | logout 后用旧 cookie 访问 web 路由 | 401；响应含 `Set-Cookie: session_token=; Max-Age=0` |
| AUTH-07 | `[B]` | 无 cookie 访问 web 路由 | `GET /api/hierarchy` 无 cookie 无 Bearer | 401 |
| AUTH-08 | `[B]` | 伪造 cookie | `Cookie: session_token=fake` | 401 |
| AUTH-09 | `[B]` | cookie 鉴权 web 组 | 有效 cookie（无 Bearer） | 200 且 user 注入 context |
| AUTH-10 | `[B]` | token 自动续期 | 服务端 token 剩余<1天时请求 | `expires_at` 刷新为 now+7天 + 响应含新 `Set-Cookie` |
| AUTH-11 | `[B]` | cookie HttpOnly | 登录响应 | `Set-Cookie` 含 `HttpOnly`，JS `document.cookie` 不含 `session_token` |
| AUTH-12 | `[B]` | cookie 跨域属性 | 生产 HTTPS 环境 | `SameSite=None; Secure` |
| AUTH-13 | `[B]` | EventSource 带 cookie 鉴权 SSE | SSE 连接带有效 cookie | 收到 snapshot |
| AUTH-14 | `[F]` | 登录 action | 调 `auth.login(u,p)` | cookie 写入 + user 状态更新 + 进主界面 |
| AUTH-15 | `[F]` | 登出 action | 调 `auth.logout()` | 状态清空 + SSE 关闭 + 登录页 |
| AUTH-16 | `[F]` | 登录态恢复 | 刷新页面（cookie 仍在） | 自动进主界面 + SSE 重连 |

---

### 2.4 SSE 连接管理（阶段 P0/P2）

| ID | 层 | 场景 | 输入 | 期望 |
|----|----|------|------|------|
| SSE-01 | `[B]` | SSE 连接鉴权与初始推送 | 有效 cookie 连接 | 依次收到 snapshot+hierarchy_snapshot+agent_executions |
| SSE-02 | `[B]` | SSE 写入互斥（约束 A） | 并发 snapshot+delta | 单条 JSON 完整，无字节交错 |
| SSE-03 | `[B]` | SSE 重连时序（约束 B） | 重连期间产生 delta | 先 register 再 snapshot，delta 不丢 |
| SSE-04 | `[B]` | SSE 保活心跳 | 25s 周期 | 服务端推 `: ping` 注释行 |
| SSE-05 | `[B]` | SSE 慢消费者断开 | 客户端 send 缓冲满 | 客户端被清理，不 OOM |
| SSE-F01 | `[F]` | EventSource 连接 | 登录后 | SSE 连接 + 收 snapshot |
| SSE-F02 | `[F]` | 断线自动重连 | 后端停 → 60s 超时 → 后端起 | EventSource 自动重连 |
| SSE-F03 | `[F]` | 401 主动关闭（约束 D） | cookie 过期 | SSE `close()` + 弹登录框（不盲重连） |
| SSE-F04 | `[F]` | 保活心跳 | 25s | 收到 `: ping`，连接保持 |
| SSE-F05 | `[F]` | 60s 无消息超时 | 60s 无任何消息 | 主动断连并重连 |

---

### 2.5 BroadcastChannel 多标签页（阶段 P2）

| ID | 层 | 场景 | 输入 | 期望 |
|----|----|------|------|------|
| BC-01 | `[F]` | 多标签共享 | tab1 持有 SSE，tab2 监听 | tab2 经 BroadcastChannel 收到相同消息 |
| BC-02 | `[F]` | leader 选举 | tab1 关闭 | tab2 成 leader 并重连 SSE |
| BC-03 | `[F]` | leader 心跳 | leader 每 3s 广播心跳 | follower 收到，不抢领导权 |
| BC-04 | `[F]` | follower 超时夺权 | leader 10s 无心跳 | follower 升级 leader |

---

### 2.6 层级管理（阶段 P4）

| ID | 层 | 场景 | 输入 | 期望 |
|----|----|------|------|------|
| HIER-01 | `[B]` | 建 workspace 自动获 admin | A 建 ws | A 对该 ws perm `level=100` |
| HIER-02 | `[B]` | 建 workspace 自动建 Inspiration | 建任意 ws | 含 3 个 agent topic |
| HIER-03 | `[B]` | 建 project 自动获 admin | A 建 proj | A 对该 proj perm `level=100` |
| HIER-04 | `[B]` | 无权限建 project | B(Viewer) 在他人 ws 建 proj | 403 |
| HIER-05 | `[B]` | WS Admin 删 project | A 删自己 ws 下 proj | 204 |
| HIER-06 | `[B]` | PA 删 project 被拒 | C(仅 pa) 删 proj | 403 |
| HIER-07 | `[B]` | PA 删 topic | C(pa) 删自己 proj 下 topic | 204 |
| HIER-08 | `[B]` | PA 删他人 topic | C(pa of proj1) 删 proj2 topic | 403 |
| HIER-09 | `[B]` | 权限不继承 | A 对 ws1=admin 未授权 proj2 | A 对 proj2 无 admin |
| HIER-10 | `[B]` | Viewer 建 story | B(level=10) 建 story | 403 |
| HIER-11 | `[B]` | hierarchy_updated 仍只在 session 自动挂载时触发 | 任意 CRUD | CRUD 不广播（保持现状）；session 挂载才广播 |
| HIER-12 | `[F]` | 修复硬编码 ID | 在 ws2/proj3 下建 topic | 请求路径含 `2` 和 `3`，不写死 `1` |
| HIER-13 | `[F]` | refreshHierarchy 更新 store | CRUD 后 | store.hierarchy 更新 + tree 重渲染 |
| HIER-14 | `[F]` | createWorkspace action | 调 `hierarchy.createWorkspace(name)` | POST `/api/workspaces` + store 刷新 |
| HIER-15 | `[F]` | createStory 接收动态 tid | 在 topic5 下建 story | 请求路径含正确 tid |
| HIER-16 | `[F]` | switchWorkspace 切换 | 选 ws2 | selectedWorkspaceId=2 + tree 重渲染 |

---

### 2.7 权限管理（阶段 P4）

| ID | 层 | 场景 | 输入 | 期望 |
|----|----|------|------|------|
| PERM-01 | `[B]` | WS Admin 授权 Viewer | `PUT /api/permissions/workspace/1 {user_id:B, level:10}` | B 对 ws1 perm=10 |
| PERM-02 | `[B]` | Viewer 不能授权 | B(Viewer) PUT perm | 403 |
| PERM-03 | `[B]` | 删除权限 | `DELETE /api/permissions/workspace/1/{uid}` | 该 perm 消失 |
| PERM-04 | `[B]` | 列出权限 | `GET /api/permissions/workspace/{id}` | 返回 perm 列表 |
| PERM-05 | `[B]` | 列出用户 | `GET /api/users` | 返回所有 user |
| PERM-06 | `[F]` | 权限弹窗渲染 | 打开 PermissionModal | 显示用户列表 + perm 列表 |
| PERM-07 | `[F]` | addPermission action | 选用户+level 点 Add | PUT perm + 列表刷新 |
| PERM-08 | `[F]` | removePermission action | 点 ✕ | DELETE perm + 列表刷新 |

---

### 2.8 Session 实时推送（阶段 P4）

| ID | 层 | 场景 | 输入 | 期望 |
|----|----|------|------|------|
| SESS-01 | `[F]` | snapshot 全量替换 | 收 `snapshot {sessions:[s1,s2]}` | store.sessions 被替换为新 map（清空再灌） |
| SESS-02 | `[F]` | session_added 增量 | 收 `session_added {session:s3}` | s3 加入 map，s1/s2 不受影响 |
| SESS-03 | `[F]` | delta 合并幂等 | 连续 delta 改同 session 不同字段 | 两字段都更新，无中间态泄漏 |
| SESS-04 | `[B]` | Hook+Scanner 并发 delta | 同时触发 delta | 最终 session 状态一致（无数据竞争） |
| SESS-05 | `[F]` | 按 status 筛选 | filter=active | getter 只返回 active 卡片 |
| SESS-06 | `[F]` | 按 last_event_time_ms 排序 | 多 session 不同时间 | 最新事件排最前 |
| SESS-07 | `[F]` | 卡片展开独立 | 展开 A 不影响 B | expandedCards 按 key 独立 |
| SESS-08 | `[B]` | SSE delta 推送并发安全 | 多客户端 + 高频 delta | 每客户端 Mutex 保护，无写入错乱 |

---

### 2.9 时间线渲染（阶段 P4）

| ID | 层 | 场景 | 输入 | 期望 |
|----|----|------|------|------|
| TL-01 | `[F]` | Turn 倒序 | turns=[t0,t1,t2,t3] | DOM 顺序 Turn4,3,2,1（最新最上） |
| TL-02 | `[F]` | 最新 Turn 默认展开 | 首次渲染 | 最新 turn body open，其余折叠 |
| TL-03 | `[F]` | 工具组折叠/展开 | toggle 工具组 | expandedToolGroups 按 id 独立 |
| TL-04 | `[F]` | payload 去敏感字段 | formatPayloadDisplay | 删除 `daemon_token`、`_role` |
| TL-05 | `[F]` | 长文本折叠 | output > 200 字符 | 截断到 200 + 可展开 |
| TL-06 | `[F]` | tool 状态徽章 | status=running/completed/error | 对应颜色徽章 |
| TL-07 | `[F]` | turn 折叠/展开 | toggle turn | expandedTurns 按 id 独立 |

---

### 2.10 Web 输入注入（阶段 P3）

| ID | 层 | 场景 | 输入 | 期望 |
|----|----|------|------|------|
| IN-01 | `[B]` | send_input 入队 | `POST /api/sessions/{key}/input {text}` | `pending[key]=text` + 新 Turn 入队 + SSE delta |
| IN-02 | `[B]` | poll-input 取走即清 | 插件 GET 第一次 | 200 `{text}`；再 GET → 204 |
| IN-03 | `[B]` | poll-input 缺参 | 无 `agent_type` 或 `agent_session_id` | 204 |
| IN-04 | `[B]` | 插件 X-Daemon-Token 鉴权 | poll-input 带 daemon token | 200 |
| IN-05 | `[F]` | 前端 sendInput 经 REST | 点 Send | `POST /api/sessions/{key}/input`，输入框清空 |
| IN-06 | `[F]` | 空文本不发 | 空输入点 Send | 不发请求 |
| IN-07 | `[F]` | 输入后立即显示 | send_input 后收 SSE delta | user_input 字段立即在卡片显示 |

---

### 2.11 Agent 控制（阶段 P3，REST + 全局 SSE 广播）

| ID | 层 | 场景 | 输入 | 期望 |
|----|----|------|------|------|
| AG-01 | `[B]` | 空 session_id 自动创建 | `POST /prompt {session_id:""}` | SSE `agent_session_created` + 新 sid + exec_id |
| AG-02 | `[B]` | exec_started 广播 + REST 返回 exec_id | 启动执行 | SSE `agent_exec_started` 的 exec_id 与 REST 响应一致（约束 C） |
| AG-03 | `[B]` | 流式 agent_message | 执行中 | SSE 多条 `agent_message`，最后 `is_final=true` |
| AG-04 | `[B]` | error 标记 final | agent 报错 | SSE `agent_error` + execution 标 error |
| AG-05 | `[B]` | 关浏览器执行继续 | SSE 断后 | 后台 goroutine 完成，`ExecStore.Complete` |
| AG-06 | `[B]` | 重连恢复执行历史 | 重连 SSE | 收 `agent_executions` 含已完成记录 |
| AG-07 | `[B]` | 取消执行 | `POST /cancel` | 子进程 kill + SSE `agent_cancelled` |
| AG-08 | `[B]` | timeout 上限 120m | `timeout_minutes=200` | 实际按 120m |
| AG-09 | `[B]` | ExecutionStore 上限 500 | 建 501 条 | 最旧被逐出 |
| AG-10 | `[B]` | 跨客户端广播 | A 发 prompt, B SSE 在线 | B 也收 `agent_exec_started` + `agent_message` |
| AG-11 | `[F]` | store 消息追加 | 收 `agent_message` | executionHistory 对应 exec.messages 追加 |
| AG-12 | `[F]` | is_final 置 completed | 收 `is_final=true` | 该 exec.status=completed |
| AG-13 | `[F]` | 执行历史渲染 | renderExecHistory | 按时间倒序 + 状态图标(⏳✅❌⏹) |
| AG-14 | `[F]` | agent_session_created 回填 | 收 `agent_session_created` | session_id 输入框回填新 sid |
| AG-15 | `[F]` | agent_error 显示 | 收 `agent_error` | 输出区红色 ERROR + status="Error" |
| AG-16 | `[F]` | tool_use 消息渲染 | 收 msg_type=tool_use | 显示 `[tool_name] tool_input` 紫色 |
| AG-17 | `[F]` | sendPrompt action | 调 `agent.sendPrompt(...)` | REST POST prompt + status="Running..." |
| AG-18 | `[F]` | cancel action | 调 `agent.cancel(...)` | REST POST cancel + status="Cancelling..." |
| AG-IDEM | `[F]` | 重复 exec_started 不双插 | 同 exec_id 两次 | executionHistory 不重复插入 |

---

## 3. 用例与实施阶段映射

| 阶段 | 子任务 | 对应用例 |
|------|--------|---------|
| P0 | T002-1 | DEP-01,02,04,06,07; AUTH-MID-01~04; SSE-01~05 |
| P1 | T002-2 | AUTH-01~13 |
| P2 | T002-3 | AUTH-14~16; SSE-F01~05; BC-01~04; DEP-03,05 |
| P3 | T002-4 | AG-01~18, AG-IDEM; IN-01~07 |
| P4 | T002-5 | HIER-01~16; PERM-01~08; SESS-01~08; TL-01~07 |
| P5 | T002-6 | 全部用例回归 + DEP-08 |

**建议**：每阶段先写对应 `[F]`/`[B]` 测试再实现（TDD），阶段末跑全量回归。

---

## 4. 测试环境与数据准备

### 4.1 后端测试 `[B]`
- 复用 `go test` 机制（现有 `make test` 跑 `./internal/session/`，需扩展到 `./internal/server/`、`./internal/auth/`）。
- 权限用例需多用户 fixture：注册 A/B/C 三用户，A 建 ws1+proj1，C 被授 proj1 的 pa。
- SSE 用例用 `httptest.NewServer` + 客户端读 `text/event-stream` 验证消息流。
- CORS 用例用 `httptest.NewRecorder` + `OPTIONS` 请求验证响应头。
- cookie 用例用 `httptest.NewRecorder` 检查 `Set-Cookie` 头。

### 4.2 前端测试 `[F]`
- Vitest + jsdom 环境。
- state 模块测试：mock `api/client` 和 `sse/manager`，验证调用后状态变化。
- SSE 消息处理测试：构造消息 JSON 喂给 state 模块，断言状态。
- BroadcastChannel 测试：mock `BroadcastChannel` API。
- cookie 测试：jsdom 提供 `document.cookie`（但 HttpOnly cookie 在 jsdom 中仍可读，需 mock）。

### 4.3 共用 fixture 数据

```typescript
const mockSession = {
  session_key: "abc123", agent_type: "claude", agent_session_id: "sid-1",
  status: "active", last_hook_event: "PreToolUse",
  terminal: "iTerm2", cpu_percent: 12.3, memory_mb: 256,
  turn_count: 3, pid: 12345, cwd: "/tmp",
  last_event_time_ms: 1718000000000,
  turns: [{ turn_idx: 0, user_input: "hi", user_ts: 1718000000000, entries: [] }]
};
const mockHierarchy = {
  workspaces: [{
    workspace: { id: 1, name: "Inspiration", description: "", status: "active", created_at: 0, updated_at: 0 },
    projects: [{
      project: { id: 1, workspace_id: 1, name: "Default", description: "", status: "active", created_at: 0, updated_at: 0 },
      topics: [{
        topic: { id: 1, project_id: 1, name: "claude", description: "", agent_type: "claude", status: "active", created_at: 0, updated_at: 0 },
        stories: [{ id: 1, topic_id: 1, name: "Story 1", description: "", session_key: "abc123", status: "active", created_at: 0, updated_at: 0 }]
      }]
    }]
  }]
};
```

---

## 5. 覆盖率目标

| 模块 | 目标覆盖 |
|------|---------|
| 后端权限检查（`checkWSAdmin`/`checkProjAdmin`） | 100% 分支（所有 403 路径） |
| 后端 CORS 中间件 | 100% 分支（允许/拒绝/预检） |
| 后端 WebAuth/MachineAuth | 100% 分支（cookie/Bearer/daemon-token/无凭证） |
| 后端 SSEHub 写入互斥 | 100%（并发不交错） |
| 前端 state 模块 SSE 消息处理 | 100% 消息 type 分支 |
| 前端 api/client credentials 注入 | 100%（有/无 cookie） |
| 前端 sessions delta 合并 | 100%（幂等、字段独立） |
| 前端 agent 状态机 | 100%（running→completed/error/cancelled） |
| 前端 BroadcastChannel leader 选举 | 100%（选举/心跳/夺权） |

未达 100% 的需在 PR 中说明原因。
