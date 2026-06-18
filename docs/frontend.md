# 前端设计说明

> 本文件为前端模块的精炼索引与关键摘要，详细设计见末尾「详细文档」链接。

---

## 1. 技术栈

| 项 | 选型 | 理由 |
|----|------|------|
| 构建工具 | Vite | 快速 HMR，原生 ES Module |
| 框架 | Vue 3 + TypeScript | 模板语法对原生 HTML 迁移友好，类型安全 |
| 状态管理 | Pinia | 按领域拆 store，WS 消息集中分发，可测试 |
| 部署 | 完全独立（静态主机 + Go API 分离） | 真正前后分离 |

---

## 2. 项目结构

```
web/frontend/
├── package.json
├── vite.config.ts          # proxy /api + /ws → :9101; env 注入 VITE_API_BASE
├── tsconfig.json
├── index.html
└── src/
    ├── main.ts             # createApp + pinia
    ├── App.vue             # 根布局 (sidebar + main)
    ├── api/
    │   ├── client.ts       # fetch 封装: baseURL + Bearer 头 + 错误处理
    │   ├── auth.ts         # register/login/logout
    │   ├── hierarchy.ts    # workspace/project/topic/story CRUD
    │   ├── permissions.ts  # permissions + users
    │   └── types.ts        # 后端类型镜像
    ├── ws/
    │   └── manager.ts      # WebSocket 单例: 鉴权/重连/心跳/消息分发
    ├── stores/
    │   ├── auth.ts         # token + user, localStorage 持久化
    │   ├── hierarchy.ts    # 层级树, CRUD 后刷新
    │   ├── sessions.ts     # WS 推送的 sessions map + delta 合并
    │   └── agent.ts        # executionHistory + 流式消息
    ├── composables/
    │   └── useWebSocket.ts # 连接生命周期 + 消息路由到 stores
    ├── components/
    │   ├── AuthOverlay.vue
    │   ├── SidebarTree.vue
    │   ├── SessionCard.vue
    │   ├── Timeline.vue
    │   ├── ToolGroup.vue
    │   ├── AgentPanel.vue
    │   ├── PermissionModal.vue
    │   └── CreateModal.vue
    └── styles/
        └── main.css       # 迁移现有内联 CSS
```

---

## 3. 组件迁移映射

现有 `web/dashboard.html` 为单文件全内联实现，按以下映射迁移为 Vue 组件：

| 现有函数 | → Vue 组件 | 状态来源 |
|---------|-----------|---------|
| `renderAuth` / `doLogin` / `doRegister` | `AuthOverlay.vue` | `auth` store |
| `renderTree` / `renderProjectNode` | `SidebarTree.vue`（递归子组件） | `hierarchy` + `sessions` store |
| `renderSessionCard` | `SessionCard.vue` | `sessions` store |
| `renderTimeline` | `Timeline.vue` + `ToolGroup.vue` | session.turns prop |
| Agent 面板 (`sendAgentPrompt`/`cancelAgent`) | `AgentPanel.vue` | `agent` store + ws.manager |
| `showPermissionModal` / `loadPermissions` | `PermissionModal.vue` | api/permissions |
| `showCreateModal` / `doCreate` | `CreateModal.vue` | api/hierarchy |
| `handleMessage`（WS 路由） | `useWebSocket` composable | 分发到各 store |
| `formatPayload` / `esc` / `trunc` | `utils/format.ts` | 纯函数 |

---

## 4. 数据流与状态管理

```
WebSocket 消息                  REST 调用
    │                              │
    ▼                              ▼
ws/manager.ts                  api/client.ts
    │ 按type分发                   │ 统一 Bearer + baseURL
    ├─ snapshot/session_added      │
    │  └▶ stores/sessions.ts       ├─ api/hierarchy.ts ─▶ stores/hierarchy.ts
    ├─ delta                       ├─ api/auth.ts      ─▶ stores/auth.ts
    │  └▶ stores/sessions.ts       └─ api/permissions.ts
    ├─ hierarchy_snapshot/updated
    │  └▶ stores/hierarchy.ts
    └─ agent_executions/exec_started/agent_message/...
       └▶ stores/agent.ts
                │
                ▼
           Vue 组件 (computed 订阅 store, 自动响应式渲染)
```

### Pinia stores 职责

| Store | 状态 | Actions | 来源 |
|-------|------|---------|------|
| `auth` | token, user | login, register, logout, restoreFromStorage | api/auth.ts + localStorage |
| `hierarchy` | HierarchyTree, selectedWorkspaceId/TopicId/StoryId | refresh, createWorkspace/Project/Topic/Story, editStory, deleteStory | api/hierarchy.ts + WS hierarchy_* |
| `sessions` | `Map<session_key, Session>`, currentFilter | applySnapshot, addSession, applyDelta, filter getter | WS snapshot/session_added/delta |
| `agent` | `executionHistory[]`, currentExecId | sendPrompt, cancel, onExecStarted, onMessage, onExecutions | ws.manager + WS agent_* |

---

## 5. 部署拓扑

### 开发态
```
Vite dev server (:5173) ──proxy──▶ Go daemon (:9101)
  /api/*  → 127.0.0.1:9101
  /ws     → 127.0.0.1:9101 (WebSocket proxy)
  免 CORS（同源经代理）
```

### 生产态
```
静态主机 (Nginx / CDN) ──CORS──▶ Go daemon (:9101, 纯 API + WS)
  前端构建产物 (dist/) 独立部署
  baseURL 由环境变量 VITE_API_BASE 注入
  Go 后端移除 GET / 静态路由, 新增 CORS 中间件
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
