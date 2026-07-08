from __future__ import annotations

import copy
import json
import math
import re
import sqlite3
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

from app.errors import ApiError
from app.repositories.plan_repository import PlanRepository
from app.repositories.task_repository import TaskRepository
from app.repositories.time_ledger_repository import TimeLedgerRepository
from app.services.llm import call_llm, parse_json_safe


VALID_PLAN_STATUSES = {"draft", "active", "completed", "archived"}
VALID_STEP_STATUSES = {"pending", "in_progress", "completed", "blocked"}
PHASE_TITLES = [
    "后端基础与工程能力",
    "LLM / RAG / Agent 核心能力",
    "项目实战与部署",
    "简历、面试与求职冲刺",
]
PHASE_MONTH_RANGES = [(1, 3), (4, 8), (9, 10), (11, 12)]
MONTH_HEADING_RE = re.compile(
    r"^#{1,4}\s*第\s*(\d+)\s*[—–-]?\s*(\d+)?\s*个?月(?:\s*[:：-]?\s*(.*))?$"
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse_date(raw: str, field: str) -> date:
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except (TypeError, ValueError) as exc:
        raise ApiError("BAD_REQUEST", f"{field} 日期格式应为 YYYY-MM-DD", 422) from exc


def _add_months(value: date, months: int) -> date:
    index = value.year * 12 + value.month - 1 + months
    year, zero_month = divmod(index, 12)
    month = zero_month + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)


def _normalize_weekdays(raw: Iterable[Any]) -> list[int]:
    result: set[int] = set()
    for item in raw:
        try:
            value = int(item)
        except (TypeError, ValueError):
            continue
        if 1 <= value <= 7:
            result.add(value)
    return sorted(result)


def _clean_line(raw: str, limit: int = 120) -> str:
    value = re.sub(r"^[\s>*+-]+", "", raw).strip()
    value = re.sub(r"\*\*|`", "", value)
    return value[:limit].strip()


def _format_duration(seconds: int) -> str:
    minutes = max(0, round(seconds / 60))
    hours, remainder = divmod(minutes, 60)
    if hours and remainder:
        return f"{hours} 小时 {remainder} 分钟"
    if hours:
        return f"{hours} 小时"
    return f"{minutes} 分钟"


def _iter_plan_steps(snapshot: dict[str, Any]):
    for phase in snapshot.get("phases", []):
        for milestone in phase.get("milestones", []):
            for goal in milestone.get("weekly_goals", []):
                for step in goal.get("steps", []):
                    yield phase, milestone, goal, step


def _iter_leaf_nodes(snapshot: dict[str, Any]):
    for phase in snapshot.get("phases", []):
        for milestone in phase.get("milestones", []):
            for goal in milestone.get("weekly_goals", []):
                steps = goal.get("steps", []) if goal.get("expanded") else []
                if steps:
                    for step in steps:
                        yield phase, milestone, step
                else:
                    yield phase, milestone, goal


