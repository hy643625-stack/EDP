from __future__ import annotations


def test_new_task_has_intrinsic_focus_and_todo_attrs(client):
    create_task = client.post(
        "/v1/tasks",
        json={"name": "晨间训练", "desc": "固定任务", "task_color": "#276749"},
    )
    assert create_task.status_code == 200
    task = create_task.json()["data"]
    task_id = task["task_id"]

    attrs = client.get(f"/v1/tasks/{task_id}/attrs")
    assert attrs.status_code == 200
    attr_names = {item["attr_name"] for item in attrs.json()["data"]}
    assert "坚持天数" in attr_names
    assert "专注时长" in attr_names
    assert "待办" in attr_names


def test_intrinsic_attr_cannot_be_deleted(client):
    create_task = client.post(
        "/v1/tasks",
        json={"name": "不可删属性测试", "desc": "test", "task_color": "#276749"},
    )
    task_id = create_task.json()["data"]["task_id"]

    attrs_resp = client.get(f"/v1/tasks/{task_id}/attrs")
    attrs = attrs_resp.json()["data"]
    intrinsic = next(item for item in attrs if item["attr_name"] == "坚持天数")

    delete_resp = client.delete(f"/v1/tasks/{task_id}/attrs/{intrinsic['attr_id']}")
    assert delete_resp.status_code == 400
    assert delete_resp.json()["error"]["code"] == "BAD_REQUEST"


def test_task_update_flow(client):
    created = client.post(
        "/v1/tasks",
        json={"name": "更新前任务", "desc": "old", "task_color": "#276749"},
    )
    task_id = created.json()["data"]["task_id"]

    patch = client.patch(
        f"/v1/tasks/{task_id}",
        json={"name": "更新后任务", "desc": "new", "task_color": "#1D4ED8"},
    )
    assert patch.status_code == 200
    item = patch.json()["data"]
    assert item["task_name"] == "更新后任务"
    assert item["task_desc"] == "new"
    assert item["task_color"] == "#1D4ED8"


def test_task_attr_update_flow(client):
    create_task = client.post(
        "/v1/tasks",
        json={"name": "属性更新测试", "desc": "test", "task_color": "#2E7D32"},
    )
    task_id = create_task.json()["data"]["task_id"]

    created_attr = client.post(
        f"/v1/tasks/{task_id}/attrs",
        json={
            "attr_name": "初始属性",
            "display_order": 10,
            "attr_sign": 0,
            "attr_record": 1,
            "target_value": 10,
            "unit": "次",
            "calc_type": "10010000",
            "calc_config": "{}",
            "weight": 1,
        },
    )
    attr_id = created_attr.json()["data"]["attr_id"]

    patched = client.patch(
        f"/v1/tasks/{task_id}/attrs/{attr_id}",
        json={"attr_name": "重命名属性", "target_value": 20, "unit": "分钟", "weight": 3},
    )
    assert patched.status_code == 200
    data = patched.json()["data"]
    assert data["attr_name"] == "重命名属性"
    assert data["target_value"] == 20
    assert data["attr_unit"] == "分钟"
    assert data["weight"] == 3


def test_task_attr_record_flow(client):
    create_task = client.post(
        "/v1/tasks",
        json={"name": "英语学习", "desc": "每日输入输出", "task_color": "#2E7D32"},
    )
    assert create_task.status_code == 200
    task = create_task.json()["data"]
    task_id = task["task_id"]

    add_attr = client.post(
        f"/v1/tasks/{task_id}/attrs",
        json={
            "attr_name": "学习时长",
            "display_order": 1,
            "attr_sign": 0,
            "attr_record": 1,
            "target_value": 60,
            "unit": "分钟",
            "calc_type": "10010000",
            "calc_config": "{}",
            "weight": 1,
        },
    )
    assert add_attr.status_code == 200
    attr_id = add_attr.json()["data"]["attr_id"]

    upsert = client.put(
        f"/v1/tasks/{task_id}/records/2026-04-14",
        json={"values": [{"attr_id": attr_id, "value": 45}]},
    )
    assert upsert.status_code == 200

    records = client.get(f"/v1/tasks/{task_id}/records", params={"start_date": "2026-04-14", "end_date": "2026-04-14"})
    assert records.status_code == 200
    data = records.json()["data"]
    assert len(data) == 1
    assert data[0]["data_value"] == 45


def test_bad_date_format_returns_bad_request(client):
    response = client.put(
        "/v1/tasks/1/records/2026_04_14",
        json={"values": [{"attr_id": 1, "value": 1}]},
    )
    assert response.status_code == 400
    payload = response.json()
    assert payload["success"] is False
    assert payload["error"]["code"] == "BAD_REQUEST"
