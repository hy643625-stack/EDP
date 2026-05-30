from __future__ import annotations

from fastapi import APIRouter, Depends

from app.dependencies import get_learning_agent_service
from app.response import success
from app.schemas import (
    CreateLearningSessionRequest,
    LearningProfileRequest,
    LearningResourcePackageRequest,
    LearningTutorRequest,
    UpdateLearningSessionProfileRequest,
)
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


# ── Phase 2: Session-based endpoints ─────────────────

@router.get("/sessions")
def list_learning_sessions(service: LearningAgentService = Depends(get_learning_agent_service)):
    return success(service.list_sessions())


@router.post("/sessions")
def create_learning_session(
    payload: CreateLearningSessionRequest,
    service: LearningAgentService = Depends(get_learning_agent_service),
):
    return success(
        service.create_learning_session(
            course_id=payload.course_id,
            conversation=payload.conversation,
            preferred_goal=payload.preferred_goal,
            weekly_days=payload.weekly_days,
            daily_minutes=payload.daily_minutes,
            title=payload.title or "",
        )
    )


@router.get("/sessions/{session_id}")
def get_learning_session(
    session_id: str,
    service: LearningAgentService = Depends(get_learning_agent_service),
):
    return success(service.get_session_detail(session_id))


@router.post("/sessions/{session_id}/profile")
def update_learning_session_profile(
    session_id: str,
    payload: UpdateLearningSessionProfileRequest,
    service: LearningAgentService = Depends(get_learning_agent_service),
):
    return success(
        service.update_session_profile(
            session_id=session_id,
            conversation=payload.conversation,
            preferred_goal=payload.preferred_goal,
            weekly_days=payload.weekly_days,
            daily_minutes=payload.daily_minutes,
        )
    )


@router.post("/sessions/{session_id}/resource-package")
def generate_session_resource_package(
    session_id: str,
    service: LearningAgentService = Depends(get_learning_agent_service),
):
    return success(service.generate_session_package(session_id))


# ── Phase 3: Tutor ───────────────────────────────────

@router.post("/sessions/{session_id}/tutor")
def tutor_learning_session(
    session_id: str,
    payload: LearningTutorRequest,
    service: LearningAgentService = Depends(get_learning_agent_service),
):
    return success(service.tutor_session(session_id, payload.question))
