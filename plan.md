# A3 初赛演示版 实现计划

> 已完成项见 [completed.md](./completed.md)：Phase 1-4 共 96 项全部交付。

---

## Phase 5：资源内容与交互补强 ✅ 已完成

> **Phase 5 的通过标准不是"资源能显示"，而是"学习者能在资源里完成一次实际学习动作"：做题、自评、勾选实验步骤、完成复盘检查。只有这些动作可演示，项目才进入 Phase 6 文档与最终交付。**

> 边界：第一版不做 AI 自动判题，不做向量检索，不要求交互状态入库；交互状态先保存在前端本地 state。

### 11.1 当前问题

- [x] `practice_pack` 目前主要是 Markdown 展示，题目数量与 summary 可能不一致
- [x] 题目缺少结构化字段，前端无法稳定做"查看提示 / 查看答案 / 自评"
- [x] `case_lab` 目前只是实验说明，没有步骤 checklist
- [x] `review_sheet` 目前只是复盘文本，没有掌握度自评
- [x] 当前 ResourceDetailDrawer 对所有资源基本只渲染 Markdown，缺少按资源类型切换的交互面板

### 11.2 后端资源结构化字段

- [x] 在 `LearningResourceCard` 中新增 optional 字段 `interaction`
- [x] `interaction.kind` 支持：`practice_pack` / `case_lab` / `review_sheet`
- [x] 保留 `content_markdown`，不破坏旧渲染和 Markdown 导出
- [x] 不新增数据库表，资源包仍整体存 JSON

`practice_pack` 的 `interaction.items` 每项至少包含：

- [x] `exercise_id` / `module_id` / `module_title`
- [x] `level`：`basic | standard | transfer`
- [x] `type` + `prompt` + `target_concepts`
- [x] `hint`：提示文本
- [x] `answer_outline`：答案要点（不可截断到无法判断）
- [x] `feedback`：做对时看什么 / 不会时回看什么 / 常见错误
- [x] `source_refs`

`case_lab` 的 `interaction.items` 结构：

- [x] `steps`：`[{step_id, description, is_done: false}]` — 实验步骤 checklist，至少 3 步
- [x] `deliverables`：`[{item_id, description, is_done: false}]` — 提交物 checklist，至少 2 项
- [x] `reflections`：`[{question, answer: ""}]` — 反思问题列表，至少 2 题

`review_sheet` 的 `interaction.items` 结构：

- [x] `item_id` / `description` / `module`
- [x] `mastered`：`false`（初始值）
- [x] `score`：`null`（1-5 分掌握度，初始为空）

### 11.3 分层练习包增强

- [x] summary 题目数量必须与实际 `interaction.items.length` 一致
- [x] 如果 summary 写"精选 24 道"，则实际必须有 24 道可交互题
- [x] 如果只展示 12 道，summary 必须写"从 24 道中精选 12 道"
- [x] 题目不能被截断到影响阅读，答案要点不能被截断到无法判断
- [x] 每道题必须有 `hint` / `answer_outline` / `feedback`
- [x] 至少覆盖基础、标准、迁移三个层级

### 11.4 前端练习交互

新增 `InteractivePracticePanel` 组件，必须支持：

- [x] 按基础 / 标准 / 迁移筛选题目
- [x] 展示题目所属模块和目标概念
- [x] 点击"查看提示"
- [x] 点击"查看答案 / 解析"
- [x] 点击"我做对了 / 不确定 / 不会"进行自评
- [x] 显示完成进度，例如 `已自评 5/12`
- [x] 自评状态第一版只保存在前端本地 state

验收流程：

> 打开分层练习包 → 选择一道题 → 查看提示 → 查看答案 → 点击自评 → 进度增加

### 11.5 实验任务交互

`case_lab` 需要支持：

- [x] 实验步骤 checklist（勾选）
- [x] 提交物 checklist（勾选）
- [x] 反思问题输入框
- [x] 当前完成步骤数统计

验收流程：

> 打开实验任务 → 勾选两个步骤 → 勾选一个提交物 → 输入反思 → 页面显示完成进度

### 11.6 复盘清单交互

`review_sheet` 需要支持：

- [x] 易错点 checklist
- [x] "已掌握 / 需复习"状态切换
- [x] 1-5 分掌握度自评
- [x] 自动汇总未掌握项数量

验收流程：

> 打开复盘清单 → 勾选复盘项 → 设置掌握度 → 页面显示未掌握项数量

### 11.7 详情抽屉按资源类型渲染

