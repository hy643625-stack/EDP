from __future__ import annotations

from datetime import datetime

from app.errors import ApiError
from app.repositories.record_repository import RecordRepository
from app.repositories.task_repository import TaskRepository


class RecordService:
    def __init__(self, repo: RecordRepository, task_repo: TaskRepository) -> None:
        self.repo = repo
        self.task_repo = task_repo

    def upsert_records(self, task_id: int, record_date: str, values: list[dict]) -> None:
        if not self.task_repo.task_exists(task_id):
            raise ApiError("NOT_FOUND", "任务不存在", 404)
        self._validate_date(record_date)

        if not values:
            raise ApiError("BAD_REQUEST", "values 不能为空", 400)

        attrs = {item["attr_id"] for item in self.task_repo.list_attrs(task_id)}
        for item in values:
            if item["attr_id"] not in attrs:
                raise ApiError("BAD_REQUEST", f"属性 {item['attr_id']} 不属于任务 {task_id}", 400)

        self.repo.upsert_records(task_id, record_date, values)

    def list_records(
        self,
        task_id: int,
        start_date: str | None,
        end_date: str | None,
    ) -> list[dict]:
        if not self.task_repo.task_exists(task_id):
            raise ApiError("NOT_FOUND", "任务不存在", 404)

        if start_date:
            self._validate_date(start_date)
        if end_date:
            self._validate_date(end_date)

        return self.repo.list_records(task_id, start_date, end_date)

    @staticmethod
    def _validate_date(raw: str) -> None:
        try:
            datetime.strptime(raw, "%Y-%m-%d")
        except ValueError as exc:
            raise ApiError("BAD_REQUEST", f"日期格式错误: {raw}，应为 YYYY-MM-DD", 400) from exc
