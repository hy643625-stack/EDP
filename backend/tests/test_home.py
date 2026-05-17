from __future__ import annotations

from datetime import date, timedelta


def _create_task(client, name: str, color: str = "#2563EB") -> int:
    created = client.post(
        "/v1/tasks",
        json={"name": name, "desc": f"{name} desc", "task_color": color},
    )
    assert created.status_code == 200
    return int(created.json()["data"]["task_id"])


def _create_attr(client, task_id: int, attr_name: str, *, target_value: float = 10, calc_config: str = "{}") -> int:
    created = client.post(
        f"/v1/tasks/{task_id}/attrs",
        json={
            "attr_name": attr_name,
            "display_order": 10,
            "attr_sign": 0,
            "attr_record": 1,
            "target_value": target_value,
            "unit": "次",
            "calc_type": "10010000",
            "calc_config": calc_config,
            "weight": 1,
        },
    )
    assert created.status_code == 200
    return int(created.json()["data"]["attr_id"])


def _upsert_record(client, task_id: int, attr_id: int, record_date: str, value: float) -> None:
    res = client.put(
        f"/v1/tasks/{task_id}/records/{record_date}",
        json={"values": [{"attr_id": attr_id, "value": value}]},
    )
    assert res.status_code == 200


def _input_type_calc_config(input_type: str, *, period_start: str = "2026-04-01", period_end: str = "2026-05-20") -> str:
    return (
        '{"schedule_config":{'
        f'"period_start":"{period_start}",'
        f'"period_end":"{period_end}",'
        f'"ux_config":{{"input_type":"{input_type}","quick_step":1,"detail_enabled":true}}'
        "}}"
    )


def test_command_center_returns_pending_review_cards_and_record_cards(client):
    task_a = _create_task(client, "算法")
    task_b = _create_task(client, "读书", color="#8B5CF6")

    pending_attr = _create_attr(
        client,
        task_a,
        "刷题",
        calc_config='{"schedule_config":{"period_start":"2026-04-01","period_end":"2026-04-10"}}',
    )
    active_attr = _create_attr(
        client,
        task_b,
        "阅读页数",
        calc_config='{"schedule_config":{"period_start":"2026-04-01","period_end":"2026-05-10"}}',
    )

    _upsert_record(client, task_a, pending_attr, "2026-04-08", 6)
    _upsert_record(client, task_b, active_attr, "2026-04-18", 12)

    res = client.get("/v1/home/command-center", params={"date": "2026-04-18"})
    assert res.status_code == 200
    payload = res.json()["data"]

    pending = payload["pending_review_cards"]
    assert any(item["task_id"] == task_a and item["attr_id"] == pending_attr for item in pending)

    record_cards = payload["record_cards"]
    assert all(not item["is_pending_settlement"] for item in record_cards)
    assert any(item["task_id"] == task_b and item["attr_id"] == active_attr for item in record_cards)
    assert not any(item["task_id"] == task_a and item["attr_id"] == pending_attr for item in record_cards)

    inbox_types = {item["type"] for item in payload["inbox_events"]}
    assert "pending_settlement" in inbox_types


def test_command_center_pending_review_cards_ignore_task_filter(client):
    task_a = _create_task(client, "任务A")
    task_b = _create_task(client, "任务B")

    pending_a = _create_attr(
        client,
        task_a,
        "A待结算",
        calc_config='{"schedule_config":{"period_start":"2026-04-01","period_end":"2026-04-05"}}',
    )
    pending_b = _create_attr(
        client,
        task_b,
        "B待结算",
        calc_config='{"schedule_config":{"period_start":"2026-04-01","period_end":"2026-04-05"}}',
    )
    active_a = _create_attr(
        client,
        task_a,
        "A可记录",
        calc_config='{"schedule_config":{"period_start":"2026-04-01","period_end":"2026-05-05"}}',
    )

    _upsert_record(client, task_a, pending_a, "2026-04-04", 5)
    _upsert_record(client, task_b, pending_b, "2026-04-04", 8)
    _upsert_record(client, task_a, active_a, "2026-04-18", 3)

    res = client.get("/v1/home/command-center", params={"date": "2026-04-18", "task_ids": str(task_a)})
    assert res.status_code == 200
    data = res.json()["data"]

    assert data["filters"]["selected_task_ids"] == [task_a]
    assert all(item["task_id"] == task_a for item in data["record_cards"])

    pending_task_ids = {item["task_id"] for item in data["pending_review_cards"]}
    assert pending_task_ids == {task_a, task_b}


