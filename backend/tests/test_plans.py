from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta


SOURCE_TEXT = """
# 以本科就业为目标的 1 年 AI 应用工程师学习路径

# 第 1—2 个月：先补后端基本功
- Python 类型标注与 pytest
- FastAPI、PostgreSQL、Redis
- 产出 AI 问答后端雏形

# 第 3 个月：机器学习与深度学习基础
- sklearn 分类任务
- Attention Demo

# 第 4—5 个月：LLM 应用核心
- Structured Output 与 Tool Calling
- 多模型 AI Chat 平台

# 第 6—7 个月：主攻 RAG
- 文档解析、Embedding、Hybrid Search
- 企业知识库 RAG 系统

# 第 8 个月：Agent 和工作流
- LangGraph 与 Human-in-the-loop
- AI 周期任务管理 Agent

# 第 9 个月：工程化和部署
- Docker Compose、Nginx、日志与安全

# 第 10 个月：微调和模型部署
- LoRA、vLLM 与量化

# 第 11—12 个月：简历、面试、投递
- 整理三个项目与 README
- 算法、计算机基础和 AI 应用面试
"""


def _import_payload() -> dict:
    start = date.today()
    return {
        "source_text": SOURCE_TEXT,
        "title": "AI 应用工程师一年计划",
        "goal": "一年后具备 AI 应用工程师求职能力",
        "start_date": start.isoformat(),
        "target_end_date": (start + timedelta(days=365)).isoformat(),
        "preferred_weekdays": [1, 2, 3, 4, 5, 6],
        "daily_minutes": 180,
    }


def _import_plan(client) -> dict:
    response = client.post("/v1/plans/import", json=_import_payload())
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _all_steps(snapshot: dict) -> list[dict]:
    return [
        step
        for phase in snapshot["phases"]
        for milestone in phase["milestones"]
        for goal in milestone["weekly_goals"]
        for step in goal["steps"]
    ]


def test_import_plan_builds_four_phases_and_rolling_horizon(client):
    data = _import_plan(client)
    assert data["plan"]["status"] == "draft"
    assert data["mode_used"] == "local_rules"
    assert data["fallback_reason"] == "未配置可用的 AI 服务"
    assert data["snapshot"]["generation"]["mode_used"] == "local_rules"
    assert len(data["snapshot"]["phases"]) == 4

    steps = _all_steps(data["snapshot"])
    assert steps
    assert data["snapshot"]["schema_version"] == 2
    assert all("evidence_required" not in item and "evidence_prompt" not in item for item in steps)
    start = date.fromisoformat(data["plan"]["start_date"])
    assert all(date.fromisoformat(item["scheduled_date"]) <= start + timedelta(days=13) for item in steps)
    assert all(1 <= item["estimated_minutes"] <= 240 for item in steps)

    distant_goals = [
        goal
        for phase in data["snapshot"]["phases"]
        for milestone in phase["milestones"]
        for goal in milestone["weekly_goals"]
        if date.fromisoformat(goal["window_start"]) > start + timedelta(days=20)
    ]
    assert distant_goals
    assert all(goal["expanded"] is False and goal["steps"] == [] for goal in distant_goals)


def test_plan_task_is_created_only_when_draft_is_activated(client):
    before = client.get("/v1/tasks").json()["data"]
    imported = _import_plan(client)
    draft = imported["plan"]

    assert draft["task_binding_mode"] == "create"
    assert draft["task_id"] is None
    assert len(client.get("/v1/tasks").json()["data"]) == len(before)

    activated = client.post(f"/v1/plans/{draft['id']}/activate").json()["data"]
    assert activated["plan"]["task_id"] is not None
    assert activated["plan"]["task_name"] == draft["task_name_draft"]
    assert activated["plan"]["owns_task"] is True

    expanded_goals = [
        goal
        for phase in activated["snapshot"]["phases"]
        for milestone in phase["milestones"]
        for goal in milestone["weekly_goals"]
        if goal["expanded"]
    ]
    assert expanded_goals
    assert all(goal["timer_attr_id"] for goal in expanded_goals)
    assert all(
        step["timer_attr_id"] == goal["timer_attr_id"]
        for goal in expanded_goals
        for step in goal["steps"]
    )


