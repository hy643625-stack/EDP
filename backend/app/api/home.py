from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_home_service
from app.response import success
from app.schemas import FocusCaptureRequest, SettlementActionRequest, UpsertHomeRecordsRequest
from app.services.home_service import HomeService

router = APIRouter(prefix="/v1/home", tags=["home"])


@router.get("/command-center")
def get_command_center(
    date_key: str = Query(default_factory=lambda: date.today().isoformat(), alias="date"),
    task_ids: str | None = Query(default=None),
    service: HomeService = Depends(get_home_service),
):
    data = service.command_center(date_key, task_ids)
    return success(data)


@router.put("/records/{record_date}")
def upsert_home_records(
    record_date: str,
    payload: UpsertHomeRecordsRequest,
    service: HomeService = Depends(get_home_service),
):
    data = service.batch_upsert_records(record_date, [entry.model_dump() for entry in payload.entries])
    return success(data)


@router.get("/settlement-report/{task_id}/{attr_id}")
def get_settlement_report(
    task_id: int,
    attr_id: int,
    date_key: str = Query(default_factory=lambda: date.today().isoformat(), alias="date"),
    service: HomeService = Depends(get_home_service),
):
    data = service.get_settlement_report(task_id, attr_id, date_key)
    return success(data)


@router.post("/settlement-actions")
def apply_settlement_action(
    payload: SettlementActionRequest,
    service: HomeService = Depends(get_home_service),
):
    data = service.apply_settlement_action(payload.model_dump(exclude_none=True))
    return success(data)


@router.post("/focus-capture")
def focus_capture(
    payload: FocusCaptureRequest,
    service: HomeService = Depends(get_home_service),
):
    data = service.focus_capture(
        {
            "task_id": payload.task_id,
            "timer_attr_id": payload.timer_attr_id,
            "start_time": payload.start_time.isoformat(),
            "duration_seconds": payload.duration_seconds,
            "record_date": payload.record_date.isoformat(),
        }
    )
    return success(data)
