# 前端设计说明

> 本文件为前端模块的精炼索引与关键摘要，详细设计见末尾「详细文档」链接。

---

## 1. 技术栈

| 项 | 选型 | 理由 |
|----|------|------|
| 构建工具 | Vite | 快速 HMR，原生 ES Module |
| 语言 | TypeScript (vanilla, 无框架) | 类型安全，贴近原 HTML 实现，迁移成本最低 |
| 状态管理 | 自研轻量 Store (pub/sub) | 按领域拆 store，SSE 消息集中分发，可测试 |
| 鉴权 | HttpOnly Cookie (浏览器自动携带) | EventSource 不能设头，cookie 最自然；防 XSS |
| 部署 | 完全独立（静态主机 + Go API 分离） | 真正前后分离 |

---

## 2. 项目结构

```
web/frontend/
├── package.json
├── vite.config.ts          # proxy /api → :9101; env 注入 VITE_API_BASE
├── tsconfig.json
├── index.html
└── src/
    ├── main.ts             # 入口: 恢复登录/连SSE/渲染shell
    ├── config.ts           # API_BASE/SSE_PATH 来自 import.meta.env
    ├── api/
    │   ├── client.ts       # fetch 封装: credentials:include + 错误处理
    │   ├── auth.ts         # register/login/logout/isAuthed
    │   ├── hierarchy.ts    # workspace/project/topic/story CRUD (动态ID)
    │   ├── permissions.ts  # permissions + users
    │   └── agent.ts        # sendPrompt(返回exec_id)/cancelExecution/sendInput
    ├── sse/
    │   └── manager.ts      # EventSource 单例: 鉴权/重连/保活/401关闭/BroadcastChannel
    ├── state/
    │   ├── store.ts        # 轻量 pub/sub 基类
    │   ├── auth.ts         # user + authed
    │   ├── hierarchy.ts    # 层级树, 选中态, 展开
    │   ├── sessions.ts     # sessions map + delta 合并 + 筛选排序
    │   └── agent.ts        # executionHistory + 流式消息 + 幂等去重
    ├── ui/
    │   ├── auth.ts         # renderAuth/doLogin/doRegister/restoreSession
    │   ├── sidebar.ts      # renderTree/renderProjectNode
    │   ├── sessionCard.ts  # render/renderSessionCard/sendInput
    │   ├── timeline.ts     # renderTimeline/toggleToolGroup/Payload/Turn
    │   ├── agentPanel.ts   # sendPrompt(REST)/cancel/renderExecHistory
    │   └── modals.ts       # showCreateModal/showPermissionModal/refreshHierarchy
    ├── utils/
    │   └── format.ts       # esc/trunc/formatPayload/formatPayloadDisplay/formatTime
    └── styles/
        └── main.css       # 从旧 dashboard.html 迁移的样式
```

---

## 3. 组件迁移映射

现有 `web/dashboard.html`（已删除）为单文件全内联实现，按以下映射迁移为 TS 模块：

| 现有函数 | → TS 模块 | 状态来源 |
|---------|-----------|---------|
| `renderAuth` / `doLogin` / `doRegister` | `ui/auth.ts` | `state/auth.ts` |
| `renderTree` / `renderProjectNode` | `ui/sidebar.ts` | `state/hierarchy.ts` + `state/sessions.ts` |
| `renderSessionCard` | `ui/sessionCard.ts` | `state/sessions.ts` |
| `renderTimeline` | `ui/timeline.ts` + 工具组 | session.turns |
| Agent 面板 (`sendAgentPrompt`/`cancelAgent`) | `ui/agentPanel.ts` | `state/agent.ts` + `api/agent.ts`(REST) |
| `showPermissionModal` / `loadPermissions` | `ui/modals.ts` | `api/permissions.ts` |
| `showCreateModal` / `doCreate` | `ui/modals.ts` | `api/hierarchy.ts` |
| `handleMessage`（WS 路由） | `main.ts handleSSE` | 分发到各 state 模块 |
| `formatPayload` / `esc` / `trunc` | `utils/format.ts` | 纯函数 |

---

## 4. 数据流与状态管理

```
SSE 事件                         REST 调用
    │                              │
    ▼                              ▼
sse/manager.ts                  api/client.ts (credentials:include)
    │ 按type分发                   │ cookie 自动携带
    ├─ snapshot/session_added/delta│
    │  └▶ state/sessions.ts       ├─ api/hierarchy.ts ─▶ state/hierarchy.ts
    ├─ hierarchy_snapshot/updated │ ├─ api/auth.ts ─▶ state/auth.ts
    │  └▶ state/hierarchy.ts      ├─ api/permissions.ts
    └─ agent_executions/exec_started/agent_message/...
       └▶ state/agent.ts
                 │
                 ▼
            ui 模块 (订阅 state store, 自动重渲染)
```

### State Store 职责

| Store | 状态 | 来源 |
|-------|------|------|
| `auth` | user, authed | api/auth.ts + cookie (浏览器管理) |
| `hierarchy` | HierarchyTree, selectedWorkspaceId/TopicId/StoryId, expandedNodes | SSE hierarchy_* + api/hierarchy.ts |
| `sessions` | `Record<session_key, Session>`, currentFilter, expanded* | SSE snapshot/session_added/delta |
| `agent` | `Execution[]`, currentExecId | SSE agent_* + api/agent.ts (REST 发命令) |

---

## 5. 部署拓扑

### 开发态
```
Vite dev server (:5173) ──proxy──▶ Go daemon (:9101)
  /api/*  → 127.0.0.1:9101
  免 CORS（同源经代理），cookie SameSite=Lax
```

### 生产态
```
静态主机 (Nginx / CDN) ──CORS──▶ Go daemon (:9101, 纯 API + SSE)
  前端构建产物 (dist/) 独立部署
  baseURL 由环境变量 VITE_API_BASE 注入
  cookie SameSite=None; Secure (跨域 HTTPS)
  --cors-origins=https://app.yourhost.com
```

---

## 6. 实施阶段划分

| 阶段 | 内容 | 验收用例 |
|------|------|---------|
| P0 | 后端 CORS 中间件 + 移除静态路由 + `--cors-origins` 参数 | DEP-01,02,04,06,07 |
| P1 | 前端脚手架 + api/client + ws/manager + auth store | AUTH-01~13, WS-01~07 |
| P2 | hierarchy store + SidebarTree + CreateModal + PermissionModal | HIER-01~16, PERM-01~08 |
| P3 | sessions store + SessionCard + Timeline + ToolGroup | SESS-01~08, TL-01~07 |
| P4 | agent store + AgentPanel + 执行历史 | AG-01~18, IN-01~07 |
| P5 | 对等验证 + 删除旧 dashboard.html + Makefile 集成 | 全部用例回归 |

---

## 7. 已知问题（迁移时修复）

1. **硬编码 ID**：`createStory()` 和 `doCreate('topic')` 把 `wid=1, pid=1` 写死，迁移后必须改为动态传入当前选中 workspace/project。
2. **未实现的 CRUD**：Workspace/Project/Topic 的 PUT/DELETE 前端无 UI，迁移时可补全或暂留。
3. **Token 存储**：当前用 localStorage，分离 SPA 后需考虑 XSS 防护。
4. **双套 Agent 控制接口**：REST（SSE）和 WebSocket 两套并存，前端只用 WS，建议统一。

---

## 详细文档

- 完整执行方案 + 时序图 + 状态图：[frontend-separation-plan.md](./frontend-separation-plan.md)
- API 交互分析（REST + WS 协议）：[api-analysis.md](./api-analysis.md)
- 测试用例：[test-cases.md](./test-cases.md)
