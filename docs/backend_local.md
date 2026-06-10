# Agent Monitor — 本地 Daemon 架构说明书

> v1 | 2026-06-10 | 本地闭环采集 + Web 看板

---

## 1. 系统概述

**通信流向：**

```
Agent Hook ──agent-monitor-hook──▶ events.jsonl ──fsnotify──▶ Daemon ──WS──▶ 浏览器 (localhost:9101)
```

**核心设计：**

| 原则 | 说明 |
|------|------|
| Hook 写文件 | agent-monitor-hook 二进制 → 构造合法 JSON → `events.jsonl` |
| Session 创建 | 只有 Hook 事件创建 session。PID Scanner 仅增强 + 检测死亡 |
| PID 关联 | Hook 事件自带 PID，直接绑定 session。PID Scanner 仅对已绑定 PID 的 session 更新资源/检测死亡 |
| Fail-Open | Daemon 不在时事件不丢（文件持久化），agent 不受影响 |
| 字段兼容 | SessionKey = `hex(SHA256(user_id\|device_id\|agent_type\|agent_session_id))[:16]`，v2 不变 |

---

## 2. 模块架构

```
Agent Hook                  ┌─ Daemon ────────────────────────────────────┐
  │                         │                                              │
  │  agent-monitor-hook     │  EventWatcher ──Event──▶ SessionManager     │
  │  events.jsonl           │  (fsnotify)                │                 │
  │                         │                            │                 │
  ▼                         │  PID Scanner ──ProcessInfo─┤                 │
  ~/.agent-monitor/         │  (15s)        ──死亡检测──▶│                 │
  ├── events.jsonl          │                            │                 │
  ├── local-token           │  Terminal Detector         │                 │
  └── device-id             │                            ▼                 │
                            │                    WebSocket Hub             │
                            │                         │                   │
                            │  Session Recovery ──Session─┘               │
                            │  (启动时)                                    │
                            │                                              │
                            │  HTTP: /api/sessions /health /ws /           │
                            └──────────────────────────────────────────────┘
                                                 │
                                                 ▼
                                            浏览器看板
```

**模块职责：**

| 模块 | 职责 |
|------|------|
| EventWatcher | fsnotify 监听 `events.jsonl`，解析 JSON，验证 token，产出 Event |
| Session Manager | 维护 `map[SessionKey]*Session`。创建 session（Hook）、更新字段、生成 Delta |
| PID Scanner | 15s gopsutil 扫描。已绑定 PID 的 session 更新 CPU/Memory。检测死亡 → disappeared。检测静默 → idle。新 PID 忽略等 hook |
| Terminal Detector | PPID 链上溯 (≤10层) 识别终端 |
| Session Recovery | 启动时扫描 transcript JSONL 恢复最近 24h session |
| WebSocket Hub | 管理 WS 连接。新连接推 Snapshot，实时广播 Delta |

---

## 3. 数据存储

**daemon_sessions 表（SQLite，可选）：**

```sql
CREATE TABLE daemon_sessions (
    user_id          TEXT NOT NULL,        -- v1: "local"
    device_id        TEXT NOT NULL,        -- UUID v4
    agent_type       TEXT NOT NULL,        -- opencode/codex/claude
    agent_session_id TEXT NOT NULL,        -- agent 原生 session id
    session_key      TEXT NOT NULL,        -- hex(SHA256(四字段))[:16]
    pid              INTEGER DEFAULT 0,
    terminal         TEXT DEFAULT '',
    cwd              TEXT DEFAULT '',
    status           TEXT DEFAULT 'active',
    start_time_ms    INTEGER NOT NULL,     -- Unix 毫秒
    last_event_time_ms INTEGER DEFAULT 0,
    last_event_type  TEXT DEFAULT '',
    last_file        TEXT DEFAULT '',
    last_command     TEXT DEFAULT '',
    memory_mb        REAL DEFAULT 0,
    cpu_percent      REAL DEFAULT 0,
    turn_count       INTEGER DEFAULT 0,
    git_branch       TEXT DEFAULT '',
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    ended_at         INTEGER,

    PRIMARY KEY (user_id, device_id, agent_type, agent_session_id)
);
```

**本地文件：**

