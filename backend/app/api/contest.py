"""Contest training API endpoints."""

from __future__ import annotations

import asyncio
import json
import queue
import threading

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

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
    import_quality = "manual"
    page_data = None

    if "codeforces.com" in url:
        try:
            problem, page_data = service.fetch_codeforces_problem_full(url)
            import_quality = "full_statement" if page_data and page_data.get("statement_markdown") else "metadata_only"
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
        import_quality = "manual"

    # AI review: enrich tags, educational value, prerequisites
    review = service.review_problem(problem)
    merged_tags = review.get("tags", problem.tags) or problem.tags
    educational_value = review.get("educational_value", "")
    prerequisites = review.get("prerequisites", [])

    # Check if AI is configured
    ai_available = service._get_llm_config() is not None

    # Determine problem_id for DB
    parsed = service._parse_cf_url(url)
    if parsed and "codeforces.com" in url:
        platform_db = "codeforces"
        problem_id_str = f"{parsed['contest_id']}{parsed['index']}"
    else:
        platform_db = str(problem.platform)
        problem_id_str = payload.get("problem_id", "") or url.split("/")[-1] or url

    # Save to DB with full data
    db_record = request.app.state.db.upsert_contest_problem(
        platform=platform_db,
        problem_id=problem_id_str,
        title=str(problem.title),
        source_url=url,
        statement_markdown=str(problem.statement_markdown),
        tags=json.dumps(merged_tags if isinstance(merged_tags, list) else problem.tags, ensure_ascii=False),
        difficulty=payload.get("difficulty", 0),
        educational_value=educational_value,
        prerequisites=json.dumps(prerequisites if isinstance(prerequisites, list) else [], ensure_ascii=False),
        samples=json.dumps(problem.samples, ensure_ascii=False),
        input_format=str(problem.input_format),
        output_format=str(problem.output_format),
        constraints=json.dumps(problem.constraints, ensure_ascii=False),
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

    # Build response with parsed JSON fields
    resp_problem: dict[str, Any] = dict(db_record)
    for field in ("tags", "prerequisites", "samples", "constraints"):
        try:
            resp_problem[field] = json.loads(resp_problem.get(field, "[]"))
        except (json.JSONDecodeError, TypeError):
            resp_problem[field] = []

    return success({
        "problem": resp_problem,
        "ai_reviewed": review.get("ai_reviewed", False),
        "ai_available": ai_available,
        "import_quality": import_quality,
        "submissions": submissions,
    })


@router.get("/problems")
def list_problems(request: Request):
    problems = request.app.state.db.list_contest_problems()
    for p in problems:
        for field in ("tags", "prerequisites", "samples", "constraints"):
            try:
                p[field] = json.loads(p.get(field, "[]"))
            except (json.JSONDecodeError, TypeError):
                p[field] = []
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
    for field in ("tags", "prerequisites", "samples", "constraints"):
        try:
            p[field] = json.loads(p.get(field, "[]"))
        except (json.JSONDecodeError, TypeError):
            p[field] = []
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
    """Diagnose a WA submission — sample execution + rule-based + LLM + optional 对拍."""
    problem_data = payload.get("problem", {})
    submission_data = payload.get("submission", {})
    deep = bool(payload.get("deep", False))

    problem = ProblemSnapshot.from_dict(problem_data)
    submission = SubmissionSnapshot.from_dict(submission_data)

    service = _get_service(request)
    diagnosis = service.diagnose_wa(problem, submission, deep=deep)

    return success({"diagnosis": diagnosis})


# ── SSE Streaming Diagnosis ────────────────────────────


@router.post("/diagnose/stream")
async def diagnose_stream(payload: dict, request: Request):
    """Streaming WA diagnosis via Server-Sent Events — no timeout, real-time progress."""
    problem_data = payload.get("problem", {})
    submission_data = payload.get("submission", {})
    deep = bool(payload.get("deep", False))

    problem = ProblemSnapshot.from_dict(problem_data)
    submission = SubmissionSnapshot.from_dict(submission_data)

    service = _get_service(request)
    event_queue: queue.Queue[dict] = queue.Queue()
    loop = asyncio.get_running_loop()

    def emit(event: str, data: Any) -> None:
        event_queue.put({"event": event, "data": data})

    def run_diagnosis() -> None:
        try:
            service.diagnose_wa_stream(problem, submission, emit=emit, deep=deep)
        except Exception as e:
            emit("error", {"message": str(e)})

    thread = threading.Thread(target=run_diagnosis, daemon=True)
    thread.start()

    async def event_generator():
        while True:
            try:
                item = await loop.run_in_executor(None, event_queue.get, True, 10)
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
                if item["event"] == "done" or item["event"] == "error":
                    break
            except queue.Empty:
                # Keep-alive ping every 10s
                yield f": keepalive\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── Compiler discovery ────────────────────────────────


@router.get("/compilers")
def list_compilers():
    """List available C++ compilers on this machine."""
    from app.contest.runner import discover_compilers, get_compiler_info
    compilers = discover_compilers()
    current = get_compiler_info()
    return success({
        "compilers": compilers,
        "active": current,
        "has_compiler": len(compilers) > 0,
    })