class PlanService:
    def __init__(
        self,
        repo: PlanRepository,
        ai_settings_service: Any,
        task_repo: TaskRepository | None = None,
        time_repo: TimeLedgerRepository | None = None,
    ) -> None:
        self.repo = repo
        self.ai_settings_service = ai_settings_service
        self.task_repo = task_repo or TaskRepository(repo.db)
        self.time_repo = time_repo or TimeLedgerRepository(repo.db)

    def import_plan(self, payload: dict[str, Any]) -> dict[str, Any]:
        source_text = str(payload.get("source_text") or "").strip()
        if len(source_text) < 1 or len(source_text) > 100_000:
            raise ApiError("BAD_REQUEST", "计划文本长度需在 1 到 100000 字符之间", 422)

        start_day = _parse_date(str(payload.get("start_date") or ""), "开始")
        end_day = _parse_date(str(payload.get("target_end_date") or ""), "预计完成")
        if end_day <= start_day:
            raise ApiError("BAD_REQUEST", "预计完成日期必须晚于开始日期", 422)

        weekdays = _normalize_weekdays(payload.get("preferred_weekdays") or [])
        if not weekdays:
            raise ApiError("BAD_REQUEST", "请至少选择一个计划执行日", 422)
        daily_minutes = int(payload.get("daily_minutes") or 0)
        if daily_minutes < 15 or daily_minutes > 480:
            raise ApiError("BAD_REQUEST", "每日可用时间需在 15 到 480 分钟之间", 422)

        title = str(payload.get("title") or "").strip() or self._infer_title(source_text)
        goal = str(payload.get("goal") or "").strip()
        binding = payload.get("task_binding") if isinstance(payload.get("task_binding"), dict) else {}
        binding_mode = str(binding.get("mode") or "create").strip().lower()
        if binding_mode not in {"create", "existing"}:
            raise ApiError("BAD_REQUEST", "任务绑定模式仅支持 create / existing", 422)
        binding_task_id: int | None = None
        task_name_draft = ""
        if binding_mode == "existing":
            binding_task_id = int(binding.get("task_id") or 0)
            if binding_task_id <= 1 or not self.task_repo.task_exists(binding_task_id):
                raise ApiError("BAD_REQUEST", "请选择有效的已有任务", 422)
        else:
            task_name_draft = str(binding.get("task_name") or title).strip()[:64]
            if not task_name_draft:
                raise ApiError("BAD_REQUEST", "新建任务名称不能为空", 422)
        warnings: list[str] = []
        outline, fallback_reason = self._ai_outline(source_text)
        mode_used = "model" if outline else "local_rules"
        if outline is None:
            warnings.append(f"AI 未参与：{fallback_reason}；当前使用本地规则兜底")

        snapshot = self._build_snapshot(
            source_text=source_text,
            start_day=start_day,
            end_day=end_day,
            weekdays=weekdays,
            daily_minutes=daily_minutes,
            outline=outline,
        )
        snapshot["generation"] = {
            "mode_used": mode_used,
            "fallback_reason": fallback_reason,
        }
        snapshot["warnings"] = warnings
        plan = self.repo.create_plan(
            {
                "title": title[:120],
                "goal": goal[:500],
                "source_text": source_text,
                "start_date": start_day.isoformat(),
                "target_end_date": end_day.isoformat(),
                "preferred_weekdays": weekdays,
                "daily_minutes": daily_minutes,
                "task_binding_mode": binding_mode,
                "task_name_draft": task_name_draft,
                "task_id": binding_task_id,
            },
            snapshot,
        )
        result = self.get_plan(str(plan["id"]))
        result["mode_used"] = mode_used
        result["warnings"] = warnings
        return result

    def list_plans(self) -> list[dict[str, Any]]:
        return [self._serialize_plan_row(item) for item in self.repo.list_plans()]

    def get_plan(self, plan_id: str, target_date: date | str | None = None) -> dict[str, Any]:
        row = self._require_plan(plan_id)
        revision = self.repo.get_revision(plan_id, int(row["active_revision"]))
        if revision is None:
            raise ApiError("NOT_FOUND", "计划修订不存在", 404)
        snapshot = self._load_json(revision.get("plan_json"), {})
        self._normalize_progress_weights(snapshot)
        states = self.repo.get_step_states(plan_id)
        time_totals = self.repo.get_time_totals(plan_id)
        goal_bindings = self.repo.get_goal_bindings(plan_id)
        goal_time_totals = self.repo.get_goal_time_totals(plan_id)
        enriched = self._enrich_snapshot(
            snapshot,
            states,
            time_totals,
            goal_bindings,
            goal_time_totals,
            int(row.get("task_id") or 0),
        )
        generation = snapshot.get("generation") if isinstance(snapshot.get("generation"), dict) else {}
        reviews = self.repo.list_reviews(plan_id)
        target_day = (
            target_date
            if isinstance(target_date, date)
            else _parse_date(target_date, "查看")
            if isinstance(target_date, str) and target_date
            else date.today()
        )
        return {
            "plan": self._serialize_plan_row(row),
            "snapshot": enriched,
            "progress": self._build_progress(snapshot, states, goal_time_totals),
            "revisions": self.repo.list_revisions(plan_id),
            "reviews": [self._serialize_review(item) for item in reviews],
            "review_status": self._build_review_status(
                plan_id, snapshot, states, row, reviews, target_day
            ),
            "mode_used": generation.get("mode_used", "local_rules"),
            "fallback_reason": generation.get("fallback_reason"),
            "warnings": snapshot.get("warnings", []),
        }

    def update_draft(self, plan_id: str, snapshot: dict[str, Any]) -> dict[str, Any]:
        self._recalculate_estimates(snapshot)
        self._normalize_progress_weights(snapshot)
        self._validate_snapshot(snapshot)
        if not self.repo.update_draft(plan_id, snapshot):
            raise ApiError("BAD_REQUEST", "只有草稿计划可以编辑预览", 409)
        return self.get_plan(plan_id)

    def activate(self, plan_id: str) -> dict[str, Any]:
        row = self._require_plan(plan_id)
        revision = self.repo.get_revision(plan_id, int(row["active_revision"]))
        snapshot = self._load_json(revision.get("plan_json") if revision else None, {})
        try:
            activated = self.repo.activate(plan_id, snapshot)
        except sqlite3.IntegrityError as exc:
            raise ApiError("BAD_REQUEST", "任务名称已存在，请修改名称或绑定已有任务", 409) from exc
        if not activated:
            raise ApiError("BAD_REQUEST", "计划已经激活、任务无效或无法激活", 409)
        return self.get_plan(plan_id)

    def update_status(self, plan_id: str, status: str) -> dict[str, Any]:
        normalized = status.strip().lower()
        if normalized not in VALID_PLAN_STATUSES - {"draft"}:
            raise ApiError("BAD_REQUEST", "不支持的计划状态", 422)
        self._require_plan(plan_id)
        self.repo.update_status(plan_id, normalized)
        return self.get_plan(plan_id)

    def dashboard(self, target_date: str, plan_id: str | None = None) -> dict[str, Any]:
        target_day = _parse_date(target_date, "查看")
        plan_rows = self.repo.list_plans()
        if plan_id:
            plan_rows = [row for row in plan_rows if row["id"] == plan_id]
            if not plan_rows:
                raise ApiError("NOT_FOUND", "计划不存在", 404)
        else:
            plan_rows = [row for row in plan_rows if row["status"] == "active"]

        sections: dict[str, list[dict[str, Any]]] = {"overdue": [], "today": [], "upcoming": []}
        summaries: list[dict[str, Any]] = []
        for row in plan_rows:
            detail = self.get_plan(str(row["id"]), target_day)
            summaries.append(
                {
                    "plan": detail["plan"],
                    "progress": detail["progress"],
                    "review_status": detail["review_status"],
                }
            )
            for _, _, _, step in _iter_plan_steps(detail["snapshot"]):
                status = str(step.get("status") or "pending")
                if status == "completed":
                    continue
                scheduled = _parse_date(str(step["scheduled_date"]), "步骤")
                item = dict(step)
                item["plan_id"] = row["id"]
                item["plan_title"] = row["title"]
                if scheduled < target_day:
                    sections["overdue"].append(item)
                elif scheduled == target_day:
                    sections["today"].append(item)
                elif scheduled <= target_day + timedelta(days=2):
                    sections["upcoming"].append(item)
        for items in sections.values():
            items.sort(key=lambda item: (item["scheduled_date"], item["plan_title"], item["title"]))
        return {"date": target_day.isoformat(), "plans": summaries, **sections}

    def add_time_log(self, plan_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        row, _, goal, step = self._require_step(plan_id, str(payload.get("step_id") or ""))
        if row["status"] != "active":
            raise ApiError("BAD_REQUEST", "只有激活计划可以记录耗时", 409)
        duration = int(payload.get("duration_seconds") or 0)
        if duration <= 0 or duration > 86_400:
            raise ApiError("BAD_REQUEST", "单次实际耗时需在 1 秒到 24 小时之间", 422)
        source = str(payload.get("source") or "timer")
        if source not in {"timer", "manual"}:
            raise ApiError("BAD_REQUEST", "耗时来源仅支持 timer / manual", 422)
        start_time = str(payload.get("start_time") or _utc_now())
        try:
            datetime.fromisoformat(start_time.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ApiError("BAD_REQUEST", "start_time 需为 ISO 时间", 422) from exc

        log = self._record_step_time(
            row=row,
            plan_id=plan_id,
            goal_id=str(goal["goal_id"]),
            step_id=str(step["step_id"]),
            start_time=start_time,
            record_date=str(payload.get("record_date") or start_time[:10]),
            duration_seconds=duration,
            note=str(payload.get("note") or "")[:500],
        )
        states = self.repo.get_step_states(plan_id)
        current = states.get(step["step_id"])
        if not current or current["status"] == "pending":
            self.repo.upsert_step_state(plan_id, step["step_id"], "in_progress")
        return {"time_log": log, "plan": self.get_plan(plan_id)}

    def complete_step(self, plan_id: str, step_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        row, _, goal, step = self._require_step(plan_id, step_id)
        if row["status"] != "active":
            raise ApiError("BAD_REQUEST", "只有激活计划可以完成步骤", 409)

        manual_minutes = int(payload.get("actual_minutes") or 0)
        if manual_minutes < 0 or manual_minutes > 1_440:
            raise ApiError("BAD_REQUEST", "补记时间需在 0 到 1440 分钟之间", 422)
        if manual_minutes > 0:
            self._record_step_time(
                row=row,
                plan_id=plan_id,
                goal_id=str(goal["goal_id"]),
                step_id=step_id,
                start_time=_utc_now(),
                record_date=date.today().isoformat(),
                duration_seconds=manual_minutes * 60,
                note=str(payload.get("time_note") or "完成时补记")[:500],
            )

        state = self.repo.upsert_step_state(
            plan_id,
            step_id,
            "completed",
            completed_at=_utc_now(),
        )
        return {"step_state": self._serialize_state(state), "plan": self.get_plan(plan_id)}

    def reopen_step(self, plan_id: str, step_id: str) -> dict[str, Any]:
        self._require_step(plan_id, step_id)
        state = self.repo.upsert_step_state(plan_id, step_id, "in_progress")
        return {"step_state": self._serialize_state(state), "plan": self.get_plan(plan_id)}

    def create_review(self, plan_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        row = self._require_plan(plan_id)
        if row["status"] != "active":
            raise ApiError("BAD_REQUEST", "只有激活计划可以复盘", 409)
        review_date = _parse_date(str(payload.get("review_date") or date.today().isoformat()), "复盘")
        revision = self.repo.get_revision(plan_id, int(row["active_revision"]))
        snapshot = self._load_json(revision.get("plan_json") if revision else None, {})
        states = self.repo.get_step_states(plan_id)
        next_week_minutes = int(payload.get("next_week_minutes") or row["daily_minutes"])
        if next_week_minutes < 15 or next_week_minutes > 480:
            raise ApiError("BAD_REQUEST", "下周每日可用时间需在 15 到 480 分钟之间", 422)
        proposed, changes = self._build_review_proposal(
            snapshot,
            states,
            row,
            review_date,
            next_week_minutes,
        )
        review_input = {
            "review_date": review_date.isoformat(),
            "summary": str(payload.get("summary") or "")[:2000],
            "blockers": str(payload.get("blockers") or "")[:2000],
            "next_week_minutes": next_week_minutes,
        }
        review = self.repo.create_review(
            plan_id,
            int(row["active_revision"]),
            review_input,
            {"snapshot": proposed, "changes": changes},
        )
        return self._serialize_review(review)

    def apply_review(self, plan_id: str, review_id: int) -> dict[str, Any]:
        review = self.repo.get_review(plan_id, review_id)
        if review is None:
            raise ApiError("NOT_FOUND", "复盘建议不存在", 404)
        proposal = self._load_json(review.get("proposal_json"), {})
        snapshot = proposal.get("snapshot")
        if not isinstance(snapshot, dict):
            raise ApiError("BAD_REQUEST", "复盘建议数据损坏", 409)
        next_version = self.repo.apply_review(plan_id, review_id, snapshot)
        if next_version is None:
            raise ApiError("BAD_REQUEST", "复盘建议已处理或基线版本已变化", 409)
        return {"revision": next_version, "plan": self.get_plan(plan_id)}

    def reject_review(self, plan_id: str, review_id: int) -> dict[str, Any]:
        self._require_plan(plan_id)
        if not self.repo.reject_review(plan_id, review_id):
            raise ApiError("BAD_REQUEST", "复盘建议已处理", 409)
        return {"review_id": review_id, "status": "rejected"}

    def _ai_outline(self, source_text: str) -> tuple[dict[str, Any] | None, str | None]:
        try:
            runtime_config = self.ai_settings_service.get_runtime_provider_config()
        except Exception:
            return None, "AI 配置读取失败"
        if runtime_config is None:
            return None, "未配置可用的 AI 服务"
        prompt = (
            "把下面长期学习路线提取为严格 JSON，只输出对象。结构为 "
            '{"phases":[{"title":"","objective":"","milestones":'
            '[{"month_start":1,"month_end":2,"title":"","objective":"","topics":[""]}]}]}。'
            "必须恰好四个 phases；月份限制 1 到 12；保留项目产出和技能主题。\n\n"
            + source_text[:40_000]
        )
        raw = call_llm(
            self.ai_settings_service,
            "你是学习计划结构化助手，不扩写事实，只提取原文。",
            prompt,
            max_tokens=4000,
            timeout_seconds=20,
        )
        if not raw:
            return None, "AI 调用在 20 秒内未成功返回"
        parsed = parse_json_safe(raw) if raw else None
        if not isinstance(parsed, dict) or not isinstance(parsed.get("phases"), list):
            return None, "AI 返回内容不是有效的计划 JSON"
        if len(parsed["phases"]) != 4:
            return None, "AI 返回内容未包含四个阶段"
        return parsed, None

    def _build_snapshot(
        self,
        source_text: str,
        start_day: date,
        end_day: date,
        weekdays: list[int],
        daily_minutes: int,
        outline: dict[str, Any] | None,
    ) -> dict[str, Any]:
        local_milestones = self._extract_month_sections(source_text)
        phases: list[dict[str, Any]] = []
        horizon_end = min(end_day, start_day + timedelta(days=13))
        ai_phases = outline.get("phases", []) if outline else []

        for phase_index, (month_start, month_end) in enumerate(PHASE_MONTH_RANGES, start=1):
            ai_phase = ai_phases[phase_index - 1] if phase_index <= len(ai_phases) else {}
            phase_start = _add_months(start_day, month_start - 1)
            phase_end = min(end_day, _add_months(start_day, month_end) - timedelta(days=1))
            title = _clean_line(str(ai_phase.get("title") or PHASE_TITLES[phase_index - 1]))
            objective = _clean_line(str(ai_phase.get("objective") or f"完成第 {month_start} 至 {month_end} 个月的核心能力建设"), 240)

            ai_milestones = ai_phase.get("milestones") if isinstance(ai_phase.get("milestones"), list) else []
            milestone_specs = self._phase_milestones(
                local_milestones,
                ai_milestones,
                month_start,
                month_end,
                title,
            )
            milestones: list[dict[str, Any]] = []
            for milestone_index, spec in enumerate(milestone_specs, start=1):
                milestone_start = _add_months(start_day, int(spec["month_start"]) - 1)
                milestone_end = min(end_day, _add_months(start_day, int(spec["month_end"])) - timedelta(days=1))
                weekly_goals = self._build_weekly_goals(
                    phase_index,
                    milestone_index,
                    milestone_start,
                    milestone_end,
                    weekdays,
                    daily_minutes,
                    horizon_end,
                    list(spec.get("topics") or []),
                )
                estimated = sum(int(goal["estimated_minutes"]) for goal in weekly_goals)
                milestones.append(
                    {
                        "milestone_id": f"phase-{phase_index}-milestone-{milestone_index}",
                        "title": str(spec["title"])[:120],
                        "objective": str(spec.get("objective") or "")[:500],
                        "start_date": milestone_start.isoformat(),
                        "end_date": milestone_end.isoformat(),
                        "estimated_minutes": estimated,
                        "weekly_goals": weekly_goals,
                    }
                )
            phases.append(
                {
                    "phase_id": f"phase-{phase_index}",
                    "title": title,
                    "objective": objective,
                    "start_date": phase_start.isoformat(),
                    "end_date": phase_end.isoformat(),
                    "estimated_minutes": sum(int(item["estimated_minutes"]) for item in milestones),
                    "milestones": milestones,
                }
            )
        return {
            "schema_version": 2,
            "generated_at": _utc_now(),
            "horizon_end": horizon_end.isoformat(),
            "phases": phases,
        }

    def _extract_month_sections(self, source_text: str) -> list[dict[str, Any]]:
        lines = source_text.splitlines()
        sections: list[dict[str, Any]] = []
        current: dict[str, Any] | None = None
        for raw in lines:
            match = MONTH_HEADING_RE.match(raw.strip())
            if match:
                if current:
                    sections.append(current)
                month_start = max(1, min(12, int(match.group(1))))
                month_end = max(month_start, min(12, int(match.group(2) or month_start)))
                current = {
                    "month_start": month_start,
                    "month_end": month_end,
                    "title": _clean_line(match.group(3) or f"第 {month_start}-{month_end} 个月"),
                    "objective": "",
                    "topics": [],
                }
                continue
            if current is None:
                continue
            cleaned = _clean_line(raw)
            if not cleaned or cleaned.startswith("#"):
                continue
            if raw.lstrip().startswith(("*", "-", "1.", "2.", "3.")):
                if len(cleaned) >= 2 and len(current["topics"]) < 24:
                    current["topics"].append(cleaned)
            elif not current["objective"] and len(cleaned) >= 8:
                current["objective"] = cleaned
        if current:
            sections.append(current)
        return sections

    def _phase_milestones(
        self,
        local: list[dict[str, Any]],
        ai_items: list[dict[str, Any]],
        month_start: int,
        month_end: int,
        fallback_title: str,
    ) -> list[dict[str, Any]]:
        source = ai_items or [
            item for item in local
            if int(item["month_start"]) <= month_end and int(item["month_end"]) >= month_start
        ]
        result: list[dict[str, Any]] = []
        for raw in source:
            try:
                item_start = max(month_start, min(month_end, int(raw.get("month_start", month_start))))
                item_end = max(item_start, min(month_end, int(raw.get("month_end", item_start))))
            except (TypeError, ValueError):
                continue
            topics = [_clean_line(str(item)) for item in raw.get("topics", []) if _clean_line(str(item))]
            result.append(
                {
                    "month_start": item_start,
                    "month_end": item_end,
                    "title": _clean_line(str(raw.get("title") or fallback_title)),
                    "objective": _clean_line(str(raw.get("objective") or "完成本阶段学习与可验证产出。"), 500),
                    "topics": topics,
                }
            )
        if not result:
            result.append(
                {
                    "month_start": month_start,
                    "month_end": month_end,
                    "title": fallback_title,
                    "objective": "完成本阶段学习与可验证产出",
                    "topics": [fallback_title],
                }
            )
        return result

    def _build_weekly_goals(
        self,
        phase_index: int,
        milestone_index: int,
        start_day: date,
        end_day: date,
        weekdays: list[int],
        daily_minutes: int,
        horizon_end: date,
        topics: list[str],
    ) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        week_start = start_day - timedelta(days=start_day.isoweekday() - 1)
        topic_pool = topics or ["核心知识学习", "代码实践", "项目产出", "复盘与总结"]
        week_index = 1
        while week_start <= end_day:
            window_start = max(start_day, week_start)
            window_end = min(end_day, week_start + timedelta(days=6))
            active_dates = [
                window_start + timedelta(days=offset)
                for offset in range((window_end - window_start).days + 1)
                if (window_start + timedelta(days=offset)).isoweekday() in weekdays
            ]
            if not active_dates:
                week_start += timedelta(days=7)
                week_index += 1
                continue
            topic = topic_pool[(week_index - 1) % len(topic_pool)]
            goal_id = f"p{phase_index}-m{milestone_index}-w{week_index}"
            can_expand = window_end <= horizon_end
            steps = self._build_week_steps(goal_id, active_dates, daily_minutes, topic) if can_expand else []
            result.append(
                {
                    "goal_id": goal_id,
                    "title": f"第 {week_index} 周：{topic}",
                    "objective": f"围绕{topic}完成学习、实践和一次可检查输出",
                    "window_start": window_start.isoformat(),
                    "window_end": window_end.isoformat(),
                    "estimated_minutes": len(active_dates) * daily_minutes,
                    "progress_weight": 1.0,
                    "expanded": bool(steps),
                    "steps": steps,
                }
            )
            week_start += timedelta(days=7)
            week_index += 1
        return result

    def _build_week_steps(
        self,
        goal_id: str,
        active_dates: list[date],
        daily_minutes: int,
        topic: str,
    ) -> list[dict[str, Any]]:
        actions = ["理解与整理", "代码练习", "项目推进", "复盘输出"]
        steps: list[dict[str, Any]] = []
        sequence = 1
        for day_index, active_day in enumerate(active_dates):
            chunk_count = max(1, math.ceil(daily_minutes / 240))
            base = daily_minutes // chunk_count
            remainder = daily_minutes % chunk_count
            for chunk_index in range(chunk_count):
                minutes = base + (1 if chunk_index < remainder else 0)
                action = actions[(day_index + chunk_index) % len(actions)]
                steps.append(
                    {
                        "step_id": f"{goal_id}-s{sequence}",
                        "title": f"{action}：{topic}",
                        "description": "记录实际耗时，并手动勾选完成",
                        "scheduled_date": active_day.isoformat(),
                        "due_date": active_day.isoformat(),
                        "estimated_minutes": minutes,
                        "dependencies": [steps[-1]["step_id"]] if steps else [],
                    }
                )
                sequence += 1
        if steps:
            step_weight = 1.0 / len(steps)
            for step in steps:
                step["progress_weight"] = step_weight
        return steps

    def _build_review_proposal(
        self,
        snapshot: dict[str, Any],
        states: dict[str, dict[str, Any]],
        plan_row: dict[str, Any],
        review_date: date,
        daily_capacity: int,
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        proposed = copy.deepcopy(snapshot)
        self._normalize_progress_weights(proposed)
        weekdays = _normalize_weekdays(self._load_json(plan_row.get("preferred_weekdays_json"), []))
        horizon_end = min(
            _parse_date(str(plan_row["target_end_date"]), "预计完成"),
            review_date + timedelta(days=13),
        )
        changes: list[dict[str, Any]] = []

        for phase in proposed.get("phases", []):
            for milestone in phase.get("milestones", []):
                for goal in milestone.get("weekly_goals", []):
                    goal_end = _parse_date(str(goal["window_end"]), "周目标")
                    if not goal.get("expanded") and goal_end <= horizon_end and goal_end >= review_date:
                        start = _parse_date(str(goal["window_start"]), "周目标")
                        dates = [
                            start + timedelta(days=offset)
                            for offset in range((goal_end - start).days + 1)
                            if (start + timedelta(days=offset)).isoweekday() in weekdays
                        ]
                        goal["steps"] = self._build_week_steps(
                            str(goal["goal_id"]), dates, int(plan_row["daily_minutes"]), str(goal["title"]).split("：", 1)[-1]
                        )
                        goal["expanded"] = bool(goal["steps"])
                        if goal["expanded"]:
                            changes.append({"type": "expanded", "item_id": goal["goal_id"], "title": goal["title"]})

                    split_steps: list[dict[str, Any]] = []
                    for step in goal.get("steps", []):
                        estimate = int(step.get("estimated_minutes") or 1)
                        current_status = states.get(str(step.get("step_id")), {}).get("status", "pending")
                        scheduled = _parse_date(str(step["scheduled_date"]), "步骤")
                        if current_status != "pending" or estimate <= daily_capacity or scheduled > horizon_end:
                            split_steps.append(step)
                            continue
                        parts = max(2, math.ceil(estimate / daily_capacity))
                        previous_id: str | None = None
                        for part_index in range(parts):
                            part = copy.deepcopy(step)
                            part["step_id"] = f"{step['step_id']}-r{int(plan_row['active_revision']) + 1}p{part_index + 1}"
                            part["title"] = f"{step['title']}（{part_index + 1}/{parts}）"
                            part["estimated_minutes"] = min(
                                daily_capacity,
                                estimate - part_index * daily_capacity,
                            )
                            part["dependencies"] = [previous_id] if previous_id else list(step.get("dependencies") or [])
                            part["progress_weight"] = float(step.get("progress_weight") or 0) / parts
                            part.pop("evidence_required", None)
                            part.pop("evidence_prompt", None)
                            previous_id = part["step_id"]
                            split_steps.append(part)
                        changes.append(
                            {
                                "type": "split",
                                "item_id": step["step_id"],
                                "title": step["title"],
                                "from": f"{estimate} 分钟",
                                "to": f"{parts} 个步骤",
                            }
                        )
                    goal["steps"] = split_steps

        movable: list[dict[str, Any]] = []
        for _, _, _, step in _iter_plan_steps(proposed):
            status = states.get(str(step["step_id"]), {}).get("status", "pending")
            if status != "completed" and _parse_date(str(step["scheduled_date"]), "步骤") <= horizon_end:
                movable.append(step)
        slots: list[date] = []
        cursor = review_date
        while cursor <= horizon_end:
            if cursor.isoweekday() in weekdays:
                slots.append(cursor)
            cursor += timedelta(days=1)
        if not slots:
            return proposed, changes

        day_load: dict[str, int] = {slot.isoformat(): 0 for slot in slots}
        for step in movable:
            old_date = str(step["scheduled_date"])
            estimate = int(step.get("estimated_minutes") or 1)
            available_slot = next(
                (slot for slot in slots if day_load[slot.isoformat()] + estimate <= daily_capacity),
                None,
            )
            if available_slot is None:
                changes.append(
                    {
                        "type": "capacity_conflict",
                        "item_id": step["step_id"],
                        "title": step["title"],
                        "from": old_date,
                        "to": "14 天窗口容量不足，保持原日期",
                    }
                )
                continue
            new_date = available_slot.isoformat()
            day_load[new_date] += estimate
            if new_date != old_date:
                step["scheduled_date"] = new_date
                step["due_date"] = new_date
                changes.append(
                    {
                        "type": "moved",
                        "item_id": step["step_id"],
                        "title": step["title"],
                        "from": old_date,
                        "to": new_date,
                    }
                )
        proposed["horizon_end"] = horizon_end.isoformat()
        proposed["generated_at"] = _utc_now()
        self._recalculate_estimates(proposed)
        return proposed, changes

    def _recalculate_estimates(self, snapshot: dict[str, Any]) -> None:
        for phase in snapshot.get("phases", []):
            phase_total = 0
            for milestone in phase.get("milestones", []):
                milestone_total = 0
                for goal in milestone.get("weekly_goals", []):
                    if goal.get("expanded") and goal.get("steps"):
                        goal["estimated_minutes"] = sum(
                            max(0, int(step.get("estimated_minutes") or 0))
                            for step in goal["steps"]
                        )
                    milestone_total += max(0, int(goal.get("estimated_minutes") or 0))
                milestone["estimated_minutes"] = milestone_total
                phase_total += milestone_total
            phase["estimated_minutes"] = phase_total

    def _normalize_progress_weights(self, snapshot: dict[str, Any]) -> None:
        snapshot["schema_version"] = 2
        for phase in snapshot.get("phases", []):
            for milestone in phase.get("milestones", []):
                for goal in milestone.get("weekly_goals", []):
                    try:
                        goal_weight = float(goal.get("progress_weight") or 1.0)
                    except (TypeError, ValueError):
                        goal_weight = 1.0
                    if goal_weight <= 0:
                        goal_weight = 1.0
                    goal["progress_weight"] = goal_weight

                    steps = goal.get("steps") if isinstance(goal.get("steps"), list) else []
                    if not steps:
                        continue
                    try:
                        step_weights = [float(step.get("progress_weight") or 0) for step in steps]
                    except (TypeError, ValueError):
                        step_weights = []
                    weights_are_stable = (
                        len(step_weights) == len(steps)
                        and all(weight > 0 for weight in step_weights)
                        and math.isclose(sum(step_weights), goal_weight, rel_tol=1e-6, abs_tol=1e-6)
                    )
                    if weights_are_stable:
                        continue
                    step_weight = goal_weight / len(steps)
                    for step in steps:
                        step["progress_weight"] = step_weight

    def _build_progress(
        self,
        snapshot: dict[str, Any],
        states: dict[str, dict[str, Any]],
        goal_time_totals: dict[str, int] | None = None,
    ) -> dict[str, Any]:
        estimated_total = 0
        completed_minutes = 0
        task_total = 0.0
        completed_task_weight = 0.0
        completed_steps = 0
        total_steps = 0
        phase_rows: dict[str, dict[str, Any]] = {}
        for phase in snapshot.get("phases", []):
            phase_row = phase_rows.setdefault(
                str(phase["phase_id"]),
                {
                    "phase_id": phase["phase_id"],
                    "title": phase["title"],
                    "estimated_minutes": 0,
                    "completed_minutes": 0,
                    "total_task_weight": 0.0,
                    "completed_task_weight": 0.0,
                    "completed_steps": 0,
                    "total_steps": 0,
                    "actual_seconds": 0,
                },
            )
            for milestone in phase.get("milestones", []):
                for goal in milestone.get("weekly_goals", []):
                    if goal.get("cancelled") or goal.get("status") == "cancelled":
                        continue
                    goal_id = str(goal.get("goal_id") or "")
                    phase_row["actual_seconds"] += int((goal_time_totals or {}).get(goal_id, 0))
                    steps = goal.get("steps", []) if goal.get("expanded") else []
                    active_steps = [
                        step for step in steps
                        if not step.get("cancelled") and step.get("status") != "cancelled"
                    ]
                    nodes = active_steps or [goal]
                    for node in nodes:
                        estimate = max(0, int(node.get("estimated_minutes") or 0))
                        try:
                            weight = float(node.get("progress_weight") or 0)
                        except (TypeError, ValueError):
                            weight = 0.0
                        if node is goal and weight <= 0:
                            weight = 1.0
                        weight = max(0.0, weight)
                        state = states.get(str(node.get("step_id") or node.get("goal_id")), {})
                        is_completed = state.get("status") == "completed"

                        estimated_total += estimate
                        task_total += weight
                        phase_row["estimated_minutes"] += estimate
                        phase_row["total_task_weight"] += weight
                        if node is not goal:
                            total_steps += 1
                            phase_row["total_steps"] += 1
                        if is_completed:
                            completed_minutes += estimate
                            completed_task_weight += weight
                            phase_row["completed_minutes"] += estimate
                            phase_row["completed_task_weight"] += weight
                            if node is not goal:
                                completed_steps += 1
                                phase_row["completed_steps"] += 1
        for row in phase_rows.values():
            task_denominator = float(row["total_task_weight"])
            minute_denominator = int(row["estimated_minutes"])
            row["total_task_weight"] = round(task_denominator, 4)
            row["completed_task_weight"] = round(float(row["completed_task_weight"]), 4)
            row["completion_rate"] = (
                round(float(row["completed_task_weight"]) / task_denominator * 100, 1)
                if task_denominator else 0.0
            )
            row["workload_completion_rate"] = (
                round(int(row["completed_minutes"]) / minute_denominator * 100, 1)
                if minute_denominator else 0.0
            )
        return {
            "estimated_minutes": estimated_total,
            "completed_minutes": completed_minutes,
            "total_task_weight": round(task_total, 4),
            "completed_task_weight": round(completed_task_weight, 4),
            "completed_steps": completed_steps,
            "total_steps": total_steps,
            "completion_rate": round(completed_task_weight / task_total * 100, 1) if task_total else 0.0,
            "workload_completion_rate": (
                round(completed_minutes / estimated_total * 100, 1) if estimated_total else 0.0
            ),
            "actual_seconds": sum((goal_time_totals or {}).values()),
            "phases": list(phase_rows.values()),
        }

    def _build_review_status(
        self,
        plan_id: str,
        snapshot: dict[str, Any],
        states: dict[str, dict[str, Any]],
        plan_row: dict[str, Any],
        reviews: list[dict[str, Any]],
        target_day: date,
    ) -> dict[str, Any]:
        week_start = target_day - timedelta(days=target_day.isoweekday() - 1)
        period_end = target_day
        reviewed_this_week = False
        pending_review_id: int | None = None
        for review in reviews:
            if review.get("status") == "pending" and pending_review_id is None:
                pending_review_id = int(review["id"])
            review_input = self._load_json(review.get("review_input_json"), {})
            try:
                review_day = _parse_date(str(review_input.get("review_date") or ""), "复盘")
            except ApiError:
                continue
            if week_start <= review_day <= week_start + timedelta(days=6):
                reviewed_this_week = True

        future_dates: list[date] = []
        planned_steps = 0
        completed_in_period = 0
        overdue_titles: list[str] = []
        blocked_titles: list[str] = []
        for _, _, _, step in _iter_plan_steps(snapshot):
            if step.get("cancelled") or step.get("status") == "cancelled":
                continue
            scheduled = _parse_date(str(step.get("scheduled_date") or ""), "步骤")
            state = states.get(str(step.get("step_id") or ""), {})
            status = str(state.get("status") or "pending")
            if status != "completed" and scheduled >= target_day:
                future_dates.append(scheduled)
            if week_start <= scheduled <= period_end:
                planned_steps += 1
                if status == "completed":
                    completed_in_period += 1
                elif status == "blocked":
                    blocked_titles.append(str(step.get("title") or "未命名步骤"))
                elif scheduled < target_day:
                    overdue_titles.append(str(step.get("title") or "未命名步骤"))

        detailed_until = max(future_dates) if future_dates else None
        detailed_days_remaining = (
            (detailed_until - target_day).days + 1 if detailed_until is not None else 0
        )
        weekend_due = target_day.isoweekday() >= 6
        coverage_due = detailed_days_remaining < 7
        can_remind = (
            plan_row.get("status") == "active"
            and not reviewed_this_week
            and pending_review_id is None
        )
        reasons: list[str] = []
        if weekend_due:
            reasons.append("week_end")
        if coverage_due:
            reasons.append("coverage_low")

        actual_seconds = self.repo.get_period_time_total(
            plan_id, week_start.isoformat(), period_end.isoformat()
        )
        summary = (
            f"本周截至今天计划 {planned_steps} 个步骤，已完成 {completed_in_period} 个，"
            f"实际投入 {_format_duration(actual_seconds)}"
        )
        blocker_parts: list[str] = []
        if blocked_titles:
            blocker_parts.append("阻塞：" + "、".join(blocked_titles[:3]))
        if overdue_titles:
            blocker_parts.append("逾期未完成：" + "、".join(overdue_titles[:3]))

        return {
            "due": can_remind and bool(reasons),
            "reasons": reasons,
            "reviewed_this_week": reviewed_this_week,
            "pending_review_id": pending_review_id,
            "detailed_until": detailed_until.isoformat() if detailed_until else None,
            "detailed_days_remaining": detailed_days_remaining,
            "prefill": {
                "period_start": week_start.isoformat(),
                "period_end": period_end.isoformat(),
                "planned_steps": planned_steps,
                "completed_steps": completed_in_period,
                "overdue_steps": len(overdue_titles),
                "blocked_steps": len(blocked_titles),
                "actual_seconds": actual_seconds,
                "summary": summary,
                "blockers": "\n".join(blocker_parts),
                "next_week_minutes": int(plan_row.get("daily_minutes") or 60),
            },
        }

    def _enrich_snapshot(
        self,
        snapshot: dict[str, Any],
        states: dict[str, dict[str, Any]],
        time_totals: dict[str, int],
        goal_bindings: dict[str, dict[str, Any]],
        goal_time_totals: dict[str, int],
        task_id: int,
    ) -> dict[str, Any]:
        result = copy.deepcopy(snapshot)
        for phase in result.get("phases", []):
            for milestone in phase.get("milestones", []):
                for goal in milestone.get("weekly_goals", []):
                    goal_id = str(goal.get("goal_id") or "")
                    binding = goal_bindings.get(goal_id, {})
                    goal["timer_attr_id"] = binding.get("attr_id")
                    goal["actual_seconds"] = goal_time_totals.get(goal_id, 0)
                    for step in goal.get("steps", []):
                        state = states.get(str(step["step_id"]), {})
                        step["status"] = state.get("status", "pending")
                        step["evidence"] = self._load_json(state.get("evidence_json"), [])
                        step["completed_at"] = state.get("completed_at")
                        step["actual_seconds"] = time_totals.get(str(step["step_id"]), 0)
                        step["task_id"] = task_id or None
                        step["timer_attr_id"] = binding.get("attr_id")
        return result

    def _require_plan(self, plan_id: str) -> dict[str, Any]:
        row = self.repo.get_plan(plan_id)
        if row is None:
            raise ApiError("NOT_FOUND", "计划不存在", 404)
        return row

    def _require_step(
        self, plan_id: str, step_id: str
    ) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
        row = self._require_plan(plan_id)
        revision = self.repo.get_revision(plan_id, int(row["active_revision"]))
        snapshot = self._load_json(revision.get("plan_json") if revision else None, {})
        for _, _, goal, step in _iter_plan_steps(snapshot):
            if step.get("step_id") == step_id:
                return row, snapshot, goal, step
        raise ApiError("NOT_FOUND", "计划步骤不存在", 404)

    def _record_step_time(
        self,
        *,
        row: dict[str, Any],
        plan_id: str,
        goal_id: str,
        step_id: str,
        start_time: str,
        record_date: str,
        duration_seconds: int,
        note: str,
    ) -> dict[str, Any]:
        binding = self.repo.get_goal_bindings(plan_id).get(goal_id)
        task_id = int(row.get("task_id") or 0)
        if task_id <= 1 or not binding:
            raise ApiError("BAD_REQUEST", "Plan 尚未建立任务或周目标计时属性", 409)
        return self.time_repo.record_session(
            task_id=task_id,
            attr_id=int(binding["attr_id"]),
            start_time=start_time,
            record_date=record_date,
            duration_seconds=duration_seconds,
            source_type="plan_step",
            source_id=f"{plan_id}:{step_id}",
            note=note,
            plan_id=plan_id,
            step_id=step_id,
        )

    def _validate_snapshot(self, snapshot: dict[str, Any]) -> None:
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get("phases"), list) or not snapshot["phases"]:
            raise ApiError("BAD_REQUEST", "计划预览必须包含阶段", 422)
        ids: set[str] = set()
        for _, _, _, step in _iter_plan_steps(snapshot):
            step_id = str(step.get("step_id") or "")
            if not step_id or step_id in ids:
                raise ApiError("BAD_REQUEST", "步骤 ID 缺失或重复", 422)
            ids.add(step_id)
            estimate = int(step.get("estimated_minutes") or 0)
            if estimate < 1 or estimate > 240:
                raise ApiError("BAD_REQUEST", "单个步骤预计时间需在 1 到 240 分钟之间", 422)
            _parse_date(str(step.get("scheduled_date") or ""), "步骤")

    def _infer_title(self, source_text: str) -> str:
        for raw in source_text.splitlines():
            line = _clean_line(raw)
            if raw.lstrip().startswith("#") and len(line) >= 4:
                return line[:120]
        return "长期学习计划"

    def _serialize_plan_row(self, row: dict[str, Any]) -> dict[str, Any]:
        result = dict(row)
        result["preferred_weekdays"] = _normalize_weekdays(
            self._load_json(result.pop("preferred_weekdays_json", None), [])
        )
        result["daily_minutes"] = int(result["daily_minutes"])
        result["active_revision"] = int(result["active_revision"])
        result["owns_task"] = bool(result.get("owns_task"))
        result.pop("source_text", None)
        return result

    def _serialize_state(self, row: dict[str, Any]) -> dict[str, Any]:
        result = dict(row)
        result["evidence"] = self._load_json(result.pop("evidence_json", None), [])
        return result

    def _serialize_review(self, row: dict[str, Any]) -> dict[str, Any]:
        result = dict(row)
        result["review_input"] = self._load_json(result.pop("review_input_json", None), {})
        result["proposal"] = self._load_json(result.pop("proposal_json", None), {})
        return result

    @staticmethod
    def _load_json(raw: Any, fallback: Any) -> Any:
        if not isinstance(raw, str):
            return copy.deepcopy(fallback)
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return copy.deepcopy(fallback)
