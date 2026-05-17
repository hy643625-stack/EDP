# AI 设置说明

## 目标

AI 助手在项目中被设计为：

- 可配置
- 可选择
- 可关闭
- 默认不依赖云端服务

即使用户完全不配置任何 AI 服务，系统也必须继续可用，并自动回退到本地规则算法。

## 当前实现

当前版本已经提供以下能力：

- AI 模式选择：`off / cloud / local / auto`
- 可扩展服务商目录，由后端统一下发，前端不把服务商逻辑写死在 UI 中
- 当前支持的服务商：
  - `openai_compatible`
  - `openai`
  - `deepseek`
  - `qwen`
  - `glm`
  - `kimi`
  - `ollama`
  - `lmstudio`
  - `custom_api`
- 根据服务商动态渲染配置项
- 本地保存 AI 设置
- API Key 本地加密保存
- 测试连接接口
- 配置缺失、请求失败、超时、返回异常时自动降级到本地规则算法

## 配置保存位置

默认文件位置：

- `%LOCALAPPDATA%\EveryDayPerfect\ai-settings.json`

如需覆盖路径，可设置环境变量：

- `AI_CONFIG_PATH`

## 安全策略

- API Key 不能硬编码
- API Key 不写入日志
- API Key 不在界面中明文回显
- Windows 环境下优先使用当前用户的 DPAPI 加密后再落盘
- 用户可以修改、清空、测试配置

## 默认行为

- 默认模式：`off`
- 默认启用本地规则算法
- 未配置 API Key 或模型名称时，不报致命错误，直接回退到本地规则算法
- AI 功能接入业务后，仍然必须经过用户确认后才允许写入数据库

## 当前已接入的 AI 业务接口

- `GET /v1/ai/settings`
- `PUT /v1/ai/settings`
- `POST /v1/ai/settings/test`
- `POST /v1/ai/summary`

其中：

- `POST /v1/ai/summary` 当前已经接入“本地规则复盘”
- 如果用户配置了云端或本地模型，但真实模型调用尚未接入，接口会自动降级到本地规则算法，并返回降级原因

## 验证方式

后端全量测试：

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q --basetemp _test_tmp\pytest-temp
```

AI 设置 smoke：

```powershell
.\.venv\Scripts\python.exe .\tools\ai_settings_smoke.py
```

AI 总结 smoke：

```powershell
.\.venv\Scripts\python.exe .\tools\ai_summary_smoke.py
```

## 前端入口

主界面头部包含：

- `AI 设置`

设置弹层当前包含：

- 模式切换
- 服务商选择
- 动态配置字段
- 隐私提示
- 测试连接
- 保存设置

## 后续接入建议

如果继续推进 AI 业务，建议按这个顺序走：

1. 先把 `POST /v1/ai/summary` 接上真实模型调用
2. 模型调用失败时保持自动降级到本地规则算法
3. 再把前端某个复盘页面接入第一版 AI 总结入口
4. 所有 AI 建议保持“只建议、不自动写库”

## 维护说明

后续如新增服务商，优先修改：

- `C:\Users\Lenovo\Desktop\EveryDayPerfect\01-source\EveryDayPerfect\backend\app\services\ai_settings_service.py`

前端会根据后端返回的字段自动渲染，尽量不要在 UI 里新增服务商分支硬编码。
