# 验收标准说明

> 本文件为测试分层与用例概览，完整用例见末尾「详细文档」链接。

---

## 1. 测试分层标注

| 标注 | 含义 | 框架 |
|------|------|------|
| `[B]` | 后端 Go 测试 | `go test`（Go testing） |
| `[F]` | 前端测试 | Vitest + jsdom |
| `[BF]` | 双层均需覆盖 | 后端验证契约，前端验证状态处理 |

**原则：**
- `[B]` 验证 HTTP/SSE 契约与权限边界。
- `[F]` 验证 TS state 模块对 SSE 消息的处理和 api/client 鉴权注入。
- `[BF]` 两层都要测：后端保证语义，前端保证状态正确。

---

## 2. 用户角色（测试 Actor）

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
| 前后分离部署 | DEP | 8 | P0/P2/P5 | CORS预检/拒绝非允许源/baseURL注入/移除静态路由/SSE跨域 |
| 鉴权中间件 | AUTH-MID | 4 | P0 | WebAuth分组统一鉴权/MachineAuth机器端点/公开组/注入user |
| 认证 | AUTH | 16 | P1/P2 | 注册/登录/登出/Cookie下发/HttpOnly/续期/SSE鉴权/持久化 |
| SSE 连接 | SSE | 10 | P0/P2 | 初始推送/写入互斥/重连时序/保活心跳/401主动关闭 |
| BroadcastChannel | BC | 4 | P2 | 多标签共享/leader选举/心跳/夺权 |
| 层级管理 | HIER | 16 | P4 | 自动授权/权限不继承/PA删topic/硬编码ID修复 |
| 权限管理 | PERM | 8 | P4 | 授权/删除/列表/Viewer不能授权 |
| Session 推送 | SESS | 8 | P4 | snapshot替换/delta幂等/并发安全/筛选排序 |
| 时间线渲染 | TL | 7 | P4 | 倒序/默认展开/工具组折叠/去敏感字段 |
| Web 输入注入 | IN | 7 | P3 | 入队/取走即清/插件鉴权/空文本不发/REST |
| Agent 控制 | AG | 19 | P3 | 自动创建session/流式消息/关浏览器继续/重连恢复/跨客户端广播/REST返回exec_id |

**合计：107 用例**

---

## 5. 实施阶段与用例映射

| 阶段 | 子任务 | 内容 | 对应用例 |
|------|--------|------|---------|
| P0 | T002-1 | 后端 CORS + 移除静态路由 + SSE 地基 + 鉴权独立化 | DEP-01,02,04,06,07; AUTH-MID-01~04; SSE-01~05 |
| P1 | T002-2 | Cookie 鉴权 + 服务端 token 续期 | AUTH-01~13 |
| P2 | T002-3 | 前端脚手架 + 登录 + SSE 闭环 + BroadcastChannel | AUTH-14~16; SSE-F01~05; BC-01~04; DEP-03,05 |
| P3 | T002-4 | REST 命令 + Agent 执行流（全局 SSE 广播） | AG-01~18, AG-IDEM; IN-01~07 |
| P4 | T002-5 | 层级 + 会话卡片 + 时间线（修硬编码 ID） | HIER-01~16; PERM-01~08; SESS-01~08; TL-01~07 |
| P5 | T002-6 | 对等验证 + 删除旧 dashboard + Makefile + 文档 | 全部用例回归 + DEP-08 |

**建议**：每阶段先写对应 `[F]`/`[B]` 测试再实现（TDD），阶段末跑全量回归。

---

## 6. 关键状态机（测试依据）

- **Session**：`active ↔ idle → stopped/disappeared/error`
- **SSE 连接（前端）**：`disconnected → connecting → connected → disconnected(自动重连)` + 401→`closed+登录框`
- **Execution**：`created → running → completed/error/cancelled`

---

## 7. 覆盖率目标

| 模块 | 目标覆盖 |
|------|---------|
| 后端权限检查（checkWSAdmin/checkProjAdmin） | 100% 分支（所有 403 路径） |
| 后端 CORS 中间件 | 100% 分支（允许/拒绝/预检） |
| 后端 WebAuth/MachineAuth | 100% 分支（cookie/Bearer/daemon-token/无凭证） |
| 后端 SSEHub 写入互斥 | 100%（并发不交错） |
| 前端 state 模块 SSE 消息处理 | 100% 消息 type 分支 |
| 前端 api/client credentials 注入 | 100%（有/无 cookie） |
| 前端 sessions delta 合并 | 100%（幂等、字段独立） |
| 前端 agent 状态机 | 100%（running→completed/error/cancelled） |
| 前端 BroadcastChannel leader 选举 | 100%（选举/心跳/夺权） |

未达 100% 的需在 PR 中说明原因。

---

## 8. 测试环境

### 后端 `[B]`
- 扩展 `make test` 覆盖 `./internal/session/`、`./internal/server/`、`./internal/auth/`。
- 权限用例需多用户 fixture：注册 A/B/C 三用户，A 建 ws1+proj1，C 被授 proj1 的 pa。
- SSE 用例用 `httptest.NewServer` + 客户端读 `text/event-stream` 验证消息流。
- CORS 用例用 `httptest.NewRecorder` + `OPTIONS` 请求验证响应头。
- cookie 用例用 `httptest.NewRecorder` 检查 `Set-Cookie` 头。

### 前端 `[F]`
- Vitest + jsdom 环境。
- state 模块测试：mock `api/client` 和 `sse/manager`，验证调用后状态变化。
- SSE 消息处理测试：构造消息 JSON 喂给 state 模块，断言状态。
- BroadcastChannel 测试：mock `BroadcastChannel` API。
- cookie 测试：jsdom 提供 `document.cookie`（HttpOnly cookie 需 mock 不可读语义）。

---

## 详细文档

- 完整测试用例（107 条）：[test-cases.md](./test-cases.md)
- 任务清单：[task/task.json](./task/task.json)