- [x] `practice_pack`：优先展示 `InteractivePracticePanel`
- [x] `case_lab`：优先展示实验 checklist 面板
- [x] `review_sheet`：优先展示复盘自评面板
- [x] 其他资源继续展示 Markdown
- [x] Markdown 可以作为"完整说明"保留，但不能是交互资源的唯一内容

### 11.8 测试要求

后端至少新增：

- [x] `test_practice_pack_interaction_count_matches_summary`
- [x] `test_practice_pack_items_have_hint_answer_feedback`
- [x] `test_case_lab_has_interactive_steps`
- [x] `test_review_sheet_has_checklist_items`
- [x] `test_old_resource_package_still_has_content_markdown`

前端至少保证：

- [x] `npm run test` 通过
- [x] `npm run build` 通过
- [x] 新增字段均为 optional，不破坏旧数据渲染

### 11.9 Phase 5 验收标准

- [x] 分层练习包题目数量与 summary 一致
- [x] 每道练习都有提示、答案要点、反馈
- [x] 用户能完成一次"查看提示 → 查看答案 → 自评"
- [x] 实验任务可以勾选步骤和提交物
- [x] 复盘清单可以勾选掌握状态并设置掌握度
- [x] 三类交互资源都在详情抽屉中完成，不撑高主页面
- [x] 旧的 Markdown 导出功能不被破坏
- [x] 后端测试通过
- [x] 前端测试通过
- [x] 前端 build 通过

---

## Phase 6：竞赛训练 Agent ← 当前阶段

> **方向调整**：不再继续堆静态课程资源，转向算法竞赛智能训练 Agent。核心能力：题面理解 → 代码诊断 → 能力画像 → 补题推荐。

### 6.1 第一步：题目链接导入

先做两种来源，不要一口气做全平台爬虫。

#### Codeforces 题目链接

- [ ] 优先使用 CF 官方 API（`codeforces.com/api`）解析题目
- [ ] 识别字段：`contestId / problemIndex / title / statement / input / output / samples / tags / source_url`
- [ ] 不做登录态、不绕过反爬

#### 手动导入题面

- [ ] 对洛谷、牛客、AtCoder 等，允许粘贴 Markdown 或纯文本题面
- [ ] 不强依赖非公开接口

#### 统一题目数据结构

```
ProblemSnapshot {
  platform: "codeforces" | "luogu" | "atcoder" | "manual"
  source_url, title, statement_markdown
  input_format, output_format
  samples: [{input, output}]
  constraints: string[]
  tags: string[]
  fetched_at: string
}
```

#### 验收标准

- [ ] 粘贴 CF 题目链接后生成结构化题面
- [ ] 手动题面也能进入后续分析流程
- [ ] 每道题保留来源链接和导入时间

### 6.2 第二步：用户提交导入

区分三类数据，必须授权才能获取代码。

#### 公开提交元数据

- [ ] 通过 API 获取：题号、语言、提交时间、verdict、耗时、内存

#### 用户代码

- [ ] Codeforces：支持输入 handle，获取最近提交（不含代码）
- [ ] 洛谷/其他：支持手动粘贴代码和 verdict
- [ ] 所有平台支持「手动录入一次提交」
- [ ] 不可自动获取他人源码

#### 隐藏测试数据

- [ ] 不可获取，不假装能获取
- [ ] 只能通过样例、本地构造、暴力对拍推测错误

#### 提交数据结构

```
SubmissionSnapshot {
  platform, problem_id, user_handle?
  verdict: "AC" | "WA" | "TLE" | "RE" | "MLE" | "UNKNOWN"
  language, code?
  submitted_at?, runtime_ms?, memory_kb?
}
```

#### 验收标准

- [ ] 用户可把一道题和一份代码绑定
- [ ] 系统保存 verdict、语言和代码
- [ ] 无代码时也能基于提交记录做粗粒度能力分析

### 6.3 第三步：WA 诊断 Agent ← 创新核心

诊断流程：题面解析 → 样例运行 → 代码结构分析 → 小数据对拍 → LLM 总结 → 映射画像。

#### 代码分析

- [ ] 第一版支持 C++ 代码
- [ ] 提取算法意图（双指针、贪心、DP、图搜索、并查集等）
- [ ] 运行样例判断是否样例错误
- [ ] 题目适合时生成小规模随机数据
- [ ] 尝试生成暴力解用于对拍

#### 错误类型

- [ ] 输出以下分类之一：
  `算法选型错误 / 边界条件错误 / 数据范围误判 / 贪心证明缺失 / 状态设计错误 / 实现细节错误 / 复杂度超限`

#### 诊断原则

