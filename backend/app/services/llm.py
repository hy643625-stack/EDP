"""LLM call helper — extracted from ContestService for reuse.
This is NOT a full Provider abstraction (plan 6.6). It's a convenience
function that wraps the configured AI provider's OpenAI-compatible API.
Future: upgrade to a proper LLMProvider interface with chat() and structuredOutput().
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

_logger = logging.getLogger(__name__)


def _http_client(timeout: int = 15) -> httpx.Client:
    """Create an httpx client that bypasses system proxy for external API calls."""
    return httpx.Client(timeout=timeout, trust_env=False)


def call_llm(
    ai_settings_service: Any,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 800,
    timeout_seconds: int | None = None,
) -> str | None:
    """Call the configured AI provider. Returns response text or None on failure."""
    try:
        config = ai_settings_service.get_runtime_provider_config()
    except Exception:
        _logger.info("LLM call skipped: no runtime config")
        return None
    if config is None:
        _logger.info("LLM call skipped: no config")
        return None

    base_url = str(config.get("base_url", "")).rstrip("/")
    model = str(config.get("model_name", ""))
    api_key = str(config.get("api_key", ""))
    # Most existing callers allow a long model response. Interactive flows can
    # provide a tighter budget so their local fallback runs before the UI times out.
    timeout = (
        max(int(config.get("timeout_seconds", 30)), 300)
        if timeout_seconds is None
        else max(1, int(timeout_seconds))
    )

    if not base_url or not model:
        _logger.warning("LLM call skipped: missing base_url or model_name")
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
        content = data["choices"][0]["message"]["content"]
        _logger.info("LLM response received: %d chars", len(content))
        return content
    except httpx.TimeoutException:
        _logger.error("LLM call timed out after %ds to %s", timeout, base_url)
        return None
    except httpx.HTTPStatusError as e:
        _logger.error("LLM HTTP %d: %s", e.response.status_code, e.response.text[:300])
        return None
    except Exception as e:
        _logger.error("LLM call failed: %s", e)
        return None


def parse_json_safe(text: str) -> Any | None:
    """Extract JSON from LLM response using brace counting (handles arbitrary nesting)."""
    cleaned = text.strip()
    # Remove markdown code fences (with or without surrounding text)
    fence_m = re.search(r"```(?:\w+)?\s*\n(.*?)\n```", cleaned, re.DOTALL)
    if fence_m:
        cleaned = fence_m.group(1).strip()

    # Try direct parse first
    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        pass

    # Extract outermost JSON object or array by counting brackets
    for open_char, close_char in (("{", "}"), ("[", "]")):
        start = cleaned.find(open_char)
        if start < 0:
            continue
        depth = 0
        for i in range(start, len(cleaned)):
            if cleaned[i] == open_char:
                depth += 1
            elif cleaned[i] == close_char:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(cleaned[start:i + 1])
                    except (json.JSONDecodeError, TypeError):
                        break
    return None
