from __future__ import annotations

from app.db import Database


class FocusRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def create_session(self, payload: dict) -> dict:
        with self.db.session() as conn:
            cur = conn.execute(
                """
                INSERT INTO focus_sessions (task_id, start_time, duration_seconds)
                VALUES (?, ?, ?)
                """,
                (payload["task_id"], payload["start_time"], payload["duration_seconds"]),
            )
            session_id = cur.lastrowid
            row = conn.execute(
                """
                SELECT id, task_id, start_time, duration_seconds, created_at
                FROM focus_sessions
                WHERE id = ?
                """,
                (session_id,),
            ).fetchone()
            return dict(row)

    def list_sessions(
        self,
        task_id: int | None,
        start_date: str | None,
        end_date: str | None,
    ) -> list[dict]:
        clauses: list[str] = []
        params: list[object] = []

        if task_id is not None:
            clauses.append("fs.task_id = ?")
            params.append(task_id)
        if start_date:
            clauses.append("fs.record_date >= ?")
            params.append(start_date)
        if end_date:
            clauses.append("fs.record_date <= ?")
            params.append(end_date)

        where_sql = ""
        if clauses:
            where_sql = " WHERE " + " AND ".join(clauses)

        with self.db.session() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    fs.id,
                    fs.task_id,
                    tm.task_name,
                    tm.task_color,
                    fs.attr_id,
                    ta.attr_name,
                    fs.start_time,
                    fs.record_date,
                    fs.duration_seconds,
                    fs.source_type,
                    fs.source_id,
                    fs.note,
                    fs.created_at
                FROM focus_sessions fs
                LEFT JOIN task_main tm ON tm.task_id = fs.task_id
                LEFT JOIN task_attr ta ON ta.attr_id = fs.attr_id
                {where_sql}
                ORDER BY fs.start_time ASC
                """,
                tuple(params),
            ).fetchall()
            return [dict(row) for row in rows]

    def stats(self, task_id: int | None, target_date: str) -> dict:
        filters: list[str] = []
        params: list[object] = []

        if task_id is not None:
            filters.append("task_id = ?")
            params.append(task_id)

        where_base = ""
        if filters:
            where_base = " WHERE " + " AND ".join(filters)

        with self.db.session() as conn:
            total_seconds = conn.execute(
                f"""
                SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds
                FROM focus_sessions
                {where_base}
                """,
                tuple(params),
            ).fetchone()["total_seconds"]

            today_where = where_base + (" AND " if where_base else " WHERE ") + "record_date = ?"
            today_params = [*params, target_date]
            today_seconds = conn.execute(
                f"""
                SELECT COALESCE(SUM(duration_seconds), 0) AS today_seconds
                FROM focus_sessions
                {today_where}
                """,
                tuple(today_params),
            ).fetchone()["today_seconds"]

        return {
            "todaySeconds": today_seconds,
            "totalSeconds": total_seconds,
        }
