import type { AiSummaryPayload } from '@/api/types'

export type AiSummaryHistoryItem = {
  id: string
  saved_at: string
  summary: AiSummaryPayload
}

const STORAGE_KEY = 'edp.ai.summary.history.v1'
const MAX_HISTORY = 30

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

function normalizeHistory(raw: unknown): AiSummaryHistoryItem[] {
  if (!Array.isArray(raw)) return []
  const result: AiSummaryHistoryItem[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string') continue
    if (typeof record.saved_at !== 'string') continue
    if (!record.summary || typeof record.summary !== 'object') continue
    result.push({
      id: record.id,
      saved_at: record.saved_at,
      summary: record.summary as AiSummaryPayload
    })
  }
  return result
}

export function listAiSummaryHistory(): AiSummaryHistoryItem[] {
  if (!canUseStorage()) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return normalizeHistory(JSON.parse(raw))
  } catch {
    return []
  }
}

function persistHistory(items: AiSummaryHistoryItem[]): void {
  if (!canUseStorage()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function saveAiSummaryHistory(summary: AiSummaryPayload): AiSummaryHistoryItem[] {
  const nowIso = new Date().toISOString()
  const entry: AiSummaryHistoryItem = {
    id: `${summary.task_id}-${summary.attr_id}-${summary.generated_at}`,
    saved_at: nowIso,
    summary
  }
  const existing = listAiSummaryHistory().filter((item) => item.id !== entry.id)
  const next = [entry, ...existing].slice(0, MAX_HISTORY)
  persistHistory(next)
  return next
}

export function clearAiSummaryHistory(): void {
  if (!canUseStorage()) return
  window.localStorage.removeItem(STORAGE_KEY)
}
