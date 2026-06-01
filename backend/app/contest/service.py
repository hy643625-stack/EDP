"""Contest training service — problem fetching, AI review, WA diagnosis."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from app.contest.models import ProblemSnapshot, SubmissionSnapshot
from app.db import Database

CF_API = "https://codeforces.com/api"
_logger = logging.getLogger(__name__)


def _http_client(timeout: int = 15) -> httpx.Client:
    """Create an httpx client that bypasses system proxy for external API calls."""
    return httpx.Client(timeout=timeout, trust_env=False)


class ContestService:
    def __init__(self, db: Database | None = None, ai_settings_service: Any = None) -> None:
        self.db = db
        self.ai_settings = ai_settings_service

    # ── LLM helper ─────────────────────────────────────

    def _get_llm_config(self) -> dict[str, Any] | None:
        if self.ai_settings is None:
            return None
        try:
            config = self.ai_settings.get_runtime_provider_config()
        except Exception:
            return None
        if config is None:
            return None
        return config

    def _call_llm(self, system_prompt: str, user_prompt: str) -> str | None:
        config = self._get_llm_config()
        if config is None:
            return None

        base_url = str(config.get("base_url", "")).rstrip("/")
        model = str(config.get("model_name", ""))
        api_key = str(config.get("api_key", ""))
        timeout = int(config.get("timeout_seconds", 30))

        if not base_url or not model:
            return None

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.2,
            "max_tokens": 800,
        }

        try:
            with _http_client(timeout=timeout) as client:
                resp = client.post(
                    f"{base_url}/chat/completions",
                    headers=headers,
                    json=body,
                )
                resp.raise_for_status()
                data = resp.json()
            return data["choices"][0]["message"]["content"]
        except Exception:
            return None

    # ── Problem fetching ──────────────────────────────

    def fetch_codeforces_problem(self, url: str) -> ProblemSnapshot:
        parsed = self._parse_cf_url(url)
        if parsed is None:
            raise ValueError(f"无法解析 Codeforces 题目链接: {url}")

        contest_id = parsed["contest_id"]
        index = parsed["index"]

        try:
            with _http_client() as client:
                resp = client.get(f"{CF_API}/contest.standings", params={
                    "contestId": contest_id, "from": 1, "count": 1,
                })
                resp.raise_for_status()
                data = resp.json()
            if data.get("status") != "OK":
                raise ValueError("Codeforces API 返回异常")

            problems_data = (data.get("result", {}).get("problems") or [])
            tags: list[str] = []
            title = f"CF {contest_id}{index}"
            for p in problems_data:
                if p.get("index") == index:
                    tags = p.get("tags", [])
                    title = p.get("name", title)
                    break
        except Exception as e:
            _logger.warning("Failed to fetch CF problem %s/%s: %s", contest_id, index, e)
            tags = []
            title = f"CF {contest_id}{index}"

        return ProblemSnapshot(
            platform="codeforces",
            source_url=url,
            title=title,
            statement_markdown=f"题目 {contest_id}{index}\n\n请访问 {url} 查看完整题面。",
            tags=tags,
        )

    @staticmethod
    def _parse_cf_url(url: str) -> dict[str, Any] | None:
        patterns = [
            r"/contest/(\d+)/problem/([A-Z]\d?)",
            r"/problemset/problem/(\d+)/([A-Z]\d?)",
        ]
        for pat in patterns:
            m = re.search(pat, url)
            if m:
                return {"contest_id": int(m.group(1)), "index": m.group(2)}
        return None

    def import_manual_problem(self, title: str, statement: str, platform: str = "manual",
                              source_url: str = "", tags: list[str] | None = None,
                              samples: list[dict[str, str]] | None = None) -> ProblemSnapshot:
        return ProblemSnapshot(
            platform=platform,
            source_url=source_url,
            title=title,
            statement_markdown=statement,
            tags=tags or [],
            samples=samples or [],
        )

    def import_submission(
        self, platform: str, problem_id: str, verdict: str,
        language: str = "", code: str = "", user_handle: str = "",
        submitted_at: str = "", runtime_ms: int = 0, memory_kb: int = 0,
    ) -> SubmissionSnapshot:
        return SubmissionSnapshot(
            platform=platform, problem_id=problem_id, verdict=verdict,
            language=language, code=code, user_handle=user_handle,
            submitted_at=submitted_at, runtime_ms=runtime_ms, memory_kb=memory_kb,
        )

    # ── AI Problem Review ──────────────────────────────

    def review_problem(self, problem: ProblemSnapshot) -> dict[str, Any]:
        """Use LLM to analyze a problem: tags, educational value, prerequisites."""

        cf_tags = ", ".join(problem.tags) if problem.tags else "无"
        prompt = f"""分析以下算法竞赛题目，请用 JSON 格式返回：

