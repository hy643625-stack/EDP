from __future__ import annotations

from datetime import date

from app.errors import ApiError
from app.repositories.focus_repository import FocusRepository
from app.repositories.task_repository import TaskRepository


class FocusService:
    def __init__(self, repo: FocusRepository, task_repo: TaskRepository) -> None:
        self.repo = repo
        self.task_repo = task_repo

    def create_session(self, payload: dict) -> dict:
        task_id = payload["task_id"]
        if task_id == 1:
            raise ApiError("BAD_REQUEST", "总览任务不能直接记录专注，请切换到具体任务", 400)
        if task_id <= 0:
            raise ApiError("BAD_REQUEST", "任务 ID 无效", 400)
        if not self.task_repo.task_exists(task_id):
            raise ApiError("NOT_FOUND", "任务不存在", 404)
        return self.repo.create_session(payload)

    def list_sessions(
        self,
        task_id: int | None,
        start_date: str | None,
        end_date: str | None,
    ) -> list[dict]:
        resolved_task_id = self._resolve_scope(task_id)
        if resolved_task_id is not None and not self.task_repo.task_exists(resolved_task_id):
            raise ApiError("NOT_FOUND", "任务不存在", 404)
        return self.repo.list_sessions(resolved_task_id, start_date, end_date)

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
