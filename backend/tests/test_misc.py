from __future__ import annotations

import json
import os
import shutil
import uuid
from pathlib import Path

from fastapi.testclient import TestClient


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


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "ok"


def test_ai_not_implemented(client):
    res = client.post("/v1/ai/chat")
    assert res.status_code == 501
    payload = res.json()
    assert payload["success"] is False
    assert payload["error"]["code"] == "NOT_IMPLEMENTED"


def test_ai_settings_defaults_to_rules_mode(client):
    res = client.get("/v1/ai/settings")
    assert res.status_code == 200
    payload = res.json()["data"]
    assert payload["mode"] == "off"
    assert payload["rules_enabled"] is True
    assert payload["confirmation_required"] is True
    assert payload["effective_runtime"]["status"] == "rules_only"
    assert payload["provider_configs"]["openai"]["api_key_configured"] is False


def test_ai_settings_save_masks_api_key_and_persists_locally(client):
    res = client.put(
        "/v1/ai/settings",
        json={
            "mode": "cloud",
            "provider_id": "openai",
            "provider_configs": {
                "openai": {
                    "api_key_input": "sk-demo-secret",
                    "model_name": "gpt-test",
                    "base_url": "https://api.openai.com/v1",
                    "temperature": 0.4,
                    "max_tokens": 888,
                    "stream": True,
                    "timeout_seconds": 45,
                }
            },
        },
    )
    assert res.status_code == 200
    payload = res.json()["data"]
    openai_config = payload["provider_configs"]["openai"]
    assert openai_config["api_key_configured"] is True
    assert openai_config["api_key_masked"] is not None
    assert "sk-demo-secret" not in json.dumps(payload, ensure_ascii=False)
    assert payload["effective_runtime"]["status"] == "ready"

    config_path = client.app.state.settings.ai_config_path
    raw_text = Path(config_path).read_text(encoding="utf-8")
    assert "sk-demo-secret" not in raw_text
    assert "api_key_secret" in raw_text


def test_ai_settings_test_connection_uses_provider_service(client, monkeypatch):
    from app.services.ai_settings_service import AiSettingsService

    def fake_test_connection(self, mode, provider_id, config_patch):
        assert mode == "local"
        assert provider_id == "ollama"
        assert config_patch["base_url"] == "http://127.0.0.1:11434"
        return {"ok": True, "message": "mock-ok", "degraded_to_rules": False}

    monkeypatch.setattr(AiSettingsService, "test_connection", fake_test_connection)

    res = client.post(
        "/v1/ai/settings/test",
        json={
            "mode": "local",
            "provider_id": "ollama",
            "config": {
                "base_url": "http://127.0.0.1:11434",
                "model_name": "qwen2.5:7b",
            },
        },
    )
    assert res.status_code == 200
    payload = res.json()["data"]
    assert payload["ok"] is True
    assert payload["message"] == "mock-ok"


def test_ai_summary_uses_local_rules_when_ai_is_off(client):
    task_id = _create_task(client, "AI 周复盘")
    attr_id = _create_attr(
        client,
        task_id,
        "刷题数",
        target_value=10,
        calc_config='{"schedule_config":{"period_start":"2026-04-01","period_end":"2026-04-10"}}',
    )
    _upsert_record(client, task_id, attr_id, "2026-04-03", 7)

    res = client.post(
        "/v1/ai/summary",
        json={"task_id": task_id, "attr_id": attr_id, "record_date": "2026-04-20"},
    )
    assert res.status_code == 200
    payload = res.json()["data"]

    assert payload["mode_requested"] == "off"
    assert payload["mode_used"] == "local_rules"
    assert payload["provider_id"] == "openai_compatible"
    assert payload["fallback_reason"] is None
    assert payload["confirmation_required"] is True
    assert payload["settlement_report"]["task_id"] == task_id
    assert payload["settlement_report"]["attr_id"] == attr_id
    assert isinstance(payload["summary_text"], str)
    assert "AI 周复盘" in payload["summary_text"]
    assert payload["sections"]["signals"]
    assert payload["sections"]["actions"]
    assert payload["generated_at"].endswith("Z")