| 文件 | 内容 | 权限 |
|------|------|------|
| `~/.agent-monitor/device-id` | UUID v4 | 0600 |
| `~/.agent-monitor/local-token` | 256bit Base64 | 0600 |
| `~/.agent-monitor/events.jsonl` | Hook 事件缓冲 | 0600 |
| `~/.agent-monitor/events.offset` | 消费偏移量 (int64) | 0600 |
| `~/.agent-monitor/daemon.db` | SQLite (可选) | 0600 |

---

## 4. 核心数据结构

**SessionKey：**

```dot
digraph SessionKey {
  rankdir=LR;
  node [shape=box, style=rounded, fontsize=11];
  u [label="user_id"]; d [label="device_id"]; a [label="agent_type"];
  s [label="agent_session_id"];
  concat [label="拼接 | 分隔", shape=ellipse];
  sha [label="SHA256", shape=cylinder];
  key [label="SessionKey\n16 hex chars", shape=note];
  u->concat; d->concat; a->concat; s->concat;
  concat->sha->key;
}
```

> CWD 不在 SessionKey 中。agent 切换工作目录时不产生新 session。CWD 作为可变字段由 PID Scanner 更新。

**Session 字段分组：**

```dot
digraph SessionFields {
  rankdir=TB;
  node [shape=record, fontsize=10];
  session [label="{
    Session |
    标识: UserID | DeviceID | AgentType | AgentSessionID |
    进程 (PID Scanner): PID | Terminal | CWD | CWDHash | MemoryMB | CPUPercent |
    事件 (Hook): Status | StartTimeMs | LastEventTimeMs | LastEventType | LastFile | LastCommand | TurnCount | GitBranch | Payload (原始 hook JSON) |
    元数据: ProcessCreateTimeMs (不参与 Key/匹配)
  }"];
  note [label="来源: Hook → 事件字段 | PID Scanner → 进程字段 | Recovery → 全部", shape=note];
  session -> note [style=dashed, dir=none];
}
```

**EventType 映射：**

| Hook 事件名 | EventType |
|------------|-----------|
| SessionStart | session_start |
| UserPromptSubmit | user_prompt |
| PreToolUse | pre_tool_use |
| PostToolUse | post_tool_use |
| Stop | session_end |
| Notification | notification |

**内部数据流：**

```dot
digraph DataFlow {
  rankdir=LR;
  node [shape=box, style=rounded, fontsize=10];
  hook [label="agent-monitor-hook\n构造合法 JSON\n含 pid/cwd/ts/token\n+ 原始 payload"];
  file [label="events.jsonl\n(JSONL)", shape=cylinder];
  event [label="Event"];
  proc [label="ProcessInfo\n(gopsutil)"];
  session [label="Session"];
  delta [label="Delta"];
  snap [label="Snapshot"];
  hook -> file -> event -> session;
  proc -> session [label="匹配 PID"];
  session -> delta [label="变化时"];
  session -> snap [label="全量"];
}
```

---

## 5. 模块详解

### 5.1 Daemon Token

**生成：** 首次启动时 256bit 随机 → Base64 → `~/.agent-monitor/local-token` (0600)

**验证（EventWatcher 每行 JSON）：**

```dot
digraph TokenVerify {
  rankdir=TB;
  node [shape=box, style=rounded, fontsize=10];
  read [label="读取 events.jsonl 新增行"];
  parse [label="JSON 解析\n提取 daemon_token"];
  exist [label="token 存在且非空?", shape=diamond];
  cmp [label="ConstantTimeCompare()"];
  match [label="匹配?", shape=diamond];
  ok [label="继续处理", fillcolor="#E8F5E9", style="filled,rounded"];
  drop1 [label="丢弃 + 告警", fillcolor="#FFCDD2", style="filled,rounded"];
  drop2 [label="丢弃 + 告警", fillcolor="#FFCDD2", style="filled,rounded"];
  read -> parse -> exist;
  exist -> cmp [label="是"]; exist -> drop1 [label="否"];
  cmp -> match; match -> ok [label="是"]; match -> drop2 [label="否"];
}
```

**Hook 命令模板：**

```bash
agent-monitor-hook --agent-type opencode --session-id "$SESSION_ID" --event "PostToolUse" --daemon-token "$(cat ~/.agent-monitor/local-token)"
```

