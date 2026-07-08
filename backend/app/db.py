from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS task_main (
        task_id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_name TEXT NOT NULL UNIQUE,
        attr_num INTEGER DEFAULT 0,
        create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        task_desc TEXT DEFAULT '',
        task_color TEXT DEFAULT '#4CAF50'
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS task_attr (
        attr_id INTEGER PRIMARY KEY AUTOINCREMENT,
        attr_name TEXT NOT NULL UNIQUE,
        attr_unit TEXT DEFAULT '',
        attr_type TEXT NOT NULL DEFAULT 'NUMERIC'
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS task_data (
        data_id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        attr_id INTEGER NOT NULL,
        data_value NUMERIC NOT NULL,
        text_value TEXT DEFAULT '',
        record_date DATE NOT NULL,
        create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(task_id, attr_id, record_date),
        FOREIGN KEY (task_id) REFERENCES task_main(task_id),
        FOREIGN KEY (attr_id) REFERENCES task_attr(attr_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS task_attr_relation (
        relation_id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        attr_id INTEGER NOT NULL,
        default_value NUMERIC DEFAULT 0,
        display_order INTEGER DEFAULT 1,
        attr_sign INTEGER NOT NULL DEFAULT 1,
        attr_record INTEGER NOT NULL DEFAULT 0,
        target_value INTEGER NOT NULL DEFAULT -1,
        attr_unit TEXT DEFAULT '',
        calc_type TEXT DEFAULT '10000000',
        calc_config TEXT DEFAULT '{}',
        weight INTEGER DEFAULT 0,
        UNIQUE(task_id, attr_id),
        FOREIGN KEY (task_id) REFERENCES task_main(task_id) ON DELETE CASCADE,
        FOREIGN KEY (attr_id) REFERENCES task_attr(attr_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS ai_summary_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        end_date TEXT NOT NULL,
        period_days INTEGER NOT NULL,
        summary_text TEXT NOT NULL,
        create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(task_id, end_date, period_days)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS todo_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL,
        description TEXT,
        due_date DATE,
        completed INTEGER DEFAULT 0,
        completed_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS focus_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        attr_id INTEGER,
        start_time DATETIME NOT NULL,
        record_date DATE,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        source_type TEXT NOT NULL DEFAULT 'task',
        source_id TEXT,
        note TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES task_main(task_id) ON DELETE CASCADE,
        FOREIGN KEY (attr_id) REFERENCES task_attr(attr_id)
    );
    """,
    # ── Learning module tables ──────────────────────────
    """
    CREATE TABLE IF NOT EXISTS learning_sessions (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        title TEXT DEFAULT '',
        conversation TEXT DEFAULT '',
        preferred_goal TEXT DEFAULT '',
        weekly_days INTEGER DEFAULT 4,
        daily_minutes INTEGER DEFAULT 50,
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS learning_profile_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        input_summary TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES learning_sessions(id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS learning_resource_packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        package_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES learning_sessions(id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS learning_agent_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        duration_ms INTEGER DEFAULT 0,
        input_summary TEXT DEFAULT '',
        output_summary TEXT DEFAULT '',
        fallback_reason TEXT DEFAULT '',
        source_refs_json TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES learning_sessions(id)
    );
    """,
    # ── Long-term plans ─────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        goal TEXT DEFAULT '',
        source_text TEXT NOT NULL,
        start_date TEXT NOT NULL,
        target_end_date TEXT NOT NULL,
        preferred_weekdays_json TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
        daily_minutes INTEGER NOT NULL DEFAULT 60,
        task_binding_mode TEXT NOT NULL DEFAULT 'create',
        task_name_draft TEXT DEFAULT '',
        task_id INTEGER,
        owns_task INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',
        active_revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES task_main(task_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS plan_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT 'import',
        plan_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(plan_id, version),
        FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS plan_step_states (
        plan_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(plan_id, step_id),
        FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS plan_time_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        focus_session_id INTEGER NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
        FOREIGN KEY (focus_session_id) REFERENCES focus_sessions(id) ON DELETE CASCADE
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS plan_goal_bindings (
        plan_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        task_id INTEGER NOT NULL,
        attr_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at TEXT,
        PRIMARY KEY(plan_id, goal_id),
        FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES task_main(task_id),
        FOREIGN KEY (attr_id) REFERENCES task_attr(attr_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS app_migrations (
        migration_key TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS plan_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id TEXT NOT NULL,
        base_revision INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        review_input_json TEXT NOT NULL DEFAULT '{}',
        proposal_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        applied_at TEXT,
        FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
    );
    """,
    # ── Contest module tables ────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS contest_problems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        problem_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source_url TEXT DEFAULT '',
        statement_markdown TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        difficulty INTEGER DEFAULT 0,
        educational_value TEXT DEFAULT '',
        prerequisites TEXT DEFAULT '[]',
        samples TEXT DEFAULT '[]',
        input_format TEXT DEFAULT '',
        output_format TEXT DEFAULT '',
        constraints TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(platform, problem_id)
    );
    """,
]

DEFAULT_ATTRS = [
    (1, "坚持天数"),
    (2, "项目总数"),
    (3, "今日完成度"),
    (4, "专注时长"),
    (5, "待办"),
]


class Database:
    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)

    @contextmanager
    def session(self) -> Iterator[sqlite3.Connection]:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def ensure_schema(self) -> None:
        with self.session() as conn:
            for statement in SCHEMA_STATEMENTS:
                conn.execute(statement)
            self._seed_defaults(conn)
            self._migrate_unified_time_ledger(conn)
            self._migrate_contest_problems(conn)

    @staticmethod
    def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
        return {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}

    @classmethod
    def _migrate_unified_time_ledger(cls, conn: sqlite3.Connection) -> None:
        migration_key = "plans_unified_time_ledger_v1"

        plan_columns = cls._columns(conn, "plans")
        for name, definition in {
            "task_binding_mode": "TEXT NOT NULL DEFAULT 'create'",
            "task_name_draft": "TEXT DEFAULT ''",
            "task_id": "INTEGER",
            "owns_task": "INTEGER NOT NULL DEFAULT 0",
        }.items():
            if name not in plan_columns:
                conn.execute(f"ALTER TABLE plans ADD COLUMN {name} {definition}")

        focus_columns = cls._columns(conn, "focus_sessions")
        for name, definition in {
            "attr_id": "INTEGER",
            "record_date": "DATE",
            "source_type": "TEXT NOT NULL DEFAULT 'task'",
            "source_id": "TEXT",
            "note": "TEXT DEFAULT ''",
        }.items():
            if name not in focus_columns:
                conn.execute(f"ALTER TABLE focus_sessions ADD COLUMN {name} {definition}")

        conn.execute(
            "UPDATE focus_sessions SET record_date = SUBSTR(start_time, 1, 10) "
            "WHERE record_date IS NULL OR record_date = ''"
        )

        already_applied = conn.execute(
            "SELECT 1 FROM app_migrations WHERE migration_key = ?", (migration_key,)
        ).fetchone()
        if already_applied:
            return

        cls._backfill_plan_tasks_and_bindings(conn)
        log_columns = cls._columns(conn, "plan_time_logs")
        if "focus_session_id" not in log_columns:
            conn.execute("ALTER TABLE plan_time_logs RENAME TO plan_time_logs_legacy")
            conn.execute(
                """
                CREATE TABLE plan_time_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    plan_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    focus_session_id INTEGER NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
                    FOREIGN KEY (focus_session_id) REFERENCES focus_sessions(id) ON DELETE CASCADE
                )
                """
            )
            cls._migrate_legacy_plan_logs(conn)
            conn.execute("DROP TABLE plan_time_logs_legacy")

        cls._rebuild_intrinsic_focus_totals(conn)
        conn.execute(
            "INSERT INTO app_migrations (migration_key) VALUES (?)",
            (migration_key,),
        )

    @classmethod
    def _backfill_plan_tasks_and_bindings(cls, conn: sqlite3.Connection) -> None:
        plans = conn.execute(
            "SELECT id, title, goal, task_id, active_revision FROM plans"
        ).fetchall()
        for plan in plans:
            task_id = int(plan["task_id"] or 0)
            if task_id <= 0:
                task_name = cls._unique_task_name(conn, str(plan["title"]), str(plan["id"]))
                cur = conn.execute(
                    "INSERT INTO task_main (task_name, task_desc, task_color) VALUES (?, ?, ?)",
                    (task_name, str(plan["goal"] or ""), "#2563EB"),
                )
                task_id = int(cur.lastrowid)
                cls._ensure_intrinsic_task_attrs(conn, task_id)
                conn.execute(
                    "UPDATE plans SET task_id = ?, task_name_draft = ?, owns_task = 1 WHERE id = ?",
                    (task_id, task_name, plan["id"]),
                )

            revision = conn.execute(
                "SELECT plan_json FROM plan_revisions WHERE plan_id = ? AND version = ?",
                (plan["id"], int(plan["active_revision"])),
            ).fetchone()
            if not revision:
                continue
            try:
                snapshot = json.loads(str(revision["plan_json"]))
            except (TypeError, json.JSONDecodeError):
                continue
            cls._ensure_plan_goal_bindings(conn, str(plan["id"]), str(plan["title"]), task_id, snapshot)

    @classmethod
    def _ensure_plan_goal_bindings(
        cls,
        conn: sqlite3.Connection,
        plan_id: str,
        plan_title: str,
        task_id: int,
        snapshot: dict,
    ) -> None:
        for phase in snapshot.get("phases", []):
            for milestone in phase.get("milestones", []):
                for goal in milestone.get("weekly_goals", []):
                    if not goal.get("expanded") or not goal.get("steps"):
                        continue
                    goal_id = str(goal.get("goal_id") or "")
                    if not goal_id:
                        continue
                    exists = conn.execute(
                        "SELECT 1 FROM plan_goal_bindings WHERE plan_id = ? AND goal_id = ?",
                        (plan_id, goal_id),
                    ).fetchone()
                    if exists:
                        continue
                    attr_name = cls._unique_attr_name(
                        conn,
                        f"{plan_title} · {str(goal.get('title') or '周目标')}",
                        goal_id,
                    )
                    attr_cur = conn.execute(
                        "INSERT INTO task_attr (attr_name, attr_unit) VALUES (?, '秒')",
                        (attr_name,),
                    )
                    attr_id = int(attr_cur.lastrowid)
                    calc_config = json.dumps(
                        {
                            "schedule_config": {
                                "period_start": goal.get("window_start"),
                                "period_end": goal.get("window_end"),
                                "ux_config": {
                                    "input_type": "timer",
                                    "quick_step": 60,
                                    "detail_enabled": True,
                                },
                            }
                        },
                        ensure_ascii=False,
                    )
                    conn.execute(
                        """
                        INSERT INTO task_attr_relation (
                            task_id, attr_id, display_order, attr_sign, attr_record,
                            target_value, attr_unit, calc_type, calc_config, weight
                        ) VALUES (?, ?, ?, 0, 1, ?, '秒', '10010000', ?, 1)
                        """,
                        (task_id, attr_id, 100 + attr_id, -1, calc_config),
                    )
                    conn.execute(
                        "INSERT INTO plan_goal_bindings (plan_id, goal_id, task_id, attr_id) VALUES (?, ?, ?, ?)",
                        (plan_id, goal_id, task_id, attr_id),
                    )
                    cls._refresh_task_attr_num(conn, task_id)

    @classmethod
    def _migrate_legacy_plan_logs(cls, conn: sqlite3.Connection) -> None:
        rows = conn.execute(
            """
            SELECT legacy.*, plans.task_id, plans.active_revision, plans.title
            FROM plan_time_logs_legacy legacy
            JOIN plans ON plans.id = legacy.plan_id
            ORDER BY legacy.id
            """
        ).fetchall()
        snapshot_cache: dict[str, dict] = {}
        for row in rows:
            plan_id = str(row["plan_id"])
            if plan_id not in snapshot_cache:
                revision = conn.execute(
                    "SELECT plan_json FROM plan_revisions WHERE plan_id = ? AND version = ?",
                    (plan_id, int(row["active_revision"])),
                ).fetchone()
                try:
                    snapshot_cache[plan_id] = json.loads(str(revision["plan_json"])) if revision else {}
                except (TypeError, json.JSONDecodeError):
                    snapshot_cache[plan_id] = {}
            goal_id = cls._find_goal_for_step(snapshot_cache[plan_id], str(row["step_id"]))
            binding = conn.execute(
                "SELECT attr_id FROM plan_goal_bindings WHERE plan_id = ? AND goal_id = ?",
                (plan_id, goal_id),
            ).fetchone() if goal_id else None
            attr_id = int(binding["attr_id"]) if binding else None
            record_date = str(row["start_time"])[:10]
            cur = conn.execute(
                """
                INSERT INTO focus_sessions (
                    task_id, attr_id, start_time, record_date, duration_seconds,
                    source_type, source_id, note, created_at
                ) VALUES (?, ?, ?, ?, ?, 'plan_step', ?, ?, ?)
                """,
                (
                    int(row["task_id"]), attr_id, row["start_time"], record_date,
                    int(row["duration_seconds"]), f"{plan_id}:{row['step_id']}",
                    str(row["note"] or ""), row["created_at"],
                ),
            )
            focus_session_id = int(cur.lastrowid)
            conn.execute(
                "INSERT INTO plan_time_logs (id, plan_id, step_id, focus_session_id, created_at) VALUES (?, ?, ?, ?, ?)",
                (row["id"], plan_id, row["step_id"], focus_session_id, row["created_at"]),
            )
            if attr_id is not None:
                cls._upsert_task_data_delta(
                    conn, int(row["task_id"]), attr_id, record_date, int(row["duration_seconds"])
                )

    @staticmethod
    def _find_goal_for_step(snapshot: dict, step_id: str) -> str | None:
        for phase in snapshot.get("phases", []):
            for milestone in phase.get("milestones", []):
                for goal in milestone.get("weekly_goals", []):
                    if any(str(step.get("step_id")) == step_id for step in goal.get("steps", [])):
                        return str(goal.get("goal_id") or "") or None
        return None

    @staticmethod
    def _ensure_intrinsic_task_attrs(conn: sqlite3.Connection, task_id: int) -> None:
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
        Database._refresh_task_attr_num(conn, task_id)

    @staticmethod
    def _refresh_task_attr_num(conn: sqlite3.Connection, task_id: int) -> None:
        conn.execute(
            "UPDATE task_main SET attr_num = (SELECT COUNT(*) FROM task_attr_relation WHERE task_id = ?) WHERE task_id = ?",
            (task_id, task_id),
        )

    @staticmethod
    def _unique_task_name(conn: sqlite3.Connection, title: str, plan_id: str) -> str:
        base = (title.strip() or "长期计划")[:64]
        if not conn.execute("SELECT 1 FROM task_main WHERE task_name = ?", (base,)).fetchone():
            return base
        suffix = f" · Plan {plan_id[:6]}"
        return f"{base[:64 - len(suffix)]}{suffix}"

    @staticmethod
    def _unique_attr_name(conn: sqlite3.Connection, title: str, goal_id: str) -> str:
        suffix = f" · {goal_id[-8:]}"
        candidate = f"{title[:64 - len(suffix)]}{suffix}"
        index = 2
        while conn.execute("SELECT 1 FROM task_attr WHERE attr_name = ?", (candidate,)).fetchone():
            numbered = f"-{index}"
            candidate = f"{title[:64 - len(suffix) - len(numbered)]}{suffix}{numbered}"
            index += 1
        return candidate

    @staticmethod
    def _upsert_task_data_delta(
        conn: sqlite3.Connection,
        task_id: int,
        attr_id: int,
        record_date: str,
        duration_seconds: int,
    ) -> None:
        conn.execute(
            """
            INSERT INTO task_data (task_id, attr_id, data_value, record_date, create_time)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(task_id, attr_id, record_date) DO UPDATE SET
                data_value = task_data.data_value + excluded.data_value,
                create_time = CURRENT_TIMESTAMP
            """,
            (task_id, attr_id, duration_seconds, record_date),
        )

    @staticmethod
    def _rebuild_intrinsic_focus_totals(conn: sqlite3.Connection) -> None:
        conn.execute("DELETE FROM task_data WHERE attr_id = 4")
        conn.execute(
            """
            INSERT INTO task_data (task_id, attr_id, data_value, record_date, create_time)
            SELECT task_id, 4, SUM(duration_seconds), record_date, CURRENT_TIMESTAMP
            FROM focus_sessions
            WHERE record_date IS NOT NULL AND record_date <> ''
            GROUP BY task_id, record_date
            """
        )

    @staticmethod
    def _migrate_contest_problems(conn: sqlite3.Connection) -> None:
        """Add missing columns to contest_problems for forward compatibility."""
        existing = {
            row[1] for row in
            conn.execute("PRAGMA table_info(contest_problems)").fetchall()
        }
        needed = {
            "samples": "TEXT DEFAULT '[]'",
            "input_format": "TEXT DEFAULT ''",
            "output_format": "TEXT DEFAULT ''",
            "constraints": "TEXT DEFAULT ''",
        }
        for col, col_def in needed.items():
            if col not in existing:
                conn.execute(f"ALTER TABLE contest_problems ADD COLUMN {col} {col_def}")

    # ── Contest problem helpers ─────────────────────────

    def upsert_contest_problem(self, platform: str, problem_id: str, title: str,
                                source_url: str = "", statement_markdown: str = "",
                                tags: str = "[]", difficulty: int = 0,
                                educational_value: str = "", prerequisites: str = "[]",
                                samples: str = "[]", input_format: str = "",
                                output_format: str = "", constraints: str = "",
                                created_at: str = "", updated_at: str = "") -> dict:
        with self.session() as conn:
            conn.execute(
                """
                INSERT INTO contest_problems (platform, problem_id, title, source_url,
                    statement_markdown, tags, difficulty, educational_value, prerequisites,
                    samples, input_format, output_format, constraints, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(platform, problem_id) DO UPDATE SET
                    title=excluded.title, source_url=excluded.source_url,
                    statement_markdown=excluded.statement_markdown, tags=excluded.tags,
                    difficulty=excluded.difficulty, educational_value=excluded.educational_value,
                    prerequisites=excluded.prerequisites,
                    samples=excluded.samples, input_format=excluded.input_format,
                    output_format=excluded.output_format, constraints=excluded.constraints,
                    updated_at=excluded.updated_at
                """,
                (platform, problem_id, title, source_url, statement_markdown,
                 tags, difficulty, educational_value, prerequisites,
                 samples, input_format, output_format, constraints, created_at, updated_at),
            )
            row = conn.execute(
                "SELECT * FROM contest_problems WHERE platform = ? AND problem_id = ?",
                (platform, problem_id),
            ).fetchone()
            return dict(row) if row else {}

    def get_contest_problem(self, platform: str, problem_id: str) -> dict | None:
        with self.session() as conn:
            row = conn.execute(
                "SELECT * FROM contest_problems WHERE platform = ? AND problem_id = ?",
                (platform, problem_id),
            ).fetchone()
            return dict(row) if row else None

    def list_contest_problems(self) -> list[dict]:
        with self.session() as conn:
            rows = conn.execute(
                "SELECT * FROM contest_problems ORDER BY updated_at DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    def _seed_defaults(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            """
            INSERT OR IGNORE INTO task_main (task_id, task_name, task_desc, task_color)
            VALUES (1, '总览', '数据总览', '#4CAF50')
            """
        )

        conn.executemany(
            """
            INSERT OR IGNORE INTO task_attr (attr_id, attr_name)
            VALUES (?, ?)
            """,
            DEFAULT_ATTRS,
        )

        conn.executemany(
            """
            INSERT OR IGNORE INTO task_attr_relation (
                task_id, attr_id, display_order, attr_sign, attr_record,
                target_value, attr_unit, calc_type, calc_config, weight
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (1, 1, 1, 1, -1, -1, "", "00000010", '{"count_target": "dates"}', 0),
                (1, 2, 2, 1, -1, -1, "", "00000010", '{"count_target": "tasks"}', 0),
                (1, 4, 3, 1, -1, -1, "", "00000010", "{}", 0),
                (1, 5, 4, 1, -1, -1, "", "00000010", "{}", 0),
            ],
        )

        # 为所有任务补齐固有属性：专注时长与待办
        conn.execute(
            """
            INSERT OR IGNORE INTO task_attr_relation (
                task_id, attr_id, display_order, attr_sign, attr_record,
                target_value, attr_unit, calc_type, calc_config, weight
            )
            SELECT task_id, 1, 899, 1, -1, -1, '天', '00000010', '{}', 0
            FROM task_main
            """
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO task_attr_relation (
                task_id, attr_id, display_order, attr_sign, attr_record,
                target_value, attr_unit, calc_type, calc_config, weight
            )
            SELECT task_id, 4, 900, 1, -1, -1, '秒', '00000010', '{}', 0
            FROM task_main
            """
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO task_attr_relation (
                task_id, attr_id, display_order, attr_sign, attr_record,
                target_value, attr_unit, calc_type, calc_config, weight
            )
            SELECT task_id, 5, 901, 1, -1, -1, '', '00000010', '{}', 0
            FROM task_main
            """
        )

        conn.execute(
            """
            UPDATE task_main
            SET attr_num = (
                SELECT COUNT(1)
                FROM task_attr_relation
                WHERE task_attr_relation.task_id = task_main.task_id
            )
            """
        )