def test_plan_can_bind_existing_task_or_prepare_custom_task_name(client):
    existing = client.post(
        "/v1/tasks",
        json={"name": "已有学习项目", "desc": "", "task_color": "#2563EB"},
    ).json()["data"]

    existing_payload = _import_payload()
    existing_payload["task_binding"] = {"mode": "existing", "task_id": existing["task_id"]}
    bound = client.post("/v1/plans/import", json=existing_payload).json()["data"]
    activated = client.post(f"/v1/plans/{bound['plan']['id']}/activate").json()["data"]
    assert activated["plan"]["task_id"] == existing["task_id"]
    assert activated["plan"]["owns_task"] is False

    custom_payload = _import_payload()
    custom_payload["title"] = "另一份计划"
    custom_payload["task_binding"] = {"mode": "create", "task_name": "自定义基础任务"}
    custom = client.post("/v1/plans/import", json=custom_payload).json()["data"]
    assert custom["plan"]["task_name_draft"] == "自定义基础任务"


def test_task_bound_to_plan_cannot_be_deleted(client):
    imported = _import_plan(client)
    activated = client.post(f"/v1/plans/{imported['plan']['id']}/activate").json()["data"]

    deleted = client.delete(f"/v1/tasks/{activated['plan']['task_id']}")
    assert deleted.status_code == 409
    assert "绑定长期计划" in deleted.json()["error"]["message"]


def test_import_bounds_ai_wait_and_falls_back_to_local_rules(client, monkeypatch):
    from app.services import plan_service

    saved = client.put(
        "/v1/ai/settings",
        json={
            "mode": "cloud",
            "provider_id": "openai",
            "provider_configs": {
                "openai": {
                    "api_key_input": "sk-test",
                    "base_url": "https://api.openai.com/v1",
                    "model_name": "gpt-test",
                }
            },
        },
    )
    assert saved.status_code == 200

    def fake_call_llm(*args, **kwargs):
        assert kwargs["timeout_seconds"] == 20
        return None

    monkeypatch.setattr(plan_service, "call_llm", fake_call_llm)
    response = client.post("/v1/plans/import", json=_import_payload())

    assert response.status_code == 200
    assert response.json()["data"]["mode_used"] == "local_rules"
    assert response.json()["data"]["fallback_reason"] == "AI 调用在 20 秒内未成功返回"


def test_import_reports_when_ai_outline_is_used(client, monkeypatch):
    from app.services import plan_service

    saved = client.put(
        "/v1/ai/settings",
        json={
            "mode": "cloud",
            "provider_id": "openai",
            "provider_configs": {
                "openai": {
                    "api_key_input": "sk-test",
                    "base_url": "https://api.openai.com/v1",
                    "model_name": "gpt-test",
                }
            },
        },
    )
    assert saved.status_code == 200

    phases = [
        {"title": f"AI 阶段 {index}", "objective": f"阶段目标 {index}", "milestones": []}
        for index in range(1, 5)
    ]
    monkeypatch.setattr(plan_service, "call_llm", lambda *args, **kwargs: json.dumps({"phases": phases}))

    response = client.post("/v1/plans/import", json=_import_payload())
    data = response.json()["data"]

    assert response.status_code == 200
    assert data["mode_used"] == "model"
    assert data["fallback_reason"] is None
    assert data["snapshot"]["phases"][0]["title"] == "AI 阶段 1"


