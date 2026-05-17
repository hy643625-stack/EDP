from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _default_db_path() -> Path:
    return Path.home() / "Documents" / "task.db"


def _default_app_data_dir() -> Path:
    local_app_data = os.getenv("LOCALAPPDATA", "").strip()
    if local_app_data:
        return Path(local_app_data) / "EveryDayPerfect"
    return Path.home() / "AppData" / "Local" / "EveryDayPerfect"


def _default_ai_config_path() -> Path:
    return _default_app_data_dir() / "ai-settings.json"


@dataclass(frozen=True)
class Settings:
    db_path: Path
    cors_origins: tuple[str, ...]
    frontend_dist_path: Path | None = None
    app_data_dir: Path = field(default_factory=_default_app_data_dir)
    ai_config_path: Path = field(default_factory=_default_ai_config_path)

    @staticmethod
    def from_env() -> "Settings":
        db_path = Path(os.getenv("TASK_DB_PATH", _default_db_path()))
        frontend_dist_raw = os.getenv("FRONTEND_DIST_PATH", "").strip()
        frontend_dist_path = Path(frontend_dist_raw) if frontend_dist_raw else None
        app_data_dir = Path(os.getenv("EVERYDAYPERFECT_APP_DATA_DIR", _default_app_data_dir()))
        ai_config_path = Path(os.getenv("AI_CONFIG_PATH", app_data_dir / "ai-settings.json"))
        origins = os.getenv(
            "CORS_ORIGINS",
            "http://127.0.0.1:5173,http://localhost:5173",
        )
        parsed = tuple(item.strip() for item in origins.split(",") if item.strip())
        return Settings(
            db_path=db_path,
            cors_origins=parsed,
            frontend_dist_path=frontend_dist_path,
            app_data_dir=app_data_dir,
            ai_config_path=ai_config_path,
        )
