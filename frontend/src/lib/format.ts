import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return '-'
  const safe = Math.max(0, Math.round(seconds))
  const mins = Math.floor(safe / 60)
  const hours = Math.floor(mins / 60)
  const restMins = mins % 60
  if (hours <= 0) return `${restMins}m`
  return `${hours}h ${restMins}m`
}

export function formatDateTime(raw: string | null | undefined): string {
  if (!raw) return '-'
  const dt = dayjs(raw)
  if (!dt.isValid()) return '-'
  const now = dayjs()
  if (dt.isSame(now, 'day')) return dt.format('HH:mm')
  if (dt.isSame(now, 'year')) return dt.format('MM月DD日 HH:mm')
  return dt.format('YYYY年MM月DD日 HH:mm')
}

export function formatLocalDateTime(raw: string | null | undefined): string {
  if (!raw) return '-'
  const dt = dayjs(raw)
  if (!dt.isValid()) return '-'
  return dt.format('YYYY-MM-DD HH:mm')
}

export function formatDate(raw: string | null | undefined): string {
  if (!raw) return '-'
  const dt = dayjs(raw)
  if (!dt.isValid()) return '-'
  return dt.format('YYYY年MM月DD日')
}

export function formatRelative(raw: string | null | undefined): string {
  if (!raw) return '-'
  const dt = dayjs(raw)
  if (!dt.isValid()) return '-'
  return dt.fromNow()
}

export function fallbackText<T>(value: T | null | undefined, fallback = '-'): T | string {
  if (value == null || value === '') return fallback
  return value
}

export function clampText(value: string, max = 24): string {
  if (!value) return '-'
  if (value.length <= max) return value
  return `${value.slice(0, max)}...`
}

export function toInputDateTime(date: Date): string {
  const yyyy = date.getFullYear()
  const MM = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const mm = `${date.getMinutes()}`.padStart(2, '0')
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`
}

export function todayDateString(): string {
  return dayjs().format('YYYY-MM-DD')
}
