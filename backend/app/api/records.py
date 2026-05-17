from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_record_service
from app.response import success
from app.schemas import UpsertDailyRecordsRequest
from app.services import RecordService

router = APIRouter(prefix="/v1/tasks", tags=["records"])


@router.put("/{task_id}/records/{record_date}")
def upsert_daily_records(
    task_id: int,
    record_date: str,
    payload: UpsertDailyRecordsRequest,
    service: RecordService = Depends(get_record_service),
):
    service.upsert_records(task_id, record_date, [x.model_dump() for x in payload.values])
    return success({"updated": True, "task_id": task_id, "record_date": record_date})


@router.get("/{task_id}/records")
def list_records(
    task_id: int,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    service: RecordService = Depends(get_record_service),
):
    return success(service.list_records(task_id, start_date, end_date))
