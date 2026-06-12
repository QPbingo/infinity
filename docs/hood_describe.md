## 一、Hook 二进制：cmd/hook/main.go 完整执行流程
### 1. 解析命令行参数 (line 29-34)
agentType := flag.String("agent-type", "", ...)
sessionID := flag.String("session-id", "", ...)
event := flag.String("event", "", ...)
daemonToken := flag.String("daemon-token", "", ...)
flag.Parse()
Agent 的 hook 系统调用时传入 4 个可选 flag，例如：
agent-monitor-hook --agent-type opencode --session-id abc123 --event UserPromptSubmit --daemon-token xxx
line 36-39: 如果 --agent-type 为空，直接 os.Exit(1)。这是唯一必填项。
### 2. 读取 stdin → 获取原始 payload (line 41-53)
// line 41: 一次性读取全部 stdin
payload, err := io.ReadAll(os.Stdin)
// line 46-48: 如果 stdin 为空，补一个空 JSON 对象
if len(payload) == 0 {
    payload = []byte("{}")
}
// line 50-53: 校验是否为合法 JSON，如果不是则包裹成 {"raw": "原文"}
if !json.Valid(payload) {
    payload = json.RawMessage(fmt.Sprintf(`{"raw": %q}`, string(payload)))
}
Agent hook 系统通过管道把事件 JSON 写到本进程的 stdin。这里做了容错：空输入变 {}，非法 JSON 被转义包裹。
### 3. 从 payload 中提取 session_id 和 event (line 55-68)
// line 55: 调用 extractFromStdin 解析 JSON
extracted := extractFromStdin(payload)
extractFromStdin() (line 147-157)：
func extractFromStdin(payload []byte) stdinExtract {
    var data map[string]interface{}
    if err := json.Unmarshal(payload, &data); err != nil {
        return stdinExtract{}   // 解析失败返回空
    }
    return stdinExtract{
        sessionID: extractString(data, "session_id", "sessionId"),           // line 154
        event:     extractString(data, "hook_event_name", "hookEventName", "event", "type"), // line 155
    }
}
- line 154: 按优先级尝试 session_id → sessionId，取第一个非空字符串
- line 155: 按优先级尝试 hook_event_name → hookEventName → event → type
extractString() (line 159-166)：
通用提取函数，遍历 keys 列表，type assert 为 string，返回第一个非空值。
回到 main，优先级合并 (line 57-68)：
finalSessionID := *sessionID     // 命令行 flag 优先
if finalSessionID == "" {
    finalSessionID = extracted.sessionID  // 否则用 payload 中提取的
}
finalEvent := *event             // 同理
if finalEvent == "" {
    finalEvent = extracted.event
}
finalToken := *daemonToken
if finalToken == "" {
    finalToken = readToken()     // 从 ~/.agent-monitor/local-token 文件读取
}
line 70-81: 三个最终值任一为空则 Exit(1)。
### 4. 获取进程上下文 (line 83-88)
pid := os.Getppid()    // line 83: 获取父进程 PID（即 agent 进程的 PID）
cwd, err := os.Getwd() // line 85: 获取当前工作目录
这里用的是 Getppid() 而不是 Getpid()，因为 hook 二进制是被 agent 进程 fork/exec 的子进程，agent 的 PID 才是我们关心的。
### 5. 组装 hookOutput 结构体 (line 90-99)
output := hookOutput{
    Event:       finalEvent,                         // 事件类型
    AgentType:   *agentType,                         // opencode/claude/codex
    SessionID:   finalSessionID,                     // agent 会话 ID
    DaemonToken: finalToken,                         // 认证令牌
    PID:         pid,                                // agent 进程 PID
    CWD:         cwd,                                // 工作目录
    TimestampMs: time.Now().UnixMilli(),             // 毫秒时间戳
    Payload:     json.RawMessage(payload),           // 原始 stdin 内容
}
hookOutput 结构体定义在 line 18-27，对应 session.HookEvent。
### 6. 序列化为 JSON 行 (line 101-105)
line, err := json.Marshal(output)  // 序列化为紧凑 JSON（无换行，无缩进）
结果是一行 JSON 字符串，例如：
{"event":"UserPromptSubmit","agent_type":"opencode","session_id":"abc123",...}
### 7. 准备文件路径 (line 107-117)
homeDir, _ := os.UserHomeDir()                                      // line 107
eventsPath := filepath.Join(homeDir, ".agent-monitor", "events.jsonl") // line 113
os.MkdirAll(filepath.Dir(eventsPath), 0700)                         // line 114
目标路径：~/.agent-monitor/events.jsonl，目录权限 0700。
### 8. 加文件锁写入 (line 119-139) — 关键步骤
// line 119: 打开文件（不存在则创建，只写，追加模式）
f, err := os.OpenFile(eventsPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)