def test_plan_completion_does_not_require_prior_time_log(client):
    imported = _import_plan(client)
    plan_id = imported["plan"]["id"]
    activated = client.post(f"/v1/plans/{plan_id}/activate")
    assert activated.status_code == 200

    steps = _all_steps(activated.json()["data"]["snapshot"])
    step = steps[0]

    # 无需记录耗时即可直接完成
    completed = client.post(
        f"/v1/plans/{plan_id}/steps/{step['step_id']}/complete",
        json={},
    )
    assert completed.status_code == 200, completed.text
    detail = completed.json()["data"]["plan"]
    assert detail["progress"]["completion_rate"] > 0
    assert detail["progress"]["completed_steps"] == 1

    # 耗时可选：补记应生效
    reopened = client.post(f"/v1/plans/{plan_id}/steps/{step['step_id']}/reopen")
    assert reopened.status_code == 200
    assert reopened.json()["data"]["plan"]["progress"]["completion_rate"] == 0

    completed_with_time = client.post(
        f"/v1/plans/{plan_id}/steps/{step['step_id']}/complete",
        json={"actual_minutes": 30},
    )
    assert completed_with_time.status_code == 200
    detail2 = completed_with_time.json()["data"]["plan"]
    assert detail2["progress"]["completion_rate"] > 0
    assert detail2["progress"]["actual_seconds"] == 30 * 60


def test_timer_log_and_dashboard_are_plan_scoped(client):
    imported = _import_plan(client)
    plan_id = imported["plan"]["id"]
    detail = client.post(f"/v1/plans/{plan_id}/activate").json()["data"]
    step = _all_steps(detail["snapshot"])[0]

    logged = client.post(
        f"/v1/plans/{plan_id}/time-logs",
        json={
            "step_id": step["step_id"],
            "start_time": f"{step['scheduled_date']}T08:00:00",
            "duration_seconds": 600,
            "source": "timer",
            "note": "专注学习",
        },
    )
    assert logged.status_code == 200, logged.text

    dashboard = client.get("/v1/plans/dashboard", params={"date": step["scheduled_date"], "plan_id": plan_id})
    assert dashboard.status_code == 200
    today_ids = {item["step_id"] for item in dashboard.json()["data"]["today"]}
    assert step["step_id"] in today_ids


def test_plan_time_uses_one_focus_session_and_updates_all_aggregates(client):
    imported = _import_plan(client)
    plan_id = imported["plan"]["id"]
    detail = client.post(f"/v1/plans/{plan_id}/activate").json()["data"]
    step = _all_steps(detail["snapshot"])[0]
    task_id = detail["plan"]["task_id"]

    recorded = client.post(
        "/v1/focus/sessions",
        json={
            "task_id": task_id,
            "attr_id": step["timer_attr_id"],
            "plan_id": plan_id,
            "step_id": step["step_id"],
            "start_time": f"{step['scheduled_date']}T08:00:00",
            "record_date": step["scheduled_date"],
            "duration_seconds": 900,
            "note": step["title"],
        },
    )
    assert recorded.status_code == 200, recorded.text

    sessions = client.get("/v1/focus/sessions", params={"task_id": task_id}).json()["data"]
    assert len(sessions) == 1
    assert sessions[0]["attr_id"] == step["timer_attr_id"]
    assert sessions[0]["source_type"] == "plan_step"

    records = client.get(
        f"/v1/tasks/{task_id}/records",
        params={"start_date": step["scheduled_date"], "end_date": step["scheduled_date"]},
    ).json()["data"]
    values = {item["attr_id"]: item["data_value"] for item in records}
    assert values[step["timer_attr_id"]] == 900
    assert values[4] == 900

    task_stats = client.get("/v1/focus/stats", params={"task_id": task_id, "target_date": step["scheduled_date"]}).json()["data"]
    global_stats = client.get("/v1/focus/stats", params={"target_date": step["scheduled_date"]}).json()["data"]
    assert task_stats["todaySeconds"] == 900
    assert global_stats["todaySeconds"] == 900

    refreshed = client.get(f"/v1/plans/{plan_id}").json()["data"]
    refreshed_step = next(item for item in _all_steps(refreshed["snapshot"]) if item["step_id"] == step["step_id"])
    assert refreshed_step["actual_seconds"] == 900
    assert refreshed["progress"]["actual_seconds"] == 900


