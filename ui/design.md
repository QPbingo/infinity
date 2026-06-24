# Infinity Design System

> Web 看板视觉设计规范。适用于 `ui/index.html`、`ui/dashboard.html` 及后续 `web/frontend/src/styles/` 实现。

---

## 1. 设计理念

**Dark Premium (Slate-blue)** — 以深蓝黑为基调，通过阴影层次而非硬边框来建立纵深感，强调信息清晰度与操作流畅性。

核心原则：
- **层次优先**：5 层纵深体系，卡片通过阴影"浮起"而非靠边框区分
- **减少视觉噪音**：边框使用 RGBA 半透明，仅在必要时出现
- **8px 节奏**：所有间距遵循 4/8 倍数系统
- **双模式适配**：Dark / Light 独立调色，非简单反色
- **内容聚焦**：侧边栏导航 + 主从视图，一次只看一件事

---

## 2. 色彩系统

### 2.1 Dark Mode（默认）

#### 背景层级

| Token | 色值 | 用途 |
|-------|------|------|
| `--bg-root` | `#0a0f1a` | 页面根背景、详情面板底色 |
| `--bg-base` | `#0f1724` | 侧边栏、顶部导航 |
| `--bg-raised` | `#141d2b` | 统计卡片、Session 行 |
| `--bg-surface` | `#192334` | 模态框、下拉菜单 |
| `--bg-overlay` | `#1e2a3d` | 浮层面板 |
| `--bg-hover` | `#1f2d40` | 悬停态 |
| `--bg-active` | `#243447` | 选中/激活态 |
| `--bg-input` | `#0d1320` | 输入框背景 |
| `--bg-tool` | `#0a1018` | 工具组卡片 |

#### 边框（RGBA 半透明）

| Token | 色值 | 用途 |
|-------|------|------|
| `--border-hairline` | `rgba(255,255,255,0.05)` | 极细分隔 |
| `--border-subtle` | `rgba(255,255,255,0.08)` | 卡片边框、输入框 |
| `--border-default` | `rgba(255,255,255,0.12)` | 强调边框 |
| `--border-emphasis` | `rgba(255,255,255,0.18)` | 高亮边框 |

#### 文字

| Token | 色值 | 用途 |
|-------|------|------|
| `--text-primary` | `#f1f5f9` | 标题、强调正文 |
| `--text-secondary` | `#94a3b8` | 常规正文 |
| `--text-tertiary` | `#64748b` | 标签、次要信息 |
| `--text-disabled` | `#3b4657` | 占位符、禁用态 |

#### 语义色

| Token | 色值 | 用途 |
|-------|------|------|
| `--accent` | `#3b82f6` | 主色：链接、选中态、项目图标 |
| `--accent-hover` | `#60a5fa` | 主色悬停 |
| `--accent-subtle` | `rgba(59,130,246,0.12)` | 主色浅底 |
| `--success` | `#10b981` | 运行中、完成 |
| `--success-subtle` | `rgba(16,185,129,0.12)` | 成功浅底 |
| `--warning` | `#f59e0b` | 空闲、警告 |
| `--warning-subtle` | `rgba(245,158,11,0.12)` | 警告浅底 |
| `--danger` | `#ef4444` | 错误、危险操作 |
| `--danger-subtle` | `rgba(239,68,68,0.12)` | 危险浅底 |
| `--purple` | `#a78bfa` | 工具名、Codex 徽章 |
| `--purple-subtle` | `rgba(167,139,250,0.12)` | 紫色浅底 |

### 2.2 Light Mode

通过 `[data-theme="light"]` 选择器覆盖。调色原则：暖灰白底 + 深蓝黑文字，饱和度适度降低。

