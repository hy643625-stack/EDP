import type { DailyRecord, TaskAttrRelation } from './types'

export type AttributeScheduleType = 'daily' | 'specific_days' | 'shared_days'

export type AttributeScheduleConfig = {
  type: AttributeScheduleType
  active_weekdays: number[]
  shared_weekday_groups: number[][]
  period_start: string | null
  period_end: string | null
  target_overrides: Record<string, number>
}

export type TaskAttrProgressSnapshot = {
  value: number
  targetValue: number | null
  ratio: number | null
  isSharedGroup: boolean
  sharedWeekdays: number[]
}

export function hasEffectiveTarget(attr: TaskAttrRelation, dateKey: string): boolean {
  const progress = computeTaskAttrProgressForDate(attr, [], dateKey)
  return progress.targetValue != null && progress.targetValue > 0
}

const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

function pad2(value: number): string {
  return `${value}`.padStart(2, '0')
}

function parseDateOnly(input: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

function formatDateOnlyUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

function addDaysUtc(date: Date, days: number): Date {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function normalizeWeekdays(input: unknown): number[] {
  if (!Array.isArray(input)) return []
  const unique = new Set<number>()
  for (const item of input) {
    const day = Number(item)
    if (!Number.isFinite(day)) continue
    const normalized = Math.floor(day)
    if (normalized < 1 || normalized > 7) continue
    unique.add(normalized)
  }
  return Array.from(unique).sort((a, b) => a - b)
}

function normalizeSharedGroups(input: unknown, activeWeekdays: number[]): number[][] {
  if (!Array.isArray(input)) return []
  const activeSet = new Set(activeWeekdays)
  const groups = new Map<string, number[]>()
  for (const item of input) {
    const normalized = normalizeWeekdays(item).filter((weekday) => activeSet.has(weekday))
    if (normalized.length < 2) continue
    const key = formatWeekdayGroupKey(normalized)
    groups.set(key, normalized)
  }
  return Array.from(groups.values())
}

function normalizeDateString(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (!value) return null
  const parsed = parseDateOnly(value)
  if (!parsed) return null
  return formatDateOnlyUtc(parsed)
}

function normalizeOverrides(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const entries = Object.entries(input as Record<string, unknown>)
  const result: Record<string, number> = {}
  for (const [key, value] of entries) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) continue
    result[key] = numeric
  }
  return result
}

function parseScheduleRaw(calcConfigRaw: string | null | undefined): unknown {
  if (!calcConfigRaw) return {}
  try {
    return JSON.parse(calcConfigRaw)
  } catch {
    return {}
  }
}

function compareDateOnly(a: string, b: string): number {
  const left = parseDateOnly(a)
  const right = parseDateOnly(b)
  if (!left || !right) return 0
  if (left.getTime() === right.getTime()) return 0
  return left.getTime() > right.getTime() ? 1 : -1
}

export function formatWeekdayGroupKey(weekdays: number[]): string {
  const normalized = normalizeWeekdays(weekdays)
  return normalized.join(',')
}

export function parseWeekdayGroupKey(key: string): number[] {
  return normalizeWeekdays(key.split(',').map((item) => Number(item)))
}

export function toIsoWeekday(dateLike: string): number {
  const onlyDate = parseDateOnly(dateLike)
  if (onlyDate) {
    const day = onlyDate.getUTCDay()
    return day === 0 ? 7 : day
  }
  const date = new Date(dateLike)
  if (Number.isNaN(date.getTime())) return 1
  const day = date.getDay()
  return day === 0 ? 7 : day
}

export function getDefaultScheduleConfig(): AttributeScheduleConfig {
  return {
    type: 'daily',
    active_weekdays: [...DEFAULT_WEEKDAYS],
    shared_weekday_groups: [],
    period_start: null,
    period_end: null,
    target_overrides: {}
  }
}

export function parseScheduleConfig(calcConfigRaw: string | null | undefined): AttributeScheduleConfig {
  const parsed = parseScheduleRaw(calcConfigRaw)
  const source =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'schedule_config' in parsed
      ? (parsed as Record<string, unknown>).schedule_config
      : parsed

  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return getDefaultScheduleConfig()
  }

  const raw = source as Record<string, unknown>
  const type: AttributeScheduleType =
    raw.type === 'specific_days' || raw.type === 'shared_days' ? raw.type : 'daily'

  const requestedWeekdays = normalizeWeekdays(raw.active_weekdays)
  const activeWeekdays =
    type === 'daily'
      ? [...DEFAULT_WEEKDAYS]
      : requestedWeekdays.length > 0
        ? requestedWeekdays
        : [...DEFAULT_WEEKDAYS]

  const sharedGroups =
    type === 'shared_days'
      ? normalizeSharedGroups(raw.shared_weekday_groups, activeWeekdays)
      : []

  return {
    type,
    active_weekdays: activeWeekdays,
    shared_weekday_groups: sharedGroups,
    period_start: normalizeDateString(raw.period_start),
    period_end: normalizeDateString(raw.period_end),
    target_overrides: normalizeOverrides(raw.target_overrides)
  }
}