题目名称：{problem.title}
平台标签：{cf_tags}
题面摘要：{problem.statement_markdown[:2000]}

请返回严格 JSON（不要 markdown 代码块）：
{{
  "tags": ["标签1", "标签2", ...],
  "educational_value": "学习研究价值评估（50字以内）",
  "prerequisites": ["前置知识1", "前置知识2", ...]
}}

要求：
- tags: 补充准确的算法标签（如 dp, greedy, graph, data structures, math, binary search, two pointers, etc.），结合题面分析，不要仅依赖现有标签
- educational_value: 评估这道题的学习价值，例如"经典DP入门模板题，适合练习状态定义"、"思维题，考察贪心证明"等
- prerequisites: 列出做这道题需要的前置知识，按依赖顺序排列"""

        system = "你是一位算法竞赛教练，擅长分析题目的知识点和学习价值。只返回 JSON，不要任何额外文字。"

        result = self._call_llm(system, prompt)
        if result is None:
            return {
                "tags": problem.tags,
                "educational_value": "",
                "prerequisites": [],
                "ai_reviewed": False,
            }

        # Parse JSON from LLM response
        try:
            cleaned = result.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r"^```\w*\n?", "", cleaned)
                cleaned = re.sub(r"\n?```$", "", cleaned)
            parsed = json.loads(cleaned)
            return {
                "tags": parsed.get("tags", problem.tags),
                "educational_value": parsed.get("educational_value", ""),
                "prerequisites": parsed.get("prerequisites", []),
                "ai_reviewed": True,
            }
        except (json.JSONDecodeError, TypeError):
            # Try to extract JSON object from response
            m = re.search(r"\{[^{}]*\}", result, re.DOTALL)
            if m:
                try:
                    parsed = json.loads(m.group())
                    return {
                        "tags": parsed.get("tags", problem.tags),
                        "educational_value": parsed.get("educational_value", ""),
                        "prerequisites": parsed.get("prerequisites", []),
                        "ai_reviewed": True,
                    }
                except (json.JSONDecodeError, TypeError):
                    pass
            return {
                "tags": problem.tags,
                "educational_value": "",
                "prerequisites": [],
                "ai_reviewed": False,
            }

    # ── Submission fetching ────────────────────────────

    def fetch_codeforces_submissions(self, handle: str, count: int = 20) -> list[dict[str, Any]]:
        try:
            with _http_client() as client:
                resp = client.get(f"{CF_API}/user.status", params={
                    "handle": handle, "from": 1, "count": count,
                })
                resp.raise_for_status()
                data = resp.json()
            if data.get("status") != "OK":
                return []
            results: list[dict[str, Any]] = []
            for item in data.get("result", [])[:count]:
                prob = item.get("problem", {})
                author = item.get("author", {})
                results.append({
                    "platform": "codeforces",
                    "problem_id": f"{prob.get('contestId', '')}{prob.get('index', '')}",
                    "problem_title": prob.get("name", ""),
                    "contest_id": prob.get("contestId", ""),
                    "problem_index": prob.get("index", ""),
                    "verdict": item.get("verdict", "UNKNOWN"),
                    "language": item.get("programmingLanguage", ""),
                    "code": "",  # CF API doesn't return code in user.status
                    "submitted_at": item.get("creationTimeSeconds", ""),
                    "runtime_ms": item.get("timeConsumedMillis", 0),
                    "memory_kb": item.get("memoryConsumedBytes", 0) // 1024,
                })
            return results
        except Exception:
            return []

    def match_submissions_for_problem(
        self, submissions: list[dict[str, Any]], contest_id: str, problem_index: str,
    ) -> list[dict[str, Any]]:
        """Filter submissions matching a specific CF problem."""
        return [
            s for s in submissions
            if str(s.get("contest_id", "")) == str(contest_id)
            and str(s.get("problem_index", "")) == str(problem_index)
        ]

    # ── WA Diagnosis ───────────────────────────────────

    def diagnose_wa(
        self, problem: ProblemSnapshot, submission: SubmissionSnapshot,
    ) -> dict[str, Any]:
        """Analyze a WA submission — rule-based + optional LLM enhancement."""
        code = submission.code.strip()
        if not code:
            return {
                "hypotheses": [],
                "confidence": "none",
                "note": "未提供代码。请粘贴代码或选择一条提交记录进行分析。",
            }

        hypotheses: list[dict[str, str]] = []

        # Stage 1: Algorithm intent detection (regex)
        algo_indicators = self._detect_algorithm_intent(code)

        # Stage 2: Rule-based error patterns
        hypotheses.extend(self._rule_based_check(code, problem, algo_indicators))

        # Stage 3: LLM-enhanced diagnosis (if available and code is non-trivial)
        if len(code) > 50:
            llm_result = self._llm_diagnose(problem, submission, algo_indicators)
            if llm_result:
                hypotheses = llm_result  # LLM result replaces rule-based if available

        if not hypotheses:
            hypotheses.append({
                "type": "实现细节错误",
                "hypothesis": "代码逻辑没有明显的模式错误。建议手动对拍或加随机小数据测试。",
                "evidence": "未能从代码结构中自动识别错误模式。",
            })

        return {
            "hypotheses": hypotheses[:5],
            "algo_indicators": algo_indicators,
            "has_code": True,
            "llm_enhanced": bool(self._get_llm_config()),
        }

    def _rule_based_check(
        self, code: str, problem: ProblemSnapshot, algo: dict[str, bool],
    ) -> list[dict[str, str]]:
        """Rule-based code pattern checks."""
        results: list[dict[str, str]] = []

        if algo.get("binary_search") and "while" in code:
            if "mid" in code and "+ 1" not in code and "- 1" not in code:
                results.append({
                    "type": "边界条件错误",
                    "hypothesis": "二分查找的更新条件可能未使用 mid±1，存在死循环或错误收敛风险。",
                    "evidence": "代码中使用了二分模板，但未在更新时移动边界。",
                })

        if algo.get("dp") and "memset" not in code and "fill" not in code:
            results.append({
                "type": "状态设计错误",
                "hypothesis": "DP 数组或状态转移可能未正确初始化。",
                "evidence": "检测到 DP 结构，但未发现显式的数组初始化语句。",
            })

        if "int " in code and not re.search(r"long\s+long|int64|ll\b", code):
            if any(tag in (problem.tags or []) for tag in ["math", "number theory", "combinatorics"]):
                results.append({
                    "type": "数据范围误判",
                    "hypothesis": "题目标签为数学/计数类，使用 int 而非 long long 可能导致溢出。",
                    "evidence": "代码仅使用 int，但题目标签提示可能涉及大数运算。",
                })

        return results

    def _llm_diagnose(
        self, problem: ProblemSnapshot, submission: SubmissionSnapshot, algo: dict[str, bool],
    ) -> list[dict[str, str]] | None:
        """LLM-enhanced WA diagnosis."""
        config = self._get_llm_config()
        if config is None:
            return None

        detected_algos = [k for k, v in algo.items() if v]
        prompt = f"""分析以下 WA 提交：

