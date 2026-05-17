from __future__ import annotations

import os
import shutil
import sys
import uuid
from pathlib import Path

from fastapi.testclient import TestClient


def _create_task(client: TestClient, name: str) -> int:
    response = client.post(
        "/v1/tasks",
        json={"name": name, "desc": f"{name} desc", "task_color": "#2563EB"},
    )
    response.raise_for_status()
    return int(response.json()["data"]["task_id"])


def _create_attr(client: TestClient, task_id: int, attr_name: str) -> int:
    response = client.post(
        f"/v1/tasks/{task_id}/attrs",
        json={
            "attr_name": attr_name,
            "display_order": 10,
            "attr_sign": 0,
            "attr_record": 1,
            "target_value": 10,
            "unit": "次",
            "calc_type": "10010000",
            "calc_config": '{"schedule_config":{"period_start":"2026-04-01","period_end":"2026-04-10"}}',
            "weight": 1,
        },
    )
    response.raise_for_status()
    return int(response.json()["data"]["attr_id"])


def _upsert_record(client: TestClient, task_id: int, attr_id: int, record_date: str, value: float) -> None:
    response = client.put(
        f"/v1/tasks/{task_id}/records/{record_date}",
        json={"values": [{"attr_id": attr_id, "value": value}]},
    )
    response.raise_for_status()


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    backend_dir = root / "backend"
    sys.path.insert(0, str(backend_dir))

    case_dir = root / "_manual_smoke" / f"ai-summary-{uuid.uuid4().hex}"
    case_dir.mkdir(parents=True, exist_ok=False)

    previous_skip = os.environ.get("EVERYDAYPERFECT_SKIP_DEFAULT_APP")
    os.environ["EVERYDAYPERFECT_SKIP_DEFAULT_APP"] = "1"

    try:
        from app.config import Settings
        from app.main import create_app

        app = create_app(
            Settings(
                db_path=case_dir / "task.db",
                cors_origins=("http://localhost:5173",),
                app_data_dir=case_dir,
                ai_config_path=case_dir / "ai-settings.json",
            )
        )

        with TestClient(app) as client:
            task_id = _create_task(client, "Smoke AI 复盘")
            attr_id = _create_attr(client, task_id, "刷题数")
            _upsert_record(client, task_id, attr_id, "2026-04-03", 7)

            response = client.post(
                "/v1/ai/summary",
                json={"task_id": task_id, "attr_id": attr_id, "record_date": "2026-04-20"},
            )
            payload = response.json()["data"]
            print("POST /v1/ai/summary:", response.status_code, payload["mode_used"])
            print("summary_overview:", payload["sections"]["overview"])
            print("generated_at:", payload["generated_at"])
    finally:
        if previous_skip is None:
            os.environ.pop("EVERYDAYPERFECT_SKIP_DEFAULT_APP", None)
        else:
            os.environ["EVERYDAYPERFECT_SKIP_DEFAULT_APP"] = previous_skip
        shutil.rmtree(case_dir, ignore_errors=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
