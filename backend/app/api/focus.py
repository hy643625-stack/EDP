from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_focus_service
from app.response import success
from app.schemas import CreateFocusSessionRequest
from app.services import FocusService

router = APIRouter(prefix="/v1/focus", tags=["focus"])


@router.post("/sessions")
def create_session(
    payload: CreateFocusSessionRequest,
    service: FocusService = Depends(get_focus_service),
):
    item = service.create_session(
        {
            "task_id": payload.task_id,
            "attr_id": payload.attr_id,
            "start_time": payload.start_time.isoformat(),
            "record_date": payload.record_date.isoformat() if payload.record_date else None,
            "duration_seconds": payload.duration_seconds,
            "plan_id": payload.plan_id,
            "step_id": payload.step_id,
            "note": payload.note,
        }
    )
    return success(item)


@router.get("/sessions")
def list_sessions(
    task_id: int | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    service: FocusService = Depends(get_focus_service),
):
    return success(service.list_sessions(task_id, start_date, end_date))


@router.get("/stats")
def focus_stats(
    task_id: int | None = Query(default=None),
    target_date: str | None = Query(default=None),
    service: FocusService = Depends(get_focus_service),
):
    return success(service.stats(task_id, target_date))
