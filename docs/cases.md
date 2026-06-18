# 验收标准说明

> 本文件为测试分层与用例概览，完整用例见末尾「详细文档」链接。

---

## 1. 测试分层标注

| 标注 | 含义 | 框架 |
|------|------|------|
| `[B]` | 后端 Go 测试 | `make test`（Go testing） |
| `[F]` | 前端测试 | Vitest + @vue/test-utils |
| `[BF]` | 双层均需覆盖 | 后端验证契约，前端验证状态处理 |

**原则：**
- `[B]` 验证 HTTP/WS 契约与权限边界。
- `[F]` 验证 Pinia store 对 WS 消息的处理和 api/client 鉴权注入。
- `[BF]` 两层都要测：后端保证语义，前端保证状态正确。

---

## 2. 用户角色（测试 Actor）

| Actor | 凭证 | 可访问范围 |
|-------|------|-----------|
| A1 访客 | 无 | 仅 `POST /api/auth/{register,login}` |
| A2 认证用户 | Bearer token | 所有 userMiddleware + 旧 authMiddleware 路由 |
| A3 Agent 插件 | X-Daemon-Token | `/api/poll-input`、`/api/sessions/*`、`/health` |
| A4 外部 API 调用者 | Bearer token | REST `/api/agent/*`（SSE 流） |

A2 按资源权限运行时细分：

| 子角色 | 判定 | 能力 |
|--------|------|------|
| A2.x 无权限 | 无 perm 记录 | 仅读 hierarchy |
| A2.v Viewer | `level=10` | 读 + 看 sessions；写操作 → 403 |
| A2.wa Workspace Admin | 对 ws `level=100` | 管理 ws 下所有 + 授权他人 |
| A2.pa Project Admin | 对 project `level=100` | 管理 project 下 topic/story |

---

## 3. 权限规则（测试边界依据）

- 创建 Workspace/Project 时**自动**给创建者授予 Admin。
- 删除 Project 需要 **Workspace Admin**。
- 删除 Topic/Story 需要 **Project Admin**。
- 权限**不继承**：对 ws 有 admin 不自动对 project 有 admin。

---

## 4. 用例模块概览

| 模块 | ID 前缀 | 用例数 | 阶段 | 关键场景 |
|------|---------|--------|------|---------|
| 认证 | AUTH | 13 | P1 | 注册/登录/登出/token失效/WS鉴权/持久化 |
| 层级管理 | HIER | 16 | P2 | 自动授权/权限不继承/PA删topic/硬编码ID修复 |
| 权限管理 | PERM | 8 | P2 | 授权/删除/列表/Viewer不能授权 |
| Session 推送 | SESS | 8 | P3 | snapshot替换/delta幂等/并发安全/筛选排序 |
| 时间线渲染 | TL | 7 | P3 | 倒序/默认展开/工具组折叠/去敏感字段 |
| Web 输入注入 | IN | 7 | P4 | 入队/取走即清/插件鉴权/空文本不发 |
| Agent 控制 | AG | 18 | P4 | 自动创建session/流式消息/关浏览器继续/重连恢复 |
| WS 连接管理 | WS | 7 | P1/P5 | 3s重连/全量恢复/auth_error触发logout/心跳 |
| 前后分离部署 | DEP | 8 | P0/P5 | CORS预检/拒绝非允许源/baseURL注入/移除静态路由 |

**合计：70+ 用例**

---

## 5. 实施阶段与用例映射

| 阶段 | 内容 | 对应用例 |
|------|------|---------|
| P0 | 后端 CORS + 移除静态路由 + `--cors-origins` | DEP-01,02,04,06,07 |
| P1 | 脚手架 + api/client + ws/manager + auth store | AUTH-01~13, WS-01~07 |
| P2 | hierarchy store + SidebarTree + CreateModal + PermissionModal | HIER-01~16, PERM-01~08 |
| P3 | sessions store + SessionCard + Timeline + ToolGroup | SESS-01~08, TL-01~07 |
| P4 | agent store + AgentPanel + 执行历史 | AG-01~18, IN-01~07 |
| P5 | 对等验证 + 删除旧 dashboard + Makefile 集成 | 全部用例回归 + DEP-03,05,08 |

**建议**：每阶段先写对应 `[F]`/`[B]` 测试再实现（TDD），阶段末跑全量回归。

---

## 6. 关键状态机（测试依据）

- **Session**：`active ↔ idle → stopped/disappeared/error`
- **WebSocket（前端）**：`disconnected → connecting → auth_pending → connected → disconnected(3s重连)`
- **Execution**：`created → running → completed/error/cancelled`

---

## 7. 覆盖率目标

| 模块 | 目标覆盖 |
|------|---------|
| 后端权限检查（checkWSAdmin/checkProjAdmin） | 100% 分支（所有 403 路径） |
| 后端 CORS 中间件 | 100% 分支（允许/拒绝/预检） |
| 前端 stores WS 消息处理 | 100% 消息 type 分支 |
| 前端 api/client 鉴权头注入 | 100%（有 token/无 token/错误） |
| 前端 sessions delta 合并 | 100%（幂等、字段独立） |
| 前端 agent 状态机 | 100%（running→completed/error/cancelled） |

未达 100% 的需在 PR 中说明原因。

---

## 8. 测试环境

### 后端 `[B]`
- 复用现有 `make test`。
- 权限用例需多用户 fixture：注册 A/B/C 三用户，A 建 ws1+proj1，C 被授 proj1 的 pa。
- WS 用例用 `gorilla/websocket` dialer 拨号验证消息流。
- CORS 用例用 `httptest.NewRecorder` + `OPTIONS` 请求验证响应头。

### 前端 `[F]`
- Vitest + jsdom 环境。
- store 测试：mock `api/client` 和 `ws/manager`，验证 action 调用后状态变化。
- 组件测试：@vue/test-utils mount 组件，断言渲染输出。
- localStorage 测试：jsdom 提供 localStorage，测试持久化与恢复。

---

## 详细文档

- 完整测试用例（70+ 条）：[test-cases.md](./test-cases.md)
- 执行方案 + 时序图 + 状态图：[frontend-separation-plan.md](./frontend-separation-plan.md)
