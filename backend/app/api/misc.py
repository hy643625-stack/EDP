from __future__ import annotations

from fastapi import APIRouter, Depends

from app.dependencies import get_ai_summary_service
from app.errors import ApiError
from app.response import success
from app.schemas import AiSummaryRequest
from app.services.ai_summary_service import AiSummaryService

router = APIRouter(tags=["misc"])


@router.get("/health")
def health():
    return success({"status": "ok"})


@router.post("/v1/ai/chat")
def ai_chat_placeholder():
    raise ApiError("NOT_IMPLEMENTED", "AI 聊天能力将在下一阶段迁移", 501)


@router.post("/v1/ai/summary")
def ai_summary(
    payload: AiSummaryRequest,
    service: AiSummaryService = Depends(get_ai_summary_service),
):
    data = service.build_settlement_summary(
        task_id=payload.task_id,
        attr_id=payload.attr_id,
        record_date=payload.record_date.isoformat(),
    )
    return success(data)