def test_ai_summary_degrades_to_rules_when_ai_mode_is_ready_but_model_call_not_wired(client):
    task_id = _create_task(client, "AI 降级验证")
    attr_id = _create_attr(
        client,
        task_id,
        "阅读页数",
        target_value=20,
        calc_config='{"schedule_config":{"period_start":"2026-04-01","period_end":"2026-04-10"}}',
    )
    _upsert_record(client, task_id, attr_id, "2026-04-04", 25)

    save = client.put(
        "/v1/ai/settings",
        json={
            "mode": "local",
            "provider_id": "ollama",
            "provider_configs": {
                "ollama": {
                    "base_url": "http://127.0.0.1:11434",
                    "model_name": "qwen2.5:7b",
                }
            },
        },
    )
    assert save.status_code == 200
    assert save.json()["data"]["effective_runtime"]["status"] == "ready"

    res = client.post(
        "/v1/ai/summary",
        json={"task_id": task_id, "attr_id": attr_id, "record_date": "2026-04-20"},
    )
    assert res.status_code == 200
    payload = res.json()["data"]

    assert payload["mode_requested"] == "local"
    assert payload["mode_used"] == "local_rules"
    assert payload["provider_id"] == "ollama"
    assert payload["fallback_reason"] is not None
    assert "降级" in payload["fallback_reason"]
    assert payload["settlement_report"]["task_id"] == task_id
    assert payload["settlement_report"]["attr_id"] == attr_id
    assert payload["sections"]["overview"]


def test_ai_summary_uses_model_output_when_provider_call_succeeds(client, monkeypatch):
    from app.services.ai_summary_service import AiSummaryService

    task_id = _create_task(client, "AI 模型输出")
    attr_id = _create_attr(
        client,
        task_id,
        "写作字数",
        target_value=1000,
        calc_config='{"schedule_config":{"period_start":"2026-04-01","period_end":"2026-04-10"}}',
    )
    _upsert_record(client, task_id, attr_id, "2026-04-05", 1200)

    save = client.put(
        "/v1/ai/settings",
        json={
            "mode": "cloud",
            "provider_id": "openai",
            "provider_configs": {
                "openai": {
                    "api_key_input": "sk-demo-secret",
                    "base_url": "https://api.openai.com/v1",
                    "model_name": "gpt-test",
                }
            },
        },
    )
    assert save.status_code == 200

    def fake_call_model(self, prompt, runtime_provider):
        assert runtime_provider["provider_id"] == "openai"
        assert runtime_provider["model_name"] == "gpt-test"
        assert "写作字数" in prompt
        return json.dumps(
            {
                "overview": "写作字数本周期超额完成，适合进入下一阶段。",
                "summary_text": "本周期的核心优势是完成度高。\n建议把目标升级为更高质量的产出约束。",
                "signals": ["完成率已经超过 100%。", "当前节律比较稳定。"],
                "actions": ["下周期增加结果型约束。", "保留当前写作节律。"],
            },
            ensure_ascii=False,
        )

    monkeypatch.setattr(AiSummaryService, "_call_model", fake_call_model)

    res = client.post(
        "/v1/ai/summary",
        json={"task_id": task_id, "attr_id": attr_id, "record_date": "2026-04-20"},
    )
    assert res.status_code == 200
    payload = res.json()["data"]

    assert payload["mode_requested"] == "cloud"
    assert payload["mode_used"] == "model"
    assert payload["provider_id"] == "openai"
    assert payload["fallback_reason"] is None
    assert payload["sections"]["overview"] == "写作字数本周期超额完成，适合进入下一阶段。"
    assert payload["sections"]["signals"][0] == "完成率已经超过 100%。"
    assert "核心优势" in payload["summary_text"]


def test_ai_summary_degrades_when_model_returns_invalid_json(client, monkeypatch):
    from app.services.ai_summary_service import AiSummaryService

    task_id = _create_task(client, "AI JSON 降级")
    attr_id = _create_attr(
        client,
        task_id,
        "阅读页数",
        target_value=30,
        calc_config='{"schedule_config":{"period_start":"2026-04-01","period_end":"2026-04-10"}}',
    )
    _upsert_record(client, task_id, attr_id, "2026-04-05", 10)

    save = client.put(
        "/v1/ai/settings",
        json={
            "mode": "local",
            "provider_id": "ollama",
            "provider_configs": {
                "ollama": {
                    "base_url": "http://127.0.0.1:11434",
                    "model_name": "qwen2.5:7b",
                }
            },
        },
    )
    assert save.status_code == 200

    def fake_call_model(self, prompt, runtime_provider):
        return "not-json"

    monkeypatch.setattr(AiSummaryService, "_call_model", fake_call_model)

    res = client.post(
        "/v1/ai/summary",
        json={"task_id": task_id, "attr_id": attr_id, "record_date": "2026-04-20"},
    )
    assert res.status_code == 200
    payload = res.json()["data"]

    assert payload["mode_requested"] == "local"
    assert payload["mode_used"] == "local_rules"
    assert payload["provider_id"] == "ollama"
    assert payload["fallback_reason"] is not None
    assert "JSON" in payload["fallback_reason"] or "降级" in payload["fallback_reason"]


