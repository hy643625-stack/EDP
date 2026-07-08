import type { AiSummaryPayload } from '@/api/types'
import { formatLocalDateTime } from '@/lib/format'

const AI_PROVIDER_LABELS: Record<string, string> = {
  openai_compatible: 'OpenAI Compatible',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  qwen: '通义千问 Qwen',
  glm: '智谱 GLM',
  kimi: 'Moonshot Kimi',
  ollama: 'Ollama 本地模型',
  lmstudio: 'LM Studio 本地模型',
  custom_api: '自定义 API'
}

export function getAiProviderLabel(providerId: string | null | undefined): string {
  if (!providerId) return '未指定'
  return AI_PROVIDER_LABELS[providerId] ?? providerId
}

export function buildAiSummaryClipboardText(summary: AiSummaryPayload): string {
  const modeLabel = summary.mode_used === 'model' ? 'AI 模型已生效' : '已降级为本地规则'
  const providerLabel = getAiProviderLabel(summary.provider_id)
  const lines = [
    'AI 复盘总结',
    `任务：${summary.task_name}`,
    `属性：${summary.attr_name}`,
    `状态：${modeLabel}`,
    `服务商：${providerLabel}`,
    `生成时间：${formatLocalDateTime(summary.generated_at)}`,
    '',
    `概览：${summary.sections.overview}`,
    '',
    summary.summary_text,
    '',
    '关键信号：',
    ...summary.sections.signals.map((item) => `- ${item}`),
    '',
    '下一步建议：',
    ...summary.sections.actions.map((item) => `- ${item}`)
  ]

  if (summary.fallback_reason) {
    lines.push('', `降级说明：${summary.fallback_reason}`)
  }
  if (summary.runtime_message) {
    lines.push('', `运行状态：${summary.runtime_message}`)
  }
  if (summary.confirmation_required) {
    lines.push('', '提示：所有 AI 建议都需要人工确认后，才会进入真实数据或配置修改')
  }

  return lines.join('\n')
}

export function buildAiSummaryMarkdown(summary: AiSummaryPayload): string {
  const modeLabel = summary.mode_used === 'model' ? 'AI 模型已生效' : '已降级为本地规则'
  const providerLabel = getAiProviderLabel(summary.provider_id)
  const lines = [
    '# AI 复盘总结',
    '',
    `- 任务：${summary.task_name}`,
    `- 属性：${summary.attr_name}`,
    `- 状态：${modeLabel}`,
    `- 服务商：${providerLabel}`,
    `- 生成时间：${formatLocalDateTime(summary.generated_at)}`,
    '',
    '## 概览',
    '',
    summary.sections.overview,
    '',
    '## 总结正文',
    '',
    summary.summary_text,
    '',
    '## 关键信号',
    '',
    ...summary.sections.signals.map((item) => `- ${item}`),
    '',
    '## 下一步建议',
    '',
    ...summary.sections.actions.map((item) => `- ${item}`)
  ]

  if (summary.fallback_reason) {
    lines.push('', '## 降级说明', '', summary.fallback_reason)
  }
  if (summary.runtime_message) {
    lines.push('', '## 运行状态', '', summary.runtime_message)
  }
  if (summary.confirmation_required) {
    lines.push('', '## 提示', '', '所有 AI 建议都需要人工确认后，才会进入真实数据或配置修改')
  }

  return lines.join('\n')
}

function slugifySegment(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 40)
}

export function buildAiSummaryMarkdownFilename(summary: AiSummaryPayload): string {
  const taskName = slugifySegment(summary.task_name || 'task')
  const attrName = slugifySegment(summary.attr_name || 'attr')
  const timePart = formatLocalDateTime(summary.generated_at).replace(/[: ]/g, '-')
  return `AI复盘-${taskName}-${attrName}-${timePart}.md`
}

export function downloadTextFile(content: string, filename: string, mimeType = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType })
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.URL.revokeObjectURL(url)
}
