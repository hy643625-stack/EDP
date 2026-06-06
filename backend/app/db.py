from __future__ import annotations

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
        start_time DATETIME NOT NULL,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES task_main(task_id) ON DELETE CASCADE
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