// line 126: POSIX 排他锁 — 保证并发写入的原子性
syscall.Flock(int(f.Fd()), syscall.LOCK_EX)

// line 132: 写入 JSON 行
f.Write(line)

// line 136: 写入换行符
f.Write([]byte("\n"))

// line 130 (defer): 释放锁
syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
为什么用文件锁？ 多个 agent 进程可能同时触发 hook，O_APPEND + LOCK_EX 保证每行 JSON 都是完整写入的，不会出现两行交错损坏。
## 二、readToken() — 从文件读取令牌 (line 168-178)
func readToken() string {
    homeDir, _ := os.UserHomeDir()                                    // line 169
    data, _ := os.ReadFile(filepath.Join(homeDir, ".agent-monitor", "local-token")) // line 173
    return strings.TrimSpace(string(data))                            // line 177
}
读取 daemon 启动时生成的 ~/.agent-monitor/local-token，用于认证 hook 事件的合法性。
## 三、EventWatcher：从启动到解析 payload

### 启动入口：cmd/daemon/main.go
line 195: hook.NewEventWatcher(monitorDir, tok, mgr) — 创建 EventWatcher
line 199: ew.Start() — 启动事件监听

NewEventWatcher() in internal/hook/eventwatcher.go:95-125
// line 99: 确保目录存在
os.MkdirAll(dir, 0700)

// line 104: 如果 events.jsonl 不存在则创建
os.OpenFile(filePath, os.O_CREATE|os.O_RDONLY, 0600)

### // line 111: 创建 OS 级文件监听器（macOS 用 FSEvents，Linux 用 inotify）
fsnotify.NewWatcher()

### // line 116-124: 组装 EventWatcher 结构体
** 这里的evenet watcher其实一直都在调用eventManager，包括之前的recovery也是，eventManager贯穿了整个session的生命周期 **
return &EventWatcher{
    dir:        dir,          // ~/.agent-monitor/
    filePath:   filePath,     // ~/.agent-monitor/events.jsonl
    offsetPath: filepath.Join(dir, "events.offset"), // 偏移量文件
    tokenValue: tokenValue,   // daemon 认证令牌
    handler:    handler,      // SessionManager (实现了 EventHandler 接口)
    watcher:    w,            // fsnotify 实例
    done:       make(chan struct{}),
}
### Start() in eventwatcher.go:137-162
// line 139: 开始监听 events.jsonl 的文件变更事件
ew.watcher.Add(ew.filePath)

// line 145: 读取上次消费到的字节偏移量
ew.lastPos = ew.readOffset()

// line 146-154: 如果没有有效偏移量文件，从文件末尾开始（跳过历史数据）
if ew.lastPos < 0 {
    fi, _ := os.Stat(ew.filePath)
    ew.lastPos = fi.Size()   // 跳到文件末尾
}

// line 157: 处理上次关闭后到本次启动之间写入的未读事件
### ew.handleNewLines()

// line 160: 启动后台事件循环
go ew.loop()
loop() in eventwatcher.go:193-220 — 后台事件循环
func (ew *EventWatcher) loop() {
    for {
        select {
        case <-ew.done:       // line 196: Stop() 时关闭 done channel，退出循环
            return
        case event := <-ew.watcher.Events:  // line 198: 接收文件变更事件
            switch {
            case event.Has(fsnotify.Write):   // line 203: 有新数据写入
                ew.handleNewLines()           // line 205: 读取并处理新行
            case event.Has(fsnotify.Create):  // line 206: 文件被重建（删除后重写）
                ew.watcher.Remove(ew.filePath)
                ew.watcher.Add(ew.filePath)
                ew.lastPos = 0               // 重置偏移，从头读
            }
        case err := <-ew.watcher.Errors:      // line 213: 错误日志
            log.Printf(...)
        }
    }
}
核心：handleNewLines() in eventwatcher.go:246-312
// line 247: 打开 events.jsonl
f, _ := os.Open(ew.filePath)

// line 255: Seek 到上次消费位置
f.Seek(ew.lastPos, io.SeekStart)

// line 261-262: 创建 Scanner，2MB 缓冲区（防止大 payload 导致 bufio 默认 64KB 溢出）
scanner := bufio.NewScanner(f)
scanner.Buffer(make([]byte, 2*1024*1024), 2*1024*1024)

