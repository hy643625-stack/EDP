from __future__ import annotations

import sqlite3

from app.errors import ApiError
from app.repositories.task_repository import TaskRepository


class TaskService:
    def __init__(self, repo: TaskRepository) -> None:
        self.repo = repo

    def list_tasks(self) -> list[dict]:
        return self.repo.list_tasks()

    def create_task(self, name: str, desc: str, color: str) -> dict:
        try:
            return self.repo.create_task(name=name, desc=desc, color=color)
        except sqlite3.IntegrityError as exc:
            raise ApiError("BAD_REQUEST", "任务名称已存在", 400) from exc

    def update_task(self, task_id: int, payload: dict) -> dict:
        if task_id == 1:
            raise ApiError("BAD_REQUEST", "总览任务不能修改", 400)
        updates = {key: value for key, value in payload.items() if key in {"name", "desc", "task_color"}}
        if not updates:
            raise ApiError("BAD_REQUEST", "任务修改内容不能为空", 400)
        try:
            item = self.repo.update_task(task_id, updates)
        except sqlite3.IntegrityError as exc:
            raise ApiError("BAD_REQUEST", "任务名称已存在", 400) from exc
        if not item:
            raise ApiError("NOT_FOUND", "任务不存在", 404)
        return item

    def delete_task(self, task_id: int) -> None:
        if task_id == 1:
            raise ApiError("BAD_REQUEST", "总览任务不能删除", 400)
        deleted = self.repo.delete_task(task_id)
        if not deleted:
            raise ApiError("NOT_FOUND", "任务不存在", 404)

    def list_attrs(self, task_id: int) -> list[dict]:
        if not self.repo.task_exists(task_id):
            raise ApiError("NOT_FOUND", "任务不存在", 404)
        return self.repo.list_attrs(task_id)

    def add_attr(self, task_id: int, payload: dict) -> dict:
        if not self.repo.task_exists(task_id):
            raise ApiError("NOT_FOUND", "任务不存在", 404)
        try:
            return self.repo.add_attr(task_id, payload)
        except sqlite3.IntegrityError as exc:
            raise ApiError("BAD_REQUEST", "属性已绑定到该任务", 400) from exc

    def update_attr(self, task_id: int, attr_id: int, payload: dict) -> dict:
        if not self.repo.task_exists(task_id):
            raise ApiError("NOT_FOUND", "任务不存在", 404)
        try:
            attr = self.repo.update_attr(task_id, attr_id, payload)
        except sqlite3.IntegrityError as exc:
            raise ApiError("BAD_REQUEST", "属性已绑定到该任务", 400) from exc
        if not attr:
            raise ApiError("NOT_FOUND", "任务属性不存在或无可更新字段", 404)
        return attr

    def delete_attr(self, task_id: int, attr_id: int) -> None:
        if not self.repo.task_exists(task_id):
            raise ApiError("NOT_FOUND", "任务不存在", 404)
        attrs = self.repo.list_attrs(task_id)
        target = next((item for item in attrs if item["attr_id"] == attr_id), None)
        if target is None:
            raise ApiError("NOT_FOUND", "任务属性不存在", 404)
        if target["attr_sign"] != 0:
            raise ApiError("BAD_REQUEST", "固有属性不允许删除", 400)
        deleted = self.repo.delete_attr(task_id, attr_id)
        if not deleted:
            raise ApiError("NOT_FOUND", "任务属性不存在", 404)
