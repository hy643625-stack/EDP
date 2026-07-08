from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from app.db import Database


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class PlanRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def create_plan(self, payload: dict[str, Any], plan_snapshot: dict[str, Any]) -> dict[str, Any]:
        plan_id = uuid.uuid4().hex[:12]
        now = _utc_now()
        with self.db.session() as conn:
            conn.execute(
                """
                INSERT INTO plans (
                    id, title, goal, source_text, start_date, target_end_date,
                    preferred_weekdays_json, daily_minutes, task_binding_mode,
                    task_name_draft, task_id, owns_task, status,
                    active_revision, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'draft', 1, ?, ?)
                """,
                (
                    plan_id,
                    payload["title"],
                    payload.get("goal", ""),
                    payload["source_text"],
                    payload["start_date"],
                    payload["target_end_date"],
                    json.dumps(payload["preferred_weekdays"], ensure_ascii=False),
                    payload["daily_minutes"],
                    payload["task_binding_mode"],
                    payload.get("task_name_draft", ""),
                    payload.get("task_id"),
                    now,
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO plan_revisions (plan_id, version, reason, plan_json, created_at)
                VALUES (?, 1, 'import', ?, ?)
                """,
                (plan_id, json.dumps(plan_snapshot, ensure_ascii=False), now),
            )
        return self.get_plan(plan_id) or {}

    def list_plans(self) -> list[dict[str, Any]]:
        with self.db.session() as conn:
            rows = conn.execute(
                """
                SELECT plans.id, plans.title, plans.goal, plans.start_date,
                       plans.target_end_date, plans.daily_minutes,
                       plans.preferred_weekdays_json, plans.task_binding_mode,
                       plans.task_name_draft, plans.task_id, plans.owns_task,
                       task_main.task_name, plans.status, plans.active_revision,
                       plans.created_at, plans.updated_at
                FROM plans
                LEFT JOIN task_main ON task_main.task_id = plans.task_id
                ORDER BY status = 'active' DESC, updated_at DESC
                """
            ).fetchall()
            return [dict(row) for row in rows]

    def get_plan(self, plan_id: str) -> dict[str, Any] | None:
        with self.db.session() as conn:
            row = conn.execute(
                """
                SELECT plans.*, task_main.task_name
                FROM plans
                LEFT JOIN task_main ON task_main.task_id = plans.task_id
                WHERE plans.id = ?
                """,
                (plan_id,),
            ).fetchone()
            return dict(row) if row else None

    def get_revision(self, plan_id: str, version: int) -> dict[str, Any] | None:
        with self.db.session() as conn:
            row = conn.execute(
                "SELECT * FROM plan_revisions WHERE plan_id = ? AND version = ?",
                (plan_id, version),
            ).fetchone()
            return dict(row) if row else None

    def list_revisions(self, plan_id: str) -> list[dict[str, Any]]:
        with self.db.session() as conn:
            rows = conn.execute(
                """
                SELECT id, plan_id, version, reason, created_at
                FROM plan_revisions WHERE plan_id = ? ORDER BY version DESC
                """,
                (plan_id,),
            ).fetchall()
            return [dict(row) for row in rows]

    def update_draft(self, plan_id: str, plan_snapshot: dict[str, Any]) -> bool:
        now = _utc_now()
        with self.db.session() as conn:
            plan = conn.execute(
                "SELECT status, active_revision FROM plans WHERE id = ?", (plan_id,)
            ).fetchone()
            if not plan or plan["status"] != "draft":
                return False
            conn.execute(
                """
                UPDATE plan_revisions SET plan_json = ?
                WHERE plan_id = ? AND version = ?
                """,
                (json.dumps(plan_snapshot, ensure_ascii=False), plan_id, int(plan["active_revision"])),
            )
            conn.execute("UPDATE plans SET updated_at = ? WHERE id = ?", (now, plan_id))
            return True

    def activate(self, plan_id: str, snapshot: dict[str, Any]) -> bool:
        now = _utc_now()
        with self.db.session() as conn:
            plan = conn.execute(
                "SELECT * FROM plans WHERE id = ? AND status = 'draft'", (plan_id,)
            ).fetchone()
            if not plan:
                return False

            task_id = int(plan["task_id"] or 0)
            owns_task = int(plan["owns_task"] or 0)
            if str(plan["task_binding_mode"]) == "existing":
                if task_id <= 1 or not conn.execute(
                    "SELECT 1 FROM task_main WHERE task_id = ?", (task_id,)
                ).fetchone():
                    return False
            elif task_id <= 0:
                task_name = str(plan["task_name_draft"] or plan["title"]).strip()[:64]
                cur = conn.execute(
                    "INSERT INTO task_main (task_name, task_desc, task_color) VALUES (?, ?, ?)",
                    (task_name, str(plan["goal"] or ""), "#2563EB"),
                )
                task_id = int(cur.lastrowid)
                owns_task = 1
                Database._ensure_intrinsic_task_attrs(conn, task_id)

            Database._ensure_plan_goal_bindings(
                conn, plan_id, str(plan["title"]), task_id, snapshot
            )
            cur = conn.execute(
                "UPDATE plans SET status = 'active', updated_at = ? WHERE id = ? AND status = 'draft'",
                (now, plan_id),
            )
            conn.execute(
                "UPDATE plans SET task_id = ?, owns_task = ?, task_name_draft = COALESCE(NULLIF(task_name_draft, ''), ?) WHERE id = ?",
                (task_id, owns_task, str(plan["title"]), plan_id),
            )
            return cur.rowcount > 0

    def update_status(self, plan_id: str, status: str) -> bool:
        with self.db.session() as conn:
            cur = conn.execute(
                "UPDATE plans SET status = ?, updated_at = ? WHERE id = ?",
                (status, _utc_now(), plan_id),
            )
            return cur.rowcount > 0

    def get_step_states(self, plan_id: str) -> dict[str, dict[str, Any]]:
        with self.db.session() as conn:
            rows = conn.execute(
                "SELECT * FROM plan_step_states WHERE plan_id = ?", (plan_id,)
            ).fetchall()
            return {str(row["step_id"]): dict(row) for row in rows}

    def upsert_step_state(
        self,
        plan_id: str,
        step_id: str,
        status: str,
        evidence: list[dict[str, str]] | None = None,
        completed_at: str | None = None,
    ) -> dict[str, Any]:
        now = _utc_now()
        evidence_json = json.dumps(evidence or [], ensure_ascii=False)
        with self.db.session() as conn:
            conn.execute(
                """
                INSERT INTO plan_step_states (
                    plan_id, step_id, status, evidence_json, completed_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(plan_id, step_id) DO UPDATE SET
                    status = excluded.status,
                    evidence_json = excluded.evidence_json,
                    completed_at = excluded.completed_at,
                    updated_at = excluded.updated_at
                """,
                (plan_id, step_id, status, evidence_json, completed_at, now),
            )
            row = conn.execute(
                "SELECT * FROM plan_step_states WHERE plan_id = ? AND step_id = ?",
                (plan_id, step_id),
            ).fetchone()
            return dict(row)

    def get_time_totals(self, plan_id: str) -> dict[str, int]:
        with self.db.session() as conn:
            rows = conn.execute(
                """
                SELECT logs.step_id, COALESCE(SUM(sessions.duration_seconds), 0) AS total_seconds
                FROM plan_time_logs logs
                JOIN focus_sessions sessions ON sessions.id = logs.focus_session_id
                WHERE logs.plan_id = ? GROUP BY logs.step_id
                """,
                (plan_id,),
            ).fetchall()
            return {str(row["step_id"]): int(row["total_seconds"]) for row in rows}

    def get_goal_bindings(self, plan_id: str) -> dict[str, dict[str, Any]]:
        with self.db.session() as conn:
            rows = conn.execute(
                """
                SELECT bindings.goal_id, bindings.task_id, bindings.attr_id,
                       attrs.attr_name, bindings.archived_at
                FROM plan_goal_bindings bindings
                JOIN task_attr attrs ON attrs.attr_id = bindings.attr_id
                WHERE bindings.plan_id = ?
                """,
                (plan_id,),
            ).fetchall()
            return {str(row["goal_id"]): dict(row) for row in rows}

    def get_goal_time_totals(self, plan_id: str) -> dict[str, int]:
        with self.db.session() as conn:
            rows = conn.execute(
                """
                SELECT bindings.goal_id, COALESCE(SUM(sessions.duration_seconds), 0) AS total_seconds
                FROM plan_goal_bindings bindings
                LEFT JOIN focus_sessions sessions
                  ON sessions.task_id = bindings.task_id AND sessions.attr_id = bindings.attr_id
                WHERE bindings.plan_id = ?
                GROUP BY bindings.goal_id
                """,
                (plan_id,),
            ).fetchall()
            return {str(row["goal_id"]): int(row["total_seconds"]) for row in rows}

    def get_period_time_total(self, plan_id: str, start_date: str, end_date: str) -> int:
        with self.db.session() as conn:
            row = conn.execute(
                """
                SELECT COALESCE(SUM(sessions.duration_seconds), 0) AS total_seconds
                FROM plan_goal_bindings bindings
                JOIN focus_sessions sessions
                  ON sessions.task_id = bindings.task_id AND sessions.attr_id = bindings.attr_id
                WHERE bindings.plan_id = ?
                  AND sessions.record_date BETWEEN ? AND ?
                """,
                (plan_id, start_date, end_date),
            ).fetchone()
            return int(row["total_seconds"] or 0) if row else 0

    def create_review(
        self,
        plan_id: str,
        base_revision: int,
        review_input: dict[str, Any],
        proposal: dict[str, Any],
    ) -> dict[str, Any]:
        now = _utc_now()
        with self.db.session() as conn:
            cur = conn.execute(
                """
                INSERT INTO plan_reviews (
                    plan_id, base_revision, status, review_input_json, proposal_json, created_at
                ) VALUES (?, ?, 'pending', ?, ?, ?)
                """,
                (
                    plan_id,
                    base_revision,
                    json.dumps(review_input, ensure_ascii=False),
                    json.dumps(proposal, ensure_ascii=False),
                    now,
                ),
            )
            row = conn.execute("SELECT * FROM plan_reviews WHERE id = ?", (cur.lastrowid,)).fetchone()
            return dict(row)

    def get_review(self, plan_id: str, review_id: int) -> dict[str, Any] | None:
        with self.db.session() as conn:
            row = conn.execute(
                "SELECT * FROM plan_reviews WHERE id = ? AND plan_id = ?",
                (review_id, plan_id),
            ).fetchone()
            return dict(row) if row else None

    def list_reviews(self, plan_id: str) -> list[dict[str, Any]]:
        with self.db.session() as conn:
            rows = conn.execute(
                """
                SELECT id, plan_id, base_revision, status, review_input_json,
                       proposal_json, created_at, applied_at
                FROM plan_reviews WHERE plan_id = ? ORDER BY id DESC
                """,
                (plan_id,),
            ).fetchall()
            return [dict(row) for row in rows]

    def apply_review(self, plan_id: str, review_id: int, plan_snapshot: dict[str, Any]) -> int | None:
        now = _utc_now()
        with self.db.session() as conn:
            plan = conn.execute(
                "SELECT active_revision FROM plans WHERE id = ?", (plan_id,)
            ).fetchone()
            review = conn.execute(
                "SELECT status, base_revision FROM plan_reviews WHERE id = ? AND plan_id = ?",
                (review_id, plan_id),
            ).fetchone()
            if not plan or not review or review["status"] != "pending":
                return None
            if int(plan["active_revision"]) != int(review["base_revision"]):
                return None
            next_version = int(plan["active_revision"]) + 1
            conn.execute(
                """
                INSERT INTO plan_revisions (plan_id, version, reason, plan_json, created_at)
                VALUES (?, ?, 'weekly_review', ?, ?)
                """,
                (plan_id, next_version, json.dumps(plan_snapshot, ensure_ascii=False), now),
            )
            full_plan = conn.execute(
                "SELECT title, task_id FROM plans WHERE id = ?", (plan_id,)
            ).fetchone()
            if full_plan and int(full_plan["task_id"] or 0) > 0:
                Database._ensure_plan_goal_bindings(
                    conn,
                    plan_id,
                    str(full_plan["title"]),
                    int(full_plan["task_id"]),
                    plan_snapshot,
                )
            conn.execute(
                "UPDATE plans SET active_revision = ?, updated_at = ? WHERE id = ?",
                (next_version, now, plan_id),
            )
            conn.execute(
                "UPDATE plan_reviews SET status = 'applied', applied_at = ? WHERE id = ?",
                (now, review_id),
            )
            return next_version

    def reject_review(self, plan_id: str, review_id: int) -> bool:
        with self.db.session() as conn:
            cur = conn.execute(
                """
                UPDATE plan_reviews SET status = 'rejected'
                WHERE id = ? AND plan_id = ? AND status = 'pending'
                """,
                (review_id, plan_id),
            )
            return cur.rowcount > 0
