# A3 初赛演示版 实现计划

> 已完成项见 [completed.md](./completed.md)：Phase 1-4 共 96 项全部交付。

---

## Phase 5：资源内容与交互补强 ← 当前阶段

> **Phase 5 的通过标准不是"资源能显示"，而是"学习者能在资源里完成一次实际学习动作"：做题、自评、勾选实验步骤、完成复盘检查。只有这些动作可演示，项目才进入 Phase 6 文档与最终交付。**

> 边界：第一版不做 AI 自动判题，不做向量检索，不要求交互状态入库；交互状态先保存在前端本地 state。

### 11.1 当前问题

- [ ] `practice_pack` 目前主要是 Markdown 展示，题目数量与 summary 可能不一致
- [ ] 题目缺少结构化字段，前端无法稳定做"查看提示 / 查看答案 / 自评"
- [ ] `case_lab` 目前只是实验说明，没有步骤 checklist
- [ ] `review_sheet` 目前只是复盘文本，没有掌握度自评
- [ ] 当前 ResourceDetailDrawer 对所有资源基本只渲染 Markdown，缺少按资源类型切换的交互面板

### 11.2 后端资源结构化字段

- [ ] 在 `LearningResourceCard` 中新增 optional 字段 `interaction`
- [ ] `interaction.kind` 支持：`practice_pack` / `case_lab` / `review_sheet`
- [ ] 保留 `content_markdown`，不破坏旧渲染和 Markdown 导出
- [ ] 不新增数据库表，资源包仍整体存 JSON

`practice_pack` 的 `interaction.items` 每项至少包含：

- [ ] `exercise_id` / `module_id` / `module_title`
- [ ] `level`：`basic | standard | transfer`
- [ ] `type` + `prompt` + `target_concepts`
- [ ] `hint`：提示文本
- [ ] `answer_outline`：答案要点（不可截断到无法判断）
- [ ] `feedback`：做对时看什么 / 不会时回看什么 / 常见错误
- [ ] `source_refs`

`case_lab` 的 `interaction.items` 结构：

- [ ] `steps`：`[{step_id, description, is_done: false}]` — 实验步骤 checklist，至少 3 步
- [ ] `deliverables`：`[{item_id, description, is_done: false}]` — 提交物 checklist，至少 2 项
- [ ] `reflections`：`[{question, answer: ""}]` — 反思问题列表，至少 2 题

`review_sheet` 的 `interaction.items` 结构：

- [ ] `item_id` / `description` / `module`
- [ ] `mastered`：`false`（初始值）
- [ ] `score`：`null`（1-5 分掌握度，初始为空）

### 11.3 分层练习包增强

- [ ] summary 题目数量必须与实际 `interaction.items.length` 一致
- [ ] 如果 summary 写"精选 24 道"，则实际必须有 24 道可交互题
- [ ] 如果只展示 12 道，summary 必须写"从 24 道中精选 12 道"
- [ ] 题目不能被截断到影响阅读，答案要点不能被截断到无法判断
- [ ] 每道题必须有 `hint` / `answer_outline` / `feedback`
- [ ] 至少覆盖基础、标准、迁移三个层级

### 11.4 前端练习交互

新增 `InteractivePracticePanel` 组件，必须支持：

- [ ] 按基础 / 标准 / 迁移筛选题目
- [ ] 展示题目所属模块和目标概念
- [ ] 点击"查看提示"
- [ ] 点击"查看答案 / 解析"
- [ ] 点击"我做对了 / 不确定 / 不会"进行自评
- [ ] 显示完成进度，例如 `已自评 5/12`
- [ ] 自评状态第一版只保存在前端本地 state

验收流程：

> 打开分层练习包 → 选择一道题 → 查看提示 → 查看答案 → 点击自评 → 进度增加

### 11.5 实验任务交互

`case_lab` 需要支持：

- [ ] 实验步骤 checklist（勾选）
- [ ] 提交物 checklist（勾选）
- [ ] 反思问题输入框
- [ ] 当前完成步骤数统计

验收流程：

> 打开实验任务 → 勾选两个步骤 → 勾选一个提交物 → 输入反思 → 页面显示完成进度

### 11.6 复盘清单交互

`review_sheet` 需要支持：

- [ ] 易错点 checklist
- [ ] "已掌握 / 需复习"状态切换
- [ ] 1-5 分掌握度自评
- [ ] 自动汇总未掌握项数量

验收流程：

> 打开复盘清单 → 勾选复盘项 → 设置掌握度 → 页面显示未掌握项数量

### 11.7 详情抽屉按资源类型渲染

- [ ] `practice_pack`：优先展示 `InteractivePracticePanel`
- [ ] `case_lab`：优先展示实验 checklist 面板
- [ ] `review_sheet`：优先展示复盘自评面板
- [ ] 其他资源继续展示 Markdown
- [ ] Markdown 可以作为"完整说明"保留，但不能是交互资源的唯一内容

### 11.8 测试要求

后端至少新增：

- [ ] `test_practice_pack_interaction_count_matches_summary`
- [ ] `test_practice_pack_items_have_hint_answer_feedback`
- [ ] `test_case_lab_has_interactive_steps`
- [ ] `test_review_sheet_has_checklist_items`
- [ ] `test_old_resource_package_still_has_content_markdown`

前端至少保证：

- [ ] `npm run test` 通过
- [ ] `npm run build` 通过
- [ ] 新增字段均为 optional，不破坏旧数据渲染

### 11.9 Phase 5 验收标准

- [ ] 分层练习包题目数量与 summary 一致
- [ ] 每道练习都有提示、答案要点、反馈
- [ ] 用户能完成一次"查看提示 → 查看答案 → 自评"
- [ ] 实验任务可以勾选步骤和提交物
- [ ] 复盘清单可以勾选掌握状态并设置掌握度
- [ ] 三类交互资源都在详情抽屉中完成，不撑高主页面
- [ ] 旧的 Markdown 导出功能不被破坏
- [ ] 后端测试通过
- [ ] 前端测试通过
- [ ] 前端 build 通过

---

## Phase 6：文档与最终交付

> **等 Phase 5 交互验收通过后开始。**

- [ ] 系统开发说明书（`docs/dev-manual.md`）：架构图、技术栈、模块设计、接口文档、防幻觉策略
- [ ] 测试说明书（`docs/test-manual.md`）：测试策略、用例清单、覆盖率、集成测试步骤
- [ ] AI / 开源工具说明（`docs/ai-tools.md`）：使用的模型/接口、开源库清单及版本、讯飞接口设计说明
- [ ] 7 分钟演示脚本（`docs/demo-script.md`）：分秒级脚本 + 对应 UI 截图说明
- [ ] PPT 内容大纲（`docs/slides-outline.md`）：12-15 页，含封面、背景、架构、创新点、演示截图、总结
- [ ] 比赛方案说明（`docs/contest-plan.md`）：选题分析、技术路线、创新点总结、分工说明

---

## 执行进度

```
Phase 1 (数据底座)            ✅ 已完成
Phase 2 (智能体闭环)          ✅ 已完成
Phase 3 (学习闭环增强)        ✅ 已完成
Phase 4 (演示工作台 UI)       ✅ 已完成
Phase 5 (资源内容与交互补强)   ← 当前阶段
Phase 6 (文档与最终交付)      待开始
```
