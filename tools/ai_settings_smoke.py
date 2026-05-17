from __future__ import annotations

import os
import shutil
import sys
import uuid
from pathlib import Path

from fastapi.testclient import TestClient


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    backend_dir = root / "backend"
    sys.path.insert(0, str(backend_dir))

    case_dir = root / "_manual_smoke" / f"ai-settings-{uuid.uuid4().hex}"
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
            initial = client.get("/v1/ai/settings")
            updated = client.put(
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

            print("GET /v1/ai/settings:", initial.status_code, initial.json()["data"]["mode"])
            print(
                "PUT /v1/ai/settings:",
                updated.status_code,
                updated.json()["data"]["mode"],
                updated.json()["data"]["effective_runtime"]["status"],
            )
            print("temp_config_verified:", (case_dir / "ai-settings.json").exists())
    finally:
        if previous_skip is None:
            os.environ.pop("EVERYDAYPERFECT_SKIP_DEFAULT_APP", None)
        else:
            os.environ["EVERYDAYPERFECT_SKIP_DEFAULT_APP"] = previous_skip
        shutil.rmtree(case_dir, ignore_errors=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
