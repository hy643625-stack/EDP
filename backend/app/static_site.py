from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

_RESERVED_PREFIXES = ("v1", "health", "docs", "redoc", "openapi.json")


def _is_reserved_path(path: str) -> bool:
    normalized = path.strip("/")
    if not normalized:
        return False
    return normalized == "health" or normalized == "openapi.json" or any(
        normalized == prefix or normalized.startswith(f"{prefix}/")
        for prefix in _RESERVED_PREFIXES
        if prefix not in {"health", "openapi.json"}
    )


def configure_static_site(app: FastAPI, frontend_dist_path: Path | None) -> None:
    if frontend_dist_path is None:
        return

    dist_dir = Path(frontend_dist_path).resolve()
    index_file = dist_dir / "index.html"
    assets_dir = dist_dir / "assets"

    if not index_file.is_file():
        return

    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend-assets")

    @app.get("/", include_in_schema=False)
    def serve_frontend_index() -> FileResponse:
        return FileResponse(index_file)

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend_path(full_path: str) -> FileResponse:
        if _is_reserved_path(full_path):
            raise HTTPException(status_code=404, detail="Not Found")

        candidate = (dist_dir / full_path).resolve()
        if candidate.is_file() and dist_dir in candidate.parents:
            return FileResponse(candidate)

        return FileResponse(index_file)
