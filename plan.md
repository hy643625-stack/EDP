# A3 初赛演示版 实现计划

> 赛题：[A3-基于大模型的个性化资源生成与学习多智能体系统开发](https://www.cnsoftbei.com/content-3-1286-1.html)
> 基线：现有 EveryDayPerfect 学习工作台（React + FastAPI + SQLite）

---

## 一、课程知识库（文件型知识库）

> **总原则**：知识库不是"网上资料合集"，而是自主整理的一门课程。外部资源只做参考和出处登记，正文、题目、案例尽量自编或改写。第一版只做一门核心课程：**数据结构与算法**。

### 1.1 目录结构

```
backend/app/learning_knowledge/
  data_structures/
    course.json              ← 课程总览
    sources.json             ← 外部参考来源登记（不入正文）
    modules/
      ds-01-complexity/
        manifest.json        ← 模块元数据
        lecture.md           ← 讲解文档
        concepts.json        ← 核心概念
        exercises.json       ← 练习题库
        lab.md               ← 实验任务
      ds-02-linear-list/
      ds-03-stack-queue/
      ds-04-tree/
      ds-05-hash-search/
      ds-06-graph/
      ds-07-sorting/
      ds-08-integrated-project/
```

每个模块必须包含这 **5 个文件**：`manifest.json`、`lecture.md`、`concepts.json`、`exercises.json`、`lab.md`。**不允许自由发挥文件名**。

### 1.2 8 个模块范围

- [x] **1.2.1** `ds-01-complexity`：复杂度、ADT、递归基础
- [x] **1.2.2** `ds-02-linear-list`：顺序表、链表、增删查改
- [x] **1.2.3** `ds-03-stack-queue`：栈、队列、表达式求值、BFS 基础
- [x] **1.2.4** `ds-04-tree`：二叉树、遍历、递归、堆、哈夫曼树
- [x] **1.2.5** `ds-05-hash-search`：顺序查找、二分查找、哈希表、冲突处理
- [x] **1.2.6** `ds-06-graph`：图表示、DFS、BFS、最短路、最小生成树
- [x] **1.2.7** `ds-07-sorting`：插入、选择、冒泡、归并、快排、堆排
- [x] **1.2.8** `ds-08-integrated-project`：综合实验、错题复盘、课程项目

### 1.3 文件模板与约束

#### course.json（课程总览）

```json
{
  "course_id": "data_structures",
  "title": "数据结构与算法",
  "version": "1.0.0",
  "summary": "面向高校计算机相关专业的数据结构核心课程。",
  "target_learners": ["计算机本科低年级", "期末复习学生", "软件杯演示用户"],
  "modules": [
    "ds-01-complexity", "ds-02-linear-list", "ds-03-stack-queue",
    "ds-04-tree", "ds-05-hash-search", "ds-06-graph",
    "ds-07-sorting", "ds-08-integrated-project"
  ]
}
```

#### manifest.json（模块元数据）

```json
{
  "module_id": "ds-01-complexity",
  "title": "复杂度与抽象数据类型",
  "difficulty": "basic",
  "estimated_minutes": 90,
  "prerequisites": ["基础编程语法", "函数调用"],
  "learning_objectives": [
    "能区分时间复杂度和空间复杂度",
    "能用大 O 表示常见循环结构的复杂度"
  ],
  "keywords": ["复杂度", "ADT", "递归"],
  "source_refs": ["mit-6-006", "opendsa"]
}
```

#### concepts.json（核心概念，每模块 ≥ 5 个）

```json
[
  {
    "concept_id": "ds-01-c01",
    "name": "时间复杂度",
    "definition": "描述算法运行时间随输入规模增长而变化的量级。",
    "common_mistakes": ["把实际运行秒数等同于复杂度"],
    "example": "两层嵌套循环通常对应 O(n²)。",
    "source_refs": ["mit-6-006"]
  }
]
```

#### exercises.json（每模块 ≥ 6 题：2 基础 + 2 标准 + 2 迁移）

```json
[
  {
    "exercise_id": "ds-01-e01",
    "level": "basic",
    "type": "short_answer",
    "prompt": "为什么 O(n) 和 O(2n) 通常都写作 O(n)？",
    "answer_outline": "大 O 关注增长量级，忽略常数因子。",
    "target_concepts": ["ds-01-c01"],
    "source_refs": []
  }
]
```

题型枚举：`short_answer` | `single_choice` | `code_reading` | `code_writing` | `proof`

#### lecture.md（固定 7 个标题）

```md
# 模块名称

## 学习目标
## 知识地图
## 核心讲解
## 典型例子
## 易错点
## 自测问题
## 与后续模块的关系
```

#### lab.md（每模块 1 个实验任务）

```md
# 实验：[实验名称]

## 任务目标
## 输入输出
## 实现步骤
## 提交物
## 反思问题
```

### 1.4 外部资源登记

外部资源只进入 `sources.json`，**不直接复制正文**。

- [x] **1.4.1** MIT OCW 6.006：课程结构、算法主题参考 → https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-fall-2011/
- [x] **1.4.2** OpenDSA：数据结构模块、交互练习参考 → https://opendsa.org/
- [x] **1.4.3** Runestone 数据结构教材：Python 讲解风格参考 → https://runestone.academy/
- [x] **1.4.4** TheAlgorithms/Python：代码实现参考（MIT License）→ https://github.com/TheAlgorithms/Python
- [x] **1.4.5** 国内 MOOC/高校课程：仅用于对齐中文课程范围，不复制课件、题目、视频文案

`sources.json` 格式：x
```json
[
  {
    "source_id": "mit-6-006",
    "title": "MIT OCW 6.006 Introduction to Algorithms",
    "url": "https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-fall-2011/",
    "license": "Creative Commons",
    "usage": "参考课程结构与主题范围，不复制原文"
  }
]
```

### 1.5 工程实现顺序

- [x] **1.5.1** 创建目录骨架和 8 个模块空模板
- [x] **1.5.2** 填写 `course.json` 和 `sources.json`
- [x] **1.5.3** 每个模块先写 `manifest.json`（锁定学习目标和关键词）
- [x] **1.5.4** 每个模块写 `concepts.json`（≥ 5 个概念）
- [x] **1.5.5** 每个模块写 `exercises.json`（≥ 6 道题）
- [x] **1.5.6** 每个模块写 `lecture.md` 和 `lab.md`
- [x] **1.5.7** 实现 Python loader：启动时读取并校验知识库结构完整性
- [x] **1.5.8** 将现有 `COURSE_CATALOG` 替换为 loader 输出
- [x] **1.5.9** 资源生成结果增加 `source_refs`，证明内容来自知识库
- [x] **1.5.10** 编写知识库校验测试：模块缺字段、缺文件时 loader 报错

### 1.6 最低验收标准

- [x] 1 门完整课程
- [x] 8 个模块，每个模块 5 个文件齐全
- [x] 每模块 ≥ 5 个概念（总计 ≥ 40）
- [x] 每模块 ≥ 6 道练习（总计 ≥ 48）
- [x] 每模块 ≥ 1 个实验任务
- [x] 所有模块都有来源说明（`source_refs` 可追溯）
- [x] 后端测试能验证知识库结构完整性
- [x] 前端生成资源时能展示"参考模块/来源"

### 1.7 不要做的事

- [x] 不要写爬虫
- [x] 不要复制 MOOC、教材、博客正文
- [x] 不要一开始做向量数据库
- [x] 不要把课程内容继续硬编码在 service 里
- [x] 不要让大模型自由生成没有来源的课程知识

### 1.8 后续扩展口

此结构后续可自然扩展：
- 增加 `artificial_intelligence/` 作为第二门课程
- 给每个模块增加 `mindmap.json`（脑图结构）
- 增加 `rubric.json`（评分量表）
- 增加 `slides.md`（PPT 大纲）
- 增加向量检索（但只索引这些已审核文件）

## 二、学习画像升级（会话化）

> **目标**：让画像从"一次性生成"变为"会话内可追踪、可版本化"。创建 session → 生成画像 v1 → 追加对话 → 画像 v2 → ...，每次更新保留证据和置信度。

### 2.1 数据库

直接追加到 `backend/app/db.py` 的 `SCHEMA_STATEMENTS`：

- [ ] **2.1.1** `learning_sessions` — `id TEXT PK`, `course_id TEXT`, `title TEXT`, `conversation TEXT`, `preferred_goal TEXT`, `weekly_days INT`, `daily_minutes INT`, `status TEXT DEFAULT 'active'`, `created_at TEXT`, `updated_at TEXT`
- [ ] **2.1.2** `learning_profile_versions` — `id INTEGER PK AUTOINCREMENT`, `session_id TEXT FK`, `version INT`, `snapshot_json TEXT`（8 维画像完整 JSON）, `input_summary TEXT`, `created_at TEXT`

### 2.2 API 端点

- [ ] **2.2.1** `POST /v1/learning/sessions` — 创建会话 + 生成初始画像 v1
  - Request body: `course_id`, `conversation`, `preferred_goal`, `weekly_days`, `daily_minutes`, `title?`
  - Response: session 详情（含 profile_version=1 的完整画像）
- [ ] **2.2.2** `GET /v1/learning/sessions` — 列出最近会话摘要（按 `updated_at` 倒序，限 20 条）
- [ ] **2.2.3** `GET /v1/learning/sessions/{session_id}` — 返回会话 + 最新画像 + 画像版本列表 + 最近资源包
- [ ] **2.2.4** `POST /v1/learning/sessions/{session_id}/profile` — 追加对话，生成新版本画像
  - Request body: `conversation`（新对话内容）, `preferred_goal?`, `weekly_days?`, `daily_minutes?`
  - Response: 新画像版本号 + 完整 snapshot
- [ ] **2.2.5** `POST /v1/learning/sessions/{session_id}/resource-package` — 运行智能体链路，保存资源包和 agent_runs

### 2.3 画像版本化规范

- [ ] **2.3.1** 每个 profile_version 包含完整 8 维 snapshot（`baseline/goal/schedule/style/practice/pace/risk/support`）
- [ ] **2.3.2** `input_summary` 记录"用户说了什么触发了这次更新"（≤200 字摘要）
- [ ] **2.3.3** 每个维度含 `value`、`evidence`、`confidence` 三字段
- [ ] **2.3.4** 版本号从 1 开始递增，旧版本永久保留（不做软删除）

### 2.4 向后兼容

- [ ] **2.4.1** 保留旧 `POST /v1/learning/profile` 和 `POST /v1/learning/resource-package` 无会话接口不破坏现有前端和测试
- [ ] **2.4.2** 旧接口内部走"隐式临时 session"逻辑：不持久化到 DB，但输出格式与 session 接口一致

## 三、多智能体编排

> **目标**：将现有本地规则生成拆成可追踪的同步 agent pipeline。每次生成资源包时按 `profiler → planner → explainer/practice/curator → coach/evaluator` 顺序执行，每个 agent 包统一 runner，记录耗时、状态和降级原因。

### 3.1 智能体 Pipeline DAG

```
profiler ──→ planner ──→ explainer (并行)
              │         → practice  (并行)
              │         → curator   (并行)
              │              │
              └──────────────┴──→ coach/evaluator (收尾)
```

- [ ] **3.1.1** Profiler：输入画像最新版本 → 输出画像风险标注和建议追问
- [ ] **3.1.2** Planner：输入画像 + 课程模块列表 → 输出 3 阶段学习路径
- [ ] **3.1.3** Explainer：输入聚焦模块 + 画像 → 输出主线讲解文档（已实现：`_build_course_brief`）
- [ ] **3.1.4** Practice：输入聚焦模块 + 画像 → 输出分层练习（已实现：`_build_practice_pack`）
- [ ] **3.1.5** Curator：输入聚焦模块 + 画像 → 输出脑图 + 阅读指南 + 案例实验（已实现）
- [ ] **3.1.6** Coach/Evaluator：输入画像 + 学习路径 + 资源列表 → 输出督学建议 + 评估面板 + 复盘清单

### 3.2 AgentRunner 统一包装器

- [ ] **3.2.1** 每个 agent 调用前记录 `started_at`（`time.perf_counter()`）
- [ ] **3.2.2** 调用成功：`status=completed`, `duration_ms`, `input_summary`（≤200 字）, `output_summary`（≤200 字）, `source_refs_json`
- [ ] **3.2.3** AI 调用失败：`status=fallback`, `fallback_reason`, 继续执行本地规则生成，最终结果仍返回
- [ ] **3.2.4** 异常崩溃：`status=failed`, `fallback_reason`，不阻塞 pipeline 中不依赖该 agent 的后续步骤

### 3.3 数据库

- [ ] **3.3.1** `learning_agent_runs` — `id INTEGER PK AUTOINCREMENT`, `session_id TEXT FK`, `agent_id TEXT`, `status TEXT`（`completed|fallback|failed`）, `duration_ms INT`, `input_summary TEXT`, `output_summary TEXT`, `fallback_reason TEXT`, `source_refs_json TEXT`, `created_at TEXT`

### 3.4 防幻觉与安全审查（每个资源）

- [ ] **3.4.1** 每个资源（resource card）必须带 `safety_review` 对象：
  - `grounding_passed: bool` — 资源是否可溯源到知识库
  - `warnings: list[str]` — 内容与知识库不一致的告警
  - `source_refs: list[str]` — 实际引用的模块/来源 ID
- [ ] **3.4.2** Grounding 最低规则：资源没有有效 `module:<id>` 引用 → `grounding_passed=false`
- [ ] **3.4.3** AI 输出 JSON 无效或 grounding 不通过时 → 整个资源包回退到纯本地规则生成（标注 `mode_used=local_rules`）
- [ ] **3.4.4** 资源 `source_refs` 三类语义：
  - `origin:self_authored` — 模板/规则自编内容（已在第一阶段实现）
  - `module:<id>` — 内容直接来自知识库模块文件
  - `source:<id>` — 外部参考来源（仅在确实引用时标注，如 reading-guide）

## 四、资源生成（≥7 类）

- [ ] **4.1** 定义资源类型枚举和统一 ResourceCard schema：type、title、source_module、target_profile、estimated_minutes、generated_by_agent、content、modality
- [ ] **4.2** 实现 7 类资源生成（每类至少一个可运行生成器）：
  - [ ] 4.2.1 课程讲解文档（Markdown，含章节、图表位、关键概念高亮）
  - [ ] 4.2.2 知识脑图（JSON 树结构，前端可渲染为思维导图）
  - [ ] 4.2.3 分层题库（基础/进阶/综合，每题含题干、选项、答案、解析、关联知识点）
  - [ ] 4.2.4 拓展阅读（推荐文章/论文列表，含摘要和链接）
  - [ ] 4.2.5 代码/实验案例（可运行的代码片段 + 注释 + 预期输出）
  - [ ] 4.2.6 PPT 大纲（按 slide 组织，每页含标题、要点、备注）
  - [ ] 4.2.7 动画/短视频分镜脚本（场景描述、旁白、时长、转场）
- [ ] **4.3** 每个资源标注 generated_by_agent、source_refs（引用知识库模块）
- [ ] **4.4** 资源包版本管理：每次重新生成保存为新版本，支持查看历史

## 五、学习路径与推送

- [ ] **5.1** 定义学习路径数据模型：3 阶段（基础→进阶→综合），每阶段含模块列表、推荐资源、预计用时
- [ ] **5.2** 基于画像 + 课程知识库 + 资源包生成个性化学习路径
- [ ] **5.3** 实现"今日推荐资源"：按优先级排序的 5 个资源卡片
- [ ] **5.4** 实现"下一步动作"：基于当前掌握度推荐下一步学习模块
- [ ] **5.5** 实现"风险调整建议"：薄弱点标注 + 针对性练习推荐
- [ ] **5.6** 用户提交反馈后，自动更新推荐顺序（降低已掌握项权重）

## 六、智能辅导与评估（加分项）

- [ ] **6.1** `POST /v1/learning/sessions/{session_id}/tutor` — 即时答疑
  - [ ] 6.1.1 返回文字讲解（Markdown + LaTeX 公式）
  - [ ] 6.1.2 返回图解结构（Mermaid/ASCII 图）
  - [ ] 6.1.3 返回关联资源（从已生成资源包中检索 3 条最相关）
  - [ ] 6.1.4 响应标注 source_refs 和 confidence
- [ ] **6.2** `POST /v1/learning/sessions/{session_id}/feedback` — 学习反馈
  - [ ] 6.2.1 接收自评分（1-5）、练习结果（正确率）、资源评价（有用/无用）
  - [ ] 6.2.2 更新对应知识点掌握度
  - [ ] 6.2.3 标记薄弱点
  - [ ] 6.2.4 生成下一轮学习计划调整
- [ ] **6.3** 前端即时答疑面板：输入框 + 结果渲染 + 关联资源卡片

## 七、防幻觉与安全（详见 3.4）

> 已在第二阶段智能体编排中实现，此处仅保留全局约束。

- [x] **7.1** 所有 AI 生成内容标注 `source_refs`（引用的知识库模块或用户输入摘要）— 第一阶段已完成
- [x] **7.2** `safety_review` 检查器（`grounding_passed` / `warnings` / `source_refs`）— 第二阶段 3.4 实现
- [x] **7.3** AI 调用失败 / JSON 无效 / grounding 未通过 → 回退本地规则 — 第二阶段 3.2.3 实现
- [ ] **7.4** 前端渲染 safety_review 状态标签 — 第二阶段前端最小集成

## 八、前端体验（第二阶段：最小可见集成）

> **范围控制**：本阶段不做大布局改版，只做足够验证闭环的最小 UI 改动。完整工作台重构留给第三阶段。

- [ ] **8.1** `LearningStudioTab` 增加当前 session 状态显示
  - [ ] 8.1.1 首次构建画像时自动创建 session（调用 `POST /v1/learning/sessions`）
  - [ ] 8.1.2 顶部增加"当前学习会话"标识栏（session title + 创建时间）
  - [ ] 8.1.3 "重新开始会话"按钮（创建新 session，清空旧草稿）
- [ ] **8.2** 画像区域增加版本信息
  - [ ] 8.2.1 显示当前画像版本号（v1, v2, ...）
  - [ ] 8.2.2 每次追加对话 → 调用 `POST /v1/learning/sessions/{id}/profile` → 显示新版本
- [ ] **8.3** 智能体链路展示
  - [ ] 8.3.1 资源包生成后展示 agent_runs 列表（agent 名 + status + duration）
  - [ ] 8.3.2 回退（fallback）的 agent 标黄、失败（failed）的标红
- [ ] **8.4** 资源溯源展示
  - [ ] 8.4.1 每个资源卡片显示 `source_refs` 标签（module:xxx / source:xxx）
  - [ ] 8.4.2 显示 `safety_review` 状态（✅ grounding 通过 / ⚠️ 告警 / ❌ 未通过）
- [ ] **8.5** 前端类型新增（追加到 `api/types.ts`）：
  - [ ] 8.5.1 `LearningSessionSummary` — `{id, title, course_id, status, created_at, updated_at}`
  - [ ] 8.5.2 `LearningSessionDetail` — 含 `profile_versions`, `latest_package`, `agent_runs`
  - [ ] 8.5.3 `LearningProfileVersion` — `{version, snapshot_json, input_summary, created_at}`
  - [ ] 8.5.4 `LearningAgentRun.status` — `"completed" | "fallback" | "failed"`
  - [ ] 8.5.5 `LearningSafetyReview` — `{grounding_passed, warnings, source_refs}`
- [ ] **8.6** 向后兼容：所有新增字段均为 optional，旧 UI 不传不影响渲染

## 九、后端 API 与数据库

### 9.1 新增表（4 张，追加到 `db.py` 的 `SCHEMA_STATEMENTS`）

- [ ] **9.1.1** `learning_sessions`
  ```
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL, title TEXT,
  conversation TEXT, preferred_goal TEXT DEFAULT '',
  weekly_days INT DEFAULT 4, daily_minutes INT DEFAULT 50,
  status TEXT DEFAULT 'active', created_at TEXT, updated_at TEXT
  ```
- [ ] **9.1.2** `learning_profile_versions`
  ```
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
  version INT NOT NULL, snapshot_json TEXT NOT NULL,
  input_summary TEXT, created_at TEXT,
  FOREIGN KEY (session_id) REFERENCES learning_sessions(id)
  ```
- [ ] **9.1.3** `learning_resource_packages`
  ```
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
  version INT NOT NULL, package_json TEXT NOT NULL,
  created_at TEXT,
  FOREIGN KEY (session_id) REFERENCES learning_sessions(id)
  ```
- [ ] **9.1.4** `learning_agent_runs`
  ```
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL, status TEXT NOT NULL,
  duration_ms INT, input_summary TEXT, output_summary TEXT,
  fallback_reason TEXT, source_refs_json TEXT, created_at TEXT,
  FOREIGN KEY (session_id) REFERENCES learning_sessions(id)
  ```

> 注：资源包整体存为 JSON（`package_json`），暂不拆独立 resources 表。等资源编辑、反馈、导出需求稳定后再拆。

### 9.2 新增 Repository

- [ ] **9.2.1** 新建 `backend/app/repositories/learning_repository.py`
  - 只负责 SQLite CRUD + JSON 序列化，不写业务推理逻辑
  - 方法：`create_session`, `get_session`, `list_sessions`, `update_session`, `create_profile_version`, `get_profile_versions`, `create_package`, `get_latest_package`, `create_agent_run`, `get_agent_runs`

### 9.3 新增 API 端点

- [x] **9.3.1** `GET /v1/learning/workbench` — 已有（第一阶段接入 KB）
- [x] **9.3.2** `POST /v1/learning/profile` — 已有（旧无会话接口，保留兼容）
- [x] **9.3.3** `POST /v1/learning/resource-package` — 已有（旧无会话接口，保留兼容）
- [ ] **9.3.4** `POST /v1/learning/sessions` — 创建会话 + 生成初始画像 v1
- [ ] **9.3.5** `GET /v1/learning/sessions` — 列出最近会话（按 updated_at 倒序，限 20 条）
- [ ] **9.3.6** `GET /v1/learning/sessions/{session_id}` — 会话详情（含画像版本列表 + 最近资源包 + agent_runs）
- [ ] **9.3.7** `POST /v1/learning/sessions/{session_id}/profile` — 追加对话，生成新版本画像
- [ ] **9.3.8** `POST /v1/learning/sessions/{session_id}/resource-package` — 运行智能体链路，持久化资源包和 agent_runs

### 9.4 新增 Pydantic Schema（`backend/app/schemas.py`）

- [ ] **9.4.1** `CreateLearningSessionRequest` — `course_id`, `conversation`, `preferred_goal`, `weekly_days`, `daily_minutes`, `title?`
- [ ] **9.4.2** `UpdateLearningSessionProfileRequest` — `conversation`, `preferred_goal?`, `weekly_days?`, `daily_minutes?`

### 9.5 向后兼容保证

- [ ] **9.5.1** 旧接口 `/profile` 和 `/resource-package` 走隐式临时 session（不写 DB），输出格式与 session 接口一致
- [ ] **9.5.2** 新增字段（`source_refs`, `safety_review`, `agent_runs`）均为可选，旧前端不传不崩

## 十、测试

### 10.1 知识库校验测试（第一阶段，已完成）
- [x] **10.1.0** 知识库 loader 校验 — 22 tests pass（概念数、练习数、枚举、引用完整性、Markdown 标题）

### 10.2 后端会话测试（第二阶段新增）
- [ ] **10.2.1** `test_create_session_generates_profile_v1`：创建 session 后 DB 中有 1 条 profile_version
- [ ] **10.2.2** `test_update_profile_creates_new_version`：追加对话后版本号递增，旧版本保留
- [ ] **10.2.3** `test_unknown_session_returns_404`：查询不存在 session 返回明确错误
- [ ] **10.2.4** `test_list_sessions_returns_recent`：按 updated_at 倒序，limit 20
- [ ] **10.2.5** `test_old_profile_endpoint_still_works`：旧 `/v1/learning/profile` 不依赖 session
- [ ] **10.2.6** `test_old_resource_package_endpoint_still_works`：旧接口仍可生成资源包

### 10.3 智能体链路测试（第二阶段新增）
- [ ] **10.3.1** `test_pipeline_records_agent_runs`：生成资源包后 `agent_runs` ≥ 6 条
- [ ] **10.3.2** `test_each_resource_has_source_refs_and_safety_review`：6 个资源都有 `source_refs` 和 `safety_review`
- [ ] **10.3.3** `test_ai_failure_triggers_fallback`：模拟 AI 调用异常 → 资源包仍生成 → 对应 agent_run 标记 `fallback`
- [ ] **10.3.4** `test_grounding_failed_triggers_local_fallback`：资源无有效 module 引用 → `grounding_passed=false` → 整体回退
- [ ] **10.3.5** `test_agent_run_source_refs_semantics`：验证 `source_refs` 三类语义正确分离

### 10.4 前端
- [ ] **10.4.1** `npm run test` — 现有前端测试全通过
- [ ] **10.4.2** `npm run build` — TypeScript 编译无 error
- [ ] **10.4.3** 前端新增类型字段均为 optional，旧渲染不崩

### 10.5 集成验收（第二阶段完成标准）
- [ ] **10.5.1** 启动项目 → 选择数据结构课程 → 输入学习描述 → 创建 session → 显示画像 v1
- [ ] **10.5.2** 追加对话 → 画像更新到 v2 → 旧版本可查看
- [ ] **10.5.3** 生成资源包 → 展示 6 个 agent_runs → 每个资源有 source_refs 和 safety 状态
- [ ] **10.5.4** 重启应用 → 之前的 session 仍在列表中，可重新打开

## 十一、文档交付

- [ ] **11.1** 系统开发说明书（`docs/dev-manual.md`）：架构图、技术栈、模块设计、接口文档、防幻觉策略
- [ ] **11.2** 测试说明书（`docs/test-manual.md`）：测试策略、用例清单、覆盖率、集成测试步骤
- [ ] **11.3** AI / 开源工具说明（`docs/ai-tools.md`）：使用的模型/接口、开源库清单及版本、讯飞接口设计说明
- [ ] **11.4** 7 分钟演示脚本（`docs/demo-script.md`）：分秒级脚本 + 对应 UI 截图说明
- [ ] **11.5** PPT 内容大纲（`docs/slides-outline.md`）：12-15 页，含封面、背景、架构、创新点、演示截图、总结
- [ ] **11.6** 比赛方案说明（`docs/contest-plan.md`）：选题分析、技术路线、创新点总结、分工说明

---

## 执行顺序建议

```
Phase 1 (数据底座) ✅ 已完成
  一（知识库）→ 九（DB 骨架）→ 二（画像会话化）

Phase 2 (智能体闭环) ← 当前阶段
  二（会话 + DB）→ 九（Repository + API）→ 三（Agent Pipeline + Safety）→ 八（前端最小集成）→ 十（测试）

Phase 3 (学习闭环)
  四（资源类型扩展）→ 五（路径推送）→ 六（辅导评估）

Phase 4 (前端 + 演示)
  八（完整工作台 UI）→ 十一（文档）
```

### Phase 2 实现顺序

```
1. db.py — 追加 4 张表到 SCHEMA_STATEMENTS
2. learning_repository.py — CRUD + JSON 序列化
3. schemas.py — 新增 Pydantic 请求模型
4. learning_agent_service.py — 新增 session 方法 + AgentRunner 包装器
5. api/learning.py — 新增 5 个 session 端点
6. dependencies.py — 注入 LearningRepository
7. tests/test_learning_sessions.py — 会话测试
8. tests/test_learning_agents.py — 智能体链路测试
9. 前端 types.ts — 新增类型
10. 前端 LearningStudioTab — session 状态 + agent_runs + safety 展示
11. npm run build + 集成验收
```