**agent-monitor-hook 职责：**

```dot
digraph HookHelper {
  rankdir=TB;
  node [shape=box, style=rounded, fontsize=10];
  args [label="读取参数:\n--agent-type\n--session-id\n--event\n--daemon-token", fillcolor="#E3F2FD", style="filled,rounded"];
  stdin [label="读取 stdin:\nagent 原始 hook payload JSON\n(agent 自动提供)", fillcolor="#E3F2FD", style="filled,rounded"];
  env [label="获取进程上下文:\npid = os.Getenv('AGENT_PID')\n  或 CLAUDE_PID/CODEX_PID\n  fallback: os.Getppid()\ncwd = os.Getwd()\nts = time.Now().UnixMilli()", fillcolor="#E3F2FD", style="filled,rounded"];
  build [label="构造 JSON 行:\n{\"event\":...,\"agent_type\":...,\n \"session_id\":...,\"daemon_token\":...,\n \"pid\":...,\"cwd\":...,\n \"timestamp_ms\":...,\"payload\":{...}}", fillcolor="#FFF3E0", style="filled,rounded"];
  write [label="追加写入\nevents.jsonl", fillcolor="#E8F5E9", style="filled,rounded"];
  args -> build; stdin -> build; env -> build;
  build -> write;
}
```

**为什么不用 shell echo：** shell 变量直接拼 JSON 会因双引号、反斜杠、换行等特殊字符产生非法 JSON。helper 二进制用 `encoding/json` 库保证输出合法。agent 提供的原始 payload 通过 stdin 传入，helper 将其完整嵌入 `payload` 字段中。pid/cwd/timestamp 在 helper 内部通过系统调用获取，无需 shell 变量。

### 5.2 EventWatcher

```dot
digraph EventWatcher {
  rankdir=TB;
  node [shape=box, style=rounded, fontsize=10];
  init [label="启动:\nfsnotify.NewWatcher()\nAdd events.jsonl\n创建文件(0600) 如不存在\nlastPos = 读取 events.offset\n(若无则 lastPos = 文件当前末尾)", fillcolor="#E3F2FD", style="filled,rounded"];
  loop [label="事件循环", shape=diamond];
  write [label="IN_MODIFY\n→ handleNewLines()", fillcolor="#E8F5E9", style="filled,rounded"];
  create [label="IN_CREATE\n文件重建\n→ re-Add + lastPos=0", fillcolor="#FFF9C4", style="filled,rounded"];
  err [label="error → 记录日志", fillcolor="#FFCDD2", style="filled,rounded"];
  hnl [label="Seek(lastPos) → bufio.Scan 逐行\n(Scanner buffer 2MB, 默认64K\n不足以容纳大 payload)\n每行 JSON 解析 → 验证 token\n提取字段 → Event", fillcolor="#E3F2FD", style="filled,rounded"];
  out [label="→ SessionManager.HandleEvent()", shape=ellipse, fillcolor="#C8E6C9", style=filled];
  save [label="lastPos = 文件大小\n写入 events.offset\n(每行处理完即写, 防崩溃丢位)", fillcolor="#FFF3E0", style="filled,rounded"];
  init -> loop;
  loop -> write; loop -> create; loop -> err;
  create -> loop; err -> loop;
  write -> hnl -> out -> save -> loop;
}
```

**持久化消费位点（解决离线丢事件）：**

```
每行处理流程:
  ① Seek(lastPos) → 从上次位点开始读
  ② bufio.Scanner 逐行读取 → 跳过空行
  ③ 对每个完整 \n 结尾的行:
     a. JSON 解析 → 验证 token → 归一化
     b. SessionManager.HandleEvent()
     c. offset = 此行在文件中的字节结束位置 (\n 之后)
     d. 原子写 events.offset ← offset
  ④ 文件不以 \n 结尾 → 最后一行未写完 → offset 保持在上一完整行末
     下次启动时重读完整行（写入方最终会补 \n）

启动恢复:
  events.offset 存在 → lastPos = 读取 events.offset
  events.offset 不存在 → lastPos = 文件当前末尾
```

**events.jsonl 每行格式：**

