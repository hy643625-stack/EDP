from __future__ import annotations

from datetime import date

from app.db import Database


def _sqlite_date_value(value: object) -> object:
    if isinstance(value, date):
        return value.isoformat()
    return value


class TodoRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def list_todos(self, task_id: int | None = None) -> list[dict]:
        sql = """
            SELECT id, task_id, title, description, due_date, completed, completed_date, created_at, updated_at
            FROM todo_items
        """
        params: list[object] = []
        if task_id is not None:
            sql += " WHERE task_id = ?"
            params.append(task_id)
        sql += " ORDER BY due_date ASC, created_at DESC"

        with self.db.session() as conn:
            rows = conn.execute(sql, tuple(params)).fetchall()
            result = []
            for row in rows:
                item = dict(row)
                item["completed"] = bool(item["completed"])
                result.append(item)
            return result

    def create_todo(self, payload: dict) -> dict:
        with self.db.session() as conn:
            cur = conn.execute(
                """
                INSERT INTO todo_items (task_id, title, description, due_date)
                VALUES (?, ?, ?, ?)
                """,
                (
                    payload["task_id"],
                    payload["title"],
                    payload.get("description", ""),
                    _sqlite_date_value(payload.get("due_date")),
                ),
            )
            todo_id = cur.lastrowid
            row = conn.execute(
                """
                SELECT id, task_id, title, description, due_date, completed, completed_date, created_at, updated_at
                FROM todo_items WHERE id = ?
                """,
                (todo_id,),
            ).fetchone()
            item = dict(row)
            item["completed"] = bool(item["completed"])
            return item

    def update_todo(self, todo_id: int, updates: dict) -> dict | None:
        mapping = {
            "title": "title",
            "description": "description",
            "due_date": "due_date",
            "completed": "completed",
        }

        set_parts: list[str] = []
        values: list[object] = []
        completed_value = updates.get("completed")

        for key, value in updates.items():
            if key not in mapping:
                continue
            db_col = mapping[key]
            if key == "completed":
                set_parts.append(f"{db_col} = ?")
                values.append(1 if value else 0)
            else:
                set_parts.append(f"{db_col} = ?")
                values.append(_sqlite_date_value(value))

        if "completed" in updates:
            if completed_value:
                set_parts.append("completed_date = ?")
                values.append(date.today().isoformat())
            else:
                set_parts.append("completed_date = NULL")

        if not set_parts:
            return None

        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values.append(todo_id)

        with self.db.session() as conn:
            cur = conn.execute(
                f"UPDATE todo_items SET {', '.join(set_parts)} WHERE id = ?",
                tuple(values),
            )
            if cur.rowcount == 0:
                return None
            row = conn.execute(
                """
                SELECT id, task_id, title, description, due_date, completed, completed_date, created_at, updated_at
                FROM todo_items WHERE id = ?
                """,
                (todo_id,),
            ).fetchone()
            item = dict(row)
            item["completed"] = bool(item["completed"])
            return item

    def delete_todo(self, todo_id: int) -> bool:
        with self.db.session() as conn:
            cur = conn.execute("DELETE FROM todo_items WHERE id = ?", (todo_id,))
            return cur.rowcount > 0

    def stats(self, task_id: int | None, target_date: str) -> dict:
        filters: list[str] = []
        params: list[object] = []

        if task_id is not None:
            filters.append("task_id = ?")
            params.append(task_id)

        where_clause = ""
        if filters:
            where_clause = " WHERE " + " AND ".join(filters)

        with self.db.session() as conn:
            total = conn.execute(
                f"SELECT COUNT(1) AS n FROM todo_items{where_clause}",
                tuple(params),
            ).fetchone()["n"]

            completed_where = where_clause + (" AND " if where_clause else " WHERE ") + "completed = 1"
            completed = conn.execute(
                f"SELECT COUNT(1) AS n FROM todo_items{completed_where}",
                tuple(params),
            ).fetchone()["n"]

            today_where = completed_where + " AND completed_date = ?"
            today_params = [*params, target_date]
            today_completed = conn.execute(
                f"SELECT COUNT(1) AS n FROM todo_items{today_where}",
                tuple(today_params),
            ).fetchone()["n"]

        return {
            "total": total,
            "completed": completed,
            "todayCompleted": today_completed,
        }
