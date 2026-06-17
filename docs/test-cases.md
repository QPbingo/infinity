# Agent Monitor — 前后分离测试用例

> v1 | 2026-06-18 | 由用户/服务建模与时序交互推导而来的验收基线

配套文档：
- 执行方案 + 时序图 + 状态图：`docs/frontend-separation-plan.md`
- API 交互分析：`docs/api-analysis.md`

---

## 0. 测试分层与标注

| 标注 | 含义 | 框架 |
|------|------|------|
| `[B]` | 后端 Go 测试 | `make test`（Go testing） |
| `[F]` | 前端测试 | Vitest + @vue/test-utils |
| `[BF]` | 双层均需覆盖 | 后端验证契约，前端验证状态处理 |

**原则**：
- `[B]` 用例验证 HTTP/WS 契约与权限边界，进 Go 测试套件。
- `[F]` 用例验证 Pinia store 对 WS 消息的处理和 api/client 鉴权注入，进 Vitest。
- `[BF]` 用例两层都要测：后端保证语义，前端保证状态正确。
- 每个用例标注来源时序（见 `frontend-separation-plan.md` §7）和所属实施阶段（见 §9）。

---

## 1. 测试建模依据

### 1.1 用户角色（Actor）

| Actor | 凭证 | 可访问范围 |
|-------|------|-----------|
| A1 访客 | 无 | 仅 `POST /api/auth/{register,login}` |
| A2 认证用户 | Bearer token | 所有 `userMiddleware` + 旧 `authMiddleware` 路由 |
| A3 Agent 插件 | X-Daemon-Token | `/api/poll-input`、`/api/sessions/*`、`/health` |
| A4 外部 API 调用者 | Bearer token | REST `/api/agent/*`（SSE 流） |

A2 按资源权限运行时细分：

| 子角色 | 判定 | 能力 |
|--------|------|------|
| A2.x 无权限 | 无 perm 记录 | 仅读 hierarchy，不可写他人资源 |
| A2.v Viewer | `level=10` | 读 + 看 sessions；写操作 → 403 |
| A2.wa Workspace Admin | 对 ws `level=100` | 管理 ws 下所有 + 授权他人 |
| A2.pa Project Admin | 对 project `level=100` | 管理 project 下 topic/story；不能删 project 本身 |

### 1.2 权限规则（测试边界依据）

- 创建 Workspace/Project 时**自动**给创建者授予 Admin。
- 删除 Project 需要 **Workspace Admin**（`checkWSAdmin(h.projWS(id))`）。
- 删除 Topic/Story 需要 **Project Admin**（经 `topProj`/`stoTop` 上溯）。
- 权限**不继承**：对 ws 有 admin 不自动对 project 有 admin。

### 1.3 关键状态机

- **Session**：`active ↔ idle → stopped/disappeared/error`
- **WebSocket（前端）**：`disconnected → connecting → auth_pending → connected → disconnected(3s重连)`
- **Execution**：`created → running → completed/error/cancelled`

完整状态图见 `frontend-separation-plan.md` §8。

---

## 2. 测试用例

### 2.1 认证模块（阶段 P1）

