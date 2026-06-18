# 任务分解 — 执行标准

> 本文件定义「任务分解」的规范：顶层任务与子任务的字段定义、分解原则。
> 实际任务清单写入 `./task.json`，进展与验收见 `../progress/`。

---

## 1. 顶层任务字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 是 | 顶层任务唯一标识，格式 `T{序号}` |
| `title` | string | 是 | 任务标题 |
| `user_requirement` | string | 是 | 用户原始需求的完整描述 |
| `created_at` | string | 是 | 任务创建时间，ISO 8601 格式 |
| `status` | enum | 是 | 状态：`pending` / `in_progress` / `completed` / `blocked` |
| `subtasks` | array | 是 | 子任务数组，每个子任务可独立执行和验收 |

---

## 2. 子任务字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 子任务唯一标识，格式 `{task_id}-{序号}` |
| `title` | string | 是 | 子任务标题 |
| `description` | string | 是 | 子任务详细描述 |
| `status` | enum | 是 | 状态：`pending` / `in_progress` / `completed` / `blocked` |
| `acceptance_criteria` | array | 是 | 验收标准数组，每条为一个可检验的条件 |
| `dependencies` | array | 是 | 依赖的其他子任务 ID 数组（空表示无依赖） |
| `started_at` | string | 否 | 开始时间，ISO 8601（未开始留空） |
| `completed_at` | string | 否 | 完成时间，ISO 8601（未完成留空） |

---

## 3. 分解原则

- 每个子任务必须可独立执行和验收。
- 每个子任务必须有可检验的 `acceptance_criteria`。
- 子任务之间通过 `dependencies` 声明依赖，按依赖顺序执行。
- 粒度适中：太粗难以跟踪，太细增加管理开销。

---

## 4. 输出文件结构

`./task.json`（任务清单）按以下结构组织：

```json
{
  "task_id": "T001",
  "title": "任务标题",
  "user_requirement": "用户原始需求",
  "created_at": "ISO 8601",
  "status": "pending",
  "subtasks": [
    {
      "id": "T001-1",
      "title": "子任务标题",
      "description": "详细描述",
      "status": "pending",
      "acceptance_criteria": ["条件1", "条件2"],
      "dependencies": [],
      "started_at": "",
      "completed_at": ""
    }
  ]
}
```

---

## 5. 与其他文档的关系

| 关联文档 | 关系 |
|---------|------|
| `../progress/spec.md` + `../progress/progress.md` | 进展跟踪与验收记录，对照本目录 task.json 的 acceptance_criteria 检验 |
| `../log/spec.md` + `../log/loginfo.md` | 日志回收的 task_id 对应本目录 task.json 的任务 ID |
| `../../agent_claude.md` 「任务信息」段落 | 定义执行约束：执行任务前必须先拆分并写入 task.json |
