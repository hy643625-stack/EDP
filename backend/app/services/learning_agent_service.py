from __future__ import annotations

import copy
import json
import re
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

import httpx

from app.errors import ApiError
from app.learning_knowledge.loader import KnowledgeBase
from app.services.ai_settings_service import AiSettingsService

LEARNING_PRIVACY_NOTICE = (
    "启用云端 AI 后，学习对话、目标和资源包摘要可能会发送到所选模型服务进行处理。"
    "若不希望上传数据，请关闭 AI 或使用本地模型。"
)

LEARNING_AGENTS: list[dict[str, Any]] = [
    {"agent_id": "profiler", "name": "学习画像智能体", "responsibility": "提炼目标、基础、偏好与风险。"},
    {"agent_id": "planner", "name": "路径规划智能体", "responsibility": "拆解阶段任务与学习路径。"},
    {"agent_id": "explainer", "name": "课程讲解智能体", "responsibility": "生成讲解提纲和难点说明。"},
    {"agent_id": "practice", "name": "练习设计智能体", "responsibility": "生成分层练习与自测问题。"},
    {"agent_id": "curator", "name": "资源策展智能体", "responsibility": "组合脑图、阅读指南、案例任务。"},
    {"agent_id": "coach", "name": "督学教练智能体", "responsibility": "输出节奏建议、风险提醒和复盘动作。"},
]

PROFILE_DIMENSION_CATALOG: list[dict[str, str]] = [
    {"key": "baseline", "label": "基础水平"},
    {"key": "goal", "label": "目标导向"},
    {"key": "schedule", "label": "时间带宽"},
    {"key": "style", "label": "学习偏好"},
    {"key": "practice", "label": "练习方式"},
    {"key": "pace", "label": "节奏容忍度"},
    {"key": "risk", "label": "风险因子"},
    {"key": "support", "label": "支持策略"},
]

COURSE_INDEX = {}  # replaced by KnowledgeBase; kept for migration compatibility


def _extract_json_object(text: str) -> dict[str, Any]:
    raw = text.strip()
    if not raw:
        raise ValueError("empty model response")
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        parsed = json.loads(raw[start : end + 1])
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("model response is not valid JSON")


