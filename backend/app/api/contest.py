"""Contest training API endpoints."""

from __future__ import annotations

import json

from fastapi import APIRouter, Request

from app.contest.models import ProblemSnapshot, SubmissionSnapshot
from app.contest.service import ContestService
from app.response import success

router = APIRouter(prefix="/v1/contest", tags=["contest"])


def _get_service(request: Request) -> ContestService:
    db = request.app.state.db
    ai_settings = request.app.state.ai_settings_service
    return ContestService(db=db, ai_settings_service=ai_settings)


# ── Problem endpoints ─────────────────────────────────


@router.post("/problems/fetch")
def fetch_problem(payload: dict, request: Request):
    """Fetch problem from URL, run AI review, save to DB."""
    url = (payload.get("url") or "").strip()
    handle = (payload.get("handle") or "").strip()
    if not url:
        return success({"error": "请提供题目链接"})

    service = _get_service(request)

    if "codeforces.com" in url:
        try:
            problem = service.fetch_codeforces_problem(url)
        except Exception as e:
            return success({"error": str(e)})
    else:
        problem = service.import_manual_problem(
            title=payload.get("title", "手动导入题目"),
            statement=payload.get("statement", ""),
            platform=payload.get("platform", "manual"),
            source_url=url,
            tags=payload.get("tags", []),
            samples=payload.get("samples", []),
        )

    # AI review: enrich tags, educational value, prerequisites
    review = service.review_problem(problem)
    merged_tags = review.get("tags", problem.tags) or problem.tags
    educational_value = review.get("educational_value", "")
    prerequisites = review.get("prerequisites", [])

    # Determine problem_id for DB
    parsed = service._parse_cf_url(url)
    if parsed and "codeforces.com" in url:
        platform = "codeforces"
        problem_id_str = f"{parsed['contest_id']}{parsed['index']}"
    else:
        platform = str(problem.platform)
        problem_id_str = payload.get("problem_id", "") or url.split("/")[-1] or url

    # Save/update in DB
    db_record = request.app.state.db.upsert_contest_problem(
        platform=platform,
        problem_id=problem_id_str,
        title=str(problem.title),
        source_url=url,
        statement_markdown=str(problem.statement_markdown),
        tags=json.dumps(merged_tags if isinstance(merged_tags, list) else problem.tags, ensure_ascii=False),
        difficulty=payload.get("difficulty", 0),
        educational_value=educational_value,
        prerequisites=json.dumps(prerequisites if isinstance(prerequisites, list) else [], ensure_ascii=False),
        created_at=str(problem.fetched_at),
        updated_at=str(problem.fetched_at),
    )

    # Fetch CF submissions if handle provided
    submissions: list[dict] = []
    if handle and "codeforces.com" in url and parsed:
        all_subs = service.fetch_codeforces_submissions(handle)
        submissions = service.match_submissions_for_problem(
            all_subs, str(parsed["contest_id"]), parsed["index"],
        )

    return success({
        "problem": {
            **db_record,
            "tags": merged_tags if isinstance(merged_tags, list) else json.loads(db_record.get("tags", "[]")),
            "prerequisites": prerequisites if isinstance(prerequisites, list) else json.loads(db_record.get("prerequisites", "[]")),
        },
        "ai_reviewed": review.get("ai_reviewed", False),
        "submissions": submissions,
    })


@router.get("/problems")
def list_problems(request: Request):
    problems = request.app.state.db.list_contest_problems()
    for p in problems:
        try:
            p["tags"] = json.loads(p.get("tags", "[]"))
        except (json.JSONDecodeError, TypeError):
            p["tags"] = []
        try:
            p["prerequisites"] = json.loads(p.get("prerequisites", "[]"))
        except (json.JSONDecodeError, TypeError):
            p["prerequisites"] = []
    return success(problems)


@router.get("/problems/{problem_id}")
def get_problem(problem_id: str, request: Request):
    # problem_id can be "codeforces:4A" or similar
    parts = problem_id.split(":", 1)
    if len(parts) == 2:
        p = request.app.state.db.get_contest_problem(parts[0], parts[1])
    else:
        return success({"error": "无效的题目 ID 格式，请使用 platform:problem_id"})
    if p is None:
        return success({"error": "题目不存在"})
    try:
        p["tags"] = json.loads(p.get("tags", "[]"))
    except (json.JSONDecodeError, TypeError):
        p["tags"] = []
    try:
        p["prerequisites"] = json.loads(p.get("prerequisites", "[]"))
    except (json.JSONDecodeError, TypeError):
        p["prerequisites"] = []
    return success(p)


# ── Submission endpoints ──────────────────────────────


@router.post("/submissions/fetch-cf")
def fetch_cf_submissions(payload: dict, request: Request):
    handle = (payload.get("handle") or "").strip()
    if not handle:
        return success({"error": "请提供 Codeforces handle"})
    service = _get_service(request)
    results = service.fetch_codeforces_submissions(handle)
    return success(results)


# ── WA Diagnosis ──────────────────────────────────────


@router.post("/diagnose")
def diagnose_wa(payload: dict, request: Request):
    """Diagnose a WA submission — rule-based + optional LLM. No profile updates."""
    problem_data = payload.get("problem", {})
    submission_data = payload.get("submission", {})

    problem = ProblemSnapshot.from_dict(problem_data)
    submission = SubmissionSnapshot.from_dict(submission_data)

    service = _get_service(request)
    diagnosis = service.diagnose_wa(problem, submission)

    return success({"diagnosis": diagnosis})
