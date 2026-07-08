from __future__ import annotations

import base64
import copy
import ctypes
import json
import os
import tempfile
from pathlib import Path
from typing import Any

import httpx

from app.errors import ApiError

AI_PRIVACY_NOTICE = (
    "启用云端 AI 后，任务内容可能会发送到所选 AI 服务商进行处理。"
    "若不希望上传数据，请选择关闭 AI 或使用本地模型。"
)

AI_MODE_OPTIONS: list[dict[str, str]] = [
    {"mode": "off", "label": "关闭 AI，仅使用本地规则算法", "description": "完全不调用外部模型服务。"},
    {"mode": "cloud", "label": "使用云端大模型 API", "description": "优先调用云端模型，失败时自动回退到本地规则算法。"},
    {"mode": "local", "label": "使用本地大模型服务", "description": "优先调用本地模型服务，失败时自动回退到本地规则算法。"},
    {"mode": "auto", "label": "自动模式", "description": "优先使用已配置 AI，失败或缺失配置时自动回退。"},
]

COMMON_AI_DEFAULTS: dict[str, Any] = {
    "base_url": "",
    "model_name": "",
    "temperature": 0.2,
    "max_tokens": 1200,
    "stream": False,
    "timeout_seconds": 30,
}


def _field(
    key: str,
    label: str,
    input_type: str,
    placeholder: str = "",
    help_text: str = "",
    required: bool = False,
    secret: bool = False,
    min_value: float | None = None,
    max_value: float | None = None,
    step: float | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "key": key,
        "label": label,
        "input_type": input_type,
        "placeholder": placeholder,
        "help_text": help_text,
        "required": required,
    }
    if secret:
        item["secret"] = True
    if min_value is not None:
        item["min_value"] = min_value
    if max_value is not None:
        item["max_value"] = max_value
    if step is not None:
        item["step"] = step
    return item


COMMON_AI_FIELDS: list[dict[str, Any]] = [
    _field("temperature", "Temperature", "number", "0.2", "控制输出随机性，建议 0 到 2。", min_value=0, max_value=2, step=0.1),
    _field("max_tokens", "Max Tokens", "number", "1200", "控制单次输出上限。", min_value=1, max_value=32000, step=1),
    _field("stream", "启用流式输出", "toggle", help_text="开启后可逐步接收模型输出。"),
    _field("timeout_seconds", "请求超时时间（秒）", "number", "30", "超时或失败时会自动降级到本地规则算法。", min_value=5, max_value=600, step=1),
]


def _cloud_provider(provider_id: str, label: str, description: str, base_url: str, model_placeholder: str) -> dict[str, Any]:
    return {
        "provider_id": provider_id,
        "label": label,
        "deployment": "cloud",
        "transport": "openai_compatible",
        "description": description,
        "defaults": {**COMMON_AI_DEFAULTS, "base_url": base_url},
        "fields": [
            _field("api_key", "API Key", "password", "留空则保留当前已保存的 API Key", "仅在当前设备加密保存，不会回显原值。", secret=True),
            _field("base_url", "API Base URL", "url", base_url or "例如 https://your-endpoint.example/v1", "请输入接口基础地址。", required=True),
            _field("model_name", "模型名称", "text", model_placeholder, "用于 AI 分析与建议的模型名称。", required=True),
        ],
    }


def _local_provider(provider_id: str, label: str, description: str, base_url: str, model_placeholder: str, transport: str) -> dict[str, Any]:
    return {
        "provider_id": provider_id,
        "label": label,
        "deployment": "local",
        "transport": transport,
        "description": description,
        "defaults": {**COMMON_AI_DEFAULTS, "base_url": base_url},
        "fields": [
            _field("base_url", "本地服务地址", "url", base_url, "请输入本地模型服务地址。", required=True),
            _field("model_name", "模型名称", "text", model_placeholder, "请输入本地已安装或已加载的模型名称。", required=True),
        ],
    }


