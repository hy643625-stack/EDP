from __future__ import annotations

from app.db import Database


def _in_clause(values: list[int]) -> tuple[str, tuple[object, ...]]:
    placeholders = ", ".join("?" for _ in values)
    return f"({placeholders})", tuple(values)


class HomeRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def list_tasks(self, task_ids: list[int] | None = None) -> list[dict]:
        clauses = ["task_id != 1"]
        params: list[object] = []
        if task_ids:
            in_sql, in_params = _in_clause(task_ids)
            clauses.append(f"task_id IN {in_sql}")
            params.extend(in_params)

        where_sql = " AND ".join(clauses)
        with self.db.session() as conn:
            rows = conn.execute(
                f"""
                SELECT task_id, task_name, task_color, task_desc, create_time
                FROM task_main
                WHERE {where_sql}
                ORDER BY task_id ASC
                """,
                tuple(params),
            ).fetchall()
            return [dict(row) for row in rows]

    def list_record_cards(self, task_ids: list[int]) -> list[dict]:
        if not task_ids:
            return []
        in_sql, in_params = _in_clause(task_ids)

        with self.db.session() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    tm.task_id,
                    tm.task_name,
                    tm.task_color,
                    rel.attr_id,
                    attr.attr_name,
                    rel.attr_record,
                    rel.attr_sign,
                    rel.target_value,
                    rel.attr_unit,
                    rel.weight,
                    rel.calc_type,
                    rel.calc_config
                FROM task_attr_relation rel
                JOIN task_attr attr ON rel.attr_id = attr.attr_id
                JOIN task_main tm ON tm.task_id = rel.task_id
                WHERE rel.task_id IN {in_sql}
                  AND rel.attr_record = 1
                  AND rel.attr_sign = 0
                ORDER BY rel.task_id ASC, rel.display_order ASC, rel.attr_id ASC
                """,
                tuple(in_params),
            ).fetchall()
            return [dict(row) for row in rows]

    def list_records_on_date(self, task_ids: list[int], record_date: str) -> list[dict]:
        if not task_ids:
            return []
        in_sql, in_params = _in_clause(task_ids)
        params = [record_date, *in_params]
        with self.db.session() as conn:
            rows = conn.execute(
                f"""
                SELECT task_id, attr_id, data_value, create_time
                FROM task_data
                WHERE record_date = ?
                  AND task_id IN {in_sql}
                """,
                tuple(params),
            ).fetchall()
            return [dict(row) for row in rows]

    def list_last_record_times(self, task_ids: list[int]) -> list[dict]:
        if not task_ids:
            return []
        in_sql, in_params = _in_clause(task_ids)
        with self.db.session() as conn:
            rows = conn.execute(
                f"""
                SELECT task_id, attr_id, MAX(create_time) AS last_record_time
                FROM task_data
                WHERE task_id IN {in_sql}
                GROUP BY task_id, attr_id
                """,
                tuple(in_params),
            ).fetchall()
            return [dict(row) for row in rows]

    def todo_summary(self, task_ids: list[int] | None, target_date: str) -> dict:
        clauses: list[str] = []
        params: list[object] = []
        if task_ids:
            in_sql, in_params = _in_clause(task_ids)
            clauses.append(f"task_id IN {in_sql}")
            params.extend(in_params)

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        completed_where = f"{where_sql} {'AND' if where_sql else 'WHERE'} completed = 1"
        today_where = f"{completed_where} AND completed_date = ?"

        with self.db.session() as conn:
            total = conn.execute(
                f"SELECT COUNT(1) AS n FROM todo_items {where_sql}",
                tuple(params),
            ).fetchone()["n"]
            completed = conn.execute(
                f"SELECT COUNT(1) AS n FROM todo_items {completed_where}",
                tuple(params),
            ).fetchone()["n"]
            today = conn.execute(
                f"SELECT COUNT(1) AS n FROM todo_items {today_where}",
                tuple([*params, target_date]),
            ).fetchone()["n"]

        return {"total": total, "completed": completed, "todayCompleted": today}

    def focus_summary(self, task_ids: list[int] | None, target_date: str) -> dict:
        clauses: list[str] = []
        params: list[object] = []
        if task_ids:
            in_sql, in_params = _in_clause(task_ids)
            clauses.append(f"task_id IN {in_sql}")
            params.extend(in_params)

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        today_where = f"{where_sql} {'AND' if where_sql else 'WHERE'} DATE(start_time) = ?"
        with self.db.session() as conn:
            total_seconds = conn.execute(
                f"""
                SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds
                FROM focus_sessions
                {where_sql}
                """,
                tuple(params),
            ).fetchone()["total_seconds"]
            today_seconds = conn.execute(
                f"""
                SELECT COALESCE(SUM(duration_seconds), 0) AS today_seconds
                FROM focus_sessions
                {today_where}
                """,
                tuple([*params, target_date]),
            ).fetchone()["today_seconds"]
        return {"todaySeconds": today_seconds, "totalSeconds": total_seconds}

    def apply_entries(self, record_date: str, entries: list[dict]) -> dict:
        updated = 0
        deleted = 0
        with self.db.session() as conn:
            for item in entries:
                task_id = int(item["task_id"])
                attr_id = int(item["attr_id"])
                value = item["value"]
                if value is None:
                    conn.execute(
                        """
                        DELETE FROM task_data
                        WHERE task_id = ? AND attr_id = ? AND record_date = ?
                        """,
                        (task_id, attr_id, record_date),
                    )
                    deleted += 1
                    continue

                conn.execute(
                    """
                    INSERT INTO task_data (task_id, attr_id, data_value, record_date, create_time)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(task_id, attr_id, record_date)
                    DO UPDATE SET
                        data_value = excluded.data_value,
                        create_time = CURRENT_TIMESTAMP
                    """,
                    (task_id, attr_id, value, record_date),
                )
                updated += 1

        return {"updated": updated, "deleted": deleted}

    def get_attr_card(self, task_id: int, attr_id: int) -> dict | None:
        with self.db.session() as conn:
            row = conn.execute(
                """
                SELECT
                    tm.task_id,
                    tm.task_name,
                    tm.task_color,
                    rel.attr_id,
                    attr.attr_name,
                    rel.attr_record,
                    rel.attr_sign,
                    rel.target_value,
                    rel.attr_unit,
                    rel.weight,
                    rel.calc_type,
                    rel.calc_config
                FROM task_attr_relation rel
                JOIN task_attr attr ON rel.attr_id = attr.attr_id
                JOIN task_main tm ON tm.task_id = rel.task_id
                WHERE rel.task_id = ? AND rel.attr_id = ?
                LIMIT 1
                """,
                (task_id, attr_id),
            ).fetchone()
            return dict(row) if row else None

    def list_attr_records_in_range(
        self,
        task_id: int,
        attr_id: int,
        start_date: str | None,
        end_date: str | None,
    ) -> list[dict]:
        clauses = ["task_id = ?", "attr_id = ?"]
        params: list[object] = [task_id, attr_id]
        if start_date:
            clauses.append("record_date >= ?")
            params.append(start_date)
        if end_date:
            clauses.append("record_date <= ?")
            params.append(end_date)
        where_sql = " AND ".join(clauses)

        with self.db.session() as conn:
            rows = conn.execute(
                f"""
                SELECT record_date, data_value
                FROM task_data
                WHERE {where_sql}
                ORDER BY record_date ASC
                """,
                tuple(params),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_earliest_attr_record_date(self, task_id: int, attr_id: int) -> str | None:
        with self.db.session() as conn:
            row = conn.execute(
                """
                SELECT MIN(record_date) AS earliest_date
                FROM task_data
                WHERE task_id = ? AND attr_id = ?
                """,
                (task_id, attr_id),
            ).fetchone()
            if row is None:
                return None
            raw = row["earliest_date"]
            return str(raw) if raw else None

    def list_task_attrs(self, task_id: int) -> list[dict]:
        with self.db.session() as conn:
            rows = conn.execute(
                """
                SELECT
                    rel.task_id,
                    rel.attr_id,
                    attr.attr_name,
                    rel.display_order,
                    rel.attr_sign,
                    rel.attr_record,
                    rel.target_value,
                    rel.attr_unit,
                    rel.calc_type,
                    rel.calc_config,
                    rel.weight
                FROM task_attr_relation rel
                JOIN task_attr attr ON rel.attr_id = attr.attr_id
                WHERE rel.task_id = ?
                ORDER BY rel.display_order ASC, rel.attr_id ASC
                """,
                (task_id,),
            ).fetchall()
            return [dict(row) for row in rows]

    @staticmethod
    def _upsert_daily_delta(
        conn,
        task_id: int,
        attr_id: int,
        record_date: str,
        delta_value: float,
    ) -> float:
        conn.execute(
            """
            INSERT INTO task_data (task_id, attr_id, data_value, record_date, create_time)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(task_id, attr_id, record_date)
            DO UPDATE SET
                data_value = task_data.data_value + excluded.data_value,
                create_time = CURRENT_TIMESTAMP
            """,
            (task_id, attr_id, delta_value, record_date),
        )
        row = conn.execute(
            """
            SELECT data_value
            FROM task_data
            WHERE task_id = ? AND attr_id = ? AND record_date = ?
            LIMIT 1
            """,
            (task_id, attr_id, record_date),
        ).fetchone()
        if row is None:
            return 0.0
        return float(row["data_value"] or 0.0)

    def apply_focus_capture(
        self,
        *,
        task_id: int,
        timer_attr_id: int | None,
        focus_attr_id: int,
        start_time: str,
        duration_seconds: int,
        record_date: str,
    ) -> dict:
        with self.db.session() as conn:
            cur = conn.execute(
                """
                INSERT INTO focus_sessions (task_id, start_time, duration_seconds)
                VALUES (?, ?, ?)
                """,
                (task_id, start_time, duration_seconds),
            )
            focus_session_id = int(cur.lastrowid or 0)

            timer_attr_value_today: float | None = None
            if timer_attr_id is not None:
                timer_attr_value_today = self._upsert_daily_delta(
                    conn=conn,
                    task_id=task_id,
                    attr_id=timer_attr_id,
                    record_date=record_date,
                    delta_value=float(duration_seconds),
                )

            focus_attr_value_today = self._upsert_daily_delta(
                conn=conn,
                task_id=task_id,
                attr_id=focus_attr_id,
                record_date=record_date,
                delta_value=float(duration_seconds),
            )

            return {
                "task_id": task_id,
                "timer_attr_id": timer_attr_id,
                "focus_attr_id": focus_attr_id,
                "record_date": record_date,
                "duration_seconds": duration_seconds,
                "focus_session_id": focus_session_id,
                "timer_attr_value_today": timer_attr_value_today,
                "focus_attr_value_today": focus_attr_value_today,
            }

    def update_attr_relation(
        self,
        task_id: int,
        attr_id: int,
        *,
        attr_sign: int | None = None,
        calc_config: str | None = None,
    ) -> bool:
        set_parts: list[str] = []
        values: list[object] = []
        if attr_sign is not None:
            set_parts.append("attr_sign = ?")
            values.append(attr_sign)
        if calc_config is not None:
            set_parts.append("calc_config = ?")
            values.append(calc_config)
        if not set_parts:
            return False

        values.extend([task_id, attr_id])
        with self.db.session() as conn:
            cur = conn.execute(
                f"""
                UPDATE task_attr_relation
                SET {', '.join(set_parts)}
                WHERE task_id = ? AND attr_id = ?
                """,
                tuple(values),
            )
            return cur.rowcount > 0