def test_direct_time_on_plan_attr_counts_goal_but_not_step(client):
    imported = _import_plan(client)
    plan_id = imported["plan"]["id"]
    detail = client.post(f"/v1/plans/{plan_id}/activate").json()["data"]
    step = _all_steps(detail["snapshot"])[0]

    response = client.post(
        "/v1/focus/sessions",
        json={
            "task_id": detail["plan"]["task_id"],
            "attr_id": step["timer_attr_id"],
            "start_time": f"{step['scheduled_date']}T09:00:00",
            "record_date": step["scheduled_date"],
            "duration_seconds": 600,
        },
    )
    assert response.status_code == 200

    refreshed = client.get(f"/v1/plans/{plan_id}").json()["data"]
    refreshed_step = next(item for item in _all_steps(refreshed["snapshot"]) if item["step_id"] == step["step_id"])
    assert refreshed_step["actual_seconds"] == 0
    assert refreshed["progress"]["actual_seconds"] == 600

    completed = client.post(f"/v1/plans/{plan_id}/steps/{step['step_id']}/complete", json={})
    assert completed.status_code == 200


def test_review_creates_preview_and_only_changes_revision_after_apply(client):
    imported = _import_plan(client)
    plan_id = imported["plan"]["id"]
    client.post(f"/v1/plans/{plan_id}/activate")

    created = client.post(
        f"/v1/plans/{plan_id}/reviews",
        json={
            "review_date": date.today().isoformat(),
            "summary": "第一周按计划推进",
            "blockers": "周末时间减少",
            "next_week_minutes": 120,
        },
    )
    assert created.status_code == 200, created.text
    review = created.json()["data"]
    assert review["status"] == "pending"
    assert "snapshot" in review["proposal"]
    assert any(change["type"] == "split" for change in review["proposal"]["changes"])

    proposal_steps = _all_steps(review["proposal"]["snapshot"])
    horizon_end = date.fromisoformat(review["proposal"]["snapshot"]["horizon_end"])
    scheduled = [step for step in proposal_steps if date.fromisoformat(step["scheduled_date"]) <= horizon_end]
    daily_load: dict[str, int] = {}
    for step in scheduled:
        assert step["estimated_minutes"] <= 120
        day = step["scheduled_date"]
        daily_load[day] = daily_load.get(day, 0) + step["estimated_minutes"]
    assert all(minutes <= 120 for minutes in daily_load.values())

    before = client.get(f"/v1/plans/{plan_id}").json()["data"]
    assert before["plan"]["active_revision"] == 1

    applied = client.post(f"/v1/plans/{plan_id}/reviews/{review['id']}/apply")
    assert applied.status_code == 200, applied.text
    assert applied.json()["data"]["revision"] == 2
    after = applied.json()["data"]["plan"]
    assert after["plan"]["active_revision"] == 2
    assert len(after["revisions"]) == 2


def test_review_split_preserves_task_weight_and_completion_rate(client):
    imported = _import_plan(client)
    plan_id = imported["plan"]["id"]
    detail = client.post(f"/v1/plans/{plan_id}/activate").json()["data"]
    step = _all_steps(detail["snapshot"])[0]

    client.post(
        "/v1/focus/sessions",
        json={
            "task_id": detail["plan"]["task_id"],
            "attr_id": step["timer_attr_id"],
            "plan_id": plan_id,
            "step_id": step["step_id"],
            "start_time": f"{step['scheduled_date']}T08:00:00",
            "record_date": step["scheduled_date"],
            "duration_seconds": 600,
        },
    )
    completed = client.post(f"/v1/plans/{plan_id}/steps/{step['step_id']}/complete", json={}).json()["data"]["plan"]
    before_weight = completed["progress"]["total_task_weight"]
    before_rate = completed["progress"]["completion_rate"]

    review = client.post(
        f"/v1/plans/{plan_id}/reviews",
        json={
            "review_date": date.today().isoformat(),
            "summary": "继续推进",
            "blockers": "",
            "next_week_minutes": 120,
        },
    ).json()["data"]
    applied = client.post(f"/v1/plans/{plan_id}/reviews/{review['id']}/apply").json()["data"]["plan"]

    assert applied["progress"]["total_task_weight"] == before_weight
    assert applied["progress"]["completion_rate"] == before_rate
    for phase in applied["snapshot"]["phases"]:
        for milestone in phase["milestones"]:
            for goal in milestone["weekly_goals"]:
                if goal["steps"]:
                    assert abs(sum(item["progress_weight"] for item in goal["steps"]) - goal["progress_weight"]) < 1e-6


