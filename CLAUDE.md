# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

EveryDayPerfect (EDP) 是一个个人任务管理与复盘工具，优先 Windows 环境，兼容 macOS/Linux。当前重点是 Phase 6：AI 算法竞赛训练智能体（Contest 模块）。

- **前端:** Vite + React 18 + TypeScript + Tailwind CSS 3
- **后端:** FastAPI + SQLite（原生 `sqlite3`，无 ORM）
- **共享包:** `packages/core`（业务逻辑）、`packages/data`（数据仓库）、`packages/ui`（通用组件）
- **AI:** 通过 `httpx` 调用 OpenAI 兼容 API（已对接 DeepSeek）

## 常用命令

```bash
# 启动全部服务（后端 :18765，前端 :5173）
./start_dev.sh

# 局域网 / 手机访问
./start_mobile.sh

# 停止全部服务
./stop_dev.sh

# 仅前端
cd frontend && npm run dev

# 前端测试
cd frontend && npm test

# 仅后端
cd backend && python run.py
# 或：cd backend && uvicorn app.main:app --port 18765

# 后端测试
cd backend && python -m pytest

# 单个测试文件
cd backend && python -m pytest tests/test_learning.py -v

# 验证后端是否正常
curl http://127.0.0.1:18765/health
```

## 架构

### 请求链路

```
React (App.tsx 各选项卡) → api/client.ts (axios) → FastAPI 路由 (app/api/*.py) → 业务层 (app/services/*.py) → 数据库 (app/db.py)
```

- `App.tsx` 有 7 个选项卡：Records、Todos、Time、Stats、Plans、Learning、Contest，每个选项卡由 `frontend/src/features/` 下对应的 feature 组件渲染
- 所有 API 响应使用统一封包格式：`{success: bool, data: ..., error: {code, message} | null}`，定义在 `app/response.py`
- `client.ts` 中的 `api` 对象通过 `unwrap()` 封装所有请求，自动检查 `success` 并提取 `data`

### 后端模块对照

| 路由 (`app/api/`) | 业务层 (`app/services/`) | 职责 |
|---|---|---|
| `tasks.py` | `task_service.py` | 任务增删改查 + 属性关联 |
| `records.py` | `record_service.py` | 每日数据记录 |
| `todos.py` | `todo_service.py` | 待办事项 |
| `focus.py` | `focus_service.py` | 专注/番茄钟计时 |
| `home.py` | `home_service.py` | 指挥中心仪表盘 + 结算 |
| `ai_settings.py` | `ai_settings_service.py` | AI 供应商配置管理 |
| `misc.py` | `ai_summary_service.py` | AI 总结生成、健康检查 |
| `learning.py` | `learning_agent_service.py` | 学习工作室（会话、画像、导师） |
| `contest.py` | `contest/service.py` | 竞赛训练（题目导入、WA 诊断、对拍） |
| `plans.py` | `plan_service.py` | 长期计划（导入、滚动展开、对拍、复盘） |

### Plans 模块 (`app/repositories/plan_repository.py` + `app/services/plan_service.py` + `app/api/plans.py`)

年度路线导入与执行追踪，核心特点：

- **导入**：AI 从 Markdown 路线文本提取 4 阶段骨架，本地规则兜底。生成最近 14 天详细步骤（滚动展开），其余保留为周级摘要
- **进度计算**：主指标是**任务完成度**（`completion_rate`），基于 `progress_weight` 的加权完成率。辅助指标为工作量完成度（`workload_completion_rate`）和已耗时
- **步骤完成**：可直接点击勾选完成，耗时记录为可选。完成不会因计时自动触发
- **复盘（weekly review）**：周末或详细步骤不足 7 天时自动提醒。复盘生成重排预览（拆分过大的步骤、重新调度），用户确认后应用为新版本。预填统计数据，同一计划刷新时不覆盖用户输入
- **数据库表**：`plans`、`plan_revisions`、`plan_step_states`、`plan_time_logs`、`plan_goal_bindings`、`plan_reviews`、`app_migrations`
- **计时链路**：`POST /v1/focus/sessions`（带 `plan_id + step_id`）→ `FocusService` → `TimeLedgerRepository.record_session` → 自动创建 `plan_time_logs` 关联 + 设 `plan_step_states.status = 'in_progress'`

### Contest 模块 (`app/contest/`)

三个文件构成竞赛流程：