题目：{problem.title}
题目标签：{', '.join(problem.tags or [])}
检测到的算法模式：{', '.join(detected_algos) or '未检测到明显模式'}
判定结果：{submission.verdict}
语言：{submission.language}

代码：
```
{submission.code[:3000]}
```

请用 JSON 数组格式返回可能的错误假设（最多 3 条）：
[
  {{"type": "错误类型", "hypothesis": "具体假设", "evidence": "代码中的证据"}}
]

只返回 JSON 数组，不要其他文字。"""

        system = "你是一位算法竞赛教练，擅长分析代码中的 WA 错误。只返回 JSON 数组。"

        result = self._call_llm(system, prompt)
        if result is None:
            return None

        try:
            cleaned = result.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r"^```\w*\n?", "", cleaned)
                cleaned = re.sub(r"\n?```$", "", cleaned)
            parsed = json.loads(cleaned)
            if isinstance(parsed, list) and len(parsed) > 0:
                return parsed
        except (json.JSONDecodeError, TypeError):
            pass
        return None

    @staticmethod
    def _detect_algorithm_intent(code: str) -> dict[str, bool]:
        return {
            "binary_search": bool(re.search(r"binary_search|lower_bound|upper_bound|mid\s*=", code)),
            "dp": bool(re.search(r"dp\[|memo\[|f\[|g\[", code)),
            "greedy": bool(re.search(r"sort\(.*\).*for|priority_queue|make_heap", code)),
            "graph": bool(re.search(r"vector.*adj|vector.*g\[|graph|dfs\(|bfs\(|visited|dijkstra", code)),
            "dsu": bool(re.search(r"parent\[|find\(|union_|dsu|DSU", code)),
            "segment_tree": bool(re.search(r"segtree|segment_tree|BIT\[|fenwick|tree\[.*\]", code)),
            "math": bool(re.search(r"mod\s*=|gcd\(|lcm\(|prime|sieve|pow\(|factorial", code)),
        }