AI_PROVIDERS: list[dict[str, Any]] = [
    _cloud_provider("openai_compatible", "OpenAI Compatible", "兼容 OpenAI 风格接口的云端服务。", "", "例如 gpt-4.1-mini"),
    _cloud_provider("openai", "OpenAI", "OpenAI 官方云端 API。", "https://api.openai.com/v1", "例如 gpt-4.1-mini"),
    _cloud_provider("deepseek", "DeepSeek", "DeepSeek 云端 API。", "https://api.deepseek.com/v1", "例如 deepseek-chat"),
    _cloud_provider("qwen", "通义千问 Qwen", "通义千问兼容接口。", "https://dashscope.aliyuncs.com/compatible-mode/v1", "例如 qwen-max"),
    _cloud_provider("glm", "智谱 GLM", "智谱开放平台兼容接口。", "https://open.bigmodel.cn/api/paas/v4", "例如 glm-4-plus"),
    _cloud_provider("kimi", "Moonshot Kimi", "Moonshot Kimi 兼容接口。", "https://api.moonshot.cn/v1", "例如 moonshot-v1-8k"),
    _local_provider("ollama", "Ollama 本地模型", "通过本地 Ollama 服务调用模型。", "http://127.0.0.1:11434", "例如 qwen2.5:7b", "ollama"),
    _local_provider("lmstudio", "LM Studio 本地模型", "通过 LM Studio 本地兼容接口调用模型。", "http://127.0.0.1:1234/v1", "例如 local-model", "openai_compatible"),
    _cloud_provider("custom_api", "自定义 API", "用户自定义的云端模型接口。", "", "例如 your-model"),
]

PROVIDER_INDEX = {item["provider_id"]: item for item in AI_PROVIDERS}
VALID_AI_MODES = {item["mode"] for item in AI_MODE_OPTIONS}
LOCAL_PROVIDER_IDS = {item["provider_id"] for item in AI_PROVIDERS if item["deployment"] == "local"}


class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint), ("pbData", ctypes.POINTER(ctypes.c_byte))]


