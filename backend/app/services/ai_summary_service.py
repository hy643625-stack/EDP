from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import httpx

from app.services.ai_settings_service import AiSettingsService
from app.services.home_service import HomeService


def _format_rate_text(rate: float | None) -> str:
    if rate is None:
        return "当前周期未设置明确目标"
    return f"完成率 {round(rate, 1)}%"


def _build_signal_lines(report: dict[str, Any]) -> list[str]:
    signals: list[str] = []
    completion_rate = report.get("completion_rate")
    total_actual = float(report.get("total_actual") or 0)
    total_target = report.get("total_target")

    if total_target is None:
        signals.append(f"本周期累计值为 {round(total_actual, 2)}，当前更适合先观察执行节律")
    else:
        signals.append(f"本周期实际值 {round(total_actual, 2)}，目标值 {round(float(total_target), 2)}")
        if completion_rate is not None:
            if completion_rate >= 100:
                signals.append("当前节律已经达到或超过目标，可以考虑提高挑战强度")
            elif completion_rate >= 70:
                signals.append("执行节律整体稳定，优先保持当前动作链路")
            else:
                signals.append("执行偏差较明显，建议先降低阻力，再决定是否续期")

    period_start = report.get("period_start")
    period_end = report.get("period_end")
    if period_start and period_end:
        signals.append(f"复盘区间：{period_start} 至 {period_end}")

    recommendation_reason = str(report.get("recommendation_reason") or "").strip()
    if recommendation_reason:
        signals.append(recommendation_reason)

    return signals


def _build_action_items(report: dict[str, Any]) -> list[str]:
    action = report.get("recommended_action") or "renew"
    attr_name = report.get("attr_name") or "该属性"

    if action == "archive":
        return [
            f"先归档 {attr_name} 当前周期，避免继续积累未完成压力",
            "回看本周期失败片段，确认是目标过高还是执行频率不匹配",
            "如果它仍然重要，再以更小目标重新开启下一周期",
        ]

    if action == "evolve":
        return [
            f"为 {attr_name} 设置更高一级的目标，或增加结果型指标",
            "保留当前有效动作，不要一次性同时修改太多规则",
            "下一周期优先验证提升后的目标是否仍能稳定完成",
        ]

    return [
        f"按当前规则继续推进 {attr_name}，保留已验证有效的执行节律",
        "如果下一周期仍有波动，优先调整目标值或记录频率，而不是直接放弃",
        "所有 AI 建议都应先由用户确认，再决定是否修改数据或配置",
    ]


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