| 字段 | 必需 | 来源 |
|------|------|------|
| event | 是 | `--event` 参数 |
| agent_type | 是 | `--agent-type` 参数 |
| session_id | 是 | `--session-id` 参数 |
| daemon_token | 是 | 由 helper 从文件读取 |
| pid | 是 | `os.Getenv("AGENT_PID")` 或 agent 专属变量（CLAUDE_PID/CODEX_PID），fallback `os.Getppid()` |
| cwd | 是 | `os.Getwd()` |
| timestamp_ms | 是 | `time.Now().UnixMilli()` |
| payload | 是 | agent 原始 hook JSON (stdin → json.RawMessage) |

### 5.3 Session Manager

```dot
digraph SessionLifecycle {
  rankdir=TB;
  node [shape=box, style=rounded, fontsize=10];

  subgraph cluster_create {
    label="创建 (仅 Hook)"; color="#4CAF50";
    hook_arrive [label="HandleEvent()\nagent_session_id 已知", fillcolor="#E8F5E9"];
    compute [label="SessionKey = SHA256(四字段)[:16]\nStatus = active", fillcolor="#E8F5E9"];
    hook_arrive -> compute;
  }

  subgraph cluster_enrich {
    label="增强 (PID Scanner)"; color="#2196F3";
    match [label="PID Scanner 扫描\n→ 已绑定 PID 的 session\n→ 更新 CPU/Memory/CWD", fillcolor="#E3F2FD"];
    enrich [label="补全: PID, CPU, Memory,\nTerminal, CWD", fillcolor="#E3F2FD"];
    match -> enrich;
  }

  subgraph cluster_terminate {
    label="终止"; color="#F44336";
    end_hook [label="Hook session_end\n→ Status = stopped"];
    dead [label="PID Scanner 进程消失\n→ Status = disappeared"];
    idle [label="无 hook >5min\n→ Status = idle"];
  }

  compute -> match [style=dashed, dir=none];
  enrich -> dead [style=dashed, dir=none];
  enrich -> idle [style=dashed, dir=none];
}
```

| 触发 | 更新字段 |
|------|---------|
| Hook session_start | Status→active, StartTimeMs, CWD, LastEventTimeMs, LastEventType |
| Hook user_prompt | LastEventTimeMs, LastEventType, TurnCount++ |
| Hook pre_tool_use | LastEventTimeMs, LastEventType |
| Hook post_tool_use | LastEventTimeMs, LastEventType, LastFile, LastCommand |
| Hook tool_result | LastEventTimeMs, LastEventType |
| Hook notification | LastEventTimeMs, LastEventType |
| Hook session_end | Status→stopped, LastEventTimeMs, LastEventType |
| PID alive=true | PID, MemoryMB, CPUPercent, Terminal, CWD |
| PID alive=false | Status→disappeared |
| PID CheckIdle | Status→idle (条件: 无 hook >5min) |

**Delta:** 仅含实际变化字段。无变化不生成。

### 5.4 PID Scanner (15s)

```dot
digraph PIDScanner {
  rankdir=TB;
  node [shape=box, style=rounded, fontsize=10];
  tick [label="15s Ticker", shape=ellipse];
  all [label="gopsutil.Processes()", fillcolor="#E3F2FD", style="filled,rounded"];
  filter [label="筛选: 进程名 opencode/codex/claude\n或 node + cmdline 含 @anthropic-ai/claude-code"];
  diff [label="与已知 PID 差集分析", shape=diamond];
  alive [label="PID 仍存活 → HandlePidUpdate(alive=true)\n更新 CPU/Memory/CWD", fillcolor="#E8F5E9", style="filled,rounded"];
  new [label="新 PID (不在任何 session 中)", fillcolor="#FFF9C4", style="filled,rounded"];
  gone [label="PID 消失 → HandlePidUpdate(alive=false)\nStatus = disappeared", fillcolor="#FFCDD2", style="filled,rounded"];
  idle [label="CheckIdleSessions()\nactive + 无hook >5min → idle", fillcolor="#FFF3E0", style="filled,rounded"];
  tick -> all -> filter -> diff;
  diff -> alive; diff -> new; diff -> gone;
  alive -> idle; gone -> idle;
  new -> idle [label="忽略\n(agent_session_id 未知,\n等 Hook 事件到达后\n自动关联)"];
}
```

