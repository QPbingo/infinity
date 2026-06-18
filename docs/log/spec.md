# 日志回收 — 执行标准

> 本文件定义「日志回收」的规范、字段、模板与触发约束。
> 实际日志输出写入 `./loginfo.md`，本文件不承载实际记录。

---

## 1. 目的

| 目的 | 说明 |
|------|------|
| 过程可追溯 | 记录模型每一步「为什么这么做」「做了什么」，供事后审计 |
| 质量可检验 | 记录最终结果是否满足用户需求，验收依据是什么 |
| 缺陷可暴露 | 主动记录发现的 bug、潜在风险、未解决问题 |
| 经验可沉淀 | 记录权衡取舍、被否定的方案，避免重复踩坑 |

---

## 2. 触发时机

| 时机 | phase | 必填 | 说明 |
|------|-------|------|------|
| 任务开始前 | `thinking` | 是 | 记录对需求的理解、计划拆分、预期风险 |
| 每个子任务完成时 | `acting` | 是 | 记录该子任务做了什么、改了哪些文件 |
| 验收检查时 | `verifying` | 是 | 记录验收方法、验收结果、是否符合要求 |
| 发现 bug 时 | `verifying` | 是 | 记录 bug 描述、影响范围、修复方案 |
| 最终交付时 | `done` | 是 | 记录总体结论、遗留问题、后续建议 |

---

## 3. 记录字段定义

每条日志记录包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `log_id` | string | 是 | 日志唯一标识，格式 `log-{序号}` |
| `task_id` | string | 是 | 关联的任务 ID（对应 `../task/task.json` 中的 `task_id` 或子任务 `id`） |
| `timestamp` | string | 是 | 记录时间，ISO 8601 格式（`YYYY-MM-DDTHH:mm:ss`） |
| `phase` | enum | 是 | 阶段：`thinking` / `acting` / `verifying` / `done` |
| `thought` | string | `thinking`/`done` 必填 | 思考内容：为什么这么做、权衡了什么、预期风险 |
| `action` | string | `acting` 必填 | 执行动作：做了什么、改了哪些文件/函数 |
| `result` | string | `verifying`/`done` 必填 | 结果描述：是否符合要求、验收依据 |
| `bugs` | array | 否 | 发现的 bug 列表（见下表） |
| `conclusion` | enum | `verifying`/`done` 必填 | 结论：`pass`（通过）/ `rework`（需返工）/ `fail`（失败） |
| `next_step` | string | 否 | 下一步计划（rework/fail 时必填） |

### `bugs` 子字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bug_id` | string | 是 | bug 标识，格式 `bug-{序号}` |
| `description` | string | 是 | bug 描述 |
| `severity` | enum | 是 | 严重程度：`critical`（阻断）/ `major`（影响功能）/ `minor`（不影响主流程） |
| `impact` | string | 是 | 影响范围 |
| `fix` | string | 否 | 修复方案（已修复时填写） |
| `status` | enum | 是 | 状态：`found`（发现）/ `fixed`（已修复）/ `deferred`（暂缓） |

---

## 4. 日志记录模板

执行任务时，按以下模板在 `./loginfo.md` 的对应区段追加条目：

```markdown
### log-001 | task_id=T001 | 2026-06-18T10:30:00 | phase=thinking

**思考：**
（记录对需求的理解、计划拆分、预期风险、权衡取舍）

**结论：** pass
```

```markdown
### log-002 | task_id=T001-1 | 2026-06-18T10:45:00 | phase=acting

**执行动作：**
- 新建 xxx.md — 说明
- 编辑 xxx.go — 说明

**结论：** pass
```

```markdown
### log-003 | task_id=T001-3 | 2026-06-18T11:00:00 | phase=verifying

**结果：**
（记录验收方法、验收结果、是否符合要求）

**bugs：**
- bug_id: bug-001
  description: （bug 描述）
  severity: major
  impact: （影响范围）
  fix: （修复方案）
  status: fixed

**结论：** pass
```

```markdown
### log-004 | task_id=T001 | 2026-06-18T11:30:00 | phase=done

**思考：**
（总体结论、遗留问题、后续建议）

**结果：**
（最终交付总结）

**结论：** pass
```

---

## 5. Bug 登记模板

发现 bug 时，在 `./loginfo.md` 的 `## Bug 登记` 区段记录：

```markdown
### bug-001 | 发现于 log-003 | severity=major | status=fixed

**描述：** （bug 描述）
**影响：** （影响范围）
**修复：** （修复方案）
```

---

## 6. 输出文件结构

`./loginfo.md`（真实日志输出文件）按以下结构组织：

```markdown
# 日志回收 — 执行记录

> 本文件承载实际日志输出，规范定义见 ./spec.md

---

## 日志记录

### [任务标题] — task_id=T001

（按时间顺序追加 log 条目）

---

## Bug 登记

（按发现顺序追加 bug 条目）

---

## 最终结论

（done 阶段的总结）
```

---

## 7. 与其他文档的关系

| 关联文档 | 关系 |
|---------|------|
| `../task/task.json` | 日志的 `task_id` 对应 task.json 中的任务/子任务 ID |
| `../task/progress.md` | 日志的 `verifying`/`done` 结论驱动 progress.md 中的状态更新 |
| `../../agent_claude.md` 「日志回收」段落 | 定义触发约束：每个任务必须产出日志回收记录 |
