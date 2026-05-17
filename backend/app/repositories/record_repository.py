from __future__ import annotations

from app.db import Database


class RecordRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def upsert_records(self, task_id: int, record_date: str, values: list[dict]) -> None:
        with self.db.session() as conn:
            for item in values:
                conn.execute(
                    """
                    INSERT INTO task_data (task_id, attr_id, data_value, record_date, create_time)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(task_id, attr_id, record_date)
                    DO UPDATE SET
                        data_value = excluded.data_value,
                        create_time = CURRENT_TIMESTAMP
                    """,
                    (task_id, item["attr_id"], item["value"], record_date),
                )

    def list_records(self, task_id: int, start_date: str | None, end_date: str | None) -> list[dict]:
        clauses = ["d.task_id = ?"]
        params: list[object] = [task_id]

        if start_date:
            clauses.append("d.record_date >= ?")
            params.append(start_date)
        if end_date:
            clauses.append("d.record_date <= ?")
            params.append(end_date)

        where_sql = " AND ".join(clauses)

        with self.db.session() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    d.task_id,
                    d.attr_id,
                    a.attr_name,
                    d.data_value,
                    d.record_date,
                    d.create_time
                FROM task_data d
                JOIN task_attr a ON d.attr_id = a.attr_id
                WHERE {where_sql}
                ORDER BY d.record_date ASC, d.attr_id ASC
                """,
                tuple(params),
            ).fetchall()
            return [dict(row) for row in rows]
