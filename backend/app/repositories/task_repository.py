from __future__ import annotations

import sqlite3

from app.db import Database


class TaskRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    def list_tasks(self) -> list[dict]:
        with self.db.session() as conn:
            rows = conn.execute(
                """
                SELECT task_id, task_name, attr_num, create_time, task_desc, task_color
                FROM task_main
                ORDER BY task_id ASC
                """
            ).fetchall()
            return [dict(row) for row in rows]

    def task_exists(self, task_id: int) -> bool:
        with self.db.session() as conn:
            row = conn.execute(
                "SELECT 1 FROM task_main WHERE task_id = ?",
                (task_id,),
            ).fetchone()
            return row is not None

    def task_has_plan(self, task_id: int) -> bool:
        with self.db.session() as conn:
            row = conn.execute(
                "SELECT 1 FROM plans WHERE task_id = ? LIMIT 1", (task_id,)
            ).fetchone()
            return row is not None

    def create_task(self, name: str, desc: str, color: str) -> dict:
        with self.db.session() as conn:
            cur = conn.execute(
                """
                INSERT INTO task_main (task_name, task_desc, task_color)
                VALUES (?, ?, ?)
                """,
                (name, desc, color),
            )
            task_id = cur.lastrowid
            self._ensure_intrinsic_attrs(conn, int(task_id))
            self._refresh_attr_num(conn, int(task_id))
            row = conn.execute(
                """
                SELECT task_id, task_name, attr_num, create_time, task_desc, task_color
                FROM task_main
                WHERE task_id = ?
                """,
                (task_id,),
            ).fetchone()
            return dict(row)

    def update_task(self, task_id: int, updates: dict) -> dict | None:
        if not updates:
            return None
        mapping = {
            "name": "task_name",
            "desc": "task_desc",
            "task_color": "task_color",
        }
        set_parts: list[str] = []
        values: list[object] = []
        for key, value in updates.items():
            if key not in mapping:
                continue
            set_parts.append(f"{mapping[key]} = ?")
            values.append(value)
        if not set_parts:
            return None

        with self.db.session() as conn:
            values.append(task_id)
            cur = conn.execute(
                f"UPDATE task_main SET {', '.join(set_parts)} WHERE task_id = ?",
                tuple(values),
            )
            if cur.rowcount <= 0:
                return None
            row = conn.execute(
                """
                SELECT task_id, task_name, attr_num, create_time, task_desc, task_color
                FROM task_main
                WHERE task_id = ?
                """,
                (task_id,),
            ).fetchone()
            return dict(row) if row else None

    def _ensure_intrinsic_attrs(self, conn: sqlite3.Connection, task_id: int) -> None:
        conn.executemany(
            """
            INSERT OR IGNORE INTO task_attr_relation (
                task_id, attr_id, display_order, attr_sign, attr_record,
                target_value, attr_unit, calc_type, calc_config, weight
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (task_id, 1, 899, 1, -1, -1, "天", "00000010", "{}", 0),
                (task_id, 4, 900, 1, -1, -1, "秒", "00000010", "{}", 0),
                (task_id, 5, 901, 1, -1, -1, "", "00000010", "{}", 0),
            ],
        )

    def delete_task(self, task_id: int) -> bool:
        with self.db.session() as conn:
            conn.execute("DELETE FROM todo_items WHERE task_id = ?", (task_id,))
            conn.execute("DELETE FROM focus_sessions WHERE task_id = ?", (task_id,))
            conn.execute("DELETE FROM task_data WHERE task_id = ?", (task_id,))
            conn.execute("DELETE FROM task_attr_relation WHERE task_id = ?", (task_id,))
            cur = conn.execute("DELETE FROM task_main WHERE task_id = ?", (task_id,))
            return cur.rowcount > 0

    def list_attrs(self, task_id: int) -> list[dict]:
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

    def _get_or_create_attr(self, conn: sqlite3.Connection, attr_name: str) -> int:
        row = conn.execute(
            "SELECT attr_id FROM task_attr WHERE attr_name = ?",
            (attr_name,),
        ).fetchone()
        if row:
            return row["attr_id"]
        cur = conn.execute(
            "INSERT INTO task_attr (attr_name) VALUES (?)",
            (attr_name,),
        )
        return int(cur.lastrowid)

    def add_attr(self, task_id: int, payload: dict) -> dict:
        with self.db.session() as conn:
            attr_id = self._get_or_create_attr(conn, payload["attr_name"])
            conn.execute(
                """
                INSERT INTO task_attr_relation (
                    task_id, attr_id, display_order, attr_sign, attr_record,
                    target_value, attr_unit, calc_type, calc_config, weight
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    attr_id,
                    payload["display_order"],
                    payload["attr_sign"],
                    payload["attr_record"],
                    payload["target_value"],
                    payload["unit"],
                    payload["calc_type"],
                    payload["calc_config"],
                    payload["weight"],
                ),
            )
            self._refresh_attr_num(conn, task_id)
            row = conn.execute(
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
                WHERE rel.task_id = ? AND rel.attr_id = ?
                """,
                (task_id, attr_id),
            ).fetchone()
            return dict(row)

    def update_attr(self, task_id: int, attr_id: int, updates: dict) -> dict | None:
        if not updates:
            return None
        mapping = {
            "display_order": "display_order",
            "attr_sign": "attr_sign",
            "attr_record": "attr_record",
            "target_value": "target_value",
            "unit": "attr_unit",
            "calc_type": "calc_type",
            "calc_config": "calc_config",
            "weight": "weight",
        }
        set_parts: list[str] = []
        values: list[object] = []
        for key, value in updates.items():
            if key not in mapping:
                continue
            set_parts.append(f"{mapping[key]} = ?")
            values.append(value)

        incoming_attr_name = updates.get("attr_name")
        has_attr_name_update = isinstance(incoming_attr_name, str) and incoming_attr_name.strip() != ""
        if not set_parts and not has_attr_name_update:
            return None

        with self.db.session() as conn:
            target_attr_id = attr_id
            if has_attr_name_update and isinstance(incoming_attr_name, str):
                normalized_name = incoming_attr_name.strip()
                if normalized_name:
                    row = conn.execute(
                        "SELECT attr_id FROM task_attr WHERE attr_name = ?",
                        (normalized_name,),
                    ).fetchone()
                    if row:
                        next_attr_id = int(row["attr_id"])
                    else:
                        cur = conn.execute(
                            "INSERT INTO task_attr (attr_name) VALUES (?)",
                            (normalized_name,),
                        )
                        next_attr_id = int(cur.lastrowid)

                    if next_attr_id != attr_id:
                        exists = conn.execute(
                            "SELECT 1 FROM task_attr_relation WHERE task_id = ? AND attr_id = ?",
                            (task_id, next_attr_id),
                        ).fetchone()
                        if exists:
                            raise sqlite3.IntegrityError("属性已绑定到该任务")
                        conn.execute(
                            "UPDATE task_data SET attr_id = ? WHERE task_id = ? AND attr_id = ?",
                            (next_attr_id, task_id, attr_id),
                        )
                        conn.execute(
                            "UPDATE task_attr_relation SET attr_id = ? WHERE task_id = ? AND attr_id = ?",
                            (next_attr_id, task_id, attr_id),
                        )
                        target_attr_id = next_attr_id

            values.extend([task_id, target_attr_id])
            if set_parts:
                conn.execute(
                    f"UPDATE task_attr_relation SET {', '.join(set_parts)} WHERE task_id = ? AND attr_id = ?",
                    tuple(values),
                )
            row = conn.execute(
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
                WHERE rel.task_id = ? AND rel.attr_id = ?
                """,
                (task_id, target_attr_id),
            ).fetchone()
            return dict(row) if row else None

    def delete_attr(self, task_id: int, attr_id: int) -> bool:
        with self.db.session() as conn:
            conn.execute(
                "DELETE FROM task_data WHERE task_id = ? AND attr_id = ?",
                (task_id, attr_id),
            )
            cur = conn.execute(
                "DELETE FROM task_attr_relation WHERE task_id = ? AND attr_id = ?",
                (task_id, attr_id),
            )
            self._refresh_attr_num(conn, task_id)
            return cur.rowcount > 0

    def _refresh_attr_num(self, conn: sqlite3.Connection, task_id: int) -> None:
        conn.execute(
            """
            UPDATE task_main
            SET attr_num = (
                SELECT COUNT(1)
                FROM task_attr_relation
                WHERE task_id = ?
            )
            WHERE task_id = ?
            """,
            (task_id, task_id),
        )