| Token | Dark 值 | Light 值 |
|-------|---------|----------|
| `--bg-root` | `#0a0f1a` | `#f1f5f9` |
| `--bg-base` | `#0f1724` | `#ffffff` |
| `--bg-raised` | `#141d2b` | `#f8fafc` |
| `--bg-surface` | `#192334` | `#ffffff` |
| `--text-primary` | `#f1f5f9` | `#0f172a` |
| `--text-secondary` | `#94a3b8` | `#334155` |
| `--text-tertiary` | `#64748b` | `#64748b` |
| `--text-disabled` | `#3b4657` | `#94a3b8` |
| `--accent` | `#3b82f6` | `#2563eb` |
| `--success` | `#10b981` | `#059669` |
| `--warning` | `#f59e0b` | `#d97706` |
| `--danger` | `#ef4444` | `#dc2626` |
| `--purple` | `#a78bfa` | `#7c3aed` |
| `--border-hairline` | `rgba(255,255,255,0.05)` | `rgba(0,0,0,0.05)` |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.3)` | `0 1px 2px rgba(0,0,0,0.04)` |

### 2.3 填充色（双模式自动切换）

这些变量在 Dark/Light 下自动切换为对应透明度的黑/白色，用于徽章背景、滚动条、骨架屏等。

| Token | Dark 值 | Light 值 | 用途 |
|-------|---------|----------|------|
| `--fill-subtle` | `rgba(255,255,255,0.04)` | `rgba(0,0,0,0.03)` | 微妙背景 |
| `--fill-medium` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.05)` | 按钮/徽章背景 |
| `--fill-strong` | `rgba(255,255,255,0.12)` | `rgba(0,0,0,0.1)` | 按钮悬停 |
| `--fill-scrollbar` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.1)` | 滚动条 |
| `--fill-skeleton-base` | `rgba(255,255,255,0.04)` | `rgba(0,0,0,0.05)` | 骨架屏底色 |
| `--fill-skeleton-shine` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.09)` | 骨架屏高光 |

---

## 3. 字体

### 3.1 字体族

```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
```

Google Fonts 引入：
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### 3.2 字号层级

| Token | 大小 | 用途 |
|-------|------|------|
| `--text-xs` | `0.7rem` (≈11px) | 标签、辅助信息、徽章 |
| `--text-sm` | `0.8rem` (≈13px) | 正文、列表项、树节点 |
| `--text-base` | `0.9rem` (≈14px) | 基础字号、项目名 |
| `--text-md` | `1rem` (≈16px) | 标题、卡片标题 |
| `--text-lg` | `1.15rem` (≈18px) | 页面标题 |
| `--text-xl` | `1.35rem` (≈22px) | 区段标题 |
| `--text-2xl` | `1.65rem` (≈26px) | 统计数值 |

### 3.3 字重规范

| 层级 | 字重 | 用途 |
|------|------|------|
| 700 | `font-weight: 700` | 统计数值、主标题 |
| 600 | `font-weight: 600` | 项目节点、导航选中、卡片标题 |
| 500 | `font-weight: 500` | Topic 节点、按钮、导航未选中 |
| 400 | `font-weight: 400` | Story 节点、正文 |
| 300 | `font-weight: 300` | 特殊场景（Inter light） |

全局 `letter-spacing: -0.01em` 增强现代感。

---

## 4. 间距系统

基于 **8px 节奏**，所有间距为 4 的倍数：

| Token | 值 | 用途 |
|-------|-----|------|
| `--space-1` | `4px` | 极小间隙 |
| `--space-2` | `8px` | 行内间距、图标间距 |
| `--space-3` | `12px` | 卡片内边距、列表间距 |
| `--space-4` | `16px` | 标准内边距 |
| `--space-5` | `20px` | 区段间距 |
| `--space-6` | `24px` | 大区间距、页边距 |
| `--space-8` | `32px` | 页面级间距 |
| `--space-10` | `40px` | 空状态内边距 |
| `--space-12` | `48px` | 极大间距 |

---

