from __future__ import annotations


def test_todo_flow_overview_should_aggregate_all_tasks(client):
    new_task = client.post(
        "/v1/tasks",
        json={"name": "深度学习", "desc": "模型训练", "task_color": "#1f5f7a"},
    ).json()["data"]
    task_id = new_task["task_id"]

    global_todo = client.post(
        "/v1/todos",
        json={"task_id": 1, "title": "复盘", "description": "晚间复盘", "due_date": "2026-04-15"},
    )
    assert global_todo.status_code == 200
    assert global_todo.json()["data"]["task_id"] == 0
    todo_id = global_todo.json()["data"]["id"]

    task_todo = client.post(
        "/v1/todos",
        json={"task_id": task_id, "title": "阅读论文", "description": "", "due_date": "2026-04-15"},
    )
    assert task_todo.status_code == 200

    updated = client.patch(f"/v1/todos/{todo_id}", json={"completed": True})
    assert updated.status_code == 200
    assert updated.json()["data"]["completed"] is True

    overview_stats = client.get("/v1/todos/stats", params={"task_id": 1, "target_date": "2026-04-15"})
    assert overview_stats.status_code == 200
    assert overview_stats.json()["data"]["total"] >= 2

    overview_list = client.get("/v1/todos", params={"task_id": 1})
    assert overview_list.status_code == 200
    assert len(overview_list.json()["data"]) >= 2


def test_focus_flow_overview_should_aggregate_and_disallow_direct_record(client):
    new_task = client.post(
        "/v1/tasks",
        json={"name": "算法练习", "desc": "题目训练", "task_color": "#245f4a"},
    ).json()["data"]
    task_id = new_task["task_id"]

    blocked = client.post(
        "/v1/focus/sessions",
        json={"task_id": 1, "start_time": "2026-04-14T08:30:00", "duration_seconds": 1200},
    )
    assert blocked.status_code == 400
    assert blocked.json()["error"]["code"] == "BAD_REQUEST"

    created = client.post(
        "/v1/focus/sessions",
        json={"task_id": task_id, "start_time": "2026-04-14T08:30:00", "duration_seconds": 1500},
    )
    assert created.status_code == 200

    stats = client.get("/v1/focus/stats", params={"task_id": 1, "target_date": "2026-04-14"})
    assert stats.status_code == 200
    assert stats.json()["data"]["todaySeconds"] >= 1500

    timeline = client.get("/v1/focus/sessions", params={"task_id": 1, "start_date": "2026-04-14", "end_date": "2026-04-14"})
    assert timeline.status_code == 200
    assert len(timeline.json()["data"]) >= 1