- **`models.py`** — `ProblemSnapshot`、`SubmissionSnapshot`、`AbilityProfile` 数据类
- **`runner.py`** — C++ 编译与执行，含源码审计、资源限制、可选的 macOS sandbox。`run_samples()` 跑样例、`run_hack()` 跑对拍。编译器自动探测（可通过 `EDP_CXX_COMPILER` 环境变量覆盖）
- **`service.py`** — 总调度：CF 题目抓取（元数据 API + HTML 解析）、AI 审题、SSE 流式诊断（样例执行 → 规则检查 → LLM 分析 → 可选暴力对拍）

### 数据库 (`app/db.py`)

通过 `Database` 类操作单文件 SQLite，`session()` 上下文管理器返回 `sqlite3.Row` 字典。共 14 张表，分属 5 个模块：

- 任务管理：`task_main`、`task_attr`、`task_data`、`task_attr_relation`
- 效率工具：`todo_items`、`focus_sessions`
- 学习：`learning_sessions`、`learning_profile_versions`、`learning_resource_packages`、`learning_agent_runs`
- 长期计划：`plans`、`plan_revisions`、`plan_step_states`、`plan_time_logs`、`plan_goal_bindings`、`plan_reviews`、`app_migrations`
- 竞赛：`contest_problems`
- AI：`ai_summary_cache`

### 配置 (`app/config.py`)

`Settings` 数据类，从环境变量加载：`TASK_DB_PATH`、`CORS_ORIGINS`、`FRONTEND_DIST_PATH`、`AI_CONFIG_PATH`。

### 前端关键文件

- `src/api/client.ts` — Axios 客户端，`API_BASE_URL` 解析逻辑（处理 localhost、局域网、桌面端/pywebview 运行时），`api` 对象包含全部接口
- `src/App.tsx` — 选项卡导航、任务选择状态、计时器、全部弹窗
- `src/features/plans/PlansTab.tsx` — 长期计划界面（导入、路线、进度、复盘四视图；步骤本地完成/重新打开；去 Time 记录耗时）
- `src/features/plans/planUtils.ts` — Plans 工具函数（日期格式化、步骤收集、快照更新）
- `src/features/contest/ContestTab.tsx` — 竞赛界面（题目导入、代码编辑器含 localStorage 草稿缓存、SSE 流式诊断进度面板）
- `src/lib/` — 工具函数：`ai.ts`、`aiHistory.ts`、`cn.ts`（Tailwind class 合并）、`format.ts`、`learningStudio.ts`、`period.ts`、`theme.ts`

### 共享包

- `packages/core/src/` — `usecases.ts`、`schedule.ts`、`types.ts`、`repository.ts`（接口定义）
- `packages/data/src/` — `httpRepository.ts`、`sqliteLocalRepository.ts`（接口实现）
- `packages/ui/src/` — `Button.tsx`、`Card.tsx`、`SegmentedTabs.tsx`、`StatWidget.tsx`

## 编码约定

- Python：所有文件使用 `from __future__ import annotations`。类型标注用 `| None`，不用 `Optional`
- 数据库访问：始终使用 `with self.session() as conn:` 模式。`conn.row_factory = sqlite3.Row` 已设置，查询结果可像字典一样访问
- SQLite 中的 JSON：`tags`、`samples`、`prerequisites` 等字段以 JSON 字符串存储。读取时用 `json.loads()` 解析，必须包裹 try/except
- 前端 API 调用：始终通过 `client.ts` 中的 `api` 对象，不要直接调用 `axios` 或 `fetch`（唯一的例外是 SSE 流式请求，使用原生 `fetch`）
- C++ runner 安全：runner 有源码预检（拦截 `system`、`fork`、`exec`、`socket` 等）+ OS 资源限制 + 可选的 sandbox-exec。**这不是安全沙箱**，只应运行可信代码

## 关键约束

- 不引入外部 HTML 解析库：CF 题目页面抓取使用 Python 标准库 `html.parser`
- LLM 调用统一使用 `app/services/llm.py` 中的 `call_llm()`，最低超时 300 秒（SSE 心跳防止连接断开）
- `parse_json_safe()` 通过括号计数处理 LLM 返回的 JSON（支持 markdown 代码块包裹和任意嵌套层级）
- `EDP_CXX_COMPILER` 环境变量可覆盖编译器自动探测结果
- 前端 `VITE_API_BASE_URL` 环境变量指定后端地址（由 `start_dev.sh` 自动设置）
- `TimeLedgerRepository` 是计时写入的唯一入口：`focus_sessions` + `task_data` + `plan_time_logs` + `plan_step_states` 在同一事务中写入
- Plans 组件挂载时有竞态保护（`mountedRef`）：`refresh()` 完成 → `selectedPlanId` 确定后才触发 `loadSelection()`