## 5. 圆角

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius-sm` | `6px` | 按钮、输入框、树节点、标签 |
| `--radius-md` | `10px` | 卡片、下拉菜单、统计卡片 |
| `--radius-lg` | `14px` | Session 卡片、大面板 |
| `--radius-xl` | `20px` | 模态框 |
| `--radius-full` | `9999px` | 徽章、状态点、用户头像 |

---

## 6. 阴影与层次

通过阴影建立 Z 轴层次，替代硬边框分隔：

| Token | 值 | 用途 |
|-------|-----|------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.3)` | 微浮起：选中按钮、分段控件 |
| `--shadow-md` | `0 2px 8px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)` | 卡片悬停 |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.3)` | 下拉菜单、Toast |
| `--shadow-xl` | `0 16px 40px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.4)` | 模态框 |
| `--shadow-glow-blue` | `0 0 20px rgba(59,130,246,0.15)` | 蓝色发光 |
| `--shadow-glow-green` | `0 0 20px rgba(16,185,129,0.12)` | 绿色发光 |

**原则**：Light mode 阴影透明度降低至 1/5 ~ 1/6，因为浅色背景下阴影更明显。

---

## 7. 动效

### 7.1 缓动函数

```css
--ease-out:  cubic-bezier(0.16, 1, 0.3, 1);   /* 进入：自然减速 */
--ease-in:   cubic-bezier(0.4, 0, 1, 1);       /* 退出：加速消失 */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);   /* 往返 */
```

### 7.2 时长

| Token | 值 | 用途 |
|-------|-----|------|
| `--duration-fast` | `150ms` | 悬停、选中态切换 |
| `--duration-base` | `200ms` | 卡片浮起、边框变色 |
| `--duration-slow` | `300ms` | 模态框出入、下拉展开 |

### 7.3 动效规范

- 微交互 150-200ms，复杂过渡 ≤300ms
- 按钮按下 `scale(0.97)` 提供触感反馈
- 模态框 `slideUp`：`translateY(12px) scale(0.98)` → 原位
- 下拉菜单同理，从上方 8px 滑入
- 骨架屏 `shimmer` 动画 1.5s 循环
- `prefers-reduced-motion: reduce` 完全禁用动画

---

## 8. 信息架构

### 8.1 全局布局

```
┌─ Top Nav (48px) ──────────────────────────────────────────┐
│ [Logo] [Workspace ▼]           daemon status  [☀] [User] │
├─ Sidebar ────┬─ Main Content ─────────────────────────────┤
│              │                                             │
│ ■ Dashboard  │  [视图内容随侧边栏选中项切换]                 │
│   Sessions   │                                             │
│ ─────────── │                                             │
│ Projects [+] │                                             │
│ ■ Inspiration│                                             │
│   ● claude   │                                             │
│     · story  │                                             │
└──────────────┴─────────────────────────────────────────────┘
```

### 8.2 导航层级

| 层级 | 位置 | 内容 |
|------|------|------|
| **Workspace** | 顶部下拉 | 全局上下文切换，切换后侧边栏项目随之变化 |
| **视图导航** | 侧边栏顶部 | Dashboard / Sessions — 平级切换 |
| **项目管理** | 侧边栏 Projects 区 | Project → Topic → Story 三级树 |

### 8.3 用户入口

用户头像下拉菜单包含：
- 用户信息展示（头像、用户名、角色、当前 Workspace）
- Account Settings → 打开账户模态框
- Permissions → 打开权限管理
- Agent Panel → 打开 Agent 控制台
- Component Library → 打开组件参考库
- Sign Out

---

## 9. 组件规范

### 9.1 侧边栏导航项 (`.side-nav-item`)

```
┌──────────────────────┐
│ ▌■ Dashboard         │  ← active: accent 背景 + 3px 蓝色左边框
│   Sessions       5   │  ← 带计数徽章
└──────────────────────┘
```

- 高度 36px，圆角 `--radius-md`
- active 态左边框 3px，颜色 `--accent`
- 徽章使用 `--fill-subtle` 背景，active 时变 `--accent-subtle`

### 9.2 层级树

三级视觉分化：

| 属性 | Project | Topic | Story |
|------|---------|-------|-------|
| 字重 | **600** | 500 | 400 |
| 字号 | `--text-base` | `--text-sm` | `0.82em` |
| 缩进 | 12px | 32px | 52px |
| 图标 | ■ accent 色 1em | ● 0.7em | · 0.55em 30%透明 |
| 选中左边框 | 3px accent | 无 | 无 |
| 连接线 | 无 | 竖线 18px | 竖线+横线 38px |
| 计数徽章 | accent 色实心 | 灰色空心 | 无 |
| 行高 | 32px | 28px | 24px |

项目间用 6px 分隔线间隔。

### 9.3 Session 行 (`.session-row`)

```
┌────────────────────────────────────┐
│ ● Claude  Refactor auth middleware │
│           a3f2b9 · Ghostty · 342MB │  T3  12%
└────────────────────────────────────┘
```

- 左侧 7px 状态圆点（绿=active, 黄=idle, 灰=stopped, 红=error）
- 标题 + 副信息双行布局
- 右侧 Turns 数 + CPU 占用
- 选中态：`--accent-subtle` 背景 + 2px 蓝色左边框

### 9.4 按钮

三层样式：

| 类型 | 背景 | 边框 | 用途 |
|------|------|------|------|
| **Primary** | `--accent` | 1px accent 光环 | 主要操作 |
| **Secondary** | `--fill-medium` | `--border-subtle` | 次要操作 |
| **Danger** | `--danger` | 红色光环 | 危险操作 |
| **Ghost** | 透明 | 无 | 最小干扰 |

- 高度 32px，圆角 `--radius-sm`
- 按下 `scale(0.97)` + 阴影增强
- 禁用态 `opacity: 0.45`

### 9.5 状态徽章 (`.status-badge`)

| 状态 | 背景 | 文字色 |
|------|------|--------|
| active | `--success-subtle` | `--success` |
| idle | `--warning-subtle` | `--warning` |
| stopped | `--fill-medium` | `--text-tertiary` |
| error | `--danger-subtle` | `--danger` |

- 字号 0.65em，圆角 `--radius-full`
- 全大写 + 0.03em 字间距

### 9.6 Agent 徽章 (`.agent-badge`)

| Agent | 背景 | 文字色 |
|-------|------|--------|
| Claude | `--accent-subtle` | `--accent` |
| Codex | `--purple-subtle` | `--purple` |
| OpenCode | `--success-subtle` | `--success` |

### 9.7 输入框

```css
background: var(--bg-input);
border: 1px solid var(--border-subtle);
border-radius: var(--radius-sm);
padding: 8px 12px;
```

聚焦态：`border-color: var(--accent)` + `box-shadow: 0 0 0 3px var(--accent-subtle)`

### 9.8 模态框

```css
background: var(--bg-surface);
border: 1px solid var(--border-subtle);
border-radius: var(--radius-xl);
box-shadow: var(--shadow-xl);
```

- 遮罩 `rgba(0,0,0,0.65)` + `backdrop-filter: blur(4px)`
- slideUp 入场动画 300ms
- 点击遮罩关闭

### 9.9 Toast

```
┌──────────────────────────────┐
│ ▌✓  Workspace created        │  ← 左侧 3px 语义色边框
│     infinity-dev has been... │
└──────────────────────────────┘
```

四种语义变体：success (绿) / danger (红) / info (蓝) / neutral (灰)

### 9.10 统计卡片 (`.stat-card`)

- 背景 `--bg-raised`，边框 `--border-hairline`
- hover 浮起 `translateY(-1px)` + `shadow-md`
- 标签全大写 0.06em 字间距
- 数值使用 `--font-mono` + `font-weight: 700`

### 9.11 分段筛选 (`.filter-group`)

```html
<div class="filter-group">
  <button class="filter-pill active">All</button>
  <button class="filter-pill">Active</button>
