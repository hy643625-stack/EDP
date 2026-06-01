"""Contest training models — problem snapshots, submissions, ability profiles."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# ── Problem ────────────────────────────────────────────

class ProblemSnapshot:
    def __init__(
        self,
        platform: str,
        source_url: str,
        title: str,
        statement_markdown: str = "",
        input_format: str = "",
        output_format: str = "",
        samples: list[dict[str, str]] | None = None,
        constraints: list[str] | None = None,
        tags: list[str] | None = None,
        fetched_at: str = "",
    ) -> None:
        self.platform = platform
        self.source_url = source_url
        self.title = title
        self.statement_markdown = statement_markdown
        self.input_format = input_format
        self.output_format = output_format
        self.samples = samples or []
        self.constraints = constraints or []
        self.tags = tags or []
        self.fetched_at = fetched_at or _utc_now()

    def to_dict(self) -> dict[str, Any]:
        return {
            "platform": self.platform,
            "source_url": self.source_url,
            "title": self.title,
            "statement_markdown": self.statement_markdown,
            "input_format": self.input_format,
            "output_format": self.output_format,
            "samples": self.samples,
            "constraints": self.constraints,
            "tags": self.tags,
            "fetched_at": self.fetched_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ProblemSnapshot:
        return cls(
            platform=data.get("platform", "manual"),
            source_url=data.get("source_url", ""),
            title=data.get("title", ""),
            statement_markdown=data.get("statement_markdown", ""),
            input_format=data.get("input_format", ""),
            output_format=data.get("output_format", ""),
            samples=data.get("samples", []),
            constraints=data.get("constraints", []),
            tags=data.get("tags", []),
            fetched_at=data.get("fetched_at", ""),
        )


# ── Submission ─────────────────────────────────────────

class SubmissionSnapshot:
    VALID_VERDICTS = {"AC", "WA", "TLE", "RE", "MLE", "UNKNOWN"}

    def __init__(
        self,
        platform: str,
        problem_id: str,
        verdict: str,
        language: str = "",
        code: str = "",
        user_handle: str = "",
        submitted_at: str = "",
        runtime_ms: int = 0,
        memory_kb: int = 0,
    ) -> None:
        self.platform = platform
        self.problem_id = problem_id
        self.verdict = verdict if verdict in self.VALID_VERDICTS else "UNKNOWN"
        self.language = language
        self.code = code
        self.user_handle = user_handle
        self.submitted_at = submitted_at or _utc_now()
        self.runtime_ms = runtime_ms
        self.memory_kb = memory_kb

    def to_dict(self) -> dict[str, Any]:
        return {
            "platform": self.platform,
            "problem_id": self.problem_id,
            "verdict": self.verdict,
            "language": self.language,
            "code": self.code,
            "user_handle": self.user_handle,
            "submitted_at": self.submitted_at,
            "runtime_ms": self.runtime_ms,
            "memory_kb": self.memory_kb,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SubmissionSnapshot:
        return cls(
            platform=data.get("platform", "manual"),
            problem_id=data.get("problem_id", ""),
            verdict=data.get("verdict", "UNKNOWN"),
            language=data.get("language", ""),
            code=data.get("code", ""),
            user_handle=data.get("user_handle", ""),
            submitted_at=data.get("submitted_at", ""),
            runtime_ms=data.get("runtime_ms", 0),
            memory_kb=data.get("memory_kb", 0),
        )


# ── Ability Profile ────────────────────────────────────

CONTEST_ABILITY_DIMENSIONS = [
    "basic_implementation",      # 基础实现能力
    "complexity_judgment",       # 复杂度判断能力
    "boundary_handling",         # 边界条件处理
    "greedy_modeling",           # 贪心建模能力
    "dp_state_design",           # 动态规划状态设计
    "graph_modeling",            # 图论建模能力
    "data_structure_application",  # 数据结构应用能力
    "math_construction",         # 数学与构造能力
    "debug_verification",        # 调试与验证习惯
]

DIMENSION_LABELS: dict[str, str] = {
    "basic_implementation": "基础实现能力",
    "complexity_judgment": "复杂度判断能力",
    "boundary_handling": "边界条件处理",
    "greedy_modeling": "贪心建模能力",
    "dp_state_design": "动态规划状态设计",
    "graph_modeling": "图论建模能力",
    "data_structure_application": "数据结构应用能力",
    "math_construction": "数学与构造能力",
    "debug_verification": "调试与验证习惯",
}


class AbilityProfile:
    def __init__(self) -> None:
        self.dimensions: dict[str, dict[str, Any]] = {}
        for dim in CONTEST_ABILITY_DIMENSIONS:
            self.dimensions[dim] = {
                "dimension": dim,
                "label": DIMENSION_LABELS.get(dim, dim),
                "score": 50,  # start neutral
                "evidence": [],
                "related_problems": [],
                "recent_errors": [],
            }

    def update(self, dimension: str, evidence: str, problem_id: str = "", error_type: str = "") -> None:
        if dimension not in self.dimensions:
            return
        d = self.dimensions[dimension]
        d["evidence"].append(evidence)
        if problem_id:
            d["related_problems"].append(problem_id)
        if error_type:
            d["recent_errors"].append(error_type)
        # Simple score adjustment: errors reduce, ACs increase
        if "AC" in error_type:
            d["score"] = min(100, d["score"] + 2)
        elif error_type and error_type != "AC":
            d["score"] = max(0, d["score"] - 3)
        d["evidence"] = d["evidence"][-10:]  # keep last 10
        d["related_problems"] = list(set(d["related_problems"]))[:20]
        d["recent_errors"] = d["recent_errors"][-20:]

    def to_dict(self) -> dict[str, Any]:
        return {"dimensions": list(self.dimensions.values())}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AbilityProfile:
        profile = cls()
        for dim in (data.get("dimensions") or []):
            key = dim.get("dimension", "")
            if key in profile.dimensions:
                profile.dimensions[key] = dim
        return profile
