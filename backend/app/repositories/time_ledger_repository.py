from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.db import Database


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class TimeLedgerRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def record_session(
        self,
        *,
        task_id: int,
        attr_id: int | None,
        start_time: str,
        record_date: str,
        duration_seconds: int,
        source_type: str = "task",
        source_id: str | None = None,
        note: str = "",
        plan_id: str | None = None,
        step_id: str | None = None,
    ) -> dict[str, Any]:
        now = _utc_now()
        with self.db.session() as conn:
            cur = conn.execute(
                """
                INSERT INTO focus_sessions (
                    task_id, attr_id, start_time, record_date, duration_seconds,
                    source_type, source_id, note, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    attr_id,
                    start_time,
                    record_date,
                    duration_seconds,
                    source_type,
                    source_id,
                    note,
                    now,
                ),
            )
            focus_session_id = int(cur.lastrowid)

            attr_value_today: float | None = None
            if attr_id is not None and attr_id != 4:
                attr_value_today = self._upsert_daily_delta(
                    conn, task_id, attr_id, record_date, duration_seconds
                )
            focus_value_today = self._upsert_daily_delta(
                conn, task_id, 4, record_date, duration_seconds
            )

            plan_log_id: int | None = None
            if plan_id and step_id:
                link = conn.execute(
                    """
                    INSERT INTO plan_time_logs (
                        plan_id, step_id, focus_session_id, created_at
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (plan_id, step_id, focus_session_id, now),
                )
                plan_log_id = int(link.lastrowid)
                conn.execute(
                    """
                    INSERT INTO plan_step_states (
                        plan_id, step_id, status, evidence_json, completed_at, updated_at
                    ) VALUES (?, ?, 'in_progress', '[]', NULL, ?)
                    ON CONFLICT(plan_id, step_id) DO UPDATE SET
                        status = 'in_progress',
                        completed_at = NULL,
                        updated_at = excluded.updated_at
                    WHERE plan_step_states.status = 'pending'
                    """,
                    (plan_id, step_id, now),
                )

            return {
                "id": focus_session_id,
                "task_id": task_id,
                "attr_id": attr_id,
                "start_time": start_time,
                "record_date": record_date,
                "duration_seconds": duration_seconds,
                "source_type": source_type,
                "source_id": source_id,
                "note": note,
                "created_at": now,
                "attr_value_today": attr_value_today,
                "focus_attr_id": 4,
                "focus_attr_value_today": focus_value_today,
                "plan_log_id": plan_log_id,
            }

    @staticmethod
    def _upsert_daily_delta(conn, task_id: int, attr_id: int, record_date: str, delta: int) -> float:
        conn.execute(
            """
            INSERT INTO task_data (
                task_id, attr_id, data_value, record_date, create_time
            ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(task_id, attr_id, record_date) DO UPDATE SET
                data_value = task_data.data_value + excluded.data_value,
                create_time = CURRENT_TIMESTAMP
            """,
            (task_id, attr_id, float(delta), record_date),
        )
        row = conn.execute(
            "SELECT data_value FROM task_data WHERE task_id = ? AND attr_id = ? AND record_date = ?",
            (task_id, attr_id, record_date),
        ).fetchone()
        return float(row["data_value"] or 0) if row else 0.0
