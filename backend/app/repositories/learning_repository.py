"""SQLite repository for learning sessions, profiles, packages, and agent runs.

Pure CRUD + JSON serialization. No business logic.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from app.db import Database


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


class LearningRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    # ── Sessions ──────────────────────────────────────

    def create_session(
        self,
        course_id: str,
        conversation: str,
        preferred_goal: str = "",
        weekly_days: int = 4,
        daily_minutes: int = 50,
        title: str = "",
    ) -> dict[str, Any]:
        session_id = _new_id()
        now = _utc_now()
        with self.db.session() as conn:
            conn.execute(
                """INSERT INTO learning_sessions (id, course_id, title, conversation,
                   preferred_goal, weekly_days, daily_minutes, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (session_id, course_id, title, conversation, preferred_goal,
                 weekly_days, daily_minutes, now, now),
            )
            conn.commit()
        return self.get_session(session_id)  # type: ignore[return-value]

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        with self.db.session() as conn:
            row = conn.execute(
                "SELECT * FROM learning_sessions WHERE id = ?", (session_id,)
            ).fetchone()
        if row is None:
            return None
        return dict(row)

    def list_sessions(self, limit: int = 20) -> list[dict[str, Any]]:
        with self.db.session() as conn:
            rows = conn.execute(
                "SELECT * FROM learning_sessions WHERE status = 'active' "
                "ORDER BY updated_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def update_session(self, session_id: str, **fields: Any) -> None:
        if not fields:
            return
        fields["updated_at"] = _utc_now()
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [session_id]
        with self.db.session() as conn:
            conn.execute(
                f"UPDATE learning_sessions SET {set_clause} WHERE id = ?", values
            )
            conn.commit()

    # ── Profile versions ──────────────────────────────

    def create_profile_version(
        self, session_id: str, snapshot: dict[str, Any], input_summary: str = ""
    ) -> dict[str, Any]:
        # Determine next version number
        with self.db.session() as conn:
            last = conn.execute(
                "SELECT MAX(version) FROM learning_profile_versions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            next_version = (last[0] or 0) + 1
            now = _utc_now()
            conn.execute(
                """INSERT INTO learning_profile_versions
                   (session_id, version, snapshot_json, input_summary, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (session_id, next_version, json.dumps(snapshot, ensure_ascii=False),
                 input_summary, now),
            )
            conn.execute(
                "UPDATE learning_sessions SET updated_at = ? WHERE id = ?",
                (now, session_id),
            )
            conn.commit()
        return {"session_id": session_id, "version": next_version, "created_at": now}

    def get_profile_versions(self, session_id: str) -> list[dict[str, Any]]:
        with self.db.session() as conn:
            rows = conn.execute(
                "SELECT * FROM learning_profile_versions WHERE session_id = ? "
                "ORDER BY version DESC",
                (session_id,),
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["snapshot"] = json.loads(d.pop("snapshot_json", "{}"))
            result.append(d)
        return result

    def get_latest_profile(self, session_id: str) -> dict[str, Any] | None:
        versions = self.get_profile_versions(session_id)
        return versions[0] if versions else None

    # ── Resource packages ─────────────────────────────

    def create_package(
        self, session_id: str, package: dict[str, Any]
    ) -> dict[str, Any]:
        with self.db.session() as conn:
            last = conn.execute(
                "SELECT MAX(version) FROM learning_resource_packages WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            next_version = (last[0] or 0) + 1
            now = _utc_now()
            conn.execute(
                """INSERT INTO learning_resource_packages
                   (session_id, version, package_json, created_at)
                   VALUES (?, ?, ?, ?)""",
                (session_id, next_version, json.dumps(package, ensure_ascii=False), now),
            )
            conn.execute(
                "UPDATE learning_sessions SET updated_at = ? WHERE id = ?",
                (now, session_id),
            )
            conn.commit()
        return {"session_id": session_id, "version": next_version, "created_at": now}

    def get_latest_package(self, session_id: str) -> dict[str, Any] | None:
        with self.db.session() as conn:
            row = conn.execute(
                "SELECT * FROM learning_resource_packages WHERE session_id = ? "
                "ORDER BY version DESC LIMIT 1",
                (session_id,),
            ).fetchone()
        if row is None:
            return None
        d = dict(row)
        d["package"] = json.loads(d.pop("package_json", "{}"))
        return d

    # ── Agent runs ────────────────────────────────────

    def create_agent_run(
        self,
        session_id: str,
        agent_id: str,
        status: str,
        duration_ms: int = 0,
        input_summary: str = "",
        output_summary: str = "",
        fallback_reason: str = "",
        source_refs: list[str] | None = None,
    ) -> int:
        now = _utc_now()
        with self.db.session() as conn:
            cur = conn.execute(
                """INSERT INTO learning_agent_runs
                   (session_id, agent_id, status, duration_ms, input_summary,
                    output_summary, fallback_reason, source_refs_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (session_id, agent_id, status, duration_ms, input_summary,
                 output_summary, fallback_reason or "",
                 json.dumps(source_refs or [], ensure_ascii=False), now),
            )
            conn.commit()
            return cur.lastrowid or 0

    def get_agent_runs(self, session_id: str) -> list[dict[str, Any]]:
        with self.db.session() as conn:
            rows = conn.execute(
                "SELECT * FROM learning_agent_runs WHERE session_id = ? "
                "ORDER BY id ASC",
                (session_id,),
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["source_refs"] = json.loads(d.pop("source_refs_json", "[]"))
            result.append(d)
        return result