**新 PID 处理：** PID Scanner 无法获取 agent_session_id，因此不能匹配已有 session。新 PID 仅记录日志，不创建 session。当 Hook 事件到达时（携带 agent_session_id + PID），SessionManager 自动创建/更新 session 并绑定 PID。下一次 PID Scanner 扫描时该 PID 已变为"已知 PID"，走 alive 分支更新资源。

### 5.5 Terminal Detector

```dot
digraph TerminalDetect {
  rankdir=TB;
  node [shape=box, style=rounded, fontsize=10];
  start [label="agentPID", shape=ellipse];
  loop [label="i = 0; i < 10; currentPID 上行", shape=diamond];
  nil_chk [label="proc != nil ?", shape=diamond];
  root_chk [label="parentPID > 1 ?", shape=diamond];
  name_chk [label="parentName\nin Whitelist ?", shape=diamond];
  found [label="返回 终端名", shape=ellipse, fillcolor="#E8F5E9", style=filled];
  cont [label="i++"];
  unk [label="返回 Unknown", shape=ellipse, fillcolor="#FFCDD2", style=filled];
  start -> loop;
  loop -> nil_chk [label="i<10"]; loop -> unk [label="i>=10"];
  nil_chk -> root_chk [label="是"]; nil_chk -> unk [label="nil"];
  root_chk -> name_chk [label="是"]; root_chk -> unk [label="到达init"];
  name_chk -> found [label="是"]; name_chk -> cont [label="否"];
  cont -> loop;
}
```

**白名单:** Ghostty, iTerm2, Terminal, Warp, kitty, Alacritty, wezterm-gui, code/Code (VS Code), Cursor, hyper

### 5.6 Session Recovery

启动时扫描 transcript JSONL，恢复最近 24h session，状态 = unknown。

| Agent | Transcript 路径 |
|-------|----------------|
| OpenCode | `~/.config/opencode/sessions/*.jsonl` |
| Claude Code | `~/.claude/projects/*/*.jsonl` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` |

**恢复后立即匹配进程：** 恢复完成后触发一次 gopsutil 全量扫描。对每个恢复的 session，用 `(agent_type, agent_session_id)` 匹配运行中进程（从进程 CWD 计算 cwd_hash，与 transcript 中的 cwd_hash 对比）。匹配成功 → 绑定 PID + Status→active。不匹配 → 保持 unknown。

### 5.7 WebSocket Hub

```dot
digraph WSHub {
  rankdir=TB;
  node [shape=box, style=rounded, fontsize=10];
  clients [label="clients\nmap[*Client]struct{}", fillcolor="#F3E5F5"];
  reg [label="register ch\n等首条消息 → 校验 token\n通过 → 加入 clients + 推 Snapshot\n失败 → 关闭连接"];
  unreg [label="unregister ch\n断开 → 移除 + close(send)"];
  bcast [label="broadcast ch\nDelta → 遍历 clients 写入 send"];
  client [label="Client\nconn: *WS | send: chan []byte", fillcolor="#E3F2FD"];
  clients -> reg; clients -> unreg; clients -> bcast;
  reg -> client [label="创建"]; unreg -> client [label="销毁"]; bcast -> client [label="写入"];
}
```

心跳 30s pong，写超时 10s，send buffer 满自动断开。

---

## 6. HTTP API

Daemon 监听 `127.0.0.1:9101`。除 `/`（看板页面）外，全部端点需鉴权。

**鉴权方式：** 请求头携带 `X-Daemon-Token`，值与 `~/.agent-monitor/local-token` 一致。常量时间比较。不匹配返回 `403`。

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/sessions` | X-Daemon-Token | 全部 session JSON 数组 |
| GET | `/api/sessions/:key` | X-Daemon-Token | 单个 session 详情 |
| GET | `/health` | X-Daemon-Token | 版本、运行时间、session 数量 |
| GET | `/ws` | WS 首条消息携 token | WebSocket 升级 (见下方) |
| GET | `/` | 无 | 看板静态页面 |

**为什么 `/` 无需鉴权：** 看板页面本身不含敏感数据（仅为 HTML/JS 框架），真实数据通过 `/ws` 下发，WS 连接已做鉴权。

---

## 7. WebSocket 协议