class AiSummaryService:
    def __init__(self, home_service: HomeService, ai_settings_service: AiSettingsService) -> None:
        self.home_service = home_service
        self.ai_settings_service = ai_settings_service

    def build_settlement_summary(self, task_id: int, attr_id: int, record_date: str) -> dict[str, Any]:
        report = self.home_service.get_settlement_report(task_id, attr_id, record_date)
        execution_plan = self.ai_settings_service.get_execution_plan()
        runtime_provider = self.ai_settings_service.get_runtime_provider_config()

        fallback_reason: str | None = None
        mode_used = "local_rules"
        summary_text = self._compose_local_summary(report)
        sections = {
            "overview": f"{report['task_name']} / {report['attr_name']}：{_format_rate_text(report.get('completion_rate'))}",
            "signals": _build_signal_lines(report),
            "actions": _build_action_items(report),
        }

        if not execution_plan["uses_local_rules"] and runtime_provider is not None:
            try:
                model_summary = self._generate_model_summary(report, runtime_provider)
            except Exception as exc:
                fallback_reason = f"{self._format_model_error(exc)}，已按配置策略自动降级到本地规则算法"
            else:
                mode_used = "model"
                summary_text = model_summary["summary_text"]
                sections = model_summary["sections"]
        elif not execution_plan["uses_local_rules"]:
            fallback_reason = "当前 AI 配置尚未就绪，已按配置策略自动降级到本地规则算法"

        return {
            "task_id": report["task_id"],
            "task_name": report["task_name"],
            "attr_id": report["attr_id"],
            "attr_name": report["attr_name"],
            "record_date": record_date,
            "mode_requested": execution_plan["mode"],
            "mode_used": mode_used,
            "provider_id": execution_plan["provider_id"],
            "fallback_reason": fallback_reason,
            "runtime_message": execution_plan["runtime_message"],
            "confirmation_required": execution_plan["confirmation_required"],
            "summary_text": summary_text,
            "sections": sections,
            "settlement_report": report,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }

    def _compose_local_summary(self, report: dict[str, Any]) -> str:
        lines = [
            f"{report['task_name']} / {report['attr_name']} 周期复盘",
            f"- {_format_rate_text(report.get('completion_rate'))}",
        ]
        for signal in _build_signal_lines(report):
            lines.append(f"- {signal}")
        lines.append(f"- 建议动作：{report.get('recommended_action')}")
        return "\n".join(lines)

    def _generate_model_summary(self, report: dict[str, Any], runtime_provider: dict[str, Any]) -> dict[str, Any]:
        prompt = self._build_summary_prompt(report)
        raw = self._call_model(prompt, runtime_provider)
        parsed = _extract_json_object(raw)

        overview = self._clean_line(parsed.get("overview")) or f"{report['task_name']} / {report['attr_name']}：{_format_rate_text(report.get('completion_rate'))}"
        summary_text = self._clean_multiline_text(parsed.get("summary_text")) or self._compose_local_summary(report)
        signals = self._normalize_string_list(parsed.get("signals")) or _build_signal_lines(report)
        actions = self._normalize_string_list(parsed.get("actions")) or _build_action_items(report)

        return {
            "summary_text": summary_text,
            "sections": {
                "overview": overview,
                "signals": signals,
                "actions": actions,
            },
        }

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
                            {"role": "system", "content": "你是严谨的个人执行复盘教练，只输出 JSON。"},
                            {"role": "user", "content": prompt},
                        ],
                        "options": {
                            "temperature": temperature,
                            "num_predict": max_tokens,
                        },
                    },
                )
                response.raise_for_status()
                payload = response.json()
                message = payload.get("message") or {}
                content = message.get("content")
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
                        {"role": "system", "content": "你是严谨的个人执行复盘教练，只输出 JSON。"},
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
            if isinstance(content, list):
                text_parts = []
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        text_value = item.get("text")
                        if isinstance(text_value, str):
                            text_parts.append(text_value)
                merged = "".join(text_parts).strip()
                if merged:
                    return merged
            raise ValueError("model response missing content")

    def _build_summary_prompt(self, report: dict[str, Any]) -> str:
        payload = {
            "task_name": report.get("task_name"),
            "attr_name": report.get("attr_name"),
            "period_start": report.get("period_start"),
            "period_end": report.get("period_end"),
            "total_actual": report.get("total_actual"),
            "total_target": report.get("total_target"),
            "completion_rate": report.get("completion_rate"),
            "recommended_action": report.get("recommended_action"),
            "recommendation_reason": report.get("recommendation_reason"),
            "local_signals": _build_signal_lines(report),
            "local_actions": _build_action_items(report),
        }
        return (
            "请基于下面的周期复盘数据，输出一份简洁、可执行的中文 JSON。\n"
            "不要输出 markdown，不要解释，只返回 JSON 对象。\n"
            "字段要求：\n"
            '{\n'
            '  "overview": "一句话概览",\n'
            '  "summary_text": "2-5 行复盘文本，可包含换行",\n'
            '  "signals": ["3条以内关键信号"],\n'
            '  "actions": ["3条以内下一步建议"]\n'
            '}\n'
            "要求：\n"
            "1. 不得建议自动修改数据库。\n"
            "2. 建议要保守、具体、可执行。\n"
            "3. 如果数据不足，就直接指出数据不足。\n"
            "4. 尽量参考 local_signals 和 local_actions，但允许更自然地改写。\n"
            f"输入数据：{json.dumps(payload, ensure_ascii=False)}"
        )

    @staticmethod
    def _normalize_string_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        result: list[str] = []
        for item in value:
            text = AiSummaryService._clean_line(item)
            if text:
                result.append(text)
        return result[:3]

    @staticmethod
    def _clean_line(value: Any) -> str:
        if not isinstance(value, str):
            return ""
        return " ".join(value.strip().split())

    @staticmethod
    def _clean_multiline_text(value: Any) -> str:
        if not isinstance(value, str):
            return ""
        lines = [line.strip() for line in value.replace("\r\n", "\n").split("\n")]
        cleaned = [line for line in lines if line]
        return "\n".join(cleaned[:6])

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
        message = str(exc).strip()
        return message or "AI 调用失败"