| ID | 层 | 场景 | 输入 | 期望 | 来源时序 |
|----|----|------|------|------|---------|
| AUTH-01 | `[B]` | 注册成功 | `POST /api/auth/register {username:"a", password:"p"}` | 200 + `token` 非空 + `user.username="a"` | T1 |
| AUTH-02 | `[B]` | 重复注册 | 已存在的 username | 409 `{error}` | T1 |
| AUTH-03 | `[B]` | 缺字段 | `{username:""}` | 400 `{error}` | T1 |
| AUTH-04 | `[B]` | 登录成功 | 正确凭证 | 200 + `token` | T1 |
| AUTH-05 | `[B]` | 错误密码 | 错误密码 | 401 `{error}` | T6 |
| AUTH-06 | `[B]` | logout 使 token 失效 | logout 后再用该 Bearer 访问 user 路由 | 401 | T6 |
| AUTH-07 | `[B]` | 无 Authorization 访问 user 路由 | `GET /api/hierarchy` 无头 | 401 "auth required" | T6 |
| AUTH-08 | `[B]` | 伪造 Bearer | `Authorization: Bearer fake` | 403/401 | T6 |
| AUTH-09 | `[B]` | WS 鉴权成功 | 首条 `auth` 有效 token | 收到 `auth_ok` + `snapshot` | T1 |
| AUTH-10 | `[B]` | WS 鉴权失败 | 首条 `auth` 伪造 token | 收到 `auth_error` 并断开 | T6 |
| AUTH-11 | `[F]` | token 持久化 | 登录后刷新页面 | localStorage 恢复登录态，自动进主界面 | T1 |
| AUTH-12 | `[F]` | auth store 登录 action | 调 `auth.login(u,p)` | store.token/user 更新 + localStorage 写入 | T1 |
| AUTH-13 | `[F]` | auth store 登出 action | 调 `auth.logout()` | store 清空 + localStorage 清除 + ws 关闭 | T6 |

---

### 2.2 层级管理（阶段 P2）

| ID | 层 | 场景 | 输入 | 期望 | 来源 |
|----|----|------|------|------|------|
| HIER-01 | `[B]` | 建 workspace 自动获 admin | A 建 ws | A 对该 ws perm `level=100` | T1 |
| HIER-02 | `[B]` | 建 workspace 自动建 Inspiration | 建任意 ws | 含 3 个 agent topic (claude/codex/opencode) | T1 |
| HIER-03 | `[B]` | 建 project 自动获 admin | A 建 proj | A 对该 proj perm `level=100` | T1 |
| HIER-04 | `[B]` | 无权限建 project | B(Viewer) 在他人 ws 建 proj | 403 | T2 |
| HIER-05 | `[B]` | WS Admin 删 project | A 删自己 ws 下 proj | 204 | T2 |
| HIER-06 | `[B]` | PA 删 project 被拒 | C(仅 pa) 删 proj | 403 (需 ws admin) | T2 |
| HIER-07 | `[B]` | PA 删 topic 成功 | C(pa) 删自己 proj 下 topic | 204 | T2 |
| HIER-08 | `[B]` | PA 删他人 proj 的 topic 被拒 | C(pa of proj1) 删 proj2 的 topic | 403 | T2 |
| HIER-09 | `[B]` | 权限不继承 | A 对 ws1=admin，未显式授权 proj2 | A 对 proj2 无 admin | T2 |
| HIER-10 | `[B]` | Viewer 建 story 被拒 | B(level=10) 建 story | 403 | T2 |
| HIER-11 | `[B]` | hierarchy_updated 广播 | 任意 CRUD | 所有在线 WS 客户端收到 `hierarchy_updated` | T1 |
| HIER-12 | `[F]` | 修复硬编码 ID | 在 ws2/proj3 下建 topic | 请求路径含 `2` 和 `3`，不写死 `1` | — |
| HIER-13 | `[F]` | refreshHierarchy 更新 store | CRUD 后 | store.hierarchy 更新 + tree 重渲染 | T1 |
| HIER-14 | `[F]` | createWorkspace action | 调 `hierarchy.createWorkspace(name)` | POST `/api/workspaces` + store 刷新 | T1 |
| HIER-15 | `[F]` | createStory 接收动态 tid | 在 topic5 下建 story | 请求路径含正确 tid | T1 |
| HIER-16 | `[F]` | switchWorkspace 切换 | 选 ws2 | selectedWorkspaceId=2 + tree 重渲染 | — |

---

### 2.3 权限管理（阶段 P2）

