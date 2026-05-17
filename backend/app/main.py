from __future__ import annotations

import os
import sqlite3

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import ai_settings_router, focus_router, home_router, misc_router, records_router, tasks_router, todos_router
from app.config import Settings
from app.db import Database
from app.errors import ApiError
from app.response import failure
from app.services.ai_settings_service import AiSettingsService
from app.static_site import configure_static_site


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    app = FastAPI(title="EveryDayPerfect Backend", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    db = Database(settings.db_path)
    db.ensure_schema()
    app.state.db = db
    app.state.settings = settings
    app.state.ai_settings_service = AiSettingsService(settings.ai_config_path)

    app.include_router(ai_settings_router)
    app.include_router(misc_router)
    app.include_router(tasks_router)
    app.include_router(records_router)
    app.include_router(todos_router)
    app.include_router(focus_router)
    app.include_router(home_router)
    configure_static_site(app, settings.frontend_dist_path)

    @app.exception_handler(ApiError)
    async def handle_api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=failure(exc.code, exc.message))

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        message = "; ".join(err["msg"] for err in exc.errors())
        return JSONResponse(status_code=422, content=failure("BAD_REQUEST", message))

    @app.exception_handler(sqlite3.DatabaseError)
    async def handle_db_error(_: Request, exc: sqlite3.DatabaseError) -> JSONResponse:
        return JSONResponse(status_code=500, content=failure("DB_ERROR", str(exc)))

    @app.exception_handler(Exception)
    async def handle_unknown_error(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content=failure("INTERNAL_ERROR", str(exc)))

    return app


if os.getenv("EVERYDAYPERFECT_SKIP_DEFAULT_APP") == "1":
    app = FastAPI(title="EveryDayPerfect Backend Test Stub")
else:
    app = create_app()