def test_review_status_prompts_on_weekend_or_short_coverage_and_prefills(client):
    imported = _import_plan(client)
    plan_id = imported["plan"]["id"]
    detail = client.post(f"/v1/plans/{plan_id}/activate").json()["data"]
    start = date.fromisoformat(detail["plan"]["start_date"])
    saturday = start + timedelta(days=(6 - start.isoweekday()) % 7)

    weekend = client.get(
        f"/v1/plans/{plan_id}", params={"date": saturday.isoformat()}
    ).json()["data"]["review_status"]
    assert weekend["due"] is True
    assert "week_end" in weekend["reasons"]

    short_day = start + timedelta(days=12)
    short_coverage = client.get(
        f"/v1/plans/{plan_id}", params={"date": short_day.isoformat()}
    ).json()["data"]["review_status"]
    assert short_coverage["due"] is True
    assert "coverage_low" in short_coverage["reasons"]
    assert short_coverage["detailed_days_remaining"] < 7

    step = _all_steps(detail["snapshot"])[0]
    client.post(
        "/v1/focus/sessions",
        json={
            "task_id": detail["plan"]["task_id"],
            "attr_id": step["timer_attr_id"],
            "plan_id": plan_id,
            "step_id": step["step_id"],
            "start_time": f"{step['scheduled_date']}T08:00:00",
            "record_date": step["scheduled_date"],
            "duration_seconds": 900,
        },
    )
    prefill = client.get(
        f"/v1/plans/{plan_id}", params={"date": step["scheduled_date"]}
    ).json()["data"]["review_status"]["prefill"]
    assert prefill["actual_seconds"] == 900
    assert prefill["planned_steps"] > 0

    review = client.post(
        f"/v1/plans/{plan_id}/reviews",
        json={
            "review_date": saturday.isoformat(),
            "summary": weekend["prefill"]["summary"],
            "blockers": weekend["prefill"]["blockers"],
            "next_week_minutes": weekend["prefill"]["next_week_minutes"],
        },
    ).json()["data"]
    reviewed = client.get(
        f"/v1/plans/{plan_id}", params={"date": saturday.isoformat()}
    ).json()["data"]["review_status"]
    assert reviewed["due"] is False
    assert reviewed["reviewed_this_week"] is True
    assert reviewed["pending_review_id"] == review["id"]


def test_review_creates_timer_attrs_for_newly_expanded_goals(client):
    imported = _import_plan(client)
    plan_id = imported["plan"]["id"]
    client.post(f"/v1/plans/{plan_id}/activate")

    review = client.post(
        f"/v1/plans/{plan_id}/reviews",
        json={
            "review_date": (date.today() + timedelta(days=7)).isoformat(),
            "summary": "继续推进",
            "blockers": "",
            "next_week_minutes": 180,
        },
    ).json()["data"]
    applied = client.post(f"/v1/plans/{plan_id}/reviews/{review['id']}/apply")
    assert applied.status_code == 200

    detail = applied.json()["data"]["plan"]
    expanded = [
        goal
        for phase in detail["snapshot"]["phases"]
        for milestone in phase["milestones"]
        for goal in milestone["weekly_goals"]
        if goal["expanded"]
    ]
    assert expanded
    assert all(goal["timer_attr_id"] for goal in expanded)