</div>
```

- 父容器 `--bg-raised` 背景 + 2px padding + 圆角边框
- active 项 `--bg-surface` 背景 + `shadow-sm` 阴影

---

## 10. 图标体系

不使用 Emoji。使用 Unicode 几何符号作为结构性图标：

| 符号 | 实体 | 用途 |
|------|------|------|
| ■ | `&#9632;` | 项目 (Project) |
| ● | `&#9679;` | 主题 (Topic) |
| · | `&#8728;` | 故事 (Story) |
| ▸ | `▸` | 折叠箭头 |
| ▼ | `▼` | 展开箭头 / 下拉 |
| ✓ | `✓` | 成功 |
| ✕ | `✕` | 关闭/错误 |
| ☀ | `&#9788;` | 亮色模式 |
| ☾ | `&#9790;` | 暗色模式 |

---

## 11. CSS 变量速查

### 完整 Token 列表

```css
/* 背景 */
--bg-root, --bg-base, --bg-raised, --bg-surface, --bg-overlay
--bg-hover, --bg-active, --bg-input, --bg-tool

/* 边框 */
--border-hairline, --border-subtle, --border-default, --border-emphasis

/* 文字 */
--text-primary, --text-secondary, --text-tertiary, --text-disabled

/* 语义 */
--accent, --accent-hover, --accent-subtle, --accent-glow
--success, --success-hover, --success-subtle, --success-glow
--warning, --warning-subtle
--danger, --danger-hover, --danger-subtle
--purple, --purple-subtle

/* 间距 */
--space-1(4), --space-2(8), --space-3(12), --space-4(16)
--space-5(20), --space-6(24), --space-8(32), --space-10(40), --space-12(48)

/* 圆角 */
--radius-sm(6), --radius-md(10), --radius-lg(14), --radius-xl(20), --radius-full(9999)

/* 字号 */
--text-xs, --text-sm, --text-base, --text-md, --text-lg, --text-xl, --text-2xl

/* 阴影 */
--shadow-sm, --shadow-md, --shadow-lg, --shadow-xl
--shadow-glow-blue, --shadow-glow-green

/* 动效 */
--ease-out, --ease-in, --ease-in-out
--duration-fast(150ms), --duration-base(200ms), --duration-slow(300ms)

/* 填充 */
--fill-subtle, --fill-medium, --fill-strong
--fill-scrollbar, --fill-scrollbar-hover
--fill-skeleton-base, --fill-skeleton-shine
--glow-dot

/* 布局 */
--sidebar-width: 264px
--header-height: 48px
--list-width: 360px

/* 字体 */
--font-sans, --font-mono
```