| ID | 层 | 场景 | 输入 | 期望 | 来源 |
|----|----|------|------|------|------|
| PERM-01 | `[B]` | WS Admin 授权 Viewer | `PUT /api/permissions/workspace/1 {user_id:B, level:10}` | B 对 ws1 perm=10 | T2 |
| PERM-02 | `[B]` | Viewer 不能授权他人 | B(Viewer) PUT perm | 403 | T2 |
| PERM-03 | `[B]` | 删除权限 | `DELETE /api/permissions/workspace/1/{uid}` | 该 perm 记录消失 | T2 |
| PERM-04 | `[B]` | 列出权限 | `GET /api/permissions/workspace/{id}` | 返回当前 perm 列表 | T2 |
| PERM-05 | `[B]` | 列出用户 | `GET /api/users` | 返回所有 user | T2 |
| PERM-06 | `[F]` | 权限弹窗渲染 | 打开 PermissionModal | 显示用户列表 + perm 列表 | T2 |
| PERM-07 | `[F]` | addPermission action | 选用户+level 点 Add | PUT perm + 列表刷新 | T2 |
| PERM-08 | `[F]` | removePermission action | 点 ✕ | DELETE perm + 列表刷新 | T2 |

---

### 2.4 Session 实时推送（阶段 P3）

| ID | 层 | 场景 | 输入 | 期望 | 来源 |
|----|----|------|------|------|------|
| SESS-01 | `[F]` | snapshot 全量替换 | 收 `snapshot {sessions:[s1,s2]}` | store.sessions 被替换为新 map (含 s1,s2) | T1 |
| SESS-02 | `[F]` | session_added 增量 | 收 `session_added {session:s3}` | s3 加入 map，s1/s2 不受影响 | T4 |
| SESS-03 | `[F]` | delta 合并幂等 | 连续两条 delta 改同 session 不同字段 | Object.assign 后两字段都更新，无中间态泄漏 | T4 |
| SESS-04 | `[B]` | Hook+Scanner 并发 delta | 同时触发 delta | 最终 session 状态一致（无数据竞争） | T4 |
| SESS-05 | `[F]` | 按 status 筛选 | filter=active | getter 只返回 active 卡片 | T4 |
| SESS-06 | `[F]` | 按 last_event_time_ms 排序 | 多 session 不同时间 | 最新事件排最前 | T4 |
| SESS-07 | `[F]` | 卡片展开/折叠互不影响 | 展开 A 不影响 B | expandedCards 按 key 独立 | T4 |
| SESS-08 | `[B]` | delta 推送并发安全 | 多客户端 + 高频 delta | writeMu 保护，无写入错乱 | T4 |

---

### 2.5 时间线渲染（阶段 P3）

| ID | 层 | 场景 | 输入 | 期望 | 来源 |
|----|----|------|------|------|------|
| TL-01 | `[F]` | Turn 倒序显示 | turns=[t0,t1,t2,t3] | DOM 顺序 Turn4,3,2,1（最新在最上） | — |
| TL-02 | `[F]` | 最新 Turn 默认展开 | 首次渲染 | 最新 turn body `open=true`，其余折叠 | — |
| TL-03 | `[F]` | 工具组折叠/展开 | toggle 工具组 | expandedToolGroups 按 id 独立 | — |
| TL-04 | `[F]` | payload 去敏感字段 | formatPayloadDisplay | 删除 `daemon_token`、`_role` | — |
| TL-05 | `[F]` | 长文本折叠 | output > 200 字符 | 截断到 200 + 可展开查看完整 | — |
| TL-06 | `[F]` | tool 状态徽章 | status=running/completed/error | 对应颜色徽章 | — |
| TL-07 | `[F]` | turn 折叠/展开 | toggle turn | expandedTurns 按 id 独立，不影响其他 | — |

---

### 2.6 Web 输入注入（阶段 P4）

| ID | 层 | 场景 | 输入 | 期望 | 来源 |
|----|----|------|------|------|------|
| IN-01 | `[B]` | send_input 入队 | WS `send_input {session_key, text}` | `pending[key]=text` + 新 Turn 入队 | T5 |
| IN-02 | `[B]` | poll-input 取走即清 | 插件 GET 第一次 | 200 `{text}`；再 GET → 204 | T5 |
| IN-03 | `[B]` | poll-input 缺参 | 无 `agent_type` 或 `agent_session_id` | 204 | T5 |
| IN-04 | `[B]` | 插件用 X-Daemon-Token 鉴权 | poll-input 带 daemon token | 200 | T5 |
| IN-05 | `[F]` | 前端 sendInput 经 WS | 点 Send | `ws.send send_input`，输入框清空 | T5 |
| IN-06 | `[F]` | 空文本不发 | 空输入点 Send | 不发 WS | T5 |
| IN-07 | `[F]` | 输入后立即显示 | send_input 后收 delta | user_input 字段立即在卡片显示 | T5 |