- [ ] 结果表达为「高置信假设」，不说绝对真相
- [ ] 每条假设说明依据
- [ ] 无法复现时写「未能本地复现，只能基于代码和题面推断」

#### 验收标准

- [ ] 题面 + WA 代码 → 输出 3 条以内主要错误假设
- [ ] 每条有依据
- [ ] 无法复现时有明确声明

### 6.4 第四步：算法能力画像

从泛化学习画像改为竞赛能力画像。

#### 维度

- [ ] 基础实现能力
- [ ] 复杂度判断能力
- [ ] 边界条件处理
- [ ] 贪心建模能力
- [ ] 动态规划状态设计
- [ ] 图论建模能力
- [ ] 数据结构应用能力
- [ ] 数学与构造能力
- [ ] 调试与验证习惯

#### 画像结构

```
AbilityProfileItem {
  dimension, score, evidence[]
  related_problems[], recent_errors[]
}
```

#### 更新规则

- [ ] 每次导入题目、提交代码、完成诊断后更新
- [ ] 不存抽象分数，存具体证据

#### 验收标准

- [ ] 一次 WA 诊断后更新 1-3 个维度
- [ ] 画像可展开看到证据
- [ ] 推荐题目时引用画像依据

### 6.5 第五步：补题推荐与类似题联想

第一版用「稳定题库 + 标签图谱 + Agent 推理」。

#### 本地题库索引

- [ ] 格式：`{platform, problem_id, title, url, tags[], difficulty, tricks[], prerequisites[]}`

#### 推荐逻辑

- [ ] 用户 WA 后推荐：同 tag 基础题 / 同 trick 相似题 / 前置知识题 / 迁移挑战题
- [ ] 每次推荐 3-5 道
- [ ] 推荐理由必须具体，如：

> 推荐 P3374 是因为你在当前题中使用了树状数组，但对区间贡献转化不稳定，需要先补单点修改与区间查询模型。

#### 验收标准

- [ ] 每次诊断后推荐 3-5 道题
- [ ] 每道题有推荐理由
- [ ] 区分：基础补强 / 同类巩固 / 迁移挑战

### 6.6 第六步：模型接入策略

> **不绑定任何特定模型或供应商。最终用什么 API 就接什么 AI。** 核心是我们定义的 `LLMProvider` 接口，模型实现可以随时替换。

#### 统一接口

- [ ] `LLMProvider` 抽象接口：`chat()` + `structuredOutput()`
- [ ] 所有 Agent 逻辑只依赖接口，不直接调用任何具体 API
- [ ] 实现类示例：`OpenAICompatibleProvider`，可接入任意兼容 OpenAI Chat Completions 的服务
- [ ] 新增一个 provider 只需实现接口的两个方法
- [ ] 业务逻辑（诊断、推荐、画像）不散落在 prompt 里——接口负责调用，Agent 负责编排

#### 配置方式

- [ ] `api_base_url` + `api_key` + `model_name` 三段配置即可切换
- [ ] 复用现有 `ai-settings.json` 的 provider 配置体系
- [ ] 不做硬编码的模型名称、不做写死的 provider 列表

#### 验收标准

- [ ] 换一个 API 地址和 Key，系统行为不变
- [ ] 可以同时配置开发用模型和交付用模型
- [ ] 文档里清楚写「如何替换 AI 服务商」

### 6.7 阶段验收：闭环 Demo

- [ ] 输入 CF 题目链接 → 解析题面
- [ ] 输入 WA 代码 → 运行样例 → 分析 → 输出错误假设
- [ ] 更新能力画像
- [ ] 推荐 3-5 道补题

### 6.8 优先级

```
1. 题目导入数据结构
2. Codeforces 链接解析
3. 手动代码提交入口
4. WA 诊断 Agent
5. 画像 + 补题推荐
```

> **不要继续扩写通用课程资源，不要美化静态 Markdown。接下来让 Agent 处理真实竞赛任务。**

---

## Phase 7：文档与最终交付

> **等 Phase 6 闭环 Demo 跑通后开始。**

- [ ] 系统开发说明书（`docs/dev-manual.md`）：架构图、技术栈、模块设计、接口文档、防幻觉策略
- [ ] 测试说明书（`docs/test-manual.md`）：测试策略、用例清单、覆盖率、集成测试步骤
- [ ] AI / 开源工具说明（`docs/ai-tools.md`）：`LLMProvider` 接口设计、如何替换 AI 服务商、开源库清单及版本
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
Phase 5 (资源内容与交互补强)   ✅ 已完成
Phase 6 (竞赛训练 Agent)        ← 当前阶段
Phase 7 (文档与最终交付)        待开始
```
