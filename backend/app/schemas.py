from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class ErrorPayload(BaseModel):
    code: str
    message: str


class ApiResponse(BaseModel):
    success: bool
    data: Any = None
    error: ErrorPayload | None = None


class CreateTaskRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    desc: str = ""
    task_color: str = "#4CAF50"


class UpdateTaskRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    desc: str | None = None
    task_color: str | None = None


class TaskAttrBase(BaseModel):
    display_order: int = 1
    attr_sign: int = 0
    attr_record: int = 0
    target_value: float = -1
    unit: str = ""
    calc_type: str = "10000000"
    calc_config: str = "{}"
    weight: float = 0


class CreateTaskAttrRequest(TaskAttrBase):
    attr_name: str = Field(min_length=1, max_length=64)


class UpdateTaskAttrRequest(BaseModel):
    attr_name: str | None = Field(default=None, min_length=1, max_length=64)
    display_order: int | None = None
    attr_sign: int | None = None
    attr_record: int | None = None
    target_value: float | None = None
    unit: str | None = None
    calc_type: str | None = None
    calc_config: str | None = None
    weight: float | None = None


class RecordValue(BaseModel):
    attr_id: int
    value: float


class UpsertDailyRecordsRequest(BaseModel):
    values: list[RecordValue] = Field(default_factory=list)


class BatchRecordEntry(BaseModel):
    task_id: int
    attr_id: int
    value: float | None = None


class UpsertHomeRecordsRequest(BaseModel):
    entries: list[BatchRecordEntry] = Field(default_factory=list)


class SettlementActionRequest(BaseModel):
    task_id: int
    attr_id: int
    action: str = Field(min_length=1, max_length=16)
    anchor_date: str | None = None


class FocusCaptureRequest(BaseModel):
    task_id: int
    timer_attr_id: int | None = None
    start_time: datetime
    duration_seconds: int = Field(gt=0)
    record_date: date


class PlanTaskBindingRequest(BaseModel):
    mode: str = Field(default="create", min_length=1, max_length=16)
    task_name: str | None = Field(default=None, max_length=64)
    task_id: int | None = None


class ImportPlanRequest(BaseModel):
    source_text: str = Field(min_length=1, max_length=100_000)
    title: str = Field(default="", max_length=120)
    goal: str = Field(default="", max_length=500)
    start_date: date
    target_end_date: date
    preferred_weekdays: list[int] = Field(min_length=1)
    daily_minutes: int = Field(ge=15, le=480)
    task_binding: PlanTaskBindingRequest = Field(default_factory=PlanTaskBindingRequest)


class UpdatePlanDraftRequest(BaseModel):
    snapshot: dict[str, Any]


class UpdatePlanStatusRequest(BaseModel):
    status: str = Field(min_length=1, max_length=16)


class PlanTimeLogRequest(BaseModel):
    step_id: str = Field(min_length=1, max_length=120)
    start_time: datetime
    duration_seconds: int = Field(gt=0, le=86_400)
    source: str = Field(default="timer", min_length=1, max_length=16)
    note: str = Field(default="", max_length=500)
    record_date: date | None = None


class CompletePlanStepRequest(BaseModel):
    actual_minutes: int = Field(default=0, ge=0, le=1_440)
    time_note: str = Field(default="", max_length=500)
    evidence_text: str = Field(default="", max_length=2_000)
    evidence_url: str = Field(default="", max_length=1_000)


class PlanReviewRequest(BaseModel):
    review_date: date
    summary: str = Field(default="", max_length=2_000)
    blockers: str = Field(default="", max_length=2_000)
    next_week_minutes: int | None = Field(default=None, ge=15, le=480)


class CreateTodoRequest(BaseModel):
    task_id: int = 0
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    due_date: date | None = None


class UpdateTodoRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    due_date: date | None = None
    completed: bool | None = None


class CreateFocusSessionRequest(BaseModel):
    task_id: int
    attr_id: int | None = None
    start_time: datetime
    record_date: date | None = None
    duration_seconds: int = Field(gt=0)
    plan_id: str | None = Field(default=None, max_length=120)
    step_id: str | None = Field(default=None, max_length=120)
    note: str = Field(default="", max_length=500)


class AiProviderConfigRequest(BaseModel):
    api_key_input: str | None = None
    clear_api_key: bool = False
    base_url: str | None = None
    model_name: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    stream: bool | None = None
    timeout_seconds: int | None = Field(default=None, ge=5, le=600)


class UpdateAiSettingsRequest(BaseModel):
    mode: str = Field(min_length=1, max_length=16)
    provider_id: str | None = Field(default=None, max_length=64)
    provider_configs: dict[str, AiProviderConfigRequest] = Field(default_factory=dict)


class TestAiSettingsConnectionRequest(BaseModel):
    mode: str = Field(min_length=1, max_length=16)
    provider_id: str | None = Field(default=None, max_length=64)
    config: AiProviderConfigRequest = Field(default_factory=AiProviderConfigRequest)


class AiSummaryRequest(BaseModel):
    task_id: int = Field(gt=0)
    attr_id: int = Field(gt=0)
    record_date: date


class LearningProfileRequest(BaseModel):
    course_id: str = Field(min_length=1, max_length=64)
    conversation: str = Field(min_length=10, max_length=4000)
    preferred_goal: str = Field(default="", max_length=200)
    weekly_days: int | None = Field(default=None, ge=1, le=7)
    daily_minutes: int | None = Field(default=None, ge=10, le=300)


class LearningResourcePackageRequest(LearningProfileRequest):
    pass


# ── Phase 2: Session-based learning ───────────────────

class CreateLearningSessionRequest(BaseModel):
    course_id: str = Field(min_length=1, max_length=64)
    conversation: str = Field(min_length=10, max_length=4000)
    preferred_goal: str = Field(default="", max_length=200)
    weekly_days: int = Field(default=4, ge=1, le=7)
    daily_minutes: int = Field(default=50, ge=10, le=300)
    title: str | None = Field(default=None, max_length=128)


class UpdateLearningSessionProfileRequest(BaseModel):
    conversation: str = Field(min_length=10, max_length=4000)
    preferred_goal: str | None = Field(default=None, max_length=200)
    weekly_days: int | None = Field(default=None, ge=1, le=7)
    daily_minutes: int | None = Field(default=None, ge=10, le=300)


# ── Phase 3: Tutor ─────────────────────────────────────

class LearningTutorRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
