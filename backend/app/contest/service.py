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

    def _call_llm(self, system_prompt: str, user_prompt: str, max_tokens: int = 800) -> str | None:
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
            "max_tokens": max_tokens,
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

        result = self._call_llm(system, prompt, max_tokens=2000)
        if result is None:
            _logger.info("AI review skipped: LLM unavailable for problem %s", problem.title)
            return {
                "tags": problem.tags,
                "educational_value": "",
                "prerequisites": [],
                "ai_reviewed": False,
            }

        # Parse JSON from LLM response
        parsed = self._parse_json_safe(result)
        if isinstance(parsed, dict):
            return {
                "tags": parsed.get("tags", problem.tags),
                "educational_value": parsed.get("educational_value", ""),
                "prerequisites": parsed.get("prerequisites", []),
                "ai_reviewed": True,
            }

        _logger.warning("AI review parse failed for %s. Raw response (first 500 chars): %s",
                        problem.title, result[:500])
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
        deep: bool = False,
    ) -> dict[str, Any]:
        """Analyze a WA submission — sample execution + rule-based + LLM + optional 对拍."""
        code = submission.code.strip()
        if not code:
            return {
                "hypotheses": [],
                "sample_results": [],
                "hack_result": None,
                "confidence": "none",
                "note": "未提供代码。请粘贴代码或选择一条提交记录进行分析。",
            }

        # Stage 1: Algorithm intent detection (regex)
        algo_indicators = self._detect_algorithm_intent(code)

        # Stage 2: Run sample tests (LOCAL execution)
        sample_results_dicts: list[dict[str, Any]] = []
        sample_fail = False
        if problem.samples:
            from app.contest.runner import run_samples as _run
            results = _run(code, problem.samples)
            for r in results:
                sample_results_dicts.append({
                    "index": r.index, "input": r.input_text[:300],
                    "expected": r.expected[:500], "actual": r.actual[:500],
                    "passed": r.passed, "error": r.error[:300],
                })
                if not r.passed:
                    sample_fail = True

        # Stage 3: Rule-based error patterns
        hypotheses: list[dict[str, str]] = []
        hypotheses.extend(self._rule_based_check(code, problem, algo_indicators))

        # Stage 4: LLM-enhanced diagnosis (if available)
        llm_enhanced = False
        llm_config = self._get_llm_config()
        if llm_config and len(code) > 30:
            llm_result = self._llm_diagnose(problem, submission, algo_indicators, sample_results_dicts)
            if llm_result:
                hypotheses = llm_result
                llm_enhanced = True

        if not hypotheses:
            hypotheses.append({
                "type": "实现细节错误",
                "hypothesis": "代码逻辑没有明显的模式错误。建议进行对拍以发现反例。",
                "evidence": "未能从代码结构或样例运行中自动识别错误模式。",
            })

        # Stage 5: Deep analysis — LLM brute + generator + 对拍
        hack_result: dict[str, Any] | None = None
        if deep and llm_config and len(code) > 50:
            hack_result = self._run_hack_pipeline(problem, submission, sample_results_dicts)

        return {
            "hypotheses": hypotheses[:5],
            "algo_indicators": algo_indicators,
            "sample_results": sample_results_dicts,
            "hack_result": hack_result,
            "has_code": True,
            "llm_enhanced": llm_enhanced,
            "sample_fail": sample_fail,
        }

    # ── Hack / 对拍 pipeline ──────────────────────────

    def _run_hack_pipeline(
        self, problem: ProblemSnapshot, submission: SubmissionSnapshot,
        sample_results: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        """Let LLM write brute force + generator, run 对拍, feed results back."""
        from app.contest.runner import run_hack as _run_hack

        # Step 1: Ask LLM to generate brute force + generator
        gen_result = self._llm_generate_hack_code(problem, submission, sample_results)
        if gen_result is None:
            return None

        brute_code = gen_result.get("brute_code", "")
        gen_code = gen_result.get("generator_code", "")
        if not brute_code or not gen_code:
            return {"ok": False, "error": "LLM 未能生成有效的暴力解或生成器代码。",
                    "brute_code": brute_code, "generator_code": gen_code}

        # Step 2: Run 对拍 locally
        hack = _run_hack(submission.code, brute_code, gen_code, max_rounds=200)

        result: dict[str, Any] = {
            "ok": hack.ok,
            "round_count": hack.round_count,
            "first_fail": hack.first_fail,
            "counterexample_input": hack.counterexample_input[:500],
            "wa_output": hack.wa_output[:500],
            "brute_output": hack.brute_output[:500],
            "brute_code": brute_code,
            "generator_code": gen_code,
            "error": hack.error,
        }

        # Step 3: If counterexample found, ask LLM to analyze it
        if hack.first_fail > 0 and hack.counterexample_input:
            analysis = self._llm_analyze_counterexample(
                problem, submission, hack.counterexample_input,
                hack.wa_output, hack.brute_output, hack.first_fail,
            )
            if analysis:
                result["counterexample_analysis"] = analysis

        return result

    def _llm_generate_hack_code(
        self, problem: ProblemSnapshot, submission: SubmissionSnapshot,
        sample_results: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        """Ask LLM to generate brute force solution and data generator."""

        sample_info = ""
        for s in sample_results:
            sample_info += f"\n样例{s['index']}: 输入={s['input'][:200]} 期望={s['expected'][:200]} {'通过' if s['passed'] else '失败'}"

        prompt = f"""根据题目信息，生成两个 C++ 程序：

**题目**：{problem.title}
**标签**：{', '.join(problem.tags or [])}
**题面摘要**：{problem.statement_markdown[:1500]}
**用户 WA 代码**（仅参考算法结构，不要抄袭错误）：
```
{submission.code[:2500]}
```
**样例测试结果**：{sample_info if sample_info else '无样例数据'}

请生成两个完整的 C++ 程序，用如下 JSON 格式返回（必须严格 JSON）：
{{
  "brute_code": "完整的暴力解 C++ 代码",
  "generator_code": "完整的数据生成器 C++ 代码"
}}

要求：
1. brute_code: 写一个保证正确但可以低效的暴力解（O(2^N), O(N!) 都可以），严格按题目输入格式读取、输出格式写入。自带 main 函数，从 stdin 读、向 stdout 写。
2. generator_code: 写一个数据生成器，生成符合题目约束的小规模随机测试数据，自带 main 函数，向 stdout 输出测试数据（格式与题目输入一致）。
3. 两个程序都必须是完整可编译的 C++ 代码，不要省略头文件，不要用外部库。
4. 只返回 JSON，不要 markdown 代码块。JSON 字符串中的换行用 \\n 转义。"""

        system = "你是一位 C++ 竞赛编程专家。只返回严格的 JSON，字符串中的代码用 \\n 转义。"
        result = self._call_llm(system, prompt, max_tokens=4000)
        if result is None:
            return None

        return self._parse_json_safe(result)

    def _llm_analyze_counterexample(
        self, problem: ProblemSnapshot, submission: SubmissionSnapshot,
        counterexample_input: str, wa_output: str, brute_output: str, fail_round: int,
    ) -> list[dict[str, str]] | None:
        """Feed counterexample back to LLM for root cause analysis."""
        prompt = f"""找到了一组反例，请分析 WA 代码的具体错误：

**题目**：{problem.title}
**反例输入**（第 {fail_round} 轮对拍）：
```
{counterexample_input[:500]}
```
**WA 输出**：
```
{wa_output[:500]}
```
**正确输出（暴力解）**：
```
{brute_output[:500]}
```
**WA 代码**：
```
{submission.code[:2500]}
```

请用 JSON 数组格式返回具体的错误分析（1-2 条）：
[
  {{"type": "具体错误类型", "hypothesis": "基于反例的精确定位", "evidence": "反例证据 + 代码问题行"}}
]

只返回 JSON 数组。"""

        system = "你是一位算法竞赛教练，擅长基于反例定位代码错误。只返回 JSON 数组。"
        result = self._call_llm(system, prompt, max_tokens=1200)
        if result is None:
            return None

        parsed = self._parse_json_safe(result)
        if isinstance(parsed, list) and len(parsed) > 0:
            return parsed
        return None

    @staticmethod
    def _parse_json_safe(text: str) -> Any | None:
        """Extract JSON from LLM response, handling markdown code blocks and nested objects."""
        cleaned = text.strip()
        # Remove markdown code fences
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```\w*\n?", "", cleaned)
            cleaned = re.sub(r"\n?```$", "", cleaned)
        try:
            return json.loads(cleaned)
        except (json.JSONDecodeError, TypeError):
            pass
        # Try to extract JSON object with nesting support
        m = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", cleaned, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except (json.JSONDecodeError, TypeError):
                pass
        # Try to extract JSON array with nesting support
        m = re.search(r"\[[^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*\]", cleaned, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except (json.JSONDecodeError, TypeError):
                pass
        return None

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
        sample_results: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, str]] | None:
        """LLM-enhanced WA diagnosis."""
        config = self._get_llm_config()
        if config is None:
            return None

        detected_algos = [k for k, v in algo.items() if v]

        sample_info = ""
        if sample_results:
            for s in sample_results:
                status = "✓" if s["passed"] else "✗"
                sample_info += f"\n样例{s['index']} [{status}]: 输入={s['input'][:150]} 期望={s['expected'][:150]} 实际={s['actual'][:150]}"
                if s.get("error"):
                    sample_info += f" 错误={s['error'][:100]}"

        prompt = f"""分析以下 WA 提交：

题目：{problem.title}
题目标签：{', '.join(problem.tags or [])}
检测到的算法模式：{', '.join(detected_algos) or '未检测到明显模式'}
判定结果：{submission.verdict}
语言：{submission.language}
样例测试结果：{sample_info or '无样例数据'}

代码：
```
{submission.code[:3000]}
```

请用 JSON 数组格式返回可能的错误假设（最多 3 条）：
[
  {{"type": "错误类型", "hypothesis": "具体假设", "evidence": "代码中的证据"}}
]

结合样例测试结果进行分析。只返回 JSON 数组，不要其他文字。"""

        system = "你是一位算法竞赛教练，擅长分析代码中的 WA 错误。只返回 JSON 数组。"
        result = self._call_llm(system, prompt, max_tokens=1200)
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
