from __future__ import annotations

from fastapi import APIRouter, Depends

from app.dependencies import get_task_service
from app.response import success
from app.schemas import CreateTaskAttrRequest, CreateTaskRequest, UpdateTaskAttrRequest, UpdateTaskRequest
from app.services import TaskService

router = APIRouter(prefix="/v1/tasks", tags=["tasks"])


@router.get("")
def list_tasks(service: TaskService = Depends(get_task_service)):
    return success(service.list_tasks())


@router.post("")
def create_task(payload: CreateTaskRequest, service: TaskService = Depends(get_task_service)):
    item = service.create_task(payload.name, payload.desc, payload.task_color)
    return success(item)


@router.patch("/{task_id}")
def update_task(
    task_id: int,
    payload: UpdateTaskRequest,
    service: TaskService = Depends(get_task_service),
):
    updates = payload.model_dump(exclude_none=True)
    item = service.update_task(task_id, updates)
    return success(item)


@router.delete("/{task_id}")
def delete_task(task_id: int, service: TaskService = Depends(get_task_service)):
    service.delete_task(task_id)
    return success({"deleted": True, "task_id": task_id})


@router.get("/{task_id}/attrs")
def list_task_attrs(task_id: int, service: TaskService = Depends(get_task_service)):
    return success(service.list_attrs(task_id))


@router.post("/{task_id}/attrs")
def add_task_attr(
    task_id: int,
    payload: CreateTaskAttrRequest,
    service: TaskService = Depends(get_task_service),
):
    item = service.add_attr(task_id, payload.model_dump())
    return success(item)


@router.patch("/{task_id}/attrs/{attr_id}")
def update_task_attr(
    task_id: int,
    attr_id: int,
    payload: UpdateTaskAttrRequest,
    service: TaskService = Depends(get_task_service),
):
    updates = payload.model_dump(exclude_none=True)
    item = service.update_attr(task_id, attr_id, updates)
    return success(item)


@router.delete("/{task_id}/attrs/{attr_id}")
def delete_task_attr(
    task_id: int,
    attr_id: int,
    service: TaskService = Depends(get_task_service),
):
    service.delete_attr(task_id, attr_id)
    return success({"deleted": True, "task_id": task_id, "attr_id": attr_id})
