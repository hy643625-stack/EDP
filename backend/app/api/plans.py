from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_plan_service
from app.response import success
from app.schemas import (
    CompletePlanStepRequest,
    ImportPlanRequest,
    PlanReviewRequest,
    PlanTimeLogRequest,
    UpdatePlanDraftRequest,
    UpdatePlanStatusRequest,
)
from app.services.plan_service import PlanService


router = APIRouter(prefix="/v1/plans", tags=["plans"])


@router.post("/import")
def import_plan(payload: ImportPlanRequest, service: PlanService = Depends(get_plan_service)):
    data = payload.model_dump(mode="json")
    return success(service.import_plan(data))


@router.get("")
def list_plans(service: PlanService = Depends(get_plan_service)):
    return success(service.list_plans())


@router.get("/dashboard")
def get_plan_dashboard(
    date_key: str = Query(default_factory=lambda: date.today().isoformat(), alias="date"),
    plan_id: str | None = Query(default=None),
    service: PlanService = Depends(get_plan_service),
):
    return success(service.dashboard(date_key, plan_id))


@router.get("/{plan_id}")
def get_plan(
    plan_id: str,
    date_key: str | None = Query(default=None, alias="date"),
    service: PlanService = Depends(get_plan_service),
):
    return success(service.get_plan(plan_id, date_key))


@router.put("/{plan_id}/draft")
def update_plan_draft(
    plan_id: str,
    payload: UpdatePlanDraftRequest,
    service: PlanService = Depends(get_plan_service),
):
    return success(service.update_draft(plan_id, payload.snapshot))


@router.post("/{plan_id}/activate")
def activate_plan(plan_id: str, service: PlanService = Depends(get_plan_service)):
    return success(service.activate(plan_id))


@router.patch("/{plan_id}/status")
def update_plan_status(
    plan_id: str,
    payload: UpdatePlanStatusRequest,
    service: PlanService = Depends(get_plan_service),
):
    return success(service.update_status(plan_id, payload.status))


@router.post("/{plan_id}/steps/{step_id}/complete")
def complete_plan_step(
    plan_id: str,
    step_id: str,
    payload: CompletePlanStepRequest,
    service: PlanService = Depends(get_plan_service),
):
    return success(service.complete_step(plan_id, step_id, payload.model_dump()))


@router.post("/{plan_id}/steps/{step_id}/reopen")
def reopen_plan_step(plan_id: str, step_id: str, service: PlanService = Depends(get_plan_service)):
    return success(service.reopen_step(plan_id, step_id))


@router.post("/{plan_id}/time-logs")
def create_plan_time_log(
    plan_id: str,
    payload: PlanTimeLogRequest,
    service: PlanService = Depends(get_plan_service),
):
    data = payload.model_dump(mode="json")
    return success(service.add_time_log(plan_id, data))


@router.post("/{plan_id}/reviews")
def create_plan_review(
    plan_id: str,
    payload: PlanReviewRequest,
    service: PlanService = Depends(get_plan_service),
):
    return success(service.create_review(plan_id, payload.model_dump(mode="json")))


@router.post("/{plan_id}/reviews/{review_id}/apply")
def apply_plan_review(
    plan_id: str,
    review_id: int,
    service: PlanService = Depends(get_plan_service),
):
    return success(service.apply_review(plan_id, review_id))


@router.post("/{plan_id}/reviews/{review_id}/reject")
def reject_plan_review(
    plan_id: str,
    review_id: int,
    service: PlanService = Depends(get_plan_service),
):
    return success(service.reject_review(plan_id, review_id))