def _contains_any(text: str, keywords: list[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def _extract_core_name(name: str) -> str:
    """Extract the Chinese-only core from a concept name like '栈（Stack）' -> '栈'."""
    core = "".join(ch for ch in name if "一" <= ch <= "鿿" or "　" <= ch <= "〿")
    return core if core else name


def _has_word_overlap(question: str, concept_name: str) -> bool:
    """Check if any 2-char slice of the concept name appears in the question."""
    for i in range(len(concept_name) - 1):
        chunk = concept_name[i:i+2]
        if len(chunk) >= 2 and chunk in question:
            return True
    return False


class LearningAgentService:
    def __init__(
        self,
        ai_settings_service: AiSettingsService,
        kb: KnowledgeBase | None = None,
        repo: Any | None = None,  # LearningRepository, optional for session persistence
    ) -> None:
        self.ai_settings_service = ai_settings_service
        self.kb = kb
        self.repo = repo

    def get_workbench_payload(self) -> dict[str, Any]:
        courses = self._build_course_list()
        return {
            "courses": courses,
            "agents": copy.deepcopy(LEARNING_AGENTS),
            "profile_dimensions": copy.deepcopy(PROFILE_DIMENSION_CATALOG),
            "privacy_notice": LEARNING_PRIVACY_NOTICE,
            "runtime": self.ai_settings_service.get_execution_plan(),
            "feature_flags": {
                "profile_builder": True,
                "resource_package": True,
                "learning_path": True,
                "evaluation_panel": True,
            },
        }

    def _build_course_list(self) -> list[dict[str, Any]]:
        courses: list[dict[str, Any]] = []
        if self.kb is not None:
            for course_id in self.kb.course_ids():
                course_info = self.kb.get_course(course_id)
                if course_info is None:
                    continue
                courses.append(self._serialize_kb_course(course_info))
        # Fallback: add Python + Advanced Math from hardcoded backup
        if "python_programming" not in {c["course_id"] for c in courses}:
            courses.append(_FALLBACK_PYTHON_COURSE)
        if "advanced_math" not in {c["course_id"] for c in courses}:
            courses.append(_FALLBACK_ADVANCED_MATH_COURSE)
        return courses

    def _serialize_kb_course(self, course_info) -> dict[str, Any]:
        modules: list[dict[str, Any]] = []
        for mid in course_info.module_ids:
            module = self.kb.get_module(mid) if self.kb else None
            if module is None:
                continue
            concepts = self.kb.concept_list(mid) if self.kb else []
            modules.append({
                "module_id": module.module_id,
                "title": module.title,
                "core_points": [c["name"] for c in concepts[:3]],
                "outcome": module.learning_objectives[-1] if module.learning_objectives else "",
            })
        return {
            "course_id": course_info.course_id,
            "title": course_info.title,
            "category": "计算机核心课",
            "difficulty": "中级",
            "summary": course_info.summary,
            "tags": [],
            "module_count": len(modules),
            "modules": modules,
        }

    def _get_course(self, course_id: str) -> dict[str, Any]:
        cid = course_id.strip()
        # Try KB first
        if self.kb is not None:
            course_info = self.kb.get_course(cid)
            if course_info is not None:
                return self._serialize_kb_course(course_info)
        # Fallback
        fallback = _FALLBACK_COURSE_MAP.get(cid)
        if fallback is not None:
            return dict(fallback)
        raise ApiError("BAD_REQUEST", f"未知课程：{course_id}", 422)

    def _normalize_conversation(self, conversation: str) -> str:
        normalized = " ".join(conversation.strip().split())
        if len(normalized) < 10:
            raise ApiError("BAD_REQUEST", "请至少输入一段完整的学习描述，方便系统构建学习画像。", 422)
        return normalized

    def build_profile(
        self,
        course_id: str,
        conversation: str,
        preferred_goal: str = "",
        weekly_days: int | None = None,
        daily_minutes: int | None = None,
    ) -> dict[str, Any]:
        course = self._get_course(course_id)
        normalized_conversation = self._normalize_conversation(conversation)
        profile = self._build_profile_core(course, normalized_conversation, preferred_goal, weekly_days, daily_minutes)
        execution_plan = self.ai_settings_service.get_execution_plan()
        return {
            "course": course,
            "profile": profile,
            "mode_requested": execution_plan["mode"],
            "mode_used": "local_rules",
            "provider_id": execution_plan["provider_id"],
            "runtime_message": execution_plan["runtime_message"],
            "fallback_reason": None,
            "generated_at": self._utc_now_iso(),
        }

    def generate_learning_package(
        self,
        course_id: str,
        conversation: str,
        preferred_goal: str = "",
        weekly_days: int | None = None,
        daily_minutes: int | None = None,
    ) -> dict[str, Any]:
        course = self._get_course(course_id)
        normalized_conversation = self._normalize_conversation(conversation)
        profile = self._build_profile_core(course, normalized_conversation, preferred_goal, weekly_days, daily_minutes)
        package = self._build_local_package(course, profile, normalized_conversation)
        execution_plan = self.ai_settings_service.get_execution_plan()
        runtime_provider = self.ai_settings_service.get_runtime_provider_config()
        mode_used = "local_rules"
        fallback_reason: str | None = None

        if not execution_plan["uses_local_rules"] and runtime_provider is not None:
            try:
                enhancement = self._generate_model_enhancement(course, profile, package, runtime_provider)
            except Exception as exc:
                fallback_reason = f"{self._format_model_error(exc)}，已自动回退到本地规则算法"
            else:
                package = self._merge_model_enhancement(package, enhancement)
                mode_used = "model"
        elif not execution_plan["uses_local_rules"]:
            fallback_reason = "当前 AI 配置尚未就绪，已自动回退到本地规则算法"

        return {
            "course": course,
            "profile": profile,
            "package": package,
            "mode_requested": execution_plan["mode"],
            "mode_used": mode_used,
            "provider_id": execution_plan["provider_id"],
            "runtime_message": execution_plan["runtime_message"],
            "fallback_reason": fallback_reason,
            "generated_at": self._utc_now_iso(),
        }

    # ═══════════════════════════════════════════════════════
    # Phase 2: Session-based learning
    # ═══════════════════════════════════════════════════════

    def create_learning_session(
        self,
        course_id: str,
        conversation: str,
        preferred_goal: str = "",
        weekly_days: int = 4,
        daily_minutes: int = 50,
        title: str = "",
    ) -> dict[str, Any]:
        """Create a session, generate profile v1, persist everything."""
        course = self._get_course(course_id)
        normalized = self._normalize_conversation(conversation)
        profile = self._build_profile_core(course, normalized, preferred_goal, weekly_days, daily_minutes)
        input_summary = normalized[:200]
        meta = self._execution_meta()

        if self.repo is None:
            sid = f"ephemeral-{self._utc_now_iso()}"
            return {
                "session": {"id": sid, "course_id": course_id, "title": title or course["title"],
                 "status": "active", "created_at": self._utc_now_iso(), "updated_at": self._utc_now_iso()},
                "profile": profile,
                "profile_version": 1,
                "course": course,
                **meta,
            }

        session = self.repo.create_session(
            course_id=course_id, conversation=normalized,
            preferred_goal=preferred_goal, weekly_days=weekly_days,
            daily_minutes=daily_minutes, title=title or course["title"],
        )
        self.repo.create_profile_version(
            session["id"], {"overview": profile["overview"], "dimensions": profile["dimensions"],
            "strengths": profile["strengths"], "risks": profile["risks"],
            "follow_up_questions": profile["follow_up_questions"],
            "focus_modules": profile["focus_modules"],
            "weekly_days": profile["weekly_days"], "daily_minutes": profile["daily_minutes"]},
            input_summary=input_summary,
        )
        return {
            "session": session,
            "profile": profile,
            "profile_version": 1,
            "course": course,
            **meta,
        }

    def update_session_profile(
        self,
        session_id: str,
        conversation: str,
        preferred_goal: str | None = None,
        weekly_days: int | None = None,
        daily_minutes: int | None = None,
    ) -> dict[str, Any]:
        """Append conversation to session, generate new profile version."""
        session = self._require_session(session_id)
        course = self._get_course(session["course_id"])
        merged_conversation = (session.get("conversation", "") + " " + conversation).strip()
        goal = preferred_goal or session.get("preferred_goal", "")
        wd = weekly_days if weekly_days is not None else session.get("weekly_days", 4)
        dm = daily_minutes if daily_minutes is not None else session.get("daily_minutes", 50)
        profile = self._build_profile_core(course, merged_conversation, goal, wd, dm)
        input_summary = conversation[:200]

        if self.repo is not None:
            self.repo.update_session(session_id, conversation=merged_conversation,
                                     preferred_goal=goal, weekly_days=wd, daily_minutes=dm)
            pv = self.repo.create_profile_version(
                session_id,
                {"overview": profile["overview"], "dimensions": profile["dimensions"],
                 "strengths": profile["strengths"], "risks": profile["risks"],
                 "follow_up_questions": profile["follow_up_questions"],
                 "focus_modules": profile["focus_modules"],
                 "weekly_days": profile["weekly_days"], "daily_minutes": profile["daily_minutes"]},
                input_summary=input_summary,
            )
            return {"profile": profile, "profile_version": pv["version"], "course": course}
        return {"profile": profile, "profile_version": 1, "course": course}

    def generate_session_package(self, session_id: str) -> dict[str, Any]:
        """Run agent pipeline and persist the resource package."""
        session = self._require_session(session_id)
        course = self._get_course(session["course_id"])
        conversation = session.get("conversation", "")
        goal = session.get("preferred_goal", "")
        wd = session.get("weekly_days", 4)
        dm = session.get("daily_minutes", 50)
        profile = self._build_profile_core(course, conversation, goal, wd, dm)
        package, agent_runs = self._run_agent_pipeline(course, profile, conversation, session_id)
        execution_plan = self.ai_settings_service.get_execution_plan()

        result = {
            "course": course,
            "profile": profile,
            "package": package,
            "agent_runs": agent_runs,
            "mode_requested": execution_plan["mode"],
            "mode_used": "local_rules",
            "provider_id": execution_plan["provider_id"],
            "runtime_message": execution_plan["runtime_message"],
            "fallback_reason": None,
            "generated_at": self._utc_now_iso(),
        }
        if self.repo is not None:
            self.repo.create_package(session_id, result)
        return result

    def get_session_detail(self, session_id: str) -> dict[str, Any]:
        """Return session + profile versions + latest package + agent runs."""
        session = self._require_session(session_id)
        detail: dict[str, Any] = {"session": session}
        if self.repo is not None:
            detail["profile_versions"] = self.repo.get_profile_versions(session_id)
            latest_raw = self.repo.get_latest_package(session_id)
            detail["latest_package"] = latest_raw.get("package") if latest_raw else None
            detail["agent_runs"] = self.repo.get_agent_runs(session_id)
        else:
            detail["profile_versions"] = []
            detail["latest_package"] = None
            detail["agent_runs"] = []
        return detail

    def list_sessions(self) -> list[dict[str, Any]]:
        if self.repo is None:
            return []
        return self.repo.list_sessions()

    def _require_session(self, session_id: str) -> dict[str, Any]:
        if self.repo is None:
            raise ApiError("NOT_FOUND", "会话功能不可用（数据库未初始化）", 404)
        session = self.repo.get_session(session_id)
        if session is None:
            raise ApiError("NOT_FOUND", f"会话不存在：{session_id}", 404)
        return session

    # ── Phase 3: Tutor ─────────────────────────────────

    def tutor_session(self, session_id: str, question: str) -> dict[str, Any]:
        """Instant Q&A based on session's latest resource package.

        Uses concept→module knowledge graph: first resolves which KB concepts
        appear in the question, then matches resources by module references.
        """
        session = self._require_session(session_id)
        if self.repo is None:
            raise ApiError("BAD_REQUEST", "会话功能不可用", 400)
        latest_raw = self.repo.get_latest_package(session_id)
        if latest_raw is None:
            return {
                "answer_markdown": "尚未生成资源包，请先生成资源包后再提问",
                "related_resources": [],
                "source_refs": [],
                "confidence": 0.0,
            }
        package = latest_raw.get("package", {})
        resources = package.get("resources", [])
        if not resources:
            resources = package.get("package", {}).get("resources", [])

        # Phase 1: Resolve question → KB concepts → modules
        matched_module_ids: set[str] = set()
        matched_concept_names: list[str] = []
        if self.kb is not None:
            for mid in self.kb.module_ids():
                for c in self.kb.concept_list(mid):
                    cname = c.get("name", "")
                    # Match full name or Chinese-only core (strip parentheticals)
                    core_name = _extract_core_name(cname)
                    if (len(cname) >= 2 and cname in question) or \
                       (len(core_name) >= 1 and core_name in question) or \
                       (len(question) >= 2 and question in cname) or \
                       (len(core_name) >= 2 and _has_word_overlap(question, core_name)):
                        matched_module_ids.add(mid)
                        matched_concept_names.append(cname)
                        break  # one match per module is enough
            # Also match module titles directly in question
            for mid in self.kb.module_ids():
                module = self.kb.get_module(mid)
                if module and len(module.title) >= 2 and module.title in question:
                    matched_module_ids.add(mid)

        # Phase 2: Score resources by module reference + content overlap
        matches: list[tuple[int, dict[str, Any]]] = []
        for r in resources:
            score = 0
            refs = r.get("source_refs", [])

            # Module-level match: resource source_refs reference the concept's module
            for mid in matched_module_ids:
                if any(mid in ref for ref in refs):
                    score += 10

            # Concept name directly in resource content
            content = r.get("content_markdown", "")
            for cname in matched_concept_names:
                if cname in content:
                    score += 5

            # Title/summary match
            title = r.get("title", "")
            summary = r.get("summary", "")
            combined = title + " " + summary
            if question in combined:
                score += 5
            for cname in matched_concept_names:
                if cname in combined:
                    score += 3

            if score > 0:
                matches.append((score, r))
        matches.sort(key=lambda x: x[0], reverse=True)

        related: list[dict[str, str]] = []
        for score, r in matches[:3]:
            if score < 3:
                continue
            related.append({
                "resource_id": r.get("resource_id", ""),
                "title": r.get("title", ""),
                "summary": r.get("summary", ""),
                "type": r.get("type", ""),
            })

        if related:
            answer = (
                f"根据你当前的学习资源包，以下内容可能与你的问题相关：\n\n"
                + "\n".join(f"- **{item['title']}**：{item['summary']}" for item in related)
                + f"\n\n建议从以上资源中查找答案。如需更深入的解答，可以在追加学习描述后重新生成资源包。"
            )
            confidence = min(0.3 + len(related) * 0.2, 0.9)
            source_refs = [f"resource:{item['resource_id']}" for item in related]
        else:
            answer = (
                "当前资源包中未找到与问题直接关联的内容。基于课程知识库的保守回答：\n\n"
                "建议从「主线讲解」和「知识脑图」入手，先掌握核心概念的定义和基本操作，"
                "再通过「分层练习」巩固理解。如果问题涉及特定知识点，可以在追加学习描述时明确提及。"
            )
            confidence = 0.2
            source_refs = ["origin:self_authored"]

        return {
            "answer_markdown": answer,
            "related_resources": related,
            "source_refs": source_refs,
            "confidence": round(confidence, 2),
        }

    # ═══════════════════════════════════════════════════════
    # Agent pipeline + runner + safety
    # ═══════════════════════════════════════════════════════

    @contextmanager
    def _agent_run(self, session_id: str | None, agent_id: str, input_summary: str) -> Iterator[dict[str, Any]]:
        """Context manager: records agent start/status/duration/source_refs."""
        started = time.perf_counter()
        run_record: dict[str, Any] = {
            "agent_id": agent_id, "status": "completed", "duration_ms": 0,
            "input_summary": input_summary[:200], "output_summary": "",
            "fallback_reason": "", "source_refs": [],
        }
        try:
            yield run_record
        except Exception as exc:
            run_record["status"] = "fallback"
            run_record["fallback_reason"] = str(exc)[:200]
        finally:
            run_record["duration_ms"] = int((time.perf_counter() - started) * 1000)
            if self.repo is not None and session_id:
                self.repo.create_agent_run(
                    session_id, agent_id, run_record["status"],
                    duration_ms=run_record["duration_ms"],
                    input_summary=run_record["input_summary"][:200],
                    output_summary=run_record["output_summary"][:200],
                    fallback_reason=run_record["fallback_reason"],
                    source_refs=run_record.get("source_refs", []),
                )

    def _run_agent_pipeline(
        self, course: dict[str, Any], profile: dict[str, Any],
        conversation: str, session_id: str | None = None,
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        """Execute the full agent DAG and record all runs."""
        focus_modules = profile["focus_modules"]
        module_titles = [m["title"] for m in focus_modules]
        course_id = course.get("course_id", "")
        agent_runs: list[dict[str, Any]] = []

        # Agent 1: Profiler
        with self._agent_run(session_id, "profiler", f"分析画像: {profile['overview'][:150]}") as run:
            risks = profile.get("risks", [])
            strengths = profile.get("strengths", [])
            run["output_summary"] = f"识别 {len(risks)} 条风险和 {len(strengths)} 条优势"
            agent_runs.append(dict(run))

        # Agent 2: Planner
        with self._agent_run(session_id, "planner", f"规划路径: {', '.join(module_titles[:3])}") as run:
            learning_path = self._build_learning_path(profile, focus_modules)
            run["output_summary"] = f"{len(learning_path)} 阶段路径"
            agent_runs.append(dict(run))

        # Agent 3: Explainer
        with self._agent_run(session_id, "explainer", f"讲解: {focus_modules[0]['title']}") as run:
            resource = self._build_course_brief(
                course, profile, focus_modules,
                self._kb_module_contents(course_id, focus_modules, "lecture.md"),
                self._kb_sources(course_id),
            )
            run["output_summary"] = resource.get("summary", "")[:200]
            run["source_refs"] = resource.get("source_refs", [])
            agent_runs.append(dict(run))

        # Agent 4: Practice
        with self._agent_run(session_id, "practice", f"练习: {', '.join(module_titles[:2])}") as run:
            practice = self._build_practice_pack(
                course, profile, focus_modules,
                self._kb_module_exercises(course_id, focus_modules),
                self._kb_sources(course_id),
            )
            run["output_summary"] = practice.get("summary", "")[:200]
            run["source_refs"] = practice.get("source_refs", [])
            agent_runs.append(dict(run))

        # Agent 5: Curator
        with self._agent_run(session_id, "curator", f"策展: {', '.join(module_titles[:3])}") as run:
            mind_map = self._build_mind_map(
                course, profile, focus_modules,
                self._kb_module_concepts(course_id, focus_modules),
                self._kb_sources(course_id),
            )
            reading_guide = self._build_reading_guide(
                course, profile, focus_modules, self._kb_sources(course_id),
            )
            case_lab = self._build_case_lab(
                course, profile, focus_modules[0], focus_modules[-1],
                self._kb_module_contents(course_id, focus_modules, "lab.md"),
                self._kb_sources(course_id),
            )
            run["output_summary"] = "脑图+阅读指南+实验任务"
            agent_runs.append(dict(run))

        # Agent 6: Coach
        with self._agent_run(session_id, "coach", "评估: 复盘清单") as run:
            review = self._build_review_sheet(
                course, profile, focus_modules,
                self._kb_module_concepts(course_id, focus_modules),
                self._kb_sources(course_id),
            )
            run["output_summary"] = review.get("summary", "")[:200]
            agent_runs.append(dict(run))

        # Agent 7: Curator extra — slide outline
        with self._agent_run(session_id, "curator-slide", f"PPT大纲: {', '.join(module_titles[:3])}") as run:
            slide = self._build_slide_outline(course, profile, focus_modules, self._kb_sources(course_id))
            run["output_summary"] = slide.get("summary", "")[:200]
            run["source_refs"] = slide.get("source_refs", [])
            agent_runs.append(dict(run))

        # Build recommendations
        all_resources = [resource, mind_map, practice, reading_guide, case_lab, slide, review]
        recommendations = self._build_recommendations(profile, all_resources)
        learning_path = self._build_enhanced_learning_path(profile, focus_modules, all_resources)

        # Assemble package with safety reviews
        for r in all_resources:
            if "safety_review" not in r:
                r["safety_review"] = self._build_safety_review(r)
            r["display"] = self._get_display_meta(r.get("type", ""))
            self._validate_markdown_quality(r)

        package = {
            "package_overview": (
                f"本次资源包围绕《{course['title']}》的 {len(focus_modules)} 个核心模块展开，"
                f"优先覆盖 {module_titles[0]} 到 {module_titles[-1]} 的主线内容。"
            ),
            "coach_message": (
                f"先按「{profile['dimensions'][0]['value']} + {profile['dimensions'][3]['value']}」的组合推进。"
                "如果连续两次出现任务积压，就先缩小当天目标。"
            ),
            "resource_count": len(all_resources),
            "resources": all_resources,
            "learning_path": learning_path,
            "agent_runs": agent_runs,
            "evaluation": self._build_evaluation_panel(course, focus_modules),
            "recommendations": recommendations,
            "source_digest": {
                "conversation_excerpt": conversation[:180],
                "focus_module_titles": module_titles,
            },
        }
        return package, agent_runs

    def _build_safety_review(self, resource: dict[str, Any]) -> dict[str, Any]:
        """Validate grounding of a resource card against knowledge base."""
        source_refs = resource.get("source_refs", [])
        has_module_ref = any(ref.startswith("module:") for ref in source_refs)
        has_self_authored = any(ref.startswith("origin:self_authored") for ref in source_refs)
        warnings: list[str] = []
        if not has_module_ref and not has_self_authored:
            warnings.append("资源未标注任何知识库模块引用或自编声明")
        return {
            "grounding_passed": has_module_ref or has_self_authored,
            "warnings": warnings,
            "source_refs": source_refs,
        }

    # ── Display metadata ────────────────────────────────

    _DISPLAY_META: dict[str, dict[str, str]] = {
        "course_brief":  {"icon": "book-open",     "accent": "sky",     "layout": "article",       "density": "comfortable"},
        "mind_map":      {"icon": "map",           "accent": "violet",  "layout": "structure",      "density": "compact"},
        "practice_pack": {"icon": "list-checks",   "accent": "emerald", "layout": "question-card",  "density": "comfortable"},
        "reading_guide": {"icon": "file-text",     "accent": "amber",   "layout": "resource-list",  "density": "comfortable"},
        "case_lab":      {"icon": "code-2",        "accent": "rose",    "layout": "lab-manual",     "density": "comfortable"},
        "review_sheet":  {"icon": "clipboard-list","accent": "teal",    "layout": "checklist",      "density": "compact"},
        "slide_outline": {"icon": "presentation",  "accent": "indigo",  "layout": "slide-deck",     "density": "compact"},
    }

    @classmethod
    def _get_display_meta(cls, resource_type: str) -> dict[str, str]:
        return cls._DISPLAY_META.get(resource_type, {"icon": "book-open", "accent": "slate", "layout": "article", "density": "comfortable"})

    # ── Markdown quality validation ─────────────────────

    @staticmethod
    def _validate_markdown_quality(resource: dict[str, Any]) -> None:
        """Run lightweight checks on generated Markdown. Appends warnings to safety_review."""
        md = resource.get("content_markdown", "")
        sr = resource.get("safety_review", {})
        warnings: list[str] = list(sr.get("warnings", []))
        rtype = resource.get("type", "")

        # Must have at least one H1
        if "# " not in md:
            warnings.append("Markdown 缺少一级标题")

        # Must have at least two H2
        if md.count("\n## ") < 2:
            warnings.append("Markdown 二级标题不足（至少需 2 个）")

        # No raw HTML
        if "<div" in md or "<span" in md or "<table" in md or "<style" in md:
            warnings.append("Markdown 包含 HTML 标签，已标记待清理")

        # Code block required for lab/experiment types
        if rtype in ("case_lab",) and "```" not in md:
            warnings.append("实验类资源应包含代码块")

        # Exercise types should have answer hints
        if rtype == "practice_pack" and "答案" not in md and "answer" not in md.lower():
            warnings.append("练习类资源缺少答案要点")

        if warnings:
            sr["warnings"] = warnings
            resource["safety_review"] = sr

    def _build_profile_core(
        self,
        course: dict[str, Any],
        conversation: str,
        preferred_goal: str,
        weekly_days: int | None,
        daily_minutes: int | None,
    ) -> dict[str, Any]:
        source = f"{preferred_goal} {conversation}".lower()
        schedule_days = weekly_days if weekly_days is not None else self._infer_weekly_days(source)
        schedule_minutes = daily_minutes if daily_minutes is not None else self._infer_daily_minutes(source)

        baseline_value, baseline_evidence = self._infer_baseline(source)
        goal_value, goal_evidence = self._infer_goal(source, preferred_goal, course["title"])
        style_value, style_evidence = self._infer_style(source)
        practice_value, practice_evidence = self._infer_practice(source)
        pace_value, pace_evidence = self._infer_pace(source, schedule_days, schedule_minutes)
        risk_value, risk_evidence = self._infer_risk(source)
        support_value, support_evidence = self._infer_support(risk_value, style_value)

        dimensions = [
            self._dimension("baseline", "基础水平", baseline_value, baseline_evidence, 0.78),
            self._dimension("goal", "目标导向", goal_value, goal_evidence, 0.81),
            self._dimension("schedule", "时间带宽", f"每周 {schedule_days} 天，每天约 {schedule_minutes} 分钟", "结合用户描述与默认节奏估计。", 0.7),
            self._dimension("style", "学习偏好", style_value, style_evidence, 0.75),
            self._dimension("practice", "练习方式", practice_value, practice_evidence, 0.74),
            self._dimension("pace", "节奏容忍度", pace_value, pace_evidence, 0.72),
            self._dimension("risk", "风险因子", risk_value, risk_evidence, 0.76),
            self._dimension("support", "支持策略", support_value, support_evidence, 0.79),
        ]
        focus_modules = self._pick_focus_modules(course, source, baseline_value)
        return {
            "overview": (
                f"当前画像显示：学习者以“{goal_value}”为主目标，基础水平为“{baseline_value}”，"
                f"适合采用“{style_value}”的学习方式，并优先围绕 {len(focus_modules)} 个核心模块建立主线。"
            ),
            "dimensions": dimensions,
            "strengths": self._build_strengths(goal_value, style_value, practice_value, schedule_days),
            "risks": self._build_risks(risk_value, schedule_days, schedule_minutes, baseline_value),
            "follow_up_questions": self._build_follow_up_questions(goal_value, style_value, focus_modules),
            "focus_modules": focus_modules,
            "weekly_days": schedule_days,
            "daily_minutes": schedule_minutes,
        }

    @staticmethod
    def _dimension(key: str, label: str, value: str, evidence: str, confidence: float) -> dict[str, Any]:
        return {
            "key": key,
            "label": label,
            "value": value,
            "evidence": evidence,
            "confidence": round(confidence, 2),
        }

    def _infer_weekly_days(self, source: str) -> int:
        if _contains_any(source, ["每天", "每日", "天天"]):
            return 6
        if _contains_any(source, ["周末", "双休"]):
            return 2
        if _contains_any(source, ["碎片", "零散", "抽空"]):
            return 3
        return 4

    def _infer_daily_minutes(self, source: str) -> int:
        minute_match = re.search(r"(\d{2,3})\s*分钟", source)
        if minute_match:
            return max(20, min(240, int(minute_match.group(1))))
        hour_match = re.search(r"(\d)\s*小时", source)
        if hour_match:
            return max(30, min(240, int(hour_match.group(1)) * 60))
        if _contains_any(source, ["冲刺", "高强度", "尽快"]):
            return 90
        if _contains_any(source, ["碎片", "通勤", "很晚"]):
            return 35
        return 50

    def _infer_baseline(self, source: str) -> tuple[str, str]:
        if _contains_any(source, ["零基础", "没学过", "完全不会", "刚开始"]):
            return "入门起步", "对话中明确提到基础较弱或刚开始接触。"
        if _contains_any(source, ["基础一般", "学过一点", "有些印象", "跟不上"]):
            return "基础待巩固", "用户表达为学过但不稳定，需要系统回补。"
        if _contains_any(source, ["做过项目", "刷过题", "能写出来", "学过一遍"]):
            return "具备基础", "已有一定实践或复习经历。"
        return "基础待确认", "当前描述未完整覆盖既往学习背景，先按中低基础处理。"

    def _infer_goal(self, source: str, preferred_goal: str, course_title: str) -> tuple[str, str]:
        combined = f"{preferred_goal} {source}"
        if _contains_any(combined, ["期末", "考试", "补考", "考核", "拿分"]):
            return "面向考试提分", "出现考试、补考或拿分等明确结果词。"
        if _contains_any(combined, ["面试", "找工作", "求职"]):
            return "面向面试应用", "对话中出现面试或求职诉求。"
        if _contains_any(combined, ["项目", "实战", "作品", "软件杯"]):
            return "面向项目落地", "更关注把课程知识变成可交付产出。"
        if _contains_any(combined, ["考研", "系统复习", "强化"]):
            return "面向长期强化", "更偏向阶段性系统复习。"
        return f"围绕《{course_title}》建立稳定主线", "当前目标描述较泛，先按课程主线学习处理。"

    def _infer_style(self, source: str) -> tuple[str, str]:
        if _contains_any(source, ["图", "脑图", "可视化", "动画"]):
            return "图解和可视化优先", "用户更容易通过图示理解知识结构。"
        if _contains_any(source, ["例题", "案例", "代码", "演示"]):
            return "案例驱动优先", "更适合通过例题和案例建立理解。"
        if _contains_any(source, ["讲义", "总结", "框架", "提纲"]):
            return "结构化讲义优先", "倾向先看清知识框架再深入细节。"
        return "讲解 + 例题混合", "未观察到强烈单一偏好，采用双通道呈现。"

    def _infer_practice(self, source: str) -> tuple[str, str]:
        if _contains_any(source, ["刷题", "题目", "练习", "自测"]):
            return "小步快练", "用户对题目反馈更敏感，适合多轮短练习。"
        if _contains_any(source, ["项目", "实验", "写代码", "动手"]):
            return "案例实操", "需要把练习尽量映射到真实任务。"
        return "讲练结合", "同时保留理解题和巩固题，避免只看不练。"

    def _infer_pace(self, source: str, weekly_days: int, daily_minutes: int) -> tuple[str, str]:
        if _contains_any(source, ["冲刺", "尽快", "马上", "时间很紧"]):
            return "短期冲刺", "用户表达了明显的时限压力。"
        if weekly_days >= 5 and daily_minutes >= 70:
            return "稳定推进", "可投入时间较连续，适合按阶段稳步推进。"
        if weekly_days <= 3 or daily_minutes <= 35:
            return "碎片化推进", "可用时间有限，需要压缩单次学习负荷。"
        return "中速推进", "当前时间带宽适合以周为单位迭代。"

    def _infer_risk(self, source: str) -> tuple[str, str]:
        if _contains_any(source, ["跟不上", "看不懂", "基础差", "总是忘"]):
            return "概念断层风险", "容易在核心概念处出现断层。"
        if _contains_any(source, ["没时间", "很忙", "碎片", "拖延"]):
            return "执行连续性风险", "学习节奏可能被外部事务打断。"
        if _contains_any(source, ["紧张", "焦虑", "怕挂科", "担心"]):
            return "情绪压力风险", "需要把计划颗粒度做小，降低挫败感。"
        return "风险整体可控", "当前描述中没有出现特别明显的高危信号。"

    def _infer_support(self, risk_value: str, style_value: str) -> tuple[str, str]:
        if "执行连续性风险" in risk_value:
            return "用短时任务和周回顾维持节奏", "需要借助更短任务闭环保证执行连续。"
        if "概念断层风险" in risk_value:
            return "先补先修知识，再进入综合题", "应优先修补前置概念，减少盲目刷题。"
        if "图解" in style_value:
            return "先框架后细节，配合脑图复盘", "更适合先搭知识骨架。"
        return "按阶段讲练结合，并保留复盘节点", "兼顾理解、训练和复盘的稳定策略。"

    def _build_strengths(self, goal_value: str, style_value: str, practice_value: str, schedule_days: int) -> list[str]:
        strengths = [
            f"目标较清晰：当前主目标是“{goal_value}”。",
            f"学习偏好明确：适合“{style_value}”的内容呈现。",
            f"练习习惯可设计：建议采用“{practice_value}”的训练节奏。",
        ]
        if schedule_days >= 4:
            strengths.append("每周至少能安排 4 天左右学习时间，具备形成稳定节奏的条件。")
        return strengths[:4]

    def _build_risks(self, risk_value: str, weekly_days: int, daily_minutes: int, baseline_value: str) -> list[str]:
        risks = [f"主要风险：{risk_value}。"]
        if weekly_days <= 3:
            risks.append("周学习天数偏少，建议把每次任务限制在一个明确知识点内。")
        if daily_minutes <= 35:
            risks.append("单次学习时长较短，内容不宜铺得过大。")
        if baseline_value in {"入门起步", "基础待巩固"}:
            risks.append("前置概念可能不稳定，综合题需要延后到讲解和例题之后。")
        return risks[:4]

    def _pick_focus_modules(self, course: dict[str, Any], source: str, baseline_value: str) -> list[dict[str, Any]]:
        scored: list[tuple[int, dict[str, Any]]] = []
        for index, module in enumerate(course["modules"]):
            score = max(0, 6 - index) if baseline_value in {"入门起步", "基础待巩固"} else index
            haystack = f"{module['title']} {' '.join(module['core_points'])}".lower()
            for token in re.split(r"[\s,，。；;、]+", source):
                if len(token) >= 2 and token in haystack:
                    score += 2
            scored.append((score, module))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [
            {
                "module_id": module["module_id"],
                "title": module["title"],
                "core_points": list(module["core_points"]),
                "outcome": module["outcome"],
            }
            for _, module in scored[:4]
        ]

    def _build_follow_up_questions(self, goal_value: str, style_value: str, focus_modules: list[dict[str, Any]]) -> list[str]:
        first_two = "、".join(module["title"] for module in focus_modules[:2]) or "核心模块"
        return [
            f"在“{goal_value}”之外，你更希望优先补基础还是优先做题？",
            f"如果按“{style_value}”展开内容，你更希望每次先看讲解还是先看例题？",
            f"当前最想先解决的模块是：{first_two}，还是课程中的其他部分？",
            "你最担心的是时间不够、概念看不懂，还是练习做不出来？",
        ]

    def _build_local_package(self, course: dict[str, Any], profile: dict[str, Any], conversation: str) -> dict[str, Any]:
        focus_modules = profile["focus_modules"]
        module_titles = [module["title"] for module in focus_modules]
        resources = self._build_resources(course, profile, focus_modules)
        # Decorate with display metadata + safety review + markdown quality
        for r in resources:
            if "safety_review" not in r:
                r["safety_review"] = self._build_safety_review(r)
            r["display"] = self._get_display_meta(r.get("type", ""))
            self._validate_markdown_quality(r)
        # Phase 3: add slide_outline
        resources.append(self._build_slide_outline(course, profile, focus_modules, self._kb_sources(course.get("course_id", ""))))
        # Decorate last resource too
        last_r = resources[-1]
        if "safety_review" not in last_r:
            last_r["safety_review"] = self._build_safety_review(last_r)
        last_r["display"] = self._get_display_meta(last_r.get("type", ""))
        self._validate_markdown_quality(last_r)

        learning_path = self._build_enhanced_learning_path(profile, focus_modules, resources)
        recommendations = self._build_recommendations(profile, resources)
        return {
            "package_overview": (
                f"本次资源包围绕《{course['title']}》的 {len(focus_modules)} 个核心模块展开，"
                f"优先覆盖 {module_titles[0]} 到 {module_titles[-1]} 的主线内容，"
                f"目标是在每周 {profile['weekly_days']} 天、每天 {profile['daily_minutes']} 分钟的节奏下形成闭环。"
            ),
            "coach_message": (
                f"先按“{profile['dimensions'][0]['value']} + {profile['dimensions'][3]['value']}”的组合推进。"
                "如果连续两次出现任务积压，就先缩小当天目标，不要直接扩大资源量。"
            ),
            "resource_count": len(resources),
            "resources": resources,
            "learning_path": learning_path,
            "agent_runs": self._build_agent_runs(profile, learning_path),
            "evaluation": self._build_evaluation_panel(course, focus_modules),
            "recommendations": recommendations,
            "source_digest": {
                "conversation_excerpt": conversation[:180],
                "focus_module_titles": module_titles,
            },
        }

    def _build_resources(self, course: dict[str, Any], profile: dict[str, Any], focus_modules: list[dict[str, Any]]) -> list[dict[str, Any]]:
        course_id = course.get("course_id", "")
        first_module = focus_modules[0]
        second_module = focus_modules[1] if len(focus_modules) > 1 else focus_modules[0]
        last_module = focus_modules[-1]

        # Try to pull KB content for the focus modules
        kb_lectures = self._kb_module_contents(course_id, focus_modules, "lecture.md")
        kb_exercises = self._kb_module_exercises(course_id, focus_modules)
        kb_concepts = self._kb_module_concepts(course_id, focus_modules)
        kb_labs = self._kb_module_contents(course_id, focus_modules, "lab.md")
        sources = self._kb_sources(course_id)

        return [
            self._build_course_brief(course, profile, focus_modules, kb_lectures, sources),
            self._build_mind_map(course, profile, focus_modules, kb_concepts, sources),
            self._build_practice_pack(course, profile, focus_modules, kb_exercises, sources),
            self._build_reading_guide(course, profile, focus_modules, sources),
            self._build_case_lab(course, profile, first_module, last_module, kb_labs, sources),
            self._build_review_sheet(course, profile, focus_modules, kb_concepts, sources),
        ]

    # ── KB helpers ──────────────────────────────────────

    def _kb_module_contents(self, course_id: str, focus_modules: list[dict[str, Any]], filename: str) -> dict[str, str]:
        """Return {module_id: content} for a given file across focus modules."""
        result: dict[str, str] = {}
        if self.kb is None or course_id not in self.kb.course_ids():
            return result
        for module in focus_modules:
            mid = module.get("module_id", "")
            content = self.kb.read_module_file(mid, filename)
            if content:
                result[mid] = content
        return result

    def _kb_module_concepts(self, course_id: str, focus_modules: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
        """Return {module_id: [concept, ...]} for focus modules."""
        result: dict[str, list[dict[str, Any]]] = {}
        if self.kb is None or course_id not in self.kb.course_ids():
            return result
        for module in focus_modules:
            mid = module.get("module_id", "")
            concepts = self.kb.concept_list(mid)
            if concepts:
                result[mid] = concepts
        return result

    def _kb_module_exercises(self, course_id: str, focus_modules: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
        """Return {module_id: [exercise, ...]} for focus modules."""
        result: dict[str, list[dict[str, Any]]] = {}
        if self.kb is None or course_id not in self.kb.course_ids():
            return result
        for module in focus_modules:
            mid = module.get("module_id", "")
            exercises = self.kb.exercise_list(mid)
            if exercises:
                result[mid] = exercises
        return result

    def _kb_sources(self, course_id: str) -> list[dict[str, Any]]:
        if self.kb is None or course_id not in self.kb.course_ids():
            return []
        return self.kb.source_list(course_id)

    def _source_refs_for(self, module_ids: list[str], used_sources: list[str] | None = None, *, is_self_authored: bool = False) -> list[str]:
        """Build source_refs with clear semantics.

        - module:xxx  → content from KnowledgeBase module files
        - source:xxx  → external reference actually consulted (only when used)
        - origin:self_authored → template/rule-generated content, not from KB
        """
        refs: list[str] = []
        if is_self_authored:
            refs.append("origin:self_authored")
        else:
            refs.extend(f"module:{mid}" for mid in module_ids[:3])
        for sid in (used_sources or [])[:3]:
            refs.append(f"source:{sid}")
        return refs

    # ── Resource builders ───────────────────────────────

    def _build_course_brief(self, course: dict[str, Any], profile: dict[str, Any], focus_modules: list[dict[str, Any]], kb_lectures: dict[str, str], sources: list[dict[str, Any]]) -> dict[str, Any]:
        first_module = focus_modules[0]
        # Use KB lecture content if available, otherwise template
        lecture_content = kb_lectures.get(first_module.get("module_id", ""), "")
        if lecture_content:
            # Extract key sections from lecture (first ~1000 chars of core sections)
            lines = lecture_content.split("\n")
            body_start = 0
            for i, line in enumerate(lines):
                if line.startswith("## 核心讲解") or line.startswith("## 学习目标"):
                    body_start = i
                    break
            excerpt = "\n".join(lines[body_start:body_start + 40]) if body_start else lecture_content[:1200]
            content_md = (
                f"# {course['title']} — {first_module['title']}\n\n"
                f"> 来源：课程知识库 | 画像适配：{profile['dimensions'][1]['value']}\n\n"
                f"{excerpt}\n\n"
                f"---\n*本内容节选自课程知识库，已根据学习画像调整重点。*"
            )
        else:
            outline = "\n".join(f"- {m['title']}：{'、'.join(m['core_points'][:2])}" for m in focus_modules)
            content_md = (
                f"# {course['title']}主线讲解\n\n"
                f"## 当前学习定位\n- 目标：{profile['dimensions'][1]['value']}\n"
                f"- 基础：{profile['dimensions'][0]['value']}\n\n"
                f"## 先抓住的主线\n{outline}\n\n"
                f"## 第一优先模块：{first_module['title']}\n"
                + "\n".join(f"- {point}" for point in first_module.get("core_points", []))
            )
        return {
            "resource_id": "course-brief",
            "type": "course_brief",
            "title": f"{course['title']}主线讲解",
            "summary": "基于课程知识库生成，结合学习画像突出关键概念与易错点。",
            "estimated_minutes": 18,
            "agent_id": "explainer",
            "source_refs": self._source_refs_for([m.get("module_id", "") for m in focus_modules]),
            "content_markdown": content_md,
        }

    def _build_mind_map(self, course: dict[str, Any], profile: dict[str, Any], focus_modules: list[dict[str, Any]], kb_concepts: dict[str, list[dict[str, Any]]], sources: list[dict[str, Any]]) -> dict[str, Any]:
        lines = [f"# {course['title']} 知识脑图\n", f"> 画像适配：{profile['dimensions'][1]['value']}\n"]
        # Use KB concepts for tree structure
        has_kb = any(kb_concepts.values())
        for module in focus_modules:
            mid = module.get("module_id", "")
            concepts = kb_concepts.get(mid, [])
            lines.append(f"## {module['title']}")
            if concepts:
                for c in concepts:
                    lines.append(f"- **{c['name']}**：{c.get('definition', '')[:80]}")
                    for mistake in c.get("common_mistakes", [])[:1]:
                        lines.append(f"  - ⚠️ 易错：{mistake}")
            else:
                for point in module.get("core_points", [])[:3]:
                    lines.append(f"- {point}")
            lines.append("")
        return {
            "resource_id": "mind-map",
            "type": "mind_map",
            "title": "课程脑图",
            "summary": "由知识库概念数据自动构建的知识结构树，标注易错点。" if has_kb else "基于核心模块的关键词梳理。",
            "estimated_minutes": 10,
            "agent_id": "curator",
            "source_refs": self._source_refs_for([m.get("module_id", "") for m in focus_modules[:2]]),
            "content_markdown": "\n".join(lines),
        }

    def _build_practice_pack(self, course: dict[str, Any], profile: dict[str, Any], focus_modules: list[dict[str, Any]], kb_exercises: dict[str, list[dict[str, Any]]], sources: list[dict[str, Any]]) -> dict[str, Any]:
        lines = ["# 分层练习包\n"]
        has_kb = any(kb_exercises.values())

        if has_kb:
            # Pull real exercises from KB, categorized by level
            basic_qs = []
            standard_qs = []
            transfer_qs = []
            for module in focus_modules:
                mid = module.get("module_id", "")
                for ex in kb_exercises.get(mid, []):
                    entry = f"- [{module['title']}] {ex.get('prompt', '')[:120]}\n  - 答案要点：{ex.get('answer_outline', '')[:100]}"
                    level = ex.get("level", "standard")
                    if level == "basic":
                        basic_qs.append(entry)
                    elif level == "transfer":
                        transfer_qs.append(entry)
                    else:
                        standard_qs.append(entry)

            lines.append("## 热身题（基础）\n")
            lines.extend(basic_qs[:3] or ["- 请先完成课程知识库中基础概念的复习。\n"])
            lines.append("\n## 标准题\n")
            lines.extend(standard_qs[:3] or ["- 围绕重点模块完成课堂级别题目。\n"])
            lines.append("\n## 迁移题（综合）\n")
            lines.extend(transfer_qs[:2] or ["- 尝试将两个模块的知识联动解决综合问题。\n"])
            lines.append(f"\n> 题目来源：课程知识库，共收录 {sum(len(v) for v in kb_exercises.values())} 道练习。")
        else:
            first_module = focus_modules[0]
            second_module = focus_modules[1] if len(focus_modules) > 1 else focus_modules[0]
            last_module = focus_modules[-1]
            lines = [
                "# 分层练习包\n\n## 热身题\n"
                f"1. 用自己的话解释「{first_module['title']}」为什么重要。\n"
                f"2. 比较 {first_module['core_points'][0]} 与 {first_module['core_points'][1]} 的差别。\n\n"
                "## 标准题\n"
                f"1. 围绕 {second_module['title']} 写出一题课堂级别题目并给出步骤。\n"
                "2. 用 5 分钟回忆本周三个关键词，再对照讲义补漏。\n\n"
                "## 迁移题\n"
                f"1. 说明 {last_module['title']} 在项目/考试中的使用场景。\n"
                "2. 设计一道需要跨两个模块联动的综合题。"
            ]

        # Build interaction data (Phase 5)
        interaction = self._build_practice_interaction(focus_modules, kb_exercises) if has_kb else None

        return {
            "resource_id": "practice-pack",
            "type": "practice_pack",
            "title": "分层练习包",
            "summary": f"从课程知识库精选 {len(interaction['items']) if interaction else 0} 道练习，按基础/标准/迁移分层。" if has_kb else "包含热身题、标准题和迁移题。",
            "estimated_minutes": 25,
            "agent_id": "practice",
            "source_refs": self._source_refs_for([m.get("module_id", "") for m in focus_modules]),
            "content_markdown": "\n".join(lines) if isinstance(lines, list) else lines,
            **({"interaction": interaction} if interaction else {}),
        }

    def _build_reading_guide(self, course: dict[str, Any], profile: dict[str, Any], focus_modules: list[dict[str, Any]], sources: list[dict[str, Any]]) -> dict[str, Any]:
        lines = ["# 精读与笔记指南\n", "## 阅读顺序\n"]
        for module in focus_modules[:3]:
            lines.append(f"- 先读《{module['title']}》的定义、例题、结论。")
        lines.append("\n## 笔记模板\n- 定义\n- 关键步骤\n- 易错点\n- 自己的例子\n")
        lines.append("\n## 参考来源\n")
        if sources:
            for src in sources:
                lines.append(f"- [{src.get('source_id', '')}] {src.get('title', '')} — {src.get('usage', '')}")
                if src.get("url"):
                    lines.append(f"  {src['url']}")
        else:
            lines.append("- 课程教材及课堂讲义\n- 在线参考：OpenDSA、Runestone Academy")
        lines.append("\n## 复盘动作\n- 每学完一节，用 3 句话写出「它解决什么问题、怎么做、什么时候会错」。")
        # Build source_refs: module references for structure, explicit source refs for external links
        used_source_ids = [s.get("source_id", "") for s in sources[:3] if s.get("source_id")]
        return {
            "resource_id": "reading-guide",
            "type": "reading_guide",
            "title": "精读与笔记指南",
            "summary": "基于课程参考来源，指导学习者高效阅读和整理笔记。",
            "estimated_minutes": 12,
            "agent_id": "curator",
            "source_refs": self._source_refs_for(
                [m.get("module_id", "") for m in focus_modules[:2]],
                used_sources=used_source_ids,
            ),
            "content_markdown": "\n".join(lines),
        }

    def _build_case_lab(self, course: dict[str, Any], profile: dict[str, Any], first_module: dict[str, Any], last_module: dict[str, Any], kb_labs: dict[str, str], sources: list[dict[str, Any]]) -> dict[str, Any]:
        lab_content = kb_labs.get(first_module.get("module_id", ""), "")
        has_kb = bool(lab_content)
        if lab_content:
            excerpt = lab_content[:1000]
            content_md = (
                f"# 实验任务：{first_module['title']}\n\n"
                f"> 来源：课程知识库实验文件\n\n{excerpt}"
            )
        else:
            content_md = (
                f"# 案例 / 实验任务\n\n"
                f"## 任务主题\n将「{first_module['title']}」与「{last_module['title']}」串成一个小案例。\n\n"
                "## 任务步骤\n1. 先写出目标和输入输出。\n2. 画出结构或流程。\n3. 完成实现/推导。\n4. 最后反思哪里最容易卡住。\n\n"
                "## 提交物\n- 一页过程笔记\n- 一份答案/代码/推导结果\n- 一段 100 字复盘"
            )
        return {
            "resource_id": "case-lab",
            "type": "case_lab",
            "title": "案例 / 实验任务",
            "summary": "从课程知识库提取实验任务，将知识迁移到实际操作。" if has_kb else "把课程知识迁移到小案例中。",
            "estimated_minutes": 35,
            "agent_id": "explainer",
            "source_refs": self._source_refs_for([first_module.get("module_id", "")]),
            "content_markdown": content_md,
            "interaction": self._build_lab_interaction(first_module, kb_labs),
        }

    def _build_review_sheet(self, course: dict[str, Any], profile: dict[str, Any], focus_modules: list[dict[str, Any]], kb_concepts: dict[str, list[dict[str, Any]]], sources: list[dict[str, Any]]) -> dict[str, Any]:
        lines = ["# 复盘清单\n", "## 我已经会了什么\n"]
        for module in focus_modules[:3]:
            lines.append(f"- {module['title']}：是否能独立说出关键步骤？")
        lines.append("\n## 常见易错点（来自知识库）\n")
        has_mistakes = False
        for module in focus_modules[:3]:
            mid = module.get("module_id", "")
            concepts = kb_concepts.get(mid, [])
            for c in concepts:
                for mistake in c.get("common_mistakes", []):
                    lines.append(f"- [{c['name']}] {mistake}")
                    has_mistakes = True
        if not has_mistakes:
            lines.append("- 哪个定义总是记混？\n- 哪个题型一上手就卡住？")
        lines.append("\n## 下一次学习前要做什么\n- 重看一段讲解\n- 补做一道标准题\n- 把错因写成一句提醒")
        # Build interaction data (Phase 5)
        interaction = self._build_review_interaction(focus_modules, kb_concepts) if has_mistakes else None

        return {
            "resource_id": "review-sheet",
            "type": "review_sheet",
            "title": "考前 / 复盘清单",
            "summary": "结合知识库中记录的常见错误，帮助定位薄弱环节。" if has_mistakes else "用于最后回顾重点和错因。",
            "estimated_minutes": 8,
            "agent_id": "coach",
            "source_refs": self._source_refs_for([m.get("module_id", "") for m in focus_modules[:2]]),
            "content_markdown": "\n".join(lines),
            **({"interaction": interaction} if interaction else {}),
        }

    # ── Phase 3: Slide outline ─────────────────────────

    def _build_slide_outline(self, course: dict[str, Any], profile: dict[str, Any], focus_modules: list[dict[str, Any]], sources: list[dict[str, Any]]) -> dict[str, Any]:
        lines = [f"# {course['title']} 教学 PPT 大纲\n"]
        lines.append(f"> 画像适配：{profile['dimensions'][1]['value']}\n")
        slide_num = 1
        lines.append(f"## Slide {slide_num}\n### 页面要点\n- 课程标题：{course['title']}\n- 学习者画像综述\n### 讲解备注\n- 开场介绍课程主线与学习目标\n")
        slide_num += 1
        for module in focus_modules[:4]:
            title = module.get("title", "")
            points = module.get("core_points", [])
            lines.append(f"## Slide {slide_num}\n### 页面要点\n- 模块：{title}\n" + "\n".join(f"- {p}" for p in points[:3]) + "\n### 讲解备注\n- 结合学习者画像强调重点概念和常见误区\n")
            slide_num += 1
        lines.append(f"## Slide {slide_num}\n### 页面要点\n- 分层练习概览\n- 基础 → 标准 → 迁移\n### 讲解备注\n- 建议先展示题目，再逐步展开解析\n")
        slide_num += 1
        lines.append(f"## Slide {slide_num}\n### 页面要点\n- 课程总结与下一步\n- 推荐学习资源\n### 讲解备注\n- 回顾关键概念，引导进入自评环节\n")
        return {
            "resource_id": "slide-outline",
            "type": "slide_outline",
            "title": "PPT 教学大纲",
            "summary": f"基于 {len(focus_modules)} 个核心模块生成 {slide_num} 页 PPT 大纲，含页面要点和讲解备注。",
            "estimated_minutes": 12,
            "agent_id": "curator",
            "source_refs": self._source_refs_for([m.get("module_id", "") for m in focus_modules[:2]]),
            "content_markdown": "\n".join(lines),
        }

    # ── Phase 5: Interaction helpers ────────────────────

    @staticmethod
    def _build_practice_interaction(focus_modules: list[dict[str, Any]], kb_exercises: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
        """Build interactive exercise items from KB exercises (max 12)."""
        items: list[dict[str, Any]] = []
        for module in focus_modules:
            mid = module.get("module_id", "")
            for ex in kb_exercises.get(mid, []):
                items.append({
                    "exercise_id": ex.get("exercise_id", ""),
                    "module_id": mid,
                    "module_title": module.get("title", ""),
                    "level": ex.get("level", "standard"),
                    "type": ex.get("type", "short_answer"),
                    "prompt": ex.get("prompt", ""),
                    "target_concepts": ex.get("target_concepts", []),
                    "hint": f"回顾「{module.get('title', '')}」中的相关概念，注意区分容易混淆的知识点。",
                    "answer_outline": ex.get("answer_outline", ""),
                    "feedback": {
                        "correct": "回答正确！建议回顾相关概念的深层原理。",
                        "stuck": f"不会的话，先复习「{module.get('title', '')}」中的核心定义和例子。",
                        "common_mistake": "最常见的错误是混淆概念边界或遗漏边界条件。",
                    },
                    "source_refs": ex.get("source_refs", []),
                })
                if len(items) >= 12:
                    break
            if len(items) >= 12:
                break
        return {"kind": "practice_pack", "items": items}

    @staticmethod
    def _build_lab_interaction(first_module: dict[str, Any], kb_labs: dict[str, str]) -> dict[str, Any]:
        """Build interactive lab steps from lab.md content."""
        steps: list[dict[str, Any]] = [
            {"step_id": "step-1", "description": "阅读任务目标和输入输出", "is_done": False},
            {"step_id": "step-2", "description": "实现核心逻辑（数据结构类、算法函数）", "is_done": False},
            {"step_id": "step-3", "description": "编写性能测试脚本", "is_done": False},
            {"step_id": "step-4", "description": "运行测试并整理结果", "is_done": False},
        ]
        deliverables: list[dict[str, Any]] = [
            {"item_id": "del-1", "description": "项目源码（含 README.md）", "is_done": False},
            {"item_id": "del-2", "description": "设计文档（design.md）", "is_done": False},
            {"item_id": "del-3", "description": "运行截图或实验结果", "is_done": False},
        ]
        reflections: list[dict[str, Any]] = [
            {"question": "项目中最大的选型挑战是什么？", "answer": ""},
            {"question": "如果项目规模扩大 10 倍，哪些选择需要重新考虑？", "answer": ""},
            {"question": "你对数据结构的理解从'死记硬背'转变为'场景匹配'了吗？", "answer": ""},
        ]
        return {"kind": "case_lab", "items": [{"steps": steps, "deliverables": deliverables, "reflections": reflections}]}

    @staticmethod
    def _build_review_interaction(focus_modules: list[dict[str, Any]], kb_concepts: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
        """Build interactive review checklist from KB concept mistakes."""
        items: list[dict[str, Any]] = []
        for module in focus_modules:
            mid = module.get("module_id", "")
            for ci, c in enumerate(kb_concepts.get(mid, [])):
                for mi, mistake in enumerate(c.get("common_mistakes", [])):
                    items.append({
                        "item_id": f"review-{mid}-{ci}-{mi}",
                        "description": f"[{c.get('name', '')}] {mistake}",
                        "module": module.get("title", ""),
                        "mastered": False,
                        "score": None,
                    })
        return {"kind": "review_sheet", "items": items}

    # ── Phase 3: Recommendations ───────────────────────

    def _build_recommendations(self, profile: dict[str, Any], all_resources: list[dict[str, Any]]) -> dict[str, Any]:
        dims = profile.get("dimensions", [])
        baseline = next((d["value"] for d in dims if d["key"] == "baseline"), "")
        daily_minutes = int(profile.get("daily_minutes", 50))
        risk = next((d["value"] for d in dims if d["key"] == "risk"), "")

        scored = []
        for i, r in enumerate(all_resources):
            score = 0
            rtype = r.get("type", "")
            if "基础" in baseline or "入门" in baseline or "待巩固" in baseline:
                if rtype in ("course_brief", "mind_map", "practice_pack"):
                    score += 3
            if daily_minutes <= 35:
                if int(r.get("estimated_minutes", 30)) <= 20:
                    score += 2
            if "考试" in profile.get("overview", ""):
                if rtype in ("practice_pack", "review_sheet"):
                    score += 2
            score += max(0, 5 - i)
            scored.append((score, r.get("resource_id", ""), rtype))
        scored.sort(key=lambda x: x[0], reverse=True)
        today_ids = [rid for _, rid, _ in scored[:5]]

        if "基础" in baseline or "入门" in baseline:
            next_action = "建议先从「主线讲解」和「知识脑图」入手，建立知识框架后再做题。"
        elif daily_minutes <= 35:
            next_action = "时间较碎片化，建议每次只完成一个资源，优先「分层练习」的基础题部分。"
        else:
            next_action = "建议按「讲解 → 脑图 → 练习 → 实验」顺序推进，每完成一个模块做一次复盘。"

        adjustments = []
        if "断层" in risk or "基础" in baseline:
            adjustments.append("前置概念可能不稳，遇到卡顿先回顾「知识脑图」中的定义。")
        if "连续性" in risk or "时间" in risk:
            adjustments.append("建议把每日目标拆成 15 分钟小块，完成即停。")
        if not adjustments:
            adjustments.append("当前风险可控，按推荐顺序稳步推进。")

        return {
            "today_resources": today_ids,
            "next_action": next_action,
            "risk_adjustments": adjustments,
        }

    # ── Phase 3: Enhanced learning path ────────────────

    def _build_enhanced_learning_path(self, profile: dict[str, Any], focus_modules: list[dict[str, Any]], all_resources: list[dict[str, Any]]) -> list[dict[str, Any]]:
        base_path = self._build_learning_path(profile, focus_modules)
        resource_map = {r["resource_id"]: r for r in all_resources}
        base_path[0]["recommended_resource_ids"] = [
            rid for rid in ["course-brief", "mind-map", "practice-pack"] if rid in resource_map
        ]
        base_path[0]["estimated_days"] = 7
        base_path[0]["priority_reason"] = "优先建立概念框架，适合入门阶段"
        base_path[1]["recommended_resource_ids"] = [
            rid for rid in ["practice-pack", "reading-guide", "slide-outline"] if rid in resource_map
        ]
        base_path[1]["estimated_days"] = 10
        base_path[1]["priority_reason"] = "讲练结合，巩固核心技能"
        base_path[2]["recommended_resource_ids"] = [
            rid for rid in ["case-lab", "review-sheet", "slide-outline"] if rid in resource_map
        ]
        base_path[2]["estimated_days"] = 7
        base_path[2]["priority_reason"] = "综合输出，迁移应用能力"
        return base_path

    def _build_learning_path(self, profile: dict[str, Any], focus_modules: list[dict[str, Any]]) -> list[dict[str, Any]]:
        weekly_days = int(profile["weekly_days"])
        daily_minutes = int(profile["daily_minutes"])
        return [
            {
                "stage_id": "stage-1",
                "title": "阶段一：建立主线",
                "objective": "先打通核心定义、基本流程和课程骨架。",
                "focus_modules": [focus_modules[0]["title"], focus_modules[1]["title"] if len(focus_modules) > 1 else focus_modules[0]["title"]],
                "deliverables": ["一页知识框架图", "2 道热身题", "一份术语清单"],
                "study_plan": f"建议连续 1 周，每周 {weekly_days} 天，每天 {daily_minutes} 分钟。",
                "coach_tip": "先保证学完能复述，不急着一开始就做综合题。",
            },
            {
                "stage_id": "stage-2",
                "title": "阶段二：讲练闭环",
                "objective": "把重点模块转化为标准题、错题和迁移题。",
                "focus_modules": [module["title"] for module in focus_modules[1:3] or focus_modules[:2]],
                "deliverables": ["1 份标准题答案", "1 份错因归纳", "1 个案例草稿"],
                "study_plan": f"建议再用 1 到 2 周，以每次 {daily_minutes} 分钟完成讲练一体。",
                "coach_tip": "每次练习后都要记录一个“为什么错”，这样复盘才会累积。",
            },
            {
                "stage_id": "stage-3",
                "title": "阶段三：综合输出",
                "objective": "把分散知识合并成考试/项目可迁移的完成能力。",
                "focus_modules": [last_module["title"] for last_module in [focus_modules[-1], focus_modules[0]]],
                "deliverables": ["一份综合题/案例答案", "一页复盘清单", "个人提分策略"],
                "study_plan": "最后留出一个完整复盘窗口，串联重点、错题和常见陷阱。",
                "coach_tip": "如果时间紧，就优先保留综合输出和错因复盘，不再盲目加新内容。",
            },
        ]

    def _build_agent_runs(self, profile: dict[str, Any], learning_path: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {"agent_id": "profiler", "name": "学习画像智能体", "status": "completed", "summary": f"已生成 {len(profile['dimensions'])} 维学习画像，并识别 {len(profile['risks'])} 条风险。"},
            {"agent_id": "planner", "name": "路径规划智能体", "status": "completed", "summary": f"已输出 {len(learning_path)} 阶段学习路径。"},
            {"agent_id": "explainer", "name": "课程讲解智能体", "status": "completed", "summary": "已生成主线讲解和案例任务。"},
            {"agent_id": "practice", "name": "练习设计智能体", "status": "completed", "summary": "已生成热身、标准和迁移三层练习。"},
            {"agent_id": "curator", "name": "资源策展智能体", "status": "completed", "summary": "已组合脑图和精读指南，保证复习路径完整。"},
            {"agent_id": "coach", "name": "督学教练智能体", "status": "completed", "summary": "已生成节奏提醒与复盘清单。"},
        ]

    def _build_evaluation_panel(self, course: dict[str, Any], focus_modules: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "mastery_signals": [
                f"能在不看资料的情况下复述 {focus_modules[0]['title']} 的关键步骤。",
                f"能独立完成一题与 {focus_modules[1]['title'] if len(focus_modules) > 1 else focus_modules[0]['title']} 相关的标准题。",
                f"能把《{course['title']}》中两个模块连起来解释一个综合场景。",
            ],
            "self_check_questions": [
                f"如果让你教别人 {focus_modules[0]['title']}，你会先讲哪三个点？",
                "你当前最容易错的是概念、步骤还是审题？",
                "今天这次学习结束后，哪一条内容明天还能完整写出来？",
            ],
            "rubric": [
                {"level": "起步", "description": "能识别概念，但解释和迁移还不稳定。"},
                {"level": "稳固", "description": "能完成标准题，并说清核心步骤。"},
                {"level": "迁移", "description": "能把多个模块合起来解决综合问题。"},
            ],
        }

    def _generate_model_enhancement(
        self,
        course: dict[str, Any],
        profile: dict[str, Any],
        package: dict[str, Any],
        runtime_provider: dict[str, Any],
    ) -> dict[str, Any]:
        prompt = self._build_model_prompt(course, profile, package)
        raw = self._call_model(prompt, runtime_provider)
        parsed = _extract_json_object(raw)
        resources: list[dict[str, Any]] = []
        if isinstance(parsed.get("resources"), list):
            for item in parsed["resources"]:
                if not isinstance(item, dict):
                    continue
                resource_id = str(item.get("resource_id") or "").strip()
                if not resource_id:
                    continue
                resources.append(
                    {
                        "resource_id": resource_id,
                        "summary": self._clean_text(item.get("summary"), 160),
                        "content_markdown": self._clean_multiline_text(item.get("content_markdown"), 1800),
                    }
                )
        path_tips: list[dict[str, str]] = []
        if isinstance(parsed.get("path_tips"), list):
            for item in parsed["path_tips"]:
                if not isinstance(item, dict):
                    continue
                stage_id = str(item.get("stage_id") or "").strip()
                coach_tip = self._clean_text(item.get("coach_tip"), 140)
                if stage_id and coach_tip:
                    path_tips.append({"stage_id": stage_id, "coach_tip": coach_tip})
        return {
            "package_overview": self._clean_text(parsed.get("package_overview"), 240),
            "coach_message": self._clean_text(parsed.get("coach_message"), 220),
            "resources": resources,
            "path_tips": path_tips,
        }

    def _merge_model_enhancement(self, package: dict[str, Any], enhancement: dict[str, Any]) -> dict[str, Any]:
        merged = copy.deepcopy(package)
        if enhancement.get("package_overview"):
            merged["package_overview"] = enhancement["package_overview"]
        if enhancement.get("coach_message"):
            merged["coach_message"] = enhancement["coach_message"]
        resource_map = {item["resource_id"]: item for item in merged["resources"]}
        for item in enhancement.get("resources", []):
            target = resource_map.get(item["resource_id"])
            if target is None:
                continue
            if item.get("summary"):
                target["summary"] = item["summary"]
            if item.get("content_markdown"):
                target["content_markdown"] = item["content_markdown"]
        stage_map = {item["stage_id"]: item for item in merged["learning_path"]}
        for tip in enhancement.get("path_tips", []):
            target = stage_map.get(tip["stage_id"])
            if target is not None:
                target["coach_tip"] = tip["coach_tip"]
        return merged

    def _build_model_prompt(self, course: dict[str, Any], profile: dict[str, Any], package: dict[str, Any]) -> str:
        payload = {
            "course": course,
            "profile_overview": profile["overview"],
            "dimensions": profile["dimensions"],
            "focus_modules": profile["focus_modules"],
            "package": {
                "package_overview": package["package_overview"],
                "coach_message": package["coach_message"],
                "resources": [{"resource_id": item["resource_id"], "title": item["title"], "summary": item["summary"]} for item in package["resources"]],
                "learning_path": [{"stage_id": item["stage_id"], "title": item["title"], "coach_tip": item["coach_tip"]} for item in package["learning_path"]],
            },
        }
        return (
            "你是学习资源总编排智能体。请基于课程、学习画像和本地生成的资源草案，"
            "输出更自然、更可执行的中文 JSON。不要添加额外字段，也不要输出解释。\n"
            "JSON 结构：\n"
            "{\n"
            '  "package_overview": "120字以内的总述",\n'
            '  "coach_message": "100字以内的督学建议",\n'
            '  "resources": [{"resource_id": "course-brief", "summary": "一句摘要", "content_markdown": "Markdown正文"}],\n'
            '  "path_tips": [{"stage_id": "stage-1", "coach_tip": "一句阶段提醒"}]\n'
            "}\n"
            "要求：\n1. 不新增资源，只优化已有资源。\n2. 语气务实、具体，避免空泛鼓励。\n3. 不要建议自动修改数据库。\n"
            f"输入数据：{json.dumps(payload, ensure_ascii=False)}"
        )

    def _call_model(self, prompt: str, runtime_provider: dict[str, Any]) -> str:
        timeout = float(runtime_provider.get("timeout_seconds") or 30)
        transport = runtime_provider.get("transport")
        base_url = str(runtime_provider.get("base_url") or "").rstrip("/")
        model_name = str(runtime_provider.get("model_name") or "")
        temperature = float(runtime_provider.get("temperature") or 0.2)
        max_tokens = int(runtime_provider.get("max_tokens") or 1200)
        api_key = str(runtime_provider.get("api_key") or "")
        with httpx.Client(timeout=timeout) as client:
            if transport == "ollama":
                response = client.post(
                    f"{base_url}/api/chat",
                    json={
                        "model": model_name,
                        "stream": False,
                        "format": "json",
                        "messages": [
                            {"role": "system", "content": "你是严谨的学习资源策划助手，只输出 JSON。"},
                            {"role": "user", "content": prompt},
                        ],
                        "options": {"temperature": temperature, "num_predict": max_tokens},
                    },
                )
                response.raise_for_status()
                payload = response.json()
                content = (payload.get("message") or {}).get("content")
                if isinstance(content, str) and content.strip():
                    return content
                raise ValueError("ollama response missing content")
            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            response = client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json={
                    "model": model_name,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": "你是严谨的学习资源策划助手，只输出 JSON。"},
                        {"role": "user", "content": prompt},
                    ],
                },
            )
            response.raise_for_status()
            payload = response.json()
            choices = payload.get("choices") or []
            if not choices:
                raise ValueError("model response missing choices")
            message = choices[0].get("message") or {}
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                return content
            raise ValueError("model response missing content")

    @staticmethod
    def _clean_text(value: Any, max_length: int) -> str:
        if not isinstance(value, str):
            return ""
        collapsed = " ".join(value.replace("\r", " ").replace("\n", " ").split())
        return collapsed[:max_length].strip()

    @staticmethod
    def _clean_multiline_text(value: Any, max_length: int) -> str:
        if not isinstance(value, str):
            return ""
        normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip()
        return normalized[:max_length].rstrip()

    @staticmethod
    def _format_model_error(exc: Exception) -> str:
        if isinstance(exc, httpx.TimeoutException):
            return "AI 请求超时"
        if isinstance(exc, httpx.HTTPStatusError):
            status_code = exc.response.status_code
            if status_code in {401, 403}:
                return "AI 认证失败，请检查 API Key 或服务权限"
            if status_code == 404:
                return "AI 接口地址不存在，请检查 API Base URL"
            if status_code >= 500:
                return "AI 服务暂时不可用"
            return f"AI 服务返回状态码 {status_code}"
        if isinstance(exc, httpx.RequestError):
            return "无法连接到 AI 服务"
        return str(exc).strip() or "AI 调用失败"

    @staticmethod
    def _utc_now_iso() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    def _execution_meta(self) -> dict[str, Any]:
        """Standard execution metadata for all session/profile responses."""
        plan = self.ai_settings_service.get_execution_plan()
        return {
            "mode_requested": plan["mode"],
            "mode_used": "local_rules",
            "provider_id": plan["provider_id"],
            "runtime_message": plan["runtime_message"],
            "fallback_reason": None,
            "generated_at": self._utc_now_iso(),
        }


# ── Fallback courses (for courses not yet in KnowledgeBase) ──

_FALLBACK_PYTHON_COURSE: dict[str, Any] = {
    "course_id": "python_programming",
    "title": "Python 程序设计",
    "category": "编程基础",
    "difficulty": "入门到进阶",
    "summary": "覆盖语法、函数、数据结构、文件处理、面向对象与小项目实践。",
    "tags": ["编程", "自动化", "项目"],
    "module_count": 6,
    "modules": [
        {"module_id": "py-01", "title": "基础语法", "core_points": ["变量", "数据类型", "输入输出"], "outcome": "能写简单脚本。"},
        {"module_id": "py-02", "title": "流程与函数", "core_points": ["分支", "循环", "函数"], "outcome": "能封装重复逻辑。"},
        {"module_id": "py-03", "title": "列表字典集合", "core_points": ["序列", "映射", "推导式"], "outcome": "能组织中等规模数据。"},
        {"module_id": "py-04", "title": "文件与异常", "core_points": ["文件读写", "JSON", "异常处理"], "outcome": "能完成稳定的数据读写。"},
        {"module_id": "py-05", "title": "面向对象", "core_points": ["类", "继承", "组合"], "outcome": "能做基础对象建模。"},
        {"module_id": "py-06", "title": "项目实战", "core_points": ["模块化", "调试", "脚本实战"], "outcome": "能完成小型项目。"},
    ],
}

_FALLBACK_ADVANCED_MATH_COURSE: dict[str, Any] = {
    "course_id": "advanced_math",
    "title": "高等数学",
    "category": "数学基础课",
    "difficulty": "基础到强化",
    "summary": "覆盖极限、导数、积分、多元微积分与级数，适合期末与考研复盘。",
    "tags": ["数学", "考研", "理论"],
    "module_count": 6,
    "modules": [
        {"module_id": "am-01", "title": "极限与连续", "core_points": ["函数", "极限", "连续"], "outcome": "能判断连续与极限行为"},
        {"module_id": "am-02", "title": "导数与微分", "core_points": ["导数定义", "求导法则", "微分"], "outcome": "能完成一元求导"},
        {"module_id": "am-03", "title": "导数应用", "core_points": ["单调性", "极值", "中值定理"], "outcome": "能分析函数图像。"},
        {"module_id": "am-04", "title": "积分基础", "core_points": ["换元", "分部积分", "定积分"], "outcome": "能处理核心积分题。"},
        {"module_id": "am-05", "title": "多元微积分", "core_points": ["偏导", "全微分", "极值"], "outcome": "能分析二元函数"},
        {"module_id": "am-06", "title": "级数与综合复盘", "core_points": ["收敛性", "幂级数", "综合题"], "outcome": "能完成综合复盘。"},
    ],
}

_FALLBACK_COURSE_MAP: dict[str, dict[str, Any]] = {
    "python_programming": _FALLBACK_PYTHON_COURSE,
    "advanced_math": _FALLBACK_ADVANCED_MATH_COURSE,
}