export function stringifyScheduleConfig(scheduleConfig: AttributeScheduleConfig): string {
  const normalizedActiveWeekdays =
    scheduleConfig.type === 'daily'
      ? [...DEFAULT_WEEKDAYS]
      : normalizeWeekdays(scheduleConfig.active_weekdays)
  const normalized: AttributeScheduleConfig = {
    type: scheduleConfig.type === 'specific_days' || scheduleConfig.type === 'shared_days' ? scheduleConfig.type : 'daily',
    active_weekdays: normalizedActiveWeekdays,
    shared_weekday_groups:
      scheduleConfig.type === 'shared_days'
        ? normalizeSharedGroups(scheduleConfig.shared_weekday_groups, normalizedActiveWeekdays)
        : [],
    period_start: normalizeDateString(scheduleConfig.period_start),
    period_end: normalizeDateString(scheduleConfig.period_end),
    target_overrides: normalizeOverrides(scheduleConfig.target_overrides)
  }
  return JSON.stringify({ schedule_config: normalized })
}

export function isTaskAttrActiveOnDate(attr: TaskAttrRelation, dateKey: string): boolean {
  const config = parseScheduleConfig(attr.calc_config)
  const date = normalizeDateString(dateKey)
  if (!date) return true
  if (config.period_start && compareDateOnly(date, config.period_start) < 0) return false
  if (config.period_end && compareDateOnly(date, config.period_end) > 0) return false

  if (config.type === 'daily') return true
  const weekday = toIsoWeekday(date)
  return config.active_weekdays.includes(weekday)
}

function getOverrideTargetValue(
  baseTarget: number | null,
  overrides: Record<string, number>,
  weekday: number,
  sharedWeekdays: number[]
): number | null {
  if (sharedWeekdays.length > 1) {
    const sharedKey = formatWeekdayGroupKey(sharedWeekdays)
    if (overrides[sharedKey] != null) return overrides[sharedKey]
  }
  const dayKey = String(weekday)
  if (overrides[dayKey] != null) return overrides[dayKey]
  if (overrides.daily != null) return overrides.daily
  return baseTarget
}

function sumAttrRecordsByDate(records: DailyRecord[], taskId: number, attrId: number): Map<string, number> {
  const byDate = new Map<string, number>()
  for (const item of records) {
    if (item.task_id !== taskId) continue
    if (item.attr_id !== attrId) continue
    byDate.set(item.record_date, (byDate.get(item.record_date) ?? 0) + item.data_value)
  }
  return byDate
}

function getSharedWeekDates(dateKey: string, sharedWeekdays: number[]): string[] {
  const date = parseDateOnly(dateKey)
  if (!date) return []
  const day = date.getUTCDay()
  const isoWeekday = day === 0 ? 7 : day
  const monday = addDaysUtc(date, -(isoWeekday - 1))
  return sharedWeekdays.map((weekday) => formatDateOnlyUtc(addDaysUtc(monday, weekday - 1)))
}

export function computeTaskAttrProgressForDate(
  attr: TaskAttrRelation,
  records: DailyRecord[],
  dateKey: string
): TaskAttrProgressSnapshot {
  const normalizedDate = normalizeDateString(dateKey) ?? dateKey
  const schedule = parseScheduleConfig(attr.calc_config)
  const weekday = toIsoWeekday(normalizedDate)
  const baseTarget = attr.target_value > 0 ? attr.target_value : null
  const byDate = sumAttrRecordsByDate(records, attr.task_id, attr.attr_id)

  let value = byDate.get(normalizedDate) ?? 0
  let sharedWeekdays: number[] = []
  if (schedule.type === 'shared_days') {
    const matched = schedule.shared_weekday_groups.find((group) => group.includes(weekday))
    if (matched && matched.length > 1) {
      sharedWeekdays = matched
      const sharedDates = getSharedWeekDates(normalizedDate, matched)
      value = sharedDates.reduce((sum, key) => sum + (byDate.get(key) ?? 0), 0)
    }
  }

  const targetValue = getOverrideTargetValue(baseTarget, schedule.target_overrides, weekday, sharedWeekdays)
  const ratio = targetValue && targetValue > 0 ? Math.max(0, Math.min(100, (value / targetValue) * 100)) : null
  return {
    value,
    targetValue,
    ratio,
    isSharedGroup: sharedWeekdays.length > 1,
    sharedWeekdays
  }
}

export function calculateWeightedCompletionForDate(
  attrs: TaskAttrRelation[],
  records: DailyRecord[],
  dateKey: string
): number | null {
  const activeTargetAttrs: Array<{
    progress: TaskAttrProgressSnapshot
    weight: number
  }> = []

  for (const attr of attrs) {
    if (attr.attr_record !== 1) continue
    if (!isTaskAttrActiveOnDate(attr, dateKey)) continue

    const progress = computeTaskAttrProgressForDate(attr, records, dateKey)
    if (progress.targetValue == null || progress.targetValue <= 0) continue

    const weight = Number(attr.weight)
    if (!Number.isFinite(weight) || weight <= 0) continue

    activeTargetAttrs.push({
      progress,
      weight
    })
  }

  if (activeTargetAttrs.length === 0) return null

  const totalWeight = activeTargetAttrs.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight <= 0) return null

  let weighted = 0
  for (const item of activeTargetAttrs) {
    const progress = item.progress
    const ratio = progress.targetValue && progress.targetValue > 0
      ? Math.max(0, Math.min(1, progress.value / progress.targetValue))
      : 0
    weighted += ratio * item.weight
  }
  return (weighted / totalWeight) * 100
}