---

### 2.7 Agent 控制（WS 路径，阶段 P4）

| ID | 层 | 场景 | 输入 | 期望 | 来源 |
|----|----|------|------|------|------|
| AG-01 | `[B]` | 空 session_id 自动创建 | `agent_prompt {session_id:""}` | 收 `agent_session_created`，含新 sid + exec_id | T3 |
| AG-02 | `[B]` | exec_started 广播 | 启动执行 | 收 `agent_exec_started {exec_id,...}` | T3 |
| AG-03 | `[B]` | 流式 agent_message | 执行中 | 多条 `agent_message`，最后一条 `is_final=true` | T3 |
| AG-04 | `[B]` | error 标记 final | agent 报错 | `agent_error` + execution 标 error | T3 |
| AG-05 | `[B]` | 关浏览器执行继续 | WS 断后 | 后台 goroutine 完成，`ExecStore.Complete` | T3 |
| AG-06 | `[B]` | 重连恢复执行历史 | 重连 | 收 `agent_executions` 含已完成记录 | T3 |
| AG-07 | `[B]` | 取消执行 | `agent_cancel` | 子进程被 kill，收 `agent_cancelled` | T3 |
| AG-08 | `[B]` | timeout 上限 120m | `timeout_minutes=200` | 实际按 120m | T3 |
| AG-09 | `[B]` | ExecutionStore 上限 500 | 建 501 条 | 最旧被逐出 | T3 |
| AG-10 | `[B]` | 跨客户端广播 | A 发 prompt, B 在线 | B 也收 `agent_exec_started` | T3 |
| AG-11 | `[F]` | store 消息追加 | 收 `agent_message` | executionHistory 对应 exec.messages 追加 | T3 |
| AG-12 | `[F]` | is_final 置 completed | 收 `is_final=true` | 该 exec.status=completed | T3 |
| AG-13 | `[F]` | 执行历史渲染 | renderExecHistory | 按时间倒序 + 状态图标(⏳✅❌⏹) | T3 |
| AG-14 | `[F]` | agent_session_created 回填 | 收 agent_session_created | session_id 输入框回填新 sid | T3 |
| AG-15 | `[F]` | agent_error 显示 | 收 agent_error | 输出区显示红色 ERROR + status="Error" | T3 |
| AG-16 | `[F]` | tool_use 消息渲染 | 收 msg_type=tool_use | 显示 `[tool_name] tool_input` 紫色 | T3 |
| AG-17 | `[F]` | sendPrompt action | 调 `agent.sendPrompt(...)` | ws.send agent_prompt + status="Running..." | T3 |
| AG-18 | `[F]` | cancel action | 调 `agent.cancel(...)` | ws.send agent_cancel + status="Cancelling..." | T3 |

---

### 2.8 WS 连接管理（阶段 P1/P5）

| ID | 层 | 场景 | 输入 | 期望 | 来源 |
|----|----|------|------|------|------|
| WS-01 | `[F]` | 断线 3s 重连 | ws.close（bearerToken 仍存在） | 3s 后 connectWS | T3 |
| WS-02 | `[F]` | 重连全量恢复 | 重连后 | snapshot + hierarchy + executions 恢复全状态 | T3 |
| WS-03 | `[F]` | auth_error 触发 logout | 收 `auth_error` | 调 logout，清 token，显示 auth | T6 |
| WS-04 | `[F]` | 未鉴权不发业务消息 | auth 前 send | 消息被忽略（等 auth_ok） | T1 |
| WS-05 | `[B]` | 心跳保活 | 27s ping | 客户端回 pong，不超时（30s） | — |
| WS-06 | `[B]` | 慢消费者断开 | send 缓冲满(>256) | 客户端被踢，不 OOM | — |
| WS-07 | `[F]` | logout 不重连 | logout 后 ws.close | 不触发 3s 重连 | T6 |

