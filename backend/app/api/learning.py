from __future__ import annotations

from fastapi import APIRouter, Depends

from app.dependencies import get_learning_agent_service
from app.response import success
from app.schemas import LearningProfileRequest, LearningResourcePackageRequest
from app.services.learning_agent_service import LearningAgentService

router = APIRouter(prefix="/v1/learning", tags=["learning"])


@router.get("/workbench")
def get_learning_workbench(service: LearningAgentService = Depends(get_learning_agent_service)):
    return success(service.get_workbench_payload())


@router.post("/profile")
def build_learning_profile(
    payload: LearningProfileRequest,
    service: LearningAgentService = Depends(get_learning_agent_service),
):
    return success(
        service.build_profile(
            course_id=payload.course_id,
            conversation=payload.conversation,
            preferred_goal=payload.preferred_goal,
            weekly_days=payload.weekly_days,
            daily_minutes=payload.daily_minutes,
        )
    )


@router.post("/resource-package")
def generate_learning_resource_package(
    payload: LearningResourcePackageRequest,
    service: LearningAgentService = Depends(get_learning_agent_service),
):
    return success(
        service.generate_learning_package(
            course_id=payload.course_id,
            conversation=payload.conversation,
            preferred_goal=payload.preferred_goal,
            weekly_days=payload.weekly_days,
            daily_minutes=payload.daily_minutes,
        )
    )
