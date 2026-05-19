from __future__ import annotations


def test_learning_workbench_exposes_courses_and_agents(client):
    response = client.get("/v1/learning/workbench")
    assert response.status_code == 200
    payload = response.json()["data"]

    assert len(payload["courses"]) >= 3
    assert len(payload["agents"]) >= 6
    assert payload["feature_flags"]["resource_package"] is True


def test_learning_profile_builds_multi_dimension_profile(client):
    response = client.post(
        "/v1/learning/profile",
        json={
            "course_id": "data_structures",
            "conversation": "我正在准备期末，数据结构之前学过一点，但树和图总是看不懂，希望能通过例题和脑图把主线理清楚。",
            "preferred_goal": "先过考试，再补应用能力",
            "weekly_days": 4,
            "daily_minutes": 60,
        },
    )
    assert response.status_code == 200
    payload = response.json()["data"]

    assert payload["profile"]["overview"]
    assert len(payload["profile"]["dimensions"]) >= 6
    assert len(payload["profile"]["focus_modules"]) >= 3
    assert len(payload["profile"]["follow_up_questions"]) >= 3


def test_learning_resource_package_contains_five_plus_resources(client):
    response = client.post(
        "/v1/learning/resource-package",
        json={
            "course_id": "advanced_math",
            "conversation": "我在准备高数期末，基础一般，积分和多元函数总是混，时间比较碎片，希望用讲解加例题的方式稳定提分。",
            "preferred_goal": "期末提分",
            "weekly_days": 3,
            "daily_minutes": 45,
        },
    )
    assert response.status_code == 200
    payload = response.json()["data"]

    assert payload["package"]["resource_count"] >= 5
    assert len(payload["package"]["resources"]) >= 5
    assert len(payload["package"]["learning_path"]) == 3
    assert len(payload["package"]["agent_runs"]) >= 6
    assert len(payload["package"]["evaluation"]["mastery_signals"]) >= 3
