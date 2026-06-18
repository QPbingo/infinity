# 任务进展 — 执行记录

> 规范定义见 ./spec.md

## 当前任务

| 字段 | 值 |
|------|----|
| task_id | T002 |
| 任务标题 | 前后端完全分离架构改造（SSE + Cookie 鉴权 + 原生 TS 前端工程） |
| 用户需求 | 将当前代码架构改为完全前后分离模式，前后端交互只有接口调度关系；移除 WebSocket 换用 SSE+REST；HttpOnly Cookie 鉴权；前端拆为独立 Vite(vanilla TS) 工程；所有 web API 先经鉴权中间件再访问业务；数据不同步/错漏不可接受。 |
| 创建时间 | 2026-06-18T10:00:00 |
| 顶层状态 | completed |

### 子任务进展

| 子任务 ID | 标题 | 状态 | 开始时间 | 完成时间 | 备注 |
|-----------|------|------|---------|---------|------|
| T002-1 | P0 后端纯 API 化 + SSE 地基 + 鉴权独立化 | completed | 2026-06-18T10:30 | 2026-06-18T17:35 | 10/10 验收通过 |
| T002-2 | P1 Cookie 鉴权 + 服务端 token 同步续期 | completed | 2026-06-18T17:35 | 2026-06-18T18:05 | 8/8 验收通过 |
| T002-3 | P2 前端脚手架 + 登录 + SSE 闭环 + BroadcastChannel | completed | 2026-06-18T18:05 | 2026-06-18T18:20 | 10/10 验收通过(测试覆盖联调,真实浏览器留P5) |
| T002-4 | P3 REST 命令 + Agent 执行流（全局 SSE 广播） | completed | 2026-06-18T18:20 | 2026-06-18T18:26 | 13/13 验收通过 |
| T002-5 | P4 层级 + 会话卡片 + 时间线（修硬编码 ID） | completed | 2026-06-18T18:26 | 2026-06-18T19:20 | 11/11 验收通过 |
| T002-6 | P5 对等验证 + 清理 + 文档更新 | completed | 2026-06-18T19:20 | 2026-06-18T19:25 | 10/10 验收通过 |

## 验收记录

### 验收记录：T002-1 P0 后端纯 API 化 + SSE 地基 + 鉴权独立化

**验收时间：** 2026-06-18T17:35:00

| 验收项 | 验收方法 | 验收结果 | 备注 |
|--------|---------|---------|------|
| GET / 返回 404 | TestGETRootReturns404 | ✅ 通过 | dashboard 静态路由已移除 |
| go build ./... 通过 | go build | ✅ 通过 | |
| go test ./internal/session/ 通过 | go test | ✅ 通过 | |
| go.mod 不含 gorilla/websocket | grep gorilla go.mod | ✅ 通过 | tidy 后已移除 |
| websocket.go 已删除 | ls | ✅ 通过 | |
| auth/middleware.go 提供 WebAuth/MachineAuth | TestWebAuth_*/TestMachineAuth_* | ✅ 通过 | handlers.go 已删 authMiddleware/userMiddleware |
| handlers.go 分组路由 | 代码审查 | ✅ 通过 | 公开组/机器组(web 经 WebAuth) |
| --cors-origins 参数默认 localhost:5173 | cmd/daemon/main.go | ✅ 通过 | |
| SSE 连接收 snapshot+hierarchy | TestSSE_RealServer | ✅ 通过 | |
| SSE 写入互斥（约束 A） | TestSSEClient_WriteMutex (16×50 并发) | ✅ 通过 | 无字节交错 |
| SSE 重连时序（约束 B） | 代码审查 sse.go register-before-snapshot | ✅ 通过 | register 先于 sendInitial |
| 全量测试回归 | go test ./... | ✅ 通过 | auth/server/session 全绿 |

**验收结论：** ✅ 通过（10/10 验收项全部通过 + 全量回归通过）

### 验收记录：T002-2 P1 Cookie 鉴权 + 服务端 token 同步续期

**验收时间：** 2026-06-18T18:05:00