---

## 12. 可访问性

- **对比度**：Dark 模式主文字 ≥4.5:1，Light 模式主文字 ≥7:1
- **焦点环**：`:focus-visible` 使用 2px `--accent` 边框 + 2px 偏移
- **色彩独立性**：状态信息始终伴随图标/文字，不单独依赖颜色
- **减少动效**：`@media (prefers-reduced-motion: reduce)` 完全禁用动画
- **触摸目标**：交互元素高度 ≥32px，间距 ≥8px
- **主题持久化**：用户选择保存到 `localStorage`，默认跟随系统 `prefers-color-scheme`

---

## 13. 文件对应

| 设计组件 | 实现文件 | 关键选择器 |
|---------|---------|-----------|
| 全局 Token | `index.html` / `dashboard.html` | `:root`, `[data-theme="light"]` |
| 顶部导航 | `index.html` | `.top-nav`, `.ws-switcher`, `.user-menu` |
| 侧边栏导航 | `index.html` | `.side-nav-item` |
| 层级树 | `index.html` | `.tree-project`, `.tree-topic`, `.tree-story` |
| Session 列表 | `index.html` | `.session-row`, `.session-list-panel` |
| Session 详情 | `index.html` | `.session-detail-panel`, `.detail-header` |
| 时间线 | `index.html` | `.timeline`, `.turn-block`, `.tool-group` |
| 按钮 | `index.html` | `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-ghost` |
| 模态框 | `index.html` | `.modal-overlay`, `.modal` |
| Toast | `index.html` | `.toast-sample` |
| 统计卡片 | `index.html` | `.stat-card` |
| 空状态 | `index.html` | `.empty-state` |
| 骨架屏 | `index.html` | `.skeleton` |
| 用户菜单 | `index.html` | `.user-menu`, `.user-dropdown` |
| Workspace 切换 | `index.html` | `.ws-switcher`, `.ws-dropdown` |

---

> 最后更新：2026-06-23
