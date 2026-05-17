from __future__ import annotations

from fastapi import APIRouter, Depends

from app.dependencies import get_ai_settings_service
from app.response import success
from app.schemas import TestAiSettingsConnectionRequest, UpdateAiSettingsRequest
from app.services.ai_settings_service import AiSettingsService

router = APIRouter(prefix="/v1/ai", tags=["ai-settings"])


@router.get("/settings")
def get_ai_settings(service: AiSettingsService = Depends(get_ai_settings_service)):
    return success(service.get_settings_payload())


@router.put("/settings")
def update_ai_settings(
    payload: UpdateAiSettingsRequest,
    service: AiSettingsService = Depends(get_ai_settings_service),
):
    configs = {
        provider_id: config.model_dump(exclude_none=True)
        for provider_id, config in payload.provider_configs.items()
    }
    return success(service.update_settings(payload.mode, payload.provider_id, configs))


@router.post("/settings/test")
def test_ai_settings_connection(
    payload: TestAiSettingsConnectionRequest,
    service: AiSettingsService = Depends(get_ai_settings_service),
):
    return success(service.test_connection(payload.mode, payload.provider_id, payload.config.model_dump(exclude_none=True)))
