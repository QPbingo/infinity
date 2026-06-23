## 项目说明
	将本地agent状态与web端完全同步，支持对本地agent进行操作和修改，支持在web端对所有agent进行项目化管理。
## 项目目录
	项目目录用于索引当前项目中必要的信息都路径，执行操作时可以根据项目目录快速找到关键信息。
	- 前端设计说明
	> ./docs/frontend.md
	- 后端设计说明
	> ./docs/backend.md
	- 设计风格说明
	> ./docs/design.md
	- 验收标准说明
	> ./docs/cases.md

	- 日志回收
	> ./docs/log/spec.md （执行标准）
	> ./docs/log/loginfo.md （实际日志输出）
	- 任务分解
	> ./docs/task/spec.md （执行标准）
	> ./docs/task/task.json （任务清单）
	- 进展与验收
	> ./docs/progress/spec.md （执行标准）
	> ./docs/progress/progress.md （进展与验收记录）

## 日志回收
	日志回收用于记录模型在执行任务过程中的思考过程、执行动作、最终结果是否符合要求以及是否存在bug，形成可追溯的执行档案。
	- 记录内容
		- 思考过程（thinking）：为什么这么做、权衡了什么、预期风险。
		- 执行动作（acting）：做了什么、改了哪些文件或函数。
		- 验证结果（verifying）：是否符合用户要求、验收依据是什么。
		- 缺陷暴露（bugs）：发现的bug、潜在风险、未解决问题。
		- 最终结论（done）：总体是否通过、遗留问题、后续建议。
	- 落盘文件
	> ./docs/log/spec.md （执行标准：字段定义、模板、触发时机）
	> ./docs/log/loginfo.md （实际日志输出：按任务追加记录）
	- 触发约束
		- 每个任务开始前必须产出 thinking 阶段日志。
		- 每个子任务完成时必须产出 acting 阶段日志。
		- 验收检查时必须产出 verifying 阶段日志，发现bug须登记。
		- 最终交付时必须产出 done 阶段日志及总结。
		- 日志的 task_id 必须与 ./docs/task/task.json 中的任务ID对应。

## 任务信息
	任务信息包含「任务分解」与「进展与验收」两部分，分别对应独立目录。
	- 任务分解
		- 执行任务前必须先将用户需求拆分为子任务，写入结构化任务清单。
		- 每个子任务必须包含可检验的验收标准（acceptance_criteria）。
		- 子任务之间可声明依赖关系（dependencies），按依赖顺序执行。
		- 落盘文件
		> ./docs/task/spec.md （任务分解标准：字段定义、分解原则）
		> ./docs/task/task.json （结构化任务清单，含子任务、验收标准、依赖关系）
		- 执行约束：执行任务前必须先拆分并写入 ./docs/task/task.json。
	- 进展与验收
		- 每个子任务状态变更时必须即时更新进展记录。
		- 状态枚举：pending（未开始）/ in_progress（进行中）/ completed（已完成）/ blocked（阻塞）。
		- 子任务标记 completed 前必须逐条检验验收标准并记录结果。
		- 所有子任务 completed 后，顶层任务方可标记 completed。
		- 落盘文件
		> ./docs/progress/spec.md （进展与验收标准：进展跟踪、验收记录、交付总结）
		> ./docs/progress/progress.md （任务进展记录与验收结果）
		- 执行约束：执行过程中必须更新 ./docs/progress/progress.md。
	- 闭环约束
		- 执行过程必须同步产出 ./docs/log/loginfo.md 日志回收记录。
		- 日志的 task_id 必须与 ./docs/task/task.json 中的任务ID对应。

## 编码准则
	- 高内聚、低耦合。
	- 执行归一化逻辑时必须人工同意。
	- 严禁无视代码原本设计进行破坏式开发。
	- 常量严禁直接混入代码。
	- 使用协程时严禁没有退出条件。
	- 谨慎使用并发、锁、及协程和线程的操作。
	- 高风险操作必须使用recovery包裹。



