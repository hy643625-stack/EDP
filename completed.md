# 已完成任务清单

## Phase 1：文件型知识库 ✅

### 课程知识库
- [x] 8 个模块目录骨架（ds-01 ~ ds-08）
- [x] `course.json` + `sources.json`（5 个参考来源）
- [x] 每模块 5 个文件：`manifest.json` / `lecture.md` / `concepts.json` / `exercises.json` / `lab.md`
- [x] 40 个概念（每模块 ≥ 5）+ 48 道练习（每模块 ≥ 6）
- [x] 所有模块 `source_refs` 可溯源
- [x] Python loader：`learning_knowledge/loader.py`，启动时校验
- [x] loader 替换旧 `COURSE_CATALOG` 硬编码
- [x] 22 个 KB 校验测试（结构、枚举、引用完整性、Markdown 标题）
- [x] 不写爬虫、不复制正文、不做向量库

## Phase 2：会话化画像 + 多智能体编排 ✅

### 数据库
- [x] 4 张新表：`learning_sessions` / `learning_profile_versions` / `learning_resource_packages` / `learning_agent_runs`
- [x] `LearningRepository` CRUD + JSON 序列化

### API
- [x] `POST /v1/learning/sessions` — 创建会话 + 画像 v1
- [x] `GET /v1/learning/sessions` — 列出最近会话
- [x] `GET /v1/learning/sessions/{id}` — 会话详情
- [x] `POST /v1/learning/sessions/{id}/profile` — 追加画像
- [x] `POST /v1/learning/sessions/{id}/resource-package` — 生成资源包 + 记录 agent_runs
- [x] 旧接口 `/profile` + `/resource-package` 向后兼容

### 智能体编排
- [x] 6+1 个 agent pipeline：profiler → planner → explainer/practice/curator → curator-slide → coach
- [x] AgentRunner 统一包装器（计时、状态、降级记录）
- [x] `safety_review` 每个资源（grounding_passed / warnings / source_refs）
- [x] `source_refs` 三类语义：`origin:self_authored` / `module:<id>` / `source:<id>`
- [x] `display` 元数据（icon / accent / layout / density）

### 前端
- [x] Session 状态栏 + 新建会话按钮
- [x] 画像版本号展示
- [x] Agent runs 列表（status + duration + fallback 标记）
- [x] source_refs 标签 + safety_review 状态
- [x] 前端类型（LearningSessionSummary / LearningSessionDetail / LearningProfileVersion / LearningAgentRun / LearningSafetyReview）
- [x] MarkdownRenderer（react-markdown + remark-gfm + rehype-sanitize）
- [x] ResourceCard（6+1 种类型视觉差异化）

### 测试
- [x] 31 tests（22 KB + 9 session/pipeline）
- [x] 向后兼容测试
- [x] 测试导入隔离（EVERYDAYPERFECT_SKIP_DEFAULT_APP）

## Phase 3：学习闭环增强 ✅

### 资源扩展
- [x] `slide_outline` 资源生成器（PPT 大纲，Slide 标题 + 要点 + 备注）
- [x] 前端 `slide_outline` indigo 色系 + Presentation 图标
- [x] 资源总数 7（course_brief / mind_map / practice_pack / reading_guide / case_lab / slide_outline / review_sheet）

### 学习路径增强
- [x] 每阶段 `recommended_resource_ids` / `estimated_days` / `priority_reason`
- [x] 推荐面板：`today_resources`（5 个 ID）/ `next_action` / `risk_adjustments`
- [x] 推荐规则（本地规则：画像风险 + 时间 + 基础水平）

### Tutor 答疑
- [x] `POST /v1/learning/sessions/{id}/tutor` + `LearningTutorRequest` schema
- [x] concept→module 知识图谱匹配（`_extract_core_name` + `_has_word_overlap`）
- [x] 中文概念命中回归测试（3 tests）
- [x] 前端 `tutorLearningSession` API client + `LearningTutorResponse` 类型

### 其他
- [x] Agent runs 7 条（curator-slide 去重）
- [x] 34 tests 全部通过

## Phase 4：演示工作台 UI ✅

### 信息架构
- [x] 四视图 Tab（总览/资源/路径/评估）
- [x] 构建画像后默认「总览」；生成资源包后默认「资源」
- [x] `LearningDetailDrawer` 通用抽屉（桌面右侧滑出 / 移动端 bottom sheet，独立滚动）

### 资源展示
- [x] `ResourceTile` 资源小方块（图标、类型、标题、一行摘要、时间、safety 状态点）
- [x] 资源列表不再直接渲染 Markdown
- [x] 点击 ResourceTile → 抽屉展示完整 Markdown + source_refs + safety_review

### 减冗余
- [x] 画像主页 8 维标签 + 值（evidence 进抽屉）
- [x] 路径主页阶段名 + 目标 + 交付物数（study_plan/coach_tip 进抽屉）
- [x] 评估主页信号数 + 问题数 + 等级（rubric 进抽屉）
- [x] 课程模块列表默认收起
- [x] 智能体执行明细默认收起

### Tutor 入口
- [x] 资源视图顶部 tutor 输入框
- [x] Markdown 答复 + 关联资源可点击卡片 + confidence
- [x] 无 session 时禁用并提示

### 验证
- [x] TypeScript 0 errors
- [x] 前端 build 成功
- [x] 后端 38 tests 全部通过
