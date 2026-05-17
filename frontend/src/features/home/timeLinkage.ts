import { parseScheduleConfig } from '../../../../packages/core/src/schedule'

export type TimeLinkageStatus = 'neutral' | 'ahead' | 'behind'

export type TimeLinkageMeta = {
  startDate: string
  endDate: string
  timePercent: number
  progressPercent: number | null
  status: TimeLinkageStatus
  labelText: string
}

export type TimeLinkageLabelMeta = {
  startDate: string | null
  endDate: string | null
  labelText: string
}

export type TimeLinkageSource = {
  period_start: string | null
  period_end: string | null
  calc_config: string
}

function pad2(value: number): string {
  return `${value}`.padStart(2, '0')
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function normalizeDateKey(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!isValidDateParts(year, month, day)) return null
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function dateKeyToUtcMs(dateKey: string): number | null {
  const normalized = normalizeDateKey(dateKey)
  if (!normalized) return null
  const [year, month, day] = normalized.split('-').map((part) => Number(part))
  return Date.UTC(year, month - 1, day)
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function formatDateLabel(dateKey: string): string {
  return dateKey.replace(/-/g, '/')
}

function formatDateLabelOptional(dateKey: string | null): string {
  return dateKey ? formatDateLabel(dateKey) : '—'
}

export function getSystemTodayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

export function resolveTimeLinkageStatus(progressPercent: number | null, timePercent: number): TimeLinkageStatus {
  if (progressPercent == null || !Number.isFinite(progressPercent)) return 'neutral'
  if (progressPercent > timePercent) return 'ahead'
  if (progressPercent < timePercent - 15) return 'behind'
  return 'neutral'
}

export function deriveTimeLinkageLabelMeta(source: TimeLinkageSource): TimeLinkageLabelMeta | null {
  const schedule = parseScheduleConfig(source.calc_config)
  const startDate = normalizeDateKey(source.period_start) ?? normalizeDateKey(schedule.period_start)
  const endDate = normalizeDateKey(source.period_end) ?? normalizeDateKey(schedule.period_end)
  if (!startDate && !endDate) return null
  return {
    startDate,
    endDate,
    labelText: `${formatDateLabelOptional(startDate)} - ${formatDateLabelOptional(endDate)}`
  }
}

export function deriveTimeLinkageMeta(
  source: TimeLinkageSource,
  progressPercent: number | null,
  todayDateKey: string
): TimeLinkageMeta | null {
  const labelMeta = deriveTimeLinkageLabelMeta(source)
  if (!labelMeta?.startDate || !labelMeta?.endDate) return null
  const startDate = labelMeta.startDate
  const endDate = labelMeta.endDate

  const startMs = dateKeyToUtcMs(startDate)
  const endMs = dateKeyToUtcMs(endDate)
  const todayMs = dateKeyToUtcMs(todayDateKey)
  if (startMs == null || endMs == null || todayMs == null) return null
  if (endMs < startMs) return null

  const timePercent =
    endMs === startMs
      ? 100
      : clampPercent(((todayMs - startMs) / (endMs - startMs)) * 100)

  const normalizedProgress =
    progressPercent != null && Number.isFinite(progressPercent)
      ? Number(progressPercent)
      : null

  return {
    startDate,
    endDate,
    timePercent,
    progressPercent: normalizedProgress,
    status: resolveTimeLinkageStatus(normalizedProgress, timePercent),
    labelText: labelMeta.labelText
  }
}