// line 265: 初始化字节偏移计数器
byteOffset := ew.lastPos

// line 266: 逐行扫描
for scanner.Scan() {
    line := scanner.Text()                       // line 267: 当前行文本
    byteOffset += int64(len(scanner.Bytes()) + 1) // line 269: 偏移 + 行长度 + 换行符

    if line == "" { continue }                   // line 271: 跳过空行

    // ── 第1步：解析 JSON (line 276-281) ──
    var hookEvent session.HookEvent
    json.Unmarshal([]byte(line), &hookEvent)
    // HookEvent 结构体 (types.go:21-30):
    //   Event, AgentType, SessionID, DaemonToken, PID, CWD, TimestampMs, Payload

    // ── 第2步：Token 验证 (line 286-290) ──
    token.ConstantTimeCompare(hookEvent.DaemonToken, ew.tokenValue)
    // 防止时序攻击的常量时间比较，token 不匹配则丢弃

    // ── 第3步：转发到 SessionManager (line 295) ──  ** 其实就是这里开始了sessionManager的逻辑 **
    ew.handler.HandleEvent(&hookEvent)
    // → manager.go:55 HandleEvent()
    //   → manager.go:128 applyEvent() 根据 event.Event 类型分发解析 payload

    // ── 第4步：持久化偏移量 (line 301) ──
    ew.saveOffset(byteOffset)
    // 写入 events.offset 文件，防止崩溃丢数据
}
readOffset() / saveOffset() in eventwatcher.go:318-343
// readOffset (line 318): 从 events.offset 读 int64 ASCII 文本
data, _ := os.ReadFile(ew.offsetPath)
offset, _ := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)

// saveOffset (line 338): 原子写入偏移量（整个文件替换，防止部分写入）
ew.lastPos = offset
os.WriteFile(ew.offsetPath, []byte(strconv.FormatInt(offset, 10)), 0600)

## 完整调用链总结
Agent 触发 Hook
  │
  ├─ fork/exec agent-monitor-hook --agent-type opencode ...
  │     │
  │     ├─ stdin: {"session_id":"x","hook_event_name":"UserPromptSubmit","prompt":"hello"}
  │     │
  │     ├─ cmd/hook/main.go:41  io.ReadAll(os.Stdin) → payload
  │     ├─ cmd/hook/main.go:50  json.Valid(payload) → 校验
  │     ├─ cmd/hook/main.go:55  extractFromStdin(payload) → 提取 session_id + event
  │     ├─ cmd/hook/main.go:83  os.Getppid() → agent 的 PID
  │     ├─ cmd/hook/main.go:85  os.Getwd() → agent 的 CWD
  │     ├─ cmd/hook/main.go:90  hookOutput{Event,AgentType,SessionID,...Payload}
  │     ├─ cmd/hook/main.go:101 json.Marshal(output) → JSON 行
  │     ├─ cmd/hook/main.go:126 syscall.Flock(LOCK_EX) → 加文件锁
  │     └─ cmd/hook/main.go:132 f.Write(line) + f.Write("\n") → 写入 events.jsonl
  │
  ▼

## ~/.agent-monitor/events.jsonl (一行 JSON)
  │
  │  fsnotify.Write 事件触发
  ▼
EventWatcher.loop() [eventwatcher.go:193]
  │
  └─ handleNewLines() [eventwatcher.go:246]
       ├─ line 255: f.Seek(lastPos) → 跳到未读位置
       ├─ line 261: bufio.Scanner → 逐行读取
       ├─ line 277: json.Unmarshal → session.HookEvent
       ├─ line 286: token.ConstantTimeCompare → 认证
       ├─ line 295: handler.HandleEvent(&hookEvent)
       │     │
       │     └─ SessionManager.HandleEvent() [manager.go:55]
       │           ├─ applyEvent() [manager.go:128] → 按事件类型解析 payload
       │           │     ├─ UserPromptSubmit → extractUserInput() [line 382]
       │           │     ├─ AssistantText/ReasoningPart → extractModelOutput() [line 464]
       │           │     ├─ PreToolUse/PostToolUse → extractToolInfo() [line 483]
       │           │     └─ buildTurnEntry() [line 170] → 构建 Turn/ToolCall
       │           ├─ store.Upsert() → SQLite 持久化
       │           └─ computeDelta() + notify() → WebSocket 推送到前端
       │
       └─ line 301: saveOffset(byteOffset) → 持久化消费位置