from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import FastAPI
    from .config import Settings


def create_app(settings: "Settings | None" = None) -> "FastAPI":
    from .main import create_app as _create_app

    return _create_app(settings)


__all__ = ["create_app"]
