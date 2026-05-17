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
    start_time: datetime
    duration_seconds: int = Field(gt=0)


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
