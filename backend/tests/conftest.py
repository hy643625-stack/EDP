from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

@pytest.fixture()
def client() -> TestClient:
    root_dir = Path(__file__).resolve().parents[2]
    cases_dir = root_dir / "_test_tmp" / "backend-test-dbs"
    cases_dir.mkdir(parents=True, exist_ok=True)
    test_case_dir = cases_dir / f"case-{uuid.uuid4().hex}"
    test_case_dir.mkdir(parents=True, exist_ok=False)
    db_path = test_case_dir / "test_task.db"
    ai_config_path = test_case_dir / "ai-settings.json"
    previous_db_path = os.environ.get("TASK_DB_PATH")
    previous_ai_config_path = os.environ.get("AI_CONFIG_PATH")
    previous_app_data_dir = os.environ.get("EVERYDAYPERFECT_APP_DATA_DIR")
    previous_skip_default_app = os.environ.get("EVERYDAYPERFECT_SKIP_DEFAULT_APP")
    os.environ["TASK_DB_PATH"] = str(db_path)
    os.environ["AI_CONFIG_PATH"] = str(ai_config_path)
    os.environ["EVERYDAYPERFECT_APP_DATA_DIR"] = str(test_case_dir)
    os.environ["EVERYDAYPERFECT_SKIP_DEFAULT_APP"] = "1"

    from app.config import Settings
    from app.main import create_app

    settings = Settings(
        db_path=db_path,
        cors_origins=("http://localhost:5173",),
        app_data_dir=test_case_dir,
        ai_config_path=ai_config_path,
    )
    app = create_app(settings)
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        if previous_db_path is None:
            os.environ.pop("TASK_DB_PATH", None)
        else:
            os.environ["TASK_DB_PATH"] = previous_db_path
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
        shutil.rmtree(test_case_dir, ignore_errors=True)
