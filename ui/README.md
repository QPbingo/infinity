# Infinity Agent Monitor — UI Design Drafts

基于 [Infinity 项目](../infinity/) 的 Web 看板 UI 设计稿。

## 设计系统

采用 **Dark Premium (Slate-blue)** 设计语言，强调纵深、层次感和流畅交互：

| 层级 | 用途 | 色值 |
|------|------|------|
| 根背景 | 最深底色 | `#0a0f1a` |
| 基础面 | 侧边栏/导航 | `#0f1724` |
| 浮起面 | 统计卡片 | `#141d2b` |
| 表层面 | 模态框/浮层 | `#192334` |
| 悬停态 | hover 背景 | `#1f2d40` |
| 主色 | 按钮/链接/焦点 | `#3b82f6` |
| 成功 | 运行中/完成 | `#10b981` |
| 文字主 | 标题/强调 | `#f1f5f9` |
| 文字次 | 正文 | `#94a3b8` |
| 文字弱 | 标签/次要 | `#64748b` |
| 边框 | RGBA 半透明 | `rgba(255,255,255,0.05-0.18)` |

**字体**：`'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`
**等宽**：`'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', monospace`
**间距**：基于 8px 节奏系统
**动画**：200-300ms cubic-bezier(0.16, 1, 0.3, 1) ease-out

## 文件说明

### `index.html` — 完整设计稿

**顶部导航**：Logo · Workspace 切换器 · Daemon 状态 · 主题切换 · 用户菜单

| 入口 | 触发方式 | 内容 |
|------|---------|------|
| **Dashboard** | 默认页面 | 主从视图：侧边栏层级树 + Session 列表 + 详情面板 |
| **Account Settings** | 用户菜单 → Account Settings | 登录/账户表单（模态浮层） |
| **Permissions** | 用户菜单 → Permissions | 权限管理表格 + 授权弹窗（全屏浮层） |
| **Agent Panel** | 用户菜单 → Agent Panel | Agent 控制台（全屏浮层） |
| **Component Library** | 用户菜单 → Component Library | 组件库参考（全屏浮层） |

### `dashboard.html` — Dashboard 独立详细视图

主从视图布局，包含 6 种 Session 状态：
- **active** — 运行中，绿色状态点 + CPU 占用
- **idle** — 静默等待，黄色状态点
- **stopped** — 正常结束，灰色状态点
- **error** — 进程异常退出，红色状态点 + 错误详情
- **disappeared** — 进程消失，半透明显示
- 点击左侧列表行，右侧切换对应详情

## 屏幕覆盖

| 屏幕 | 状态覆盖 | 文件 |
|------|---------|------|
| 主看板 | session cards × 5 种状态, 筛选, 统计 | `index.html` Tab 1, `dashboard.html` |
| Session 卡片 | 折叠/展开, Timeline, 工具组 running/completed/error, 输入框 | 同上 |
| Agent 控制台 | session 列表, 流式输出 (thinking/tool/result/error), 执行历史, prompt 输入 | `index.html` Tab 2 |
| 登录 | 登录/注册表单, 错误提示 | `index.html` Tab 3 |
| 权限管理 | 权限表格, 角色徽章, 授权弹窗 | `index.html` Tab 4 |
| 组件库 | Modals, Toasts, Empty/Loading/Error 状态, Badges, Buttons, Inputs | `index.html` Tab 5 |

## 明暗模式

支持 Light / Dark 双模式：
- 右上角 &#9788;/&#9790; 按钮一键切换
- 自动跟随系统 `prefers-color-scheme` 偏好
- 选择持久化到 `localStorage`
- 所有颜色、阴影、填充色、滚动条自动适应

## 信息架构

```
┌─ Top Nav ───────────────────────────────────────────────┐
│ [Logo] [WS: infinity-dev ▼]    daemon · 3 active [☀] [D]│
└─────────────────────────────────────────────────────────┘
┌─ Sidebar ──────┬─ Session List ──┬─ Detail ────────┐
│ Projects    [+]│                 │                  │
│ ───────────── │ ● Claude        │ Timeline         │
│ ■ Inspiration │   Refactor auth │  ├ Turn 3        │
│   ● claude    │ ○ Codex         │  ├ Turn 2        │
│     refactor  │   Scanner test  │  └ Turn 1        │
│     fix-cors  │ ○ OpenCode      │                  │
│   ● codex     │   SSE reconnect │ [Send input...]  │
│   ● opencode  │ ✕ Claude        │                  │
│ ───────────── │   Debug race    │                  │
│ ■ Frontend..  │                 │                  │
└───────────────┴─────────────────┴──────────────────┘
```

- **Workspace** — 顶部全局切换器，切换整个上下文
- **Project** (■) — 侧边栏第一级，粗体，蓝色图标
- **Topic** (●) — 侧边栏第二级，中等粗细，缩进 30px
- **Story** (∘) — 侧边栏第三级，细体，缩进 48px，最弱视觉权重

## 使用方式

```bash
# 在浏览器中打开
open ui/index.html
open ui/dashboard.html

# 或用任意 HTTP server
cd ui && python3 -m http.server 8080
```

## 与前端代码的对应关系

设计稿中的组件对应 `web/frontend/src/ui/` 下的模块：

| 设计组件 | 前端模块 |
|---------|---------|
| 层级树侧边栏 | `ui/sidebar.ts` |
| Session 卡片 | `ui/sessionCard.ts` |
| 时间线 + 工具组 | `ui/timeline.ts` |
| Agent 控制台 | `ui/agentPanel.ts` |
| 登录表单 | `ui/auth.ts` |
| 创建/权限弹窗 | `ui/modals.ts` |
| Toast 通知 | `ui/toast.ts` |
