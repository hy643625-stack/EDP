from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_todo_service
from app.response import success
from app.schemas import CreateTodoRequest, UpdateTodoRequest
from app.services import TodoService

router = APIRouter(prefix="/v1/todos", tags=["todos"])


@router.get("/stats")
def todo_stats(
    task_id: int | None = Query(default=None),
    target_date: str | None = Query(default=None),
    service: TodoService = Depends(get_todo_service),
):
    return success(service.stats(task_id, target_date))


@router.get("")
def list_todos(
    task_id: int | None = Query(default=None),
    service: TodoService = Depends(get_todo_service),
):
    return success(service.list_todos(task_id))


@router.post("")
def create_todo(payload: CreateTodoRequest, service: TodoService = Depends(get_todo_service)):
    item = service.create_todo(payload.model_dump())
    return success(item)


@router.patch("/{todo_id}")
def update_todo(
    todo_id: int,
    payload: UpdateTodoRequest,
    service: TodoService = Depends(get_todo_service),
):
    item = service.update_todo(todo_id, payload.model_dump(exclude_none=True))
    return success(item)


@router.delete("/{todo_id}")
def delete_todo(todo_id: int, service: TodoService = Depends(get_todo_service)):
    service.delete_todo(todo_id)
    return success({"deleted": True, "todo_id": todo_id})