def test_settlement_report_shared_days_can_exceed_100(client):
    task_id = _create_task(client, "共享目标")
    attr_id = _create_attr(
        client,
        task_id,
        "周末冲刺",
        target_value=50,
        calc_config=(
            '{"schedule_config":{'
            '"type":"shared_days",'
            '"active_weekdays":[6,7],'
            '"shared_weekday_groups":[[6,7]],'
            '"period_start":"2026-04-01",'
            '"period_end":"2026-04-14",'
            '"target_overrides":{"6,7":50}'
            '}}'
        ),
    )

    _upsert_record(client, task_id, attr_id, "2026-04-04", 80)
    _upsert_record(client, task_id, attr_id, "2026-04-05", 40)
    _upsert_record(client, task_id, attr_id, "2026-04-11", 100)
    _upsert_record(client, task_id, attr_id, "2026-04-12", 30)

    res = client.get(f"/v1/home/settlement-report/{task_id}/{attr_id}", params={"date": "2026-04-18"})
    assert res.status_code == 200
    report = res.json()["data"]

    assert report["total_actual"] == 250.0
    assert report["total_target"] == 100.0
    assert report["completion_rate"] == 250.0
    assert report["over_target_value"] == 150.0
    assert report["recommended_action"] == "evolve"


def test_settlement_report_uses_earliest_record_when_period_start_missing(client):
    task_id = _create_task(client, "区间回填")
    attr_id = _create_attr(
        client,
        task_id,
        "阶段复盘",
        calc_config='{"schedule_config":{"period_end":"2026-04-10"}}',
    )

    _upsert_record(client, task_id, attr_id, "2026-03-01", 7)
    _upsert_record(client, task_id, attr_id, "2026-04-08", 9)

    res = client.get(f"/v1/home/settlement-report/{task_id}/{attr_id}", params={"date": "2026-04-18"})
    assert res.status_code == 200
    report = res.json()["data"]

    assert report["period_start"] == "2026-03-01"
    assert report["period_start_source"] == "earliest_record"
    assert report["period_end"] == "2026-04-10"


def test_settlement_report_no_target_defaults_to_renew(client):
    task_id = _create_task(client, "无目标属性")
    attr_id = _create_attr(
        client,
        task_id,
        "随手记录",
        target_value=-1,
        calc_config='{"schedule_config":{"period_start":"2026-04-01","period_end":"2026-04-10"}}',
    )
    _upsert_record(client, task_id, attr_id, "2026-04-03", 5)

    res = client.get(f"/v1/home/settlement-report/{task_id}/{attr_id}", params={"date": "2026-04-20"})
    assert res.status_code == 200
    report = res.json()["data"]

    assert report["total_target"] is None
    assert report["completion_rate"] is None
    assert report["recommended_action"] == "renew"


def test_settlement_actions_renew_and_archive(client):
    task_id = _create_task(client, "动作闭环")
    attr_id = _create_attr(
        client,
        task_id,
        "周期属性",
        calc_config='{"schedule_config":{"period_start":"2026-04-01","period_end":"2026-04-10"}}',
    )

    renew = client.post(
        "/v1/home/settlement-actions",
        json={"task_id": task_id, "attr_id": attr_id, "action": "renew", "anchor_date": "2026-04-20"},
    )
    assert renew.status_code == 200
    renew_data = renew.json()["data"]
    assert renew_data["period_start"] == "2026-04-20"
    assert renew_data["period_end"] == "2026-04-29"
    assert renew_data["attr_sign"] == 0

    center_after_renew = client.get("/v1/home/command-center", params={"date": "2026-04-20"})
    assert center_after_renew.status_code == 200
    pending_after_renew = center_after_renew.json()["data"]["pending_review_cards"]
    assert not any(item["task_id"] == task_id and item["attr_id"] == attr_id for item in pending_after_renew)

    archive = client.post(
        "/v1/home/settlement-actions",
        json={"task_id": task_id, "attr_id": attr_id, "action": "archive"},
    )
    assert archive.status_code == 200
    assert archive.json()["data"]["attr_sign"] == 2

    center_after_archive = client.get("/v1/home/command-center", params={"date": "2026-04-30"})
    assert center_after_archive.status_code == 200
    payload = center_after_archive.json()["data"]
    assert not any(item["task_id"] == task_id and item["attr_id"] == attr_id for item in payload["record_cards"])
    assert not any(item["task_id"] == task_id and item["attr_id"] == attr_id for item in payload["pending_review_cards"])


def test_command_center_ux_config_maps_legacy_input_mode(client):
    task_id = _create_task(client, "类型映射")
    toggle_attr = _create_attr(
        client,
        task_id,
        "打卡属性",
        calc_config='{"schedule_config":{"ux_config":{"input_mode":"toggle","quick_step":1,"detail_enabled":true}}}',
    )
    timer_attr = _create_attr(
        client,
        task_id,
        "计时属性",
        calc_config=_input_type_calc_config("timer"),
    )

    _upsert_record(client, task_id, toggle_attr, "2026-04-18", 1)
    _upsert_record(client, task_id, timer_attr, "2026-04-18", 120)

    res = client.get("/v1/home/command-center", params={"date": "2026-04-18", "task_ids": str(task_id)})
    assert res.status_code == 200
    cards = res.json()["data"]["record_cards"]

    toggle_card = next(item for item in cards if item["attr_id"] == toggle_attr)
    timer_card = next(item for item in cards if item["attr_id"] == timer_attr)

    assert toggle_card["ux_config"]["input_type"] == "boolean"
    assert timer_card["ux_config"]["input_type"] == "timer"