def test_static_frontend_hosting_serves_index_assets_and_spa_fallback():
    previous_db_path = os.environ.get("TASK_DB_PATH")
    previous_frontend_dist = os.environ.get("FRONTEND_DIST_PATH")
    previous_ai_config_path = os.environ.get("AI_CONFIG_PATH")
    previous_app_data_dir = os.environ.get("EVERYDAYPERFECT_APP_DATA_DIR")
    previous_skip_default_app = os.environ.get("EVERYDAYPERFECT_SKIP_DEFAULT_APP")

    root_dir = Path(__file__).resolve().parents[2]
    static_cases_dir = root_dir / "_test_tmp" / "backend-static-tests"
    static_cases_dir.mkdir(parents=True, exist_ok=True)

    db_dir = static_cases_dir / f"db-{uuid.uuid4().hex}"
    frontend_dir = static_cases_dir / f"dist-{uuid.uuid4().hex}"
    db_dir.mkdir(parents=True, exist_ok=False)
    frontend_dir.mkdir(parents=True, exist_ok=False)
    assets_dir = frontend_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    (frontend_dir / "index.html").write_text("<html><body>desktop-app</body></html>", encoding="utf-8")
    (assets_dir / "main.js").write_text("console.log('desktop')", encoding="utf-8")

    db_path = db_dir / "test_task.db"
    ai_config_path = db_dir / "ai-settings.json"
    os.environ["TASK_DB_PATH"] = str(db_path)
    os.environ["FRONTEND_DIST_PATH"] = str(frontend_dir)
    os.environ["AI_CONFIG_PATH"] = str(ai_config_path)
    os.environ["EVERYDAYPERFECT_APP_DATA_DIR"] = str(db_dir)
    os.environ["EVERYDAYPERFECT_SKIP_DEFAULT_APP"] = "1"

    try:
        from app.config import Settings
        from app.main import create_app

        app = create_app(
            Settings(
                db_path=db_path,
                cors_origins=("http://localhost:5173",),
                frontend_dist_path=frontend_dir,
                app_data_dir=db_dir,
                ai_config_path=ai_config_path,
            )
        )

        with TestClient(app) as test_client:
            root = test_client.get("/")
            assert root.status_code == 200
            assert "desktop-app" in root.text

            asset = test_client.get("/assets/main.js")
            assert asset.status_code == 200
            assert "console.log('desktop')" in asset.text

            spa_fallback = test_client.get("/stats")
            assert spa_fallback.status_code == 200
            assert "desktop-app" in spa_fallback.text

            missing_api = test_client.get("/v1/not-found")
            assert missing_api.status_code == 404
    finally:
        if previous_db_path is None:
            os.environ.pop("TASK_DB_PATH", None)
        else:
            os.environ["TASK_DB_PATH"] = previous_db_path

        if previous_frontend_dist is None:
            os.environ.pop("FRONTEND_DIST_PATH", None)
        else:
            os.environ["FRONTEND_DIST_PATH"] = previous_frontend_dist
        if previous_ai_config_path is None:
            os.environ.pop("AI_CONFIG_PATH", None)
        else:
            os.environ["AI_CONFIG_PATH"] = previous_ai_config_path
        if previous_app_data_dir is None:
            os.environ.pop("EVERYDAYPERFECT_APP_DATA_DIR", None)
        else:
            os.environ["EVERYDAYPERFECT_APP_DATA_DIR"] = previous_app_data_dir
        if previous_skip_default_app is None:
            os.environ.pop("EVERYDAYPERFECT_SKIP_DEFAULT_APP", None)
        else:
            os.environ["EVERYDAYPERFECT_SKIP_DEFAULT_APP"] = previous_skip_default_app

        shutil.rmtree(db_dir, ignore_errors=True)
        shutil.rmtree(frontend_dir, ignore_errors=True)