```
ws://localhost:9101/ws

连接 → 客户端首条消息携带 token:
{"type":"auth","token":"<daemon_token>"}

服务端校验 → 通过则推 Snapshot:
{"type":"auth_ok"}
{"type":"snapshot","sessions":[...],"gen_time_ms":...}

校验失败:
{"type":"auth_error"}

后续实时推送:
{"type":"delta","session_key":"...","changes":{...},"timestamp_ms":...}
{"type":"session_added","session":{...}}
{"type":"session_removed","session_key":"..."}
{"type":"pong"}
```

**前端行为：** 连接后首条发 auth。收到 auth_ok 后开始处理数据。snapshot 全量渲染。delta 局部 DOM 更新。pong 忽略。

**安全说明：** 看板页面从 localStorage 读取 token（用户首次在页面输入 token 后持久化）。Token 值来自 `~/.agent-monitor/local-token`。同机其他用户因 0600 权限无法读取 token 文件，无法通过 API/WS 鉴权。

---

## 8. Session 状态机

```dot
digraph StateMachine {
  rankdir=TB;
  node [shape=box, style="rounded,filled", fontsize=10];
  none [label="不存在", fillcolor="#E0E0E0"];
  active [label="active\n活跃", fillcolor="#C8E6C9"];
  idle [label="idle\n静默", fillcolor="#FFF9C4"];
  stopped [label="stopped\n正常结束", fillcolor="#E0E0E0"];
  unknown [label="unknown\n恢复待确认", fillcolor="#BBDEFB"];
  disappeared [label="disappeared\n异常退出", fillcolor="#FFCDD2"];

  none -> active [label="Hook session_start"];
  none -> unknown [label="Session Recovery"];
  unknown -> active [label="Hook 事件 / PID 匹配"];
  unknown -> stopped [label="PID 不匹配"];
  active -> stopped [label="Hook session_end"];
  active -> disappeared [label="PID 消失"];
  active -> idle [label="无 hook >5min"];
  idle -> active [label="Hook 事件"];
  idle -> disappeared [label="PID 消失"];
  disappeared -> active [label="Hook 事件 (重启)"];
  stopped -> active [label="Hook session_start (重启)"];
}
```

---

## 9. 部署

```bash
go build -o agent-monitor-daemon ./cmd/daemon
./agent-monitor-daemon --listen 127.0.0.1:9101 --scan-interval 15
```

| 参数 | 默认 | 说明 |
|------|------|------|
| `--listen` | `127.0.0.1:9101` | HTTP 监听 |
| `--scan-interval` | `15` | PID 扫描间隔(秒) |
| `--user-id` | `"local"` | 用户标识 |

**项目结构：**

```
agent-monitor/
├── cmd/daemon/main.go      # Daemon 入口
├── cmd/hook/main.go         # agent-monitor-hook (Hook 辅助二进制)
├── internal/
│   ├── hook/                # EventWatcher + parser
│   ├── session/             # SessionManager + types + recovery
│   ├── scanner/             # PID Scanner + Terminal Detector
│   ├── server/              # HTTP handler + WebSocket Hub
│   └── token/               # DaemonToken
├── web/dashboard.html       # 本地看板
└── cmd/setup/main.go        # agent-monitor-setup CLI
```

**验证：**

```bash
# 启动 Daemon
./agent-monitor-daemon --listen 127.0.0.1:9101

# 模拟 hook 事件
echo '{"tool":"read","input":{"filePath":"/tmp/test.txt"}}' | \
  agent-monitor-hook --agent-type opencode --session-id "test-session-001" --event "PostToolUse" --daemon-token "$(cat ~/.agent-monitor/local-token)"

# 查看结果 (需 token)
TOKEN=$(cat ~/.agent-monitor/local-token)
curl -H "X-Daemon-Token: $TOKEN" http://127.0.0.1:9101/api/sessions
open http://127.0.0.1:9101

# 验证离线恢复
killall agent-monitor-daemon
echo '{"tool":"edit","input":{"filePath":"/tmp/test2.txt"}}' | \
  agent-monitor-hook --agent-type opencode --session-id "test-session-001" --event "PostToolUse" --daemon-token "$(cat ~/.agent-monitor/local-token)"
./agent-monitor-daemon --listen 127.0.0.1:9101
# → 从 events.offset 恢复消费，离线期间事件被追上
```