def test_focus_capture_accumulates_timer_and_focus_attr(client):
    task_id = _create_task(client, "专注沉浸")
    timer_attr = _create_attr(
        client,
        task_id,
        "深度专注",
        target_value=1800,
        calc_config=_input_type_calc_config("timer"),
    )

    first = client.post(
        "/v1/home/focus-capture",
        json={
            "task_id": task_id,
            "timer_attr_id": timer_attr,
            "start_time": "2026-04-18T08:00:00",
            "duration_seconds": 1200,
            "record_date": "2026-04-18",
        },
    )
    assert first.status_code == 200
    first_data = first.json()["data"]
    assert first_data["timer_attr_id"] == timer_attr
    assert first_data["focus_attr_id"] == 4
    assert first_data["timer_attr_value_today"] == 1200.0
    assert first_data["focus_attr_value_today"] == 1200.0

    second = client.post(
        "/v1/home/focus-capture",
        json={
            "task_id": task_id,
            "timer_attr_id": timer_attr,
            "start_time": "2026-04-18T08:30:00",
            "duration_seconds": 600,
            "record_date": "2026-04-18",
        },
    )
    assert second.status_code == 200
    second_data = second.json()["data"]
    assert second_data["timer_attr_value_today"] == 1800.0
    assert second_data["focus_attr_value_today"] == 1800.0

    records = client.get(
        f"/v1/tasks/{task_id}/records",
        params={"start_date": "2026-04-18", "end_date": "2026-04-18"},
    )
    assert records.status_code == 200
    records_data = records.json()["data"]
    value_map = {int(item["attr_id"]): float(item["data_value"]) for item in records_data}
    assert value_map[timer_attr] == 1800.0
    assert value_map[4] == 1800.0

    focus_stats = client.get("/v1/focus/stats", params={"task_id": task_id, "target_date": "2026-04-18"})
    assert focus_stats.status_code == 200
    assert int(focus_stats.json()["data"]["todaySeconds"]) == 1800


def test_focus_capture_rejects_non_timer_attr_and_keeps_no_partial_write(client):
    task_id = _create_task(client, "校验回滚")
    number_attr = _create_attr(
        client,
        task_id,
        "普通计数",
        calc_config=_input_type_calc_config("number"),
    )

    blocked = client.post(
        "/v1/home/focus-capture",
        json={
            "task_id": task_id,
            "timer_attr_id": number_attr,
            "start_time": "2026-04-18T10:00:00",
            "duration_seconds": 300,
            "record_date": "2026-04-18",
        },
    )
    assert blocked.status_code == 400
    assert blocked.json()["error"]["code"] == "BAD_REQUEST"

    sessions = client.get("/v1/focus/sessions", params={"task_id": task_id, "start_date": "2026-04-18", "end_date": "2026-04-18"})
    assert sessions.status_code == 200
    assert sessions.json()["data"] == []

    records = client.get(
        f"/v1/tasks/{task_id}/records",
        params={"start_date": "2026-04-18", "end_date": "2026-04-18"},
    )
    assert records.status_code == 200
    assert records.json()["data"] == []


def test_home_batch_records_upsert_and_delete(client):
    task_id = _create_task(client, "批量记录")
    attr_id = _create_attr(client, task_id, "计数")

    upsert = client.put(
        "/v1/home/records/2026-04-18",
        json={"entries": [{"task_id": task_id, "attr_id": attr_id, "value": 5}]},
    )
    assert upsert.status_code == 200
    assert upsert.json()["data"]["updated"] == 1

    listed = client.get(f"/v1/tasks/{task_id}/records", params={"start_date": "2026-04-18", "end_date": "2026-04-18"})
    assert listed.status_code == 200
    assert listed.json()["data"][0]["data_value"] == 5

    deleted = client.put(
        "/v1/home/records/2026-04-18",
        json={"entries": [{"task_id": task_id, "attr_id": attr_id, "value": None}]},
    )
    assert deleted.status_code == 200
    assert deleted.json()["data"]["deleted"] == 1

    listed_after = client.get(f"/v1/tasks/{task_id}/records", params={"start_date": "2026-04-18", "end_date": "2026-04-18"})
    assert listed_after.status_code == 200
    assert listed_after.json()["data"] == []


def test_home_batch_records_rejects_future_and_invalid_relation(client):
    task_a = _create_task(client, "校验A")
    task_b = _create_task(client, "校验B")
    attr_a = _create_attr(client, task_a, "A属性")

    future_date = (date.today() + timedelta(days=1)).isoformat()
    future = client.put(
        f"/v1/home/records/{future_date}",
        json={"entries": [{"task_id": task_a, "attr_id": attr_a, "value": 1}]},
    )
    assert future.status_code == 400
    assert future.json()["error"]["code"] == "BAD_REQUEST"

    bad_relation = client.put(
        "/v1/home/records/2026-04-18",
        json={"entries": [{"task_id": task_b, "attr_id": attr_a, "value": 1}]},
    )
    assert bad_relation.status_code == 400
    assert bad_relation.json()["error"]["code"] == "BAD_REQUEST"