---

### 2.9 前后分离部署（阶段 P0/P5）

| ID | 层 | 场景 | 输入 | 期望 | 来源 |
|----|----|------|------|------|------|
| DEP-01 | `[B]` | CORS 预检通过 | `OPTIONS /api/*` from allowed origin | 200 + `Access-Control-Allow-Origin` + 允许方法/头 | — |
| DEP-02 | `[B]` | CORS 拒绝非允许源 | `OPTIONS` from `evil.com`（origins 配置不含它） | 无 CORS 头 / 拒绝 | — |
| DEP-03 | `[F]` | baseURL 注入 | `VITE_API_BASE=https://api.example.com` | fetch 前缀正确拼接 | — |
| DEP-04 | `[B]` | 移除 GET / 静态路由 | `GET /` | 404（分离后） | — |
| DEP-05 | `[F]` | Vite proxy 转发 | dev `/api/*` → `:9101` | 请求成功 | — |
| DEP-06 | `[B]` | WS 跨域鉴权保持 | WS from different origin | 首条消息 auth 仍有效 | — |
| DEP-07 | `[B]` | `--cors-origins` 参数 | 启动带 `--cors-origins=https://a.com,https://b.com` | 仅这两个源被允许 | — |
| DEP-08 | `[F]` | WS URL 拼接 baseURL | 生产 `wss://api.example.com/ws` | 连接正确（用 baseURL 推导 ws/wss） | — |

---

## 3. 用例与实施阶段映射

| 阶段 | 内容 | 对应用例 |
|------|------|---------|
| P0 | 后端 CORS + 移除静态路由 + `--cors-origins` | DEP-01, DEP-02, DEP-04, DEP-06, DEP-07 |
| P1 | 脚手架 + api/client + ws/manager + auth store | AUTH-01~13, WS-01~07 |
| P2 | hierarchy store + SidebarTree + CreateModal + PermissionModal | HIER-01~16, PERM-01~08 |
| P3 | sessions store + SessionCard + Timeline + ToolGroup | SESS-01~08, TL-01~07 |
| P4 | agent store + AgentPanel + 执行历史 | AG-01~18, IN-01~07 |
| P5 | 对等验证 + 删除旧 dashboard + Makefile 集成 | 全部用例回归 + DEP-03, DEP-05, DEP-08 |

**建议**：每阶段先写对应 `[F]`/`[B]` 测试再实现（TDD），阶段末跑全量回归。

---

## 4. 测试环境与数据准备

### 4.1 后端测试 `[B]`

- 复用现有 `make test` 机制。
- 权限用例需多用户 fixture：建议测试 setup 注册 A/B/C 三个用户，A 建 ws1+proj1，C 被授 proj1 的 pa。
- WS 用例用 `gorilla/websocket` dialer 拨号验证消息流。
- CORS 用例用 `httptest.NewRecorder` + `OPTIONS` 请求验证响应头。

### 4.2 前端测试 `[F]`

- Vitest 配置：jsdom 环境（DOM 测试）+ happy-dom（可选，更快）。
- store 测试：mock `api/client` 和 `ws/manager`，验证 action 调用后状态变化。
- WS 消息处理测试：构造消息 JSON 喂给 store action，断言状态。
- 组件测试：@vue/test-utils mount 组件，传 store/mock，断言渲染输出。
- localStorage 测试：jsdom 提供 localStorage，测试持久化与恢复。

### 4.3 共用 fixture 数据

```typescript
// 前端测试用 mock 数据示例
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
| 前端 stores WS 消息处理 | 100% 消息 type 分支 |
| 前端 api/client 鉴权头注入 | 100%（有 token/无 token/错误） |
| 前端 sessions delta 合并 | 100%（幂等、字段独立） |
| 前端 agent 状态机 | 100%（running→completed/error/cancelled） |

未达 100% 的需在 PR 中说明原因。