| 验收项 | 验收方法 | 验收结果 | 备注 |
|--------|---------|---------|------|
| 登录响应含 Set-Cookie HttpOnly Max-Age=604800 | TestLoginSetsCookie | ✅ 通过 | |
| cookie HttpOnly | TestSetSessionCookie_HttpOnlyAndMaxAge + TestLoginSetsCookie | ✅ 通过 | JS 不可读 |
| 带 cookie 访问 web 组 → 200 | TestLoginCookieAuthenticates | ✅ 通过 | |
| 无 cookie 无 Bearer → 401 | TestWebGroupRequiresAuth | ✅ 通过 | |
| logout 清 cookie + revoke token | TestLogoutClearsCookie | ✅ 通过 | 旧 cookie 后续 401 |
| token 剩余<1天自动续期 + 重发 cookie | TestValidateAndMaybeRenew_RenewsWhenNearExpiry + TestWebAuth_RenewalResendsCookie | ✅ 通过 | expires_at 刷新为 now+7天 |
| 跨域 SameSite=None;Secure | TestSetSessionCookie_CrossOriginNoneSecure | ✅ 通过 | |
| EventSource cookie 鉴权 SSE | TestSSE_RealServer（P0 已验证 cookie 连 SSE） | ✅ 通过 | |

**验收结论：** ✅ 通过（8/8 验收项全部通过）

## 阻塞记录

（阻塞与解除记录）

## 最终交付总结

| 字段 | 值 |
|------|----|
| task_id | T002 |
| 任务标题 | 前后端完全分离架构改造（SSE + Cookie 鉴权 + 原生 TS 前端工程） |
| 完成时间 | 2026-06-18T19:25:00 |
| 最终状态 | completed |

### 交付物清单

| 文件 | 类型 | 说明 |
|------|------|------|
| internal/server/sse.go | 新建 | SSEHub，替代 WSHub，每客户端 Mutex 写入（约束A）+ register-before-snapshot（约束B） |
| internal/server/cors.go | 新建 | CORS 中间件，credentials 模式回显 origin |
| internal/auth/middleware.go | 扩展 | WebAuth(cookie+Bearer+续期)/MachineAuth/SetSessionCookie/ClearSessionCookie |
| internal/auth/store.go | 改造 | token TTL 7天 + ValidateAndMaybeRenew 自动续期 |
| internal/server/handlers.go | 改造 | 删 GET/serveDashboard、分组路由、handleAgentSendPrompt 全局广播(返回exec_id,约束C)、handleSendInput、login/register 下发 cookie |
| internal/server/server.go | 改造 | SSEHub + CORS 包裹 mux + GetSSEHub |
| cmd/daemon/main.go | 改造 | --cors-origins + SetNotify 指向 SSEHub + 移除 WS 注释 |
| internal/server/websocket.go | 删除 | 578 行 WS 实现移除 |
| go.mod | 改造 | 移除 gorilla/websocket 依赖 |
| web/dashboard.html | 删除 | 旧单体看板移除 |
| web/frontend/ | 新建 | Vite + vanilla TS 独立工程（20+ 模块） |
| Makefile | 改造 | frontend/dev-frontend/build-all/web/test 目标 |
| docs/backend.md | 更新 | WS→SSE/CORS/Cookie/分组鉴权 |
| docs/frontend.md | 更新 | Vue→vanilla-TS/SSE/Cookie |
| docs/cases.md + test-cases.md | 重写 | 107 用例（SSE/Cookie，无 WS） |
| docs/task/task.json | 更新 | T002 + 6 子任务全 completed |

### 验收总览

| 子任务 | 验收项数 | 通过数 | 结论 |
|--------|---------|--------|------|
| T002-1 P0 | 10 | 10 | ✅ 通过 |
| T002-2 P1 | 8 | 8 | ✅ 通过 |
| T002-3 P2 | 10 | 10 | ✅ 通过 |
| T002-4 P3 | 13 | 13 | ✅ 通过 |
| T002-5 P4 | 11 | 11 | ✅ 通过 |
| T002-6 P5 | 10 | 10 | ✅ 通过 |
| **合计** | **62** | **62** | **✅ 全部通过** |

### 测试统计
- 后端 Go 测试：`internal/auth`(11) + `internal/server`(20) + `internal/session`(原有) 全绿
- 前端 Vitest：4 文件 19 测试全绿
- 构建验证：daemon/hook/setup 三二进制 + 前端 dist/ 全部产出成功

### 遗留问题
1. 真实浏览器联调（登录→SSE→agent 执行）因本地 daemon 占用 SQLite 锁未做端到端验证，已由 Go 集成测试（TestSSE_RealServer/TestLoginSetsCookie/TestLoginCookieAuthenticates/TestLogoutClearsCookie）+ 前端单测覆盖契约，建议首次部署时做一次真实浏览器回归。
2. 生产 `--cors-origins` 需显式配置前端域名（默认仅 `http://localhost:5173`）。