def test_draft_can_be_edited_before_activation(client):
    imported = _import_plan(client)
    plan_id = imported["plan"]["id"]
    snapshot = imported["snapshot"]
    first_step = _all_steps(snapshot)[0]
    first_step["title"] = "先搭建 Python 开发环境"
    first_step["estimated_minutes"] = 90

    updated = client.put(f"/v1/plans/{plan_id}/draft", json={"snapshot": snapshot})
    assert updated.status_code == 200, updated.text
    stored_step = _all_steps(updated.json()["data"]["snapshot"])[0]
    assert stored_step["title"] == "先搭建 Python 开发环境"
    assert stored_step["estimated_minutes"] == 90


def test_legacy_plan_logs_migrate_once_into_focus_ledger(tmp_path):
    from app.db import Database

    db_path = tmp_path / "legacy-plans.db"
    snapshot = {
        "schema_version": 1,
        "generated_at": "2026-07-04T00:00:00Z",
        "horizon_end": "2026-07-17",
        "phases": [
            {
                "phase_id": "p1",
                "title": "阶段",
                "milestones": [
                    {
                        "milestone_id": "m1",
                        "title": "里程碑",
                        "weekly_goals": [
                            {
                                "goal_id": "g1",
                                "title": "第一周",
                                "window_start": "2026-07-04",
                                "window_end": "2026-07-10",
                                "estimated_minutes": 120,
                                "expanded": True,
                                "steps": [
                                    {
                                        "step_id": "s1",
                                        "title": "旧步骤",
                                        "scheduled_date": "2026-07-04",
                                        "estimated_minutes": 120,
                                    }
                                ],
                            }
                        ],
                    }
                ],
            }
        ],
    }
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE focus_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                start_time DATETIME NOT NULL,
                duration_seconds INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE plans (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, goal TEXT DEFAULT '',
                source_text TEXT NOT NULL, start_date TEXT NOT NULL,
                target_end_date TEXT NOT NULL, preferred_weekdays_json TEXT NOT NULL,
                daily_minutes INTEGER NOT NULL, status TEXT NOT NULL,
                active_revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE plan_revisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT NOT NULL,
                version INTEGER NOT NULL, reason TEXT NOT NULL,
                plan_json TEXT NOT NULL, created_at TEXT NOT NULL,
                UNIQUE(plan_id, version)
            );
            CREATE TABLE plan_time_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT NOT NULL,
                step_id TEXT NOT NULL, start_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL, source TEXT NOT NULL,
                note TEXT DEFAULT '', created_at TEXT NOT NULL
            );
            """
        )
        conn.execute(
            "INSERT INTO plans VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "legacy-plan", "旧年度计划", "迁移目标", "legacy", "2026-07-04", "2027-07-04",
                "[1,2,3,4,5]", 120, "active", 1, "2026-07-04T00:00:00Z", "2026-07-04T00:00:00Z",
            ),
        )
        conn.execute(
            "INSERT INTO plan_revisions (plan_id, version, reason, plan_json, created_at) VALUES (?, 1, 'import', ?, ?)",
            ("legacy-plan", json.dumps(snapshot, ensure_ascii=False), "2026-07-04T00:00:00Z"),
        )
        conn.execute(
            "INSERT INTO plan_time_logs (plan_id, step_id, start_time, duration_seconds, source, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("legacy-plan", "s1", "2026-07-04T08:00:00", 600, "timer", "旧记录", "2026-07-04T08:10:00Z"),
        )

    db = Database(db_path)
    db.ensure_schema()
    db.ensure_schema()

    with db.session() as conn:
        plan = conn.execute("SELECT task_id FROM plans WHERE id = 'legacy-plan'").fetchone()
        sessions = conn.execute("SELECT * FROM focus_sessions").fetchall()
        links = conn.execute("SELECT * FROM plan_time_logs").fetchall()
        focus_total = conn.execute(
            "SELECT data_value FROM task_data WHERE task_id = ? AND attr_id = 4 AND record_date = '2026-07-04'",
            (plan["task_id"],),
        ).fetchone()

    assert plan["task_id"] is not None
    assert len(sessions) == 1
    assert sessions[0]["source_type"] == "plan_step"
    assert len(links) == 1
    assert links[0]["focus_session_id"] == sessions[0]["id"]
    assert focus_total["data_value"] == 600
