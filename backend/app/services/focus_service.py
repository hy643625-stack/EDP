from __future__ import annotations

import json
from datetime import date

from app.errors import ApiError
from app.repositories.focus_repository import FocusRepository
from app.repositories.task_repository import TaskRepository
from app.repositories.time_ledger_repository import TimeLedgerRepository


class FocusService:
    def __init__(
        self,
        repo: FocusRepository,
        task_repo: TaskRepository,
        time_repo: TimeLedgerRepository | None = None,
    ) -> None:
        self.repo = repo
        self.task_repo = task_repo
        self.time_repo = time_repo or TimeLedgerRepository(repo.db)

    def create_session(self, payload: dict) -> dict:
        task_id = payload["task_id"]
        if task_id == 1:
            raise ApiError("BAD_REQUEST", "总览任务不能直接记录专注，请切换到具体任务", 400)
        if task_id <= 0:
            raise ApiError("BAD_REQUEST", "任务 ID 无效", 400)
        if not self.task_repo.task_exists(task_id):
            raise ApiError("NOT_FOUND", "任务不存在", 404)
        attr_id_raw = payload.get("attr_id")
        attr_id = int(attr_id_raw) if attr_id_raw is not None else None
        if attr_id is not None:
            attrs = self.task_repo.list_attrs(task_id)
            attr = next((item for item in attrs if int(item["attr_id"]) == attr_id), None)
            if attr is None:
                raise ApiError("BAD_REQUEST", "计时属性不属于当前任务", 400)
            if not self._is_timer_attr(attr):
                raise ApiError("BAD_REQUEST", "选择的任务属性不是计时类型", 400)

        plan_id = str(payload.get("plan_id") or "").strip() or None
        step_id = str(payload.get("step_id") or "").strip() or None
        if bool(plan_id) != bool(step_id):
            raise ApiError("BAD_REQUEST", "Plan 上下文需要同时包含 plan_id 和 step_id", 400)
        if plan_id and step_id:
            self._validate_plan_context(plan_id, step_id, task_id, attr_id)

        start_time = str(payload["start_time"])
        record_date = str(payload.get("record_date") or start_time[:10])
        return self.time_repo.record_session(
            task_id=task_id,
            attr_id=attr_id,
            start_time=start_time,
            record_date=record_date,
            duration_seconds=int(payload["duration_seconds"]),
            source_type="plan_step" if plan_id else "task",
            source_id=f"{plan_id}:{step_id}" if plan_id and step_id else None,
            note=str(payload.get("note") or "")[:500],
            plan_id=plan_id,
            step_id=step_id,
        )

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

    @staticmethod
    def _is_timer_attr(attr: dict) -> bool:
        try:
            payload = json.loads(str(attr.get("calc_config") or "{}"))
        except (TypeError, json.JSONDecodeError):
            return False
        schedule = payload.get("schedule_config") if isinstance(payload, dict) else None
        source = schedule if isinstance(schedule, dict) else payload
        ux = source.get("ux_config") if isinstance(source, dict) else None
        return isinstance(ux, dict) and ux.get("input_type") == "timer"

    def _validate_plan_context(
        self,
        plan_id: str,
        step_id: str,
        task_id: int,
        attr_id: int | None,
    ) -> None:
        with self.repo.db.session() as conn:
            plan = conn.execute(
                "SELECT task_id, active_revision FROM plans WHERE id = ? AND status = 'active'",
                (plan_id,),
            ).fetchone()
            if not plan or int(plan["task_id"] or 0) != task_id:
                raise ApiError("BAD_REQUEST", "Plan 与计时任务不匹配", 400)
            revision = conn.execute(
                "SELECT plan_json FROM plan_revisions WHERE plan_id = ? AND version = ?",
                (plan_id, int(plan["active_revision"])),
            ).fetchone()
            try:
                snapshot = json.loads(str(revision["plan_json"])) if revision else {}
            except (TypeError, json.JSONDecodeError):
                snapshot = {}
            goal_id: str | None = None
            for phase in snapshot.get("phases", []):
                for milestone in phase.get("milestones", []):
                    for goal in milestone.get("weekly_goals", []):
                        if any(str(step.get("step_id")) == step_id for step in goal.get("steps", [])):
                            goal_id = str(goal.get("goal_id") or "")
                            break
            binding = conn.execute(
                "SELECT attr_id FROM plan_goal_bindings WHERE plan_id = ? AND goal_id = ?",
                (plan_id, goal_id),
            ).fetchone() if goal_id else None
            if not binding or attr_id is None or int(binding["attr_id"]) != attr_id:
                raise ApiError("BAD_REQUEST", "Plan 步骤与计时属性不匹配", 400)