class AiSettingsService:
    def __init__(self, config_path: Path) -> None:
        self.config_path = Path(config_path)

    def get_execution_plan(self) -> dict[str, Any]:
        payload = self.get_settings_payload()
        runtime = payload["effective_runtime"]
        return {
            "mode": payload["mode"],
            "provider_id": payload["provider_id"],
            "uses_local_rules": runtime["uses_local_rules"],
            "fallback_enabled": runtime["fallback_enabled"],
            "runtime_status": runtime["status"],
            "runtime_message": runtime["message"],
            "confirmation_required": payload["confirmation_required"],
        }

    def get_runtime_provider_config(self) -> dict[str, Any] | None:
        document = self._load_document()
        mode = str(document.get("mode") or "off").strip().lower()
        provider_id = document.get("provider_id")
        if mode == "off" or provider_id not in PROVIDER_INDEX:
            return None

        stored = document["provider_configs"].get(provider_id, {})
        readiness = self._evaluate_provider_readiness(provider_id, stored)
        if not readiness["ready"]:
            return None

        provider = PROVIDER_INDEX[provider_id]
        merged = self._build_provider_view(provider_id, stored)
        runtime: dict[str, Any] = {
            "provider_id": provider_id,
            "mode": mode,
            "deployment": provider["deployment"],
            "transport": provider["transport"],
            "label": provider["label"],
            "base_url": merged["base_url"],
            "model_name": merged["model_name"],
            "temperature": merged["temperature"],
            "max_tokens": merged["max_tokens"],
            "stream": merged["stream"],
            "timeout_seconds": merged["timeout_seconds"],
        }
        api_key = self._decrypt_secret(stored.get("api_key_secret"))
        if api_key:
            runtime["api_key"] = api_key
        return runtime

    def get_settings_payload(self) -> dict[str, Any]:
        document = self._load_document()
        selected_provider_id = document.get("provider_id")
        if selected_provider_id not in PROVIDER_INDEX:
            selected_provider_id = "openai_compatible"

        provider_configs = {
            provider["provider_id"]: self._build_provider_view(
                provider["provider_id"],
                document["provider_configs"].get(provider["provider_id"], {}),
            )
            for provider in AI_PROVIDERS
        }

        return {
            "mode_options": copy.deepcopy(AI_MODE_OPTIONS),
            "mode": document["mode"],
            "provider_id": selected_provider_id,
            "providers": self._build_provider_catalog(),
            "provider_configs": provider_configs,
            "rules_enabled": True,
            "confirmation_required": True,
            "privacy_notice": AI_PRIVACY_NOTICE,
            "effective_runtime": self._build_runtime_state(document["mode"], selected_provider_id, document["provider_configs"]),
        }

    def update_settings(
        self,
        mode: str,
        provider_id: str | None,
        provider_configs: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        normalized_mode = mode.strip().lower()
        if normalized_mode not in VALID_AI_MODES:
            raise ApiError("BAD_REQUEST", "不支持的 AI 模式", 422)

        selected_provider_id = provider_id.strip() if isinstance(provider_id, str) and provider_id.strip() else None
        self._validate_mode_provider(normalized_mode, selected_provider_id)

        document = self._load_document()
        document["mode"] = normalized_mode
        document["provider_id"] = selected_provider_id or document.get("provider_id") or "openai_compatible"

        for current_provider_id, patch in provider_configs.items():
            if current_provider_id not in PROVIDER_INDEX:
                raise ApiError("BAD_REQUEST", f"未知的 AI 服务商：{current_provider_id}", 422)
            existing = document["provider_configs"].get(current_provider_id, {})
            document["provider_configs"][current_provider_id] = self._merge_provider_config(
                current_provider_id,
                existing,
                patch,
            )

        self._write_document(document)
        return self.get_settings_payload()

    def test_connection(
        self,
        mode: str,
        provider_id: str | None,
        config_patch: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_mode = mode.strip().lower()
        selected_provider_id = provider_id.strip() if isinstance(provider_id, str) and provider_id.strip() else None

        if normalized_mode == "off":
            return {
                "ok": True,
                "message": "当前已关闭 AI，系统将仅使用本地规则算法，无需测试模型连接",
                "degraded_to_rules": True,
            }

        self._validate_mode_provider(normalized_mode, selected_provider_id)
        if selected_provider_id is None:
            return {"ok": False, "message": "请先选择 AI 服务商", "degraded_to_rules": True}

        stored = self._load_document()["provider_configs"].get(selected_provider_id, {})
        candidate = self._merge_provider_config(selected_provider_id, stored, config_patch)
        readiness = self._evaluate_provider_readiness(selected_provider_id, candidate)
        if not readiness["ready"]:
            return {"ok": False, "message": readiness["message"], "degraded_to_rules": True}

        try:
            result = self._run_connection_test(selected_provider_id, candidate)
            return {
                "ok": result["ok"],
                "message": result["message"],
                "degraded_to_rules": not result["ok"],
            }
        except Exception as exc:
            return {
                "ok": False,
                "message": f"连接测试失败：{self._format_http_error(exc)}，系统将自动回退到本地规则算法",
                "degraded_to_rules": True,
            }

    def _build_provider_catalog(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for provider in AI_PROVIDERS:
            items.append(
                {
                    "provider_id": provider["provider_id"],
                    "label": provider["label"],
                    "deployment": provider["deployment"],
                    "transport": provider["transport"],
                    "description": provider["description"],
                    "fields": copy.deepcopy(provider["fields"]) + copy.deepcopy(COMMON_AI_FIELDS),
                }
            )
        return items

    def _load_document(self) -> dict[str, Any]:
        default_document = {
            "schema_version": 1,
            "mode": "off",
            "provider_id": "openai_compatible",
            "provider_configs": {},
        }
        if not self.config_path.exists():
            return default_document
        try:
            raw = json.loads(self.config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return default_document
        if not isinstance(raw, dict):
            return default_document
        provider_configs = raw.get("provider_configs")
        if not isinstance(provider_configs, dict):
            provider_configs = {}
        return {
            "schema_version": 1,
            "mode": raw.get("mode", "off"),
            "provider_id": raw.get("provider_id", "openai_compatible"),
            "provider_configs": provider_configs,
        }

    def _write_document(self, document: dict[str, Any]) -> None:
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=self.config_path.parent, suffix=".tmp") as handle:
            json.dump(document, handle, ensure_ascii=False, indent=2)
            temp_path = Path(handle.name)
        temp_path.replace(self.config_path)

    def _merge_provider_config(
        self,
        provider_id: str,
        existing: dict[str, Any],
        patch: dict[str, Any],
    ) -> dict[str, Any]:
        provider = PROVIDER_INDEX[provider_id]
        defaults = provider["defaults"]
        result = {
            "base_url": self._coerce_string(patch.get("base_url"), existing.get("base_url", defaults.get("base_url", ""))),
            "model_name": self._coerce_string(patch.get("model_name"), existing.get("model_name", defaults.get("model_name", ""))),
            "temperature": self._coerce_float(patch.get("temperature"), existing.get("temperature", defaults.get("temperature", 0.2)), 0.2),
            "max_tokens": self._coerce_int(patch.get("max_tokens"), existing.get("max_tokens", defaults.get("max_tokens", 1200)), 1200),
            "stream": self._coerce_bool(patch.get("stream"), existing.get("stream", defaults.get("stream", False))),
            "timeout_seconds": self._coerce_int(
                patch.get("timeout_seconds"),
                existing.get("timeout_seconds", defaults.get("timeout_seconds", 30)),
                30,
            ),
        }
        result["temperature"] = max(0.0, min(2.0, result["temperature"]))
        result["max_tokens"] = max(1, min(32000, result["max_tokens"]))
        result["timeout_seconds"] = max(5, min(600, result["timeout_seconds"]))

        should_clear_key = bool(patch.get("clear_api_key"))
        api_key_input = patch.get("api_key_input")
        if should_clear_key:
            result["api_key_secret"] = None
        elif isinstance(api_key_input, str) and api_key_input.strip():
            result["api_key_secret"] = self._encrypt_secret(api_key_input.strip())
        else:
            result["api_key_secret"] = existing.get("api_key_secret")
        return result

    def _build_provider_view(self, provider_id: str, stored_config: dict[str, Any]) -> dict[str, Any]:
        provider = PROVIDER_INDEX[provider_id]
        defaults = provider["defaults"]
        secret = self._decrypt_secret(stored_config.get("api_key_secret"))
        return {
            "base_url": self._coerce_string(stored_config.get("base_url"), defaults.get("base_url", "")),
            "model_name": self._coerce_string(stored_config.get("model_name"), defaults.get("model_name", "")),
            "temperature": self._coerce_float(stored_config.get("temperature"), defaults.get("temperature", 0.2), 0.2),
            "max_tokens": self._coerce_int(stored_config.get("max_tokens"), defaults.get("max_tokens", 1200), 1200),
            "stream": self._coerce_bool(stored_config.get("stream"), defaults.get("stream", False)),
            "timeout_seconds": self._coerce_int(stored_config.get("timeout_seconds"), defaults.get("timeout_seconds", 30), 30),
            "api_key_configured": bool(secret),
            "api_key_masked": self._mask_secret(secret),
        }

    def _validate_mode_provider(self, mode: str, provider_id: str | None) -> None:
        if mode == "off":
            return
        if provider_id is None:
            raise ApiError("BAD_REQUEST", "请选择 AI 服务商", 422)
        provider = PROVIDER_INDEX.get(provider_id)
        if provider is None:
            raise ApiError("BAD_REQUEST", f"未知的 AI 服务商：{provider_id}", 422)
        if mode == "cloud" and provider["deployment"] == "local":
            raise ApiError("BAD_REQUEST", "当前模式需要选择云端 AI 服务商", 422)
        if mode == "local" and provider["deployment"] != "local":
            raise ApiError("BAD_REQUEST", "当前模式需要选择本地 AI 服务商", 422)

    def _build_runtime_state(
        self,
        mode: str,
        provider_id: str | None,
        provider_configs: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        if mode == "off":
            return {
                "uses_local_rules": True,
                "fallback_enabled": False,
                "status": "rules_only",
                "message": "当前已关闭 AI，系统将仅使用本地规则算法",
            }
        if provider_id is None or provider_id not in PROVIDER_INDEX:
            return {
                "uses_local_rules": True,
                "fallback_enabled": True,
                "status": "fallback",
                "message": "尚未选择有效 AI 服务商，系统将自动回退到本地规则算法",
            }

        readiness = self._evaluate_provider_readiness(provider_id, provider_configs.get(provider_id, {}))
        if not readiness["ready"]:
            return {
                "uses_local_rules": True,
                "fallback_enabled": True,
                "status": "fallback",
                "message": f"{readiness['message']} 系统将自动回退到本地规则算法",
            }

        if mode == "auto":
            message = "自动模式已就绪：优先使用所选 AI，失败时自动回退到本地规则算法"
        elif mode == "local":
            message = "本地模型模式已就绪：优先使用本地 AI，失败时自动回退到本地规则算法"
        else:
            message = "云端 AI 模式已就绪：优先使用云端 AI，失败时自动回退到本地规则算法"
        return {
            "uses_local_rules": False,
            "fallback_enabled": True,
            "status": "ready",
            "message": message,
        }

    def _evaluate_provider_readiness(self, provider_id: str, config: dict[str, Any]) -> dict[str, Any]:
        provider = PROVIDER_INDEX[provider_id]
        merged = self._build_provider_view(provider_id, config)
        if provider_id not in LOCAL_PROVIDER_IDS and not merged["api_key_configured"]:
            return {"ready": False, "message": f"{provider['label']} 尚未配置 API Key"}
        if not merged["base_url"].strip():
            field_label = "本地服务地址" if provider["deployment"] == "local" else "API Base URL"
            return {"ready": False, "message": f"{provider['label']} 尚未填写{field_label}"}
        if not merged["model_name"].strip():
            return {"ready": False, "message": f"{provider['label']} 尚未填写模型名称"}
        return {"ready": True, "message": ""}

    def _run_connection_test(self, provider_id: str, config: dict[str, Any]) -> dict[str, Any]:
        provider = PROVIDER_INDEX[provider_id]
        timeout = max(5, min(600, self._coerce_int(config.get("timeout_seconds"), 30, 30)))
        model_name = self._coerce_string(config.get("model_name"), "")
        base_url = self._coerce_string(config.get("base_url"), "")
        api_key = self._decrypt_secret(config.get("api_key_secret")) or self._coerce_string(config.get("api_key_input"), "")

        with httpx.Client(timeout=timeout) as client:
            if provider["transport"] == "ollama":
                response = client.get(self._join_url(base_url, "/api/tags"))
                response.raise_for_status()
                payload = response.json()
                models = [
                    str(item.get("name", "")).strip()
                    for item in payload.get("models", [])
                    if isinstance(item, dict)
                ]
                if model_name and not any(self._ollama_model_matches(model_name, candidate) for candidate in models):
                    return {"ok": False, "message": f"已连接到 Ollama，但未找到模型 {model_name}"}
                return {"ok": True, "message": "本地模型连接测试成功，Ollama 服务可用"}

            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            response = client.get(self._join_url(base_url, "/models"), headers=headers)
            response.raise_for_status()
            payload = response.json()
            models = [
                str(item.get("id", "")).strip()
                for item in payload.get("data", [])
                if isinstance(item, dict)
            ]
            if model_name and models and model_name not in models:
                return {"ok": False, "message": f"已连通 {provider['label']}，但未找到模型 {model_name}"}
            return {"ok": True, "message": f"{provider['label']} 连接测试成功"}

    def _encrypt_secret(self, secret: str) -> str:
        if not secret:
            return ""
        if os.name != "nt":
            return "plain:" + base64.b64encode(secret.encode("utf-8")).decode("ascii")

        source = secret.encode("utf-8")
        input_buffer = ctypes.create_string_buffer(source, len(source))
        input_blob = DATA_BLOB(len(source), ctypes.cast(input_buffer, ctypes.POINTER(ctypes.c_byte)))
        output_blob = DATA_BLOB()

        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        if not crypt32.CryptProtectData(ctypes.byref(input_blob), None, None, None, None, 0, ctypes.byref(output_blob)):
            raise OSError("无法加密 AI 配置密钥")
        try:
            encrypted = ctypes.string_at(output_blob.pbData, output_blob.cbData)
        finally:
            kernel32.LocalFree(output_blob.pbData)
        return "dpapi:" + base64.b64encode(encrypted).decode("ascii")

    def _decrypt_secret(self, stored_value: Any) -> str:
        if not isinstance(stored_value, str) or not stored_value:
            return ""
        if stored_value.startswith("plain:"):
            try:
                return base64.b64decode(stored_value[6:]).decode("utf-8")
            except Exception:
                return ""
        if not stored_value.startswith("dpapi:"):
            return ""
        try:
            encrypted = base64.b64decode(stored_value[6:])
        except Exception:
            return ""
        if os.name != "nt":
            return ""

        encrypted_buffer = ctypes.create_string_buffer(encrypted, len(encrypted))
        input_blob = DATA_BLOB(len(encrypted), ctypes.cast(encrypted_buffer, ctypes.POINTER(ctypes.c_byte)))
        output_blob = DATA_BLOB()

        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        if not crypt32.CryptUnprotectData(ctypes.byref(input_blob), None, None, None, None, 0, ctypes.byref(output_blob)):
            return ""
        try:
            raw = ctypes.string_at(output_blob.pbData, output_blob.cbData)
        finally:
            kernel32.LocalFree(output_blob.pbData)
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError:
            return ""

    def _mask_secret(self, secret: str) -> str | None:
        if not secret:
            return None
        if len(secret) <= 4:
            return "*" * len(secret)
        return f"{secret[:2]}{'*' * (len(secret) - 4)}{secret[-2:]}"

    @staticmethod
    def _join_url(base_url: str, suffix: str) -> str:
        return f"{base_url.rstrip('/')}{suffix}"

    @staticmethod
    def _ollama_model_matches(requested: str, candidate: str) -> bool:
        return candidate == requested or candidate.split(":", 1)[0] == requested

    @staticmethod
    def _coerce_string(value: Any, default: str = "") -> str:
        if isinstance(value, str):
            return value.strip()
        if value is None:
            return default
        return str(value).strip()

    @staticmethod
    def _coerce_bool(value: Any, default: bool = False) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return default
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @staticmethod
    def _coerce_int(value: Any, default: Any, fallback: int) -> int:
        candidate = value if value is not None else default
        try:
            return int(candidate)
        except (TypeError, ValueError):
            return fallback

    @staticmethod
    def _coerce_float(value: Any, default: Any, fallback: float) -> float:
        candidate = value if value is not None else default
        try:
            return float(candidate)
        except (TypeError, ValueError):
            return fallback

    @staticmethod
    def _format_http_error(exc: Exception) -> str:
        if isinstance(exc, httpx.TimeoutException):
            return "请求超时"
        if isinstance(exc, httpx.HTTPStatusError):
            status_code = exc.response.status_code
            if status_code in {401, 403}:
                return "认证失败，请检查 API Key 或接口权限"
            if status_code == 404:
                return "接口地址不存在，请检查 API Base URL"
            if status_code >= 500:
                return "服务商接口暂时不可用"
            return f"服务返回状态码 {status_code}"
        if isinstance(exc, httpx.RequestError):
            return "无法连接到目标服务，请检查网络或服务地址"
        message = str(exc).strip()
        return message or "未知错误"
