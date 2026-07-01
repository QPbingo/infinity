# Agent Monitor 三仓库拆分设计

**日期**: 2026-07-01
**状态**: 已确认
**方案**: A — 三独立 Git 仓库 + Go Module 依赖

---

## 目标

将 Agent Monitor (Infinity) 从单一仓库拆分为三个独立的 Git 仓库，实现完全的项目分离，提升可维护性。

---

## 仓库划分

### agent-monitor-hook（Hook 仓库）

Go module: `github.com/heybox/agent-monitor-hook`

```
agent-monitor-hook/
├── cmd/
│   ├── hook/main.go          # Hook 二进制 — 接收 agent 生命周期事件，写入 events.jsonl
│   └── setup/main.go         # Setup 二进制 — 在 agent 配置中注册 hook
├── internal/
│   ├── installer/            # Agent 配置安装器（Claude/Codex/OpenCode）
│   │   ├── installer.go
│   │   ├── claude.go / claude_test.go
│   │   ├── codex.go / codex_test.go
│   │   ├── opencode.go
│   │   └── opencode_plugin.js
│   └── token/                # Token 生成/读取（独立副本，纯标准库）
├── sdk/                      # Agent SDK 库 — 与 Claude/Codex/OpenCode 交互
│   ├── sdk.go, claude.go, codex.go, opencode.go
│   ├── execution.go, manager.go
├── go.mod / go.sum
├── Makefile
└── README.md
```

**职责**: Agent 交互的一切 — hook 事件捕获、SDK 库、安装器。

### agent-monitor-server（Backend 仓库）

Go module: `github.com/heybox/agent-monitor-server`

依赖: `github.com/heybox/agent-monitor-hook`（import sdk 子包）

```
agent-monitor-server/
├── cmd/
│   └── daemon/main.go        # HTTP/WebSocket 守护进程（端口 9101）
├── internal/
│   ├── auth/                 # Cookie/JWT 认证中间件
│   ├── hierarchy/            # 权限层级管理
│   ├── hook/
│   │   └── eventwatcher.go   # fsnotify 监听 events.jsonl，独立定义 HookEvent 类型
│   ├── scanner/              # Agent 进程扫描（CPU/内存/存活检测）
│   ├── server/               # HTTP handlers、CORS、SSE、WebSocket
│   ├── session/              # 会话管理、SQLite 存储、恢复
│   └── token/                # Token 常量时间比较（独立副本）
├── go.mod / go.sum
├── Makefile
└── README.md
```

**职责**: 数据聚合与分发 — 监听事件、存储会话、向前端推送实时状态。

### agent-monitor-web（Frontend 仓库）

技术栈: TypeScript + Vite（vanilla，无框架）

```
agent-monitor-web/
├── src/
│   ├── api/                  # HTTP REST 客户端
│   ├── sse/                  # Server-Sent Events 管理
│   ├── state/                # 状态 stores
│   ├── ui/                   # UI 渲染模块
│   ├── styles/               # CSS
│   ├── utils/                # 格式化工具
│   └── main.ts               # 入口
├── ui/                       # HTML 设计原型
├── public/
├── index.html
├── package.json
├── vite.config.ts            # 代理 /api → localhost:9101
├── tsconfig.json
├── vitest.config.ts
├── Makefile
└── README.md
```

**职责**: Web Dashboard — 展示 agent 状态、管理会话、实时事件流。

---

## 通信协议

### 1. Hook → Backend: events.jsonl（文件系统）

- **路径**: `~/.agent-monitor/events.jsonl`
- **格式**: JSONL（每行一个 JSON 对象）
- **同步**: POSIX flock（写端）/ fsnotify（读端）
- **认证**: daemon_token 常量时间比较
- **类型定义**: 各自独立定义 `HookEvent` 结构，通过 JSON 字段名约定保持兼容

### 2. Backend → Hook SDK: Go Module Import

```
github.com/heybox/agent-monitor-server
  └── require github.com/heybox/agent-monitor-hook v0.1.0
        └── import "...agent-monitor-hook/sdk"
```

受影响的 import:

| 文件 | 原 import | 新 import |
|------|----------|----------|
| `cmd/daemon/main.go` | `...agent-monitor/sdk` | `...agent-monitor-hook/sdk` |
| `internal/server/server.go` | `...agent-monitor/sdk` | `...agent-monitor-hook/sdk` |
| `internal/server/handlers.go` | `...agent-monitor/sdk` | `...agent-monitor-hook/sdk` |
| `internal/server/sse.go` | `...agent-monitor/sdk` | `...agent-monitor-hook/sdk` |
| `internal/session/manager.go` | `...agent-monitor/sdk` | `...agent-monitor-hook/sdk` |

### 3. Frontend → Backend: HTTP/SSE

- **REST API**: `localhost:9101/api/*`
- **实时推送**: SSE `/api/events/stream`
- **认证**: Cookie/Bearer token
- **无变化**: 与拆分前完全一致

---

## 共享策略

| 共享内容 | 策略 | 原因 |
|----------|------|------|
| HookEvent 结构 | 各自独立定义 | 通过 JSON 格式约定兼容，不需要共享代码 |
| Token 逻辑 | 各自独立副本 | 逻辑简单（生成/读取/常量比较），复制成本低 |
| SDK | Hook 仓库发布为库 | Backend 通过 Go module 引用，单向依赖 |
| Installer | 全部移到 Hook 仓库 | 它是 hook 的配套工具，自然归属 |

---

## 实施步骤

### 阶段 1: 创建 Hook 仓库
1. 初始化 `agent-monitor-hook`，Go module `github.com/heybox/agent-monitor-hook`
2. 复制 `cmd/hook/`, `cmd/setup/`, `internal/installer/`, `sdk/`
3. 新建 `internal/token/`（独立副本）
4. 更新全部 import 路径
5. 编写 Makefile，验证 `go build ./... && go test ./...`

### 阶段 2: 创建 Backend 仓库
1. 初始化 `agent-monitor-server`
2. 复制 `cmd/daemon/`, `internal/*`（除 installer 外）
3. 更新 import 路径（内部 + sdk 依赖）
4. `go.mod` 添加对 hook 仓库的 require
5. 验证构建和测试

### 阶段 3: 创建 Frontend 仓库
1. 初始化 `agent-monitor-web`
2. 复制 `web/frontend/*` 到仓库根目录
3. 复制 `ui/` 原型文件
4. 验证 `npm run build && npm test`

### 阶段 4: 清理当前仓库
1. 更新 README 指向三个新仓库
2. 删除已迁移代码
3. 归档提交

### 阶段 5: 端到端验证
1. 构建三个仓库的制品
2. 启动完整链路 (hook → backend → frontend)
3. 触发 agent 事件，确认全链路通畅

### 阶段 6: CI/CD
1. 各仓库配置独立 CI
2. Hook 仓库发布二进制 + Go module tag
3. Backend 仓库发布 daemon 二进制
4. Frontend 仓库发布静态文件

---

## 依赖方向

```
Frontend ──(HTTP/SSE)──► Backend ──(Go Module)──► Hook/SDK
                              ▲
Hook Binary ──(events.jsonl)──┘
```

单向无环，无循环依赖风险。

---

## 不复保留的内容

- 顶层 `dev.sh` — 各仓库独立构建
- 顶层 `go.mod` / `Makefile` — 仓库成为空壳/归档
- `NONONOAGENT.md` — 按需拆分到各仓库 CLAUDE.md
- 顶层 `agent_claude.md` — 按需拆分
