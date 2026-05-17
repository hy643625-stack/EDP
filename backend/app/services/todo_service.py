from __future__ import annotations

from datetime import date

from app.errors import ApiError
from app.repositories.task_repository import TaskRepository
from app.repositories.todo_repository import TodoRepository


class TodoService:
    def __init__(self, repo: TodoRepository, task_repo: TaskRepository) -> None:
        self.repo = repo
        self.task_repo = task_repo

    def list_todos(self, task_id: int | None) -> list[dict]:
        resolved_task_id = self._resolve_scope(task_id)
        if resolved_task_id is not None and not self.task_repo.task_exists(resolved_task_id):
            raise ApiError("NOT_FOUND", "任务不存在", 404)
        return self.repo.list_todos(resolved_task_id)

    def create_todo(self, payload: dict) -> dict:
        task_id = payload["task_id"]
        resolved_task_id = 0 if task_id == 1 else task_id
        if resolved_task_id != 0 and not self.task_repo.task_exists(resolved_task_id):
            raise ApiError("NOT_FOUND", "任务不存在", 404)
        normalized = {**payload, "task_id": resolved_task_id}
        return self.repo.create_todo(normalized)

    def update_todo(self, todo_id: int, updates: dict) -> dict:
        if not updates:
            raise ApiError("BAD_REQUEST", "至少提供一个可更新字段", 400)
        todo = self.repo.update_todo(todo_id, updates)
        if not todo:
            raise ApiError("NOT_FOUND", "待办不存在", 404)
        return todo

    def delete_todo(self, todo_id: int) -> None:
        if not self.repo.delete_todo(todo_id):
            raise ApiError("NOT_FOUND", "待办不存在", 404)

    def stats(self, task_id: int | None, target_date: str | None) -> dict:
        resolved_task_id = self._resolve_scope(task_id)
        if resolved_task_id is not None and not self.task_repo.task_exists(resolved_task_id):
            raise ApiError("NOT_FOUND", "任务不存在", 404)
        date_str = target_date or date.today().isoformat()
        return self.repo.stats(resolved_task_id, date_str)

    @staticmethod
    def _resolve_scope(task_id: int | None) -> int | None:
        if task_id in (None, 0, 1):
            return None
        return task_id
