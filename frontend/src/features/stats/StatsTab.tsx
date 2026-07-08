import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Bot, Sparkles } from 'lucide-react'

import {
  buildAiSummaryClipboardText,
  buildAiSummaryMarkdown,
  buildAiSummaryMarkdownFilename,
  downloadTextFile,
  getAiProviderLabel
} from '@/lib/ai'
import { clearAiSummaryHistory, listAiSummaryHistory, saveAiSummaryHistory, type AiSummaryHistoryItem } from '@/lib/aiHistory'
import { formatDuration, formatLocalDateTime } from '@/lib/format'
import { mixThemeHex, normalizeThemeHex } from '@/lib/theme'
import { calculateWeightedCompletionForDate, computeTaskAttrProgressForDate, parseScheduleConfig } from '../../../../packages/core/src/schedule'
import type { DailyRecord, FocusSession, Task, TaskAttrRelation, TodoItem } from '../../../../packages/core/src/types'
import type { AiSummaryPayload } from '@/api/types'
import { Card, CardContent, CardHeader, CardTitle, SegmentedTabs, type SegmentedTabItem } from '../../../../packages/ui/src'

type PeriodMode = 'week' | 'month'
type FocusInsightMode = 'rhythm' | 'allocation'

type StatsTabProps = {
  todos: TodoItem[]
  focusSessions: FocusSession[]
  recentRecords: DailyRecord[]
  attrs: TaskAttrRelation[]
  tasks: Task[]
  scopeTaskId: number
  onScopeTaskIdChange: (taskId: number) => void
  isGlobalScope: boolean
  onLoadAiSummary: (taskId: number, attrId: number) => Promise<AiSummaryPayload>
}

type PeriodRow = {
  key: string
  label: string
  completedTodos: number
  focusSeconds: number
  checkInDays: number
  avgCompletion: number | null
}

type PeriodDay = {
  key: string
  axisLabel: string
  rowLabel: string
  tooltipLabel: string
}

type RhythmPoint = {
  rowIndex: number
  hour: number
  seconds: number
  rowLabel: string
  tooltipLabel: string
}

type AllocationStack = {
  taskKey: string
  taskName: string
  color: string
  seconds: number
}

type AllocationDay = {
  day: PeriodDay
  totalSeconds: number
  stacks: AllocationStack[]
}

type TooltipState = {
  x: number
  y: number
  title: string
  lines: string[]
}

const periodTabs: Array<SegmentedTabItem<PeriodMode>> = [
  { key: 'week', label: '按周' },
  { key: 'month', label: '按月' }
]

const focusInsightTabs: Array<SegmentedTabItem<FocusInsightMode>> = [
  { key: 'rhythm', label: '节律热力图' },
  { key: 'allocation', label: '时间分配图' }
]

const weekLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function startOfWeekMonday(input: dayjs.Dayjs): dayjs.Dayjs {
  const offset = (input.day() + 6) % 7
  return input.startOf('day').subtract(offset, 'day')
}

function formatHoursLabel(seconds: number): string {
  const hours = seconds / 3600
  const rounded = Math.round(hours * 10) / 10
  if (Number.isInteger(rounded)) return `${rounded}h`
  return `${rounded.toFixed(1)}h`
}

function formatMinutesLabel(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return `${minutes} 分钟`
}

function normalizeRecordDateKey(raw: string): string | null {
  const parsed = dayjs(raw)
  if (!parsed.isValid()) return null
  return parsed.format('YYYY-MM-DD')
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function heatCellFill(level: number | undefined, isFuture: boolean, baseColor: string): string {
  if (isFuture) return '#f1f5f9'
  if (level == null || level <= 0) return '#e2e8f0'
  const alpha = Math.max(0.2, Math.min(1, level))
  const lighten = Math.max(0.2, 0.82 - alpha * 0.58)
  return mixThemeHex(baseColor, '#ffffff', lighten)
}

function hasVariableTarget(attr: TaskAttrRelation): boolean {
  if (attr.target_value <= 0) return false
  const schedule = parseScheduleConfig(attr.calc_config)
  const targetSet = new Set<number>([Number(attr.target_value.toFixed(4))])
  for (const overrideValue of Object.values(schedule.target_overrides ?? {})) {
    if (!Number.isFinite(overrideValue) || overrideValue <= 0) continue
    targetSet.add(Number(overrideValue.toFixed(4)))
  }
  return targetSet.size > 1
}

export function StatsTab({
  todos,
  focusSessions,
  recentRecords,
  attrs,
  tasks,
  scopeTaskId,
  onScopeTaskIdChange,
  isGlobalScope,
  onLoadAiSummary
}: StatsTabProps) {
  const [periodMode, setPeriodMode] = useState<PeriodMode>('week')
  const [focusInsightMode, setFocusInsightMode] = useState<FocusInsightMode>('rhythm')
  const [selectedAiAttrId, setSelectedAiAttrId] = useState<number | null>(null)
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)
  const [aiSummaryError, setAiSummaryError] = useState('')
  const [aiSummary, setAiSummary] = useState<AiSummaryPayload | null>(null)
  const [aiCopied, setAiCopied] = useState(false)
  const [aiExported, setAiExported] = useState(false)
  const [aiHistory, setAiHistory] = useState<AiSummaryHistoryItem[]>([])
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const chartSurfaceRef = useRef<HTMLDivElement | null>(null)
  const statsThemeColor = useMemo(
    () => normalizeThemeHex(tasks.find((task) => task.task_id === scopeTaskId)?.task_color, '#22c55e'),
    [tasks, scopeTaskId]
  )

  const periodRows = useMemo(() => {
    const now = dayjs()
    const unit = periodMode === 'week' ? 'week' : 'month'
    const count = periodMode === 'week' ? 8 : 6

    const recordDates = new Set<string>()
    const checkInDates = new Set<string>()
    for (const item of recentRecords) {
      const dateKey = normalizeRecordDateKey(item.record_date)
      if (!dateKey) continue
      recordDates.add(dateKey)
      checkInDates.add(dateKey)
    }

    const dailyCompletionByDate = new Map<string, number>()
    for (const dateKey of recordDates.values()) {
      const completion = calculateWeightedCompletionForDate(attrs, recentRecords, dateKey)
      if (completion != null) {
        dailyCompletionByDate.set(dateKey, completion)
      }
    }

    const completedTodoDates = todos
      .filter((item) => item.completed)
      .map((item) => dayjs(item.completed_date || item.updated_at))
      .filter((item) => item.isValid())
    const sessionDates = focusSessions
      .map((item) => ({ at: dayjs(item.start_time), seconds: item.duration_seconds }))
      .filter((item) => item.at.isValid())

    const rows: PeriodRow[] = []
    for (let i = count - 1; i >= 0; i -= 1) {
      const start = now.subtract(i, unit).startOf(unit)
      const end = start.endOf(unit)
      const label =
        periodMode === 'week'
          ? `${start.format('MM-DD')} ~ ${end.format('MM-DD')}`
          : start.format('YYYY-MM')

      let completedTodos = 0
      for (const date of completedTodoDates) {
        if (date.isBefore(start) || date.isAfter(end)) continue
        completedTodos += 1
      }

      let focusSeconds = 0
      for (const session of sessionDates) {
        if (session.at.isBefore(start) || session.at.isAfter(end)) continue
        focusSeconds += session.seconds
      }

      let checkInDays = 0
      for (const dateKey of checkInDates) {
        const dt = dayjs(dateKey)
        if (!dt.isValid()) continue
        if (dt.isBefore(start) || dt.isAfter(end)) continue
        checkInDays += 1
      }

      const completionValues: number[] = []
      for (const [dateKey, completion] of dailyCompletionByDate.entries()) {
        const dt = dayjs(dateKey)
        if (!dt.isValid()) continue
        if (dt.isBefore(start) || dt.isAfter(end)) continue
        completionValues.push(completion)
      }
      const avgCompletion =
        completionValues.length > 0
          ? completionValues.reduce((sum, value) => sum + value, 0) / completionValues.length
          : null

      rows.push({
        key: start.format('YYYY-MM-DD'),
        label,
        completedTodos,
        focusSeconds,
        checkInDays,
        avgCompletion
      })
    }
    return rows
  }, [periodMode, attrs, recentRecords, todos, focusSessions])

  const periodFocusPeak = useMemo(() => {
    return periodRows.reduce((max, item) => Math.max(max, item.focusSeconds), 0)
  }, [periodRows])
  const periodTodoPeak = useMemo(() => {
    return periodRows.reduce((max, item) => Math.max(max, item.completedTodos), 0)
  }, [periodRows])
  const periodCheckInPeak = useMemo(() => {
    return periodRows.reduce((max, item) => Math.max(max, item.checkInDays), 0)
  }, [periodRows])
  const dynamicTargetAttrCount = useMemo(
    () => attrs.filter((item) => hasVariableTarget(item)).length,
    [attrs]
  )
  const archivedMilestones = useMemo(() => {
    return attrs
      .filter((item) => item.attr_sign === 2 && item.attr_record === 1)
      .map((attr) => {
        const schedule = parseScheduleConfig(attr.calc_config)
        const attrRecords = recentRecords.filter((item) => item.attr_id === attr.attr_id)
        const latestRecordDate =
          attrRecords.length > 0
            ? attrRecords
                .map((item) => item.record_date)
                .sort((a, b) => dayjs(a).valueOf() - dayjs(b).valueOf())
                [attrRecords.length - 1] ?? null
            : null
        const finalDate = schedule.period_end || latestRecordDate || null
        if (!finalDate) {
          return {
            attrId: attr.attr_id,
            name: attr.attr_name,
            periodLabel: `${schedule.period_start ?? '-'} ~ ${schedule.period_end ?? '-'}`,
            ratio: null as number | null,
            valueLabel: '-',
            endedAt: null as string | null
          }
        }
        const progress = computeTaskAttrProgressForDate(attr, recentRecords, finalDate)
        const ratio =
          progress.targetValue != null && progress.targetValue > 0
            ? clampPercent((progress.value / progress.targetValue) * 100)
            : null
        const valueLabel =
          progress.targetValue != null && progress.targetValue > 0
            ? `${progress.value}${attr.attr_unit || ''} / ${progress.targetValue}${attr.attr_unit || ''}`
            : `${progress.value}${attr.attr_unit || ''}`
        return {
          attrId: attr.attr_id,
          name: attr.attr_name,
          periodLabel: `${schedule.period_start ?? '-'} ~ ${schedule.period_end ?? '-'}`,
          ratio,
          valueLabel,
          endedAt: finalDate
        }
      })
      .sort((a, b) => {
        const left = a.endedAt ? dayjs(a.endedAt).valueOf() : 0
        const right = b.endedAt ? dayjs(b.endedAt).valueOf() : 0
        return right - left
      })
  }, [attrs, recentRecords])

  const currentPeriod = periodRows[periodRows.length - 1] ?? {
    key: 'current',
    label: '-',
    completedTodos: 0,
    focusSeconds: 0,
    checkInDays: 0,
    avgCompletion: null
  }
  const currentPrefix = periodMode === 'week' ? '本周' : '本月'

  const focusPeriod = useMemo(() => {
    const now = dayjs()
    if (periodMode === 'week') {
      const start = startOfWeekMonday(now)
      const endExclusive = start.add(7, 'day')
      const days: PeriodDay[] = Array.from({ length: 7 }, (_, index) => {
        const date = start.add(index, 'day')
        return {
          key: date.format('YYYY-MM-DD'),
          axisLabel: date.format('MM-DD'),
          rowLabel: weekLabels[index],
          tooltipLabel: `${weekLabels[index]} ${date.format('MM-DD')}`
        }
      })
      return { start, endExclusive, days }
    }

    const start = now.startOf('month')
    const endExclusive = start.add(1, 'month')
    const daysInMonth = start.daysInMonth()
    const days: PeriodDay[] = Array.from({ length: daysInMonth }, (_, index) => {
      const date = start.add(index, 'day')
      const dayOfWeek = weekLabels[(date.day() + 6) % 7]
      return {
        key: date.format('YYYY-MM-DD'),
        axisLabel: date.format('DD'),
        rowLabel: date.format('MM-DD'),
        tooltipLabel: `${date.format('MM-DD')} ${dayOfWeek}`
      }
    })
    return { start, endExclusive, days }
  }, [periodMode])

  const dayIndexByKey = useMemo(
    () =>
      new Map(
        focusPeriod.days.map((day, index) => [day.key, index])
      ),
    [focusPeriod.days]
  )

  const rhythmData = useMemo(() => {
    const bucket = new Map<string, number>()
    const startMs = focusPeriod.start.valueOf()
    const endMs = focusPeriod.endExclusive.valueOf()

    for (const session of focusSessions) {
      const start = dayjs(session.start_time)
      if (!start.isValid()) continue
      const end = start.add(Math.max(1, session.duration_seconds), 'second')
      const clippedStartMs = Math.max(start.valueOf(), startMs)
      const clippedEndMs = Math.min(end.valueOf(), endMs)
      if (clippedEndMs <= clippedStartMs) continue

      let cursorMs = clippedStartMs
      while (cursorMs < clippedEndMs) {
        const cursor = dayjs(cursorMs)
        const nextHourMs = cursor.startOf('hour').add(1, 'hour').valueOf()
        const segmentEndMs = Math.min(nextHourMs, clippedEndMs)
        const segmentSeconds = Math.max(1, Math.round((segmentEndMs - cursorMs) / 1000))
        const dayKey = cursor.format('YYYY-MM-DD')
        const rowIndex = dayIndexByKey.get(dayKey)
        if (rowIndex != null) {
          const hour = cursor.hour()
          const key = `${rowIndex}-${hour}`
          bucket.set(key, (bucket.get(key) ?? 0) + segmentSeconds)
        }
        cursorMs = segmentEndMs
      }
    }

    const points: RhythmPoint[] = []
    let maxSeconds = 0
    for (const [key, seconds] of bucket.entries()) {
      if (seconds <= 0) continue
      const [rowRaw, hourRaw] = key.split('-')
      const rowIndex = Number(rowRaw)
      const hour = Number(hourRaw)
      const dayMeta = focusPeriod.days[rowIndex]
      if (!dayMeta) continue
      points.push({
        rowIndex,
        hour,
        seconds,
        rowLabel: dayMeta.rowLabel,
        tooltipLabel: dayMeta.tooltipLabel
      })
      maxSeconds = Math.max(maxSeconds, seconds)
    }

    points.sort((a, b) => a.seconds - b.seconds)
    return {
      points,
      maxSeconds
    }
  }, [focusPeriod, dayIndexByKey, focusSessions])

  const allocationData = useMemo(() => {
    const dayTaskMap = new Map<string, Map<string, AllocationStack>>()
    const legendMap = new Map<string, AllocationStack>()

    const startMs = focusPeriod.start.valueOf()
    const endMs = focusPeriod.endExclusive.valueOf()
    for (const session of focusSessions) {
      const start = dayjs(session.start_time)
      if (!start.isValid()) continue
      const end = start.add(Math.max(1, session.duration_seconds), 'second')
      const clippedStartMs = Math.max(start.valueOf(), startMs)
      const clippedEndMs = Math.min(end.valueOf(), endMs)
      if (clippedEndMs <= clippedStartMs) continue

      const taskKey = String(session.task_id)
      const taskName = session.task_name || `Task #${session.task_id}`
      const taskColor = normalizeThemeHex(session.task_color, '#64748b')

      let cursorMs = clippedStartMs
      while (cursorMs < clippedEndMs) {
        const cursor = dayjs(cursorMs)
        const nextDayMs = cursor.startOf('day').add(1, 'day').valueOf()
        const segmentEndMs = Math.min(nextDayMs, clippedEndMs)
        const segmentSeconds = Math.max(1, Math.round((segmentEndMs - cursorMs) / 1000))
        const dayKey = cursor.format('YYYY-MM-DD')

        const dayStacks = dayTaskMap.get(dayKey) ?? new Map<string, AllocationStack>()
        const existing = dayStacks.get(taskKey) ?? {
          taskKey,
          taskName,
          color: taskColor,
          seconds: 0
        }
        existing.seconds += segmentSeconds
        dayStacks.set(taskKey, existing)
        dayTaskMap.set(dayKey, dayStacks)

        const legendExisting = legendMap.get(taskKey) ?? {
          taskKey,
          taskName,
          color: taskColor,
          seconds: 0
        }
        legendExisting.seconds += segmentSeconds
        legendMap.set(taskKey, legendExisting)

        cursorMs = segmentEndMs
      }
    }

    const legend = Array.from(legendMap.values()).sort((a, b) => b.seconds - a.seconds)
    const legendOrder = new Map(legend.map((item, index) => [item.taskKey, index]))

    const days: AllocationDay[] = focusPeriod.days.map((day) => {
      const stacks = Array.from(dayTaskMap.get(day.key)?.values() ?? []).sort((a, b) => {
        return (legendOrder.get(a.taskKey) ?? 999) - (legendOrder.get(b.taskKey) ?? 999)
      })
      const totalSeconds = stacks.reduce((sum, item) => sum + item.seconds, 0)
      return {
        day,
        totalSeconds,
        stacks
      }
    })

    return {
      days,
      legend
    }
  }, [focusPeriod, focusSessions])

  const allocationMaxSeconds = useMemo(() => {
    const peak = allocationData.days.reduce((max, day) => Math.max(max, day.totalSeconds), 0)
    if (peak <= 0) return 3600
    return Math.max(3600, Math.ceil(peak / 1800) * 1800)
  }, [allocationData.days])

  useEffect(() => {
    setTooltip(null)
  }, [periodMode, focusInsightMode])

  function hideTooltip() {
    setTooltip(null)
  }

  function showTooltip(event: MouseEvent<SVGElement>, title: string, lines: string[]) {
    const rect = chartSurfaceRef.current?.getBoundingClientRect()
    if (!rect) return
    const estimatedWidth = 230
    const estimatedHeight = 40 + lines.length * 18
    const rawX = event.clientX - rect.left + 12
    const rawY = event.clientY - rect.top + 12
    const x = Math.max(8, Math.min(rawX, rect.width - estimatedWidth - 8))
    const y = Math.max(8, Math.min(rawY, rect.height - estimatedHeight - 8))
    setTooltip({ x, y, title, lines })
  }

  const rhythmWidth = 1000
  const rhythmHeight = 320
  const rhythmPaddingLeft = periodMode === 'month' ? 70 : 58
  const rhythmPaddingRight = 16
  const rhythmPaddingTop = 16
  const rhythmPaddingBottom = 30
  const rhythmPlotWidth = rhythmWidth - rhythmPaddingLeft - rhythmPaddingRight
  const rhythmPlotHeight = rhythmHeight - rhythmPaddingTop - rhythmPaddingBottom
  const rhythmRowCount = Math.max(1, focusPeriod.days.length)
  const rhythmRowHeight = rhythmPlotHeight / rhythmRowCount
  const rhythmColumnWidth = rhythmPlotWidth / 24
  const rhythmRowLabelStep = rhythmRowCount <= 10 ? 1 : rhythmRowCount <= 20 ? 2 : 3

  const allocationWidth = 1000
  const allocationHeight = 320
  const allocationPaddingLeft = 56
  const allocationPaddingRight = 16
  const allocationPaddingTop = 16
  const allocationPaddingBottom = 44
  const allocationPlotWidth = allocationWidth - allocationPaddingLeft - allocationPaddingRight
  const allocationPlotHeight = allocationHeight - allocationPaddingTop - allocationPaddingBottom
  const allocationDayCount = Math.max(1, allocationData.days.length)
  const allocationBandWidth = allocationPlotWidth / allocationDayCount
  const allocationBarWidth = Math.min(24, Math.max(7, allocationBandWidth * 0.58))
  const allocationLabelStep = allocationData.days.length <= 10 ? 1 : allocationData.days.length <= 20 ? 2 : 3

  const checkInHeatmapCells = useMemo(() => {
    const levelByDate: Record<string, number> = {}
    const recordDates = new Set<string>()
    for (const record of recentRecords) {
      const dateKey = normalizeRecordDateKey(record.record_date)
      if (!dateKey) continue
      recordDates.add(dateKey)
    }
    for (const dateKey of recordDates.values()) {
      const completion = calculateWeightedCompletionForDate(attrs, recentRecords, dateKey)
      levelByDate[dateKey] = completion == null ? 0.2 : Math.max(0.2, Math.min(1, completion / 100))
    }

    const today = dayjs()
    const end = today.endOf('week')
    const start = end.subtract(52, 'week').startOf('week')
    const cells: Array<{
      x: number
      y: number
      dateKey: string
      level?: number
      isFuture: boolean
    }> = []

    for (let week = 0; week < 53; week += 1) {
      for (let day = 0; day < 7; day += 1) {
        const date = start.add(week * 7 + day, 'day')
        const dateKey = date.format('YYYY-MM-DD')
        const isFuture = date.isAfter(today, 'day')
        cells.push({
          x: week * 14,
          y: day * 14,
          dateKey,
          level: levelByDate[dateKey],
          isFuture
        })
      }
    }
    return cells
  }, [attrs, recentRecords])

  const checkInHeatmapActiveCount = useMemo(
    () => checkInHeatmapCells.reduce((sum, item) => sum + (item.level != null && item.level > 0 && !item.isFuture ? 1 : 0), 0),
    [checkInHeatmapCells]
  )

  const aiReviewAttrs = useMemo(
    () => attrs.filter((item) => item.attr_record === 1 && item.attr_sign !== 2),
    [attrs]
  )

  useEffect(() => {
    if (aiReviewAttrs.length === 0) {
      setSelectedAiAttrId(null)
      setAiSummary(null)
      setAiSummaryError('')
      return
    }
    setSelectedAiAttrId((current) => {
      if (current != null && aiReviewAttrs.some((item) => item.attr_id === current)) return current
      return aiReviewAttrs[0]?.attr_id ?? null
    })
  }, [aiReviewAttrs])

  useEffect(() => {
    setAiSummary(null)
    setAiSummaryError('')
  }, [scopeTaskId, periodMode])

  useEffect(() => {
    setAiHistory(listAiSummaryHistory())
  }, [])

  async function handleGenerateAiSummary() {
    if (scopeTaskId === 1 || selectedAiAttrId == null) return
    setAiSummaryLoading(true)
    setAiSummaryError('')
    try {
      const summary = await onLoadAiSummary(scopeTaskId, selectedAiAttrId)
      setAiSummary(summary)
      setAiHistory(saveAiSummaryHistory(summary))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 复盘生成失败'
      setAiSummaryError(message || 'AI 复盘生成失败')
    } finally {
      setAiSummaryLoading(false)
    }
  }

  async function handleCopyAiSummary() {
    if (!aiSummary) return
    await navigator.clipboard.writeText(buildAiSummaryClipboardText(aiSummary))
    setAiCopied(true)
    window.setTimeout(() => setAiCopied(false), 1500)
  }

  async function handleCopyFromHistory(item: AiSummaryHistoryItem) {
    await navigator.clipboard.writeText(buildAiSummaryClipboardText(item.summary))
    setAiCopied(true)
    window.setTimeout(() => setAiCopied(false), 1500)
  }

  function handleExportAiSummary() {
    if (!aiSummary) return
    downloadTextFile(
      buildAiSummaryMarkdown(aiSummary),
      buildAiSummaryMarkdownFilename(aiSummary),
      'text/markdown;charset=utf-8'
    )
    setAiExported(true)
    window.setTimeout(() => setAiExported(false), 1500)
  }

  function handleExportFromHistory(item: AiSummaryHistoryItem) {
    downloadTextFile(
      buildAiSummaryMarkdown(item.summary),
      buildAiSummaryMarkdownFilename(item.summary),
      'text/markdown;charset=utf-8'
    )
    setAiExported(true)
    window.setTimeout(() => setAiExported(false), 1500)
  }

  function handleApplyHistory(item: AiSummaryHistoryItem) {
    setAiSummary(item.summary)
    setAiSummaryError('')
  }

  function handleClearHistory() {
    clearAiSummaryHistory()
    setAiHistory([])
  }

  return (
    <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
      <Card className="lg:col-span-4">
        <CardHeader>
          <div className="space-y-2">
            <CardTitle>当前周期摘要</CardTitle>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <span>筛选</span>
              <select
                className="input-clean h-8 min-w-[160px] py-0 text-xs"
                value={scopeTaskId}
                onChange={(e) => onScopeTaskIdChange(Number(e.target.value))}
              >
                <option value={1}>全局</option>
                {tasks
                  .filter((task) => task.task_id !== 1)
                  .map((task) => (
                    <option key={`stats-filter-${task.task_id}`} value={task.task_id}>
                      {task.task_name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {currentPrefix}（{currentPeriod.label}）
          </p>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2">
            <p className="text-[11px] text-slate-500">{currentPrefix}完成待办</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">{currentPeriod.completedTodos}</p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2">
            <p className="text-[11px] text-slate-500">{currentPrefix}专注时长</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">{formatDuration(currentPeriod.focusSeconds)}</p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2">
            <p className="text-[11px] text-slate-500">{currentPrefix}打卡天数</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">{currentPeriod.checkInDays}</p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2">
            <p className="text-[11px] text-slate-500">{currentPrefix}平均完成度</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">
              {currentPeriod.avgCompletion == null ? '-' : `${Math.round(currentPeriod.avgCompletion)}%`}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-8">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>周期聚合（周 / 月）</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              这里帮你把周/月数据放在一起，方便看趋势和前后变化
              {!isGlobalScope && dynamicTargetAttrCount > 0
                ? ` 已检测到 ${dynamicTargetAttrCount} 个动态目标属性，完成度统一按百分比基准`
                : null}
            </p>
          </div>
          <SegmentedTabs className="w-fit" compact tabs={periodTabs} value={periodMode} onChange={setPeriodMode} />
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid items-center gap-2 border-b border-slate-100 px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid-cols-[170px_72px_120px_72px_88px_1fr]">
            <span>周期</span>
            <span className="text-right">待办</span>
            <span className="text-right">专注</span>
            <span className="text-right">打卡</span>
            <span className="text-right">完成率</span>
            <span>强度</span>
          </div>
          <ul className="space-y-1">
            {periodRows.map((row) => {
              const completionRatio =
                row.avgCompletion == null ? 0 : clampPercent(row.avgCompletion) / 100
              const focusRatio = periodFocusPeak > 0 ? row.focusSeconds / periodFocusPeak : 0
              const todoRatio = periodTodoPeak > 0 ? row.completedTodos / periodTodoPeak : 0
              const checkInRatio = periodCheckInPeak > 0 ? row.checkInDays / periodCheckInPeak : 0
              const intensityRatio =
                focusRatio > 0
                  ? focusRatio
                  : completionRatio > 0
                    ? completionRatio
                    : Math.max(todoRatio, checkInRatio) * 0.8
              return (
                <li key={row.key} className="rounded-lg px-2 py-1.5 hover:bg-slate-50/70">
                  <div className="grid items-center gap-2 text-xs sm:grid-cols-[170px_72px_120px_72px_88px_1fr]">
                    <span className="font-medium text-slate-700 tabular-nums">{row.label}</span>
                    <span className="text-right text-slate-700 tabular-nums">{row.completedTodos}</span>
                    <span className="text-right text-slate-700 tabular-nums">{formatDuration(row.focusSeconds)}</span>
                    <span className="text-right text-slate-700 tabular-nums">{row.checkInDays}</span>
                    <span className="text-right text-slate-700 tabular-nums">{row.avgCompletion == null ? '-' : `${Math.round(row.avgCompletion)}%`}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <span
                        className="block h-full rounded-full bg-[var(--edp-brand)]"
                        style={{ width: `${Math.min(100, Math.round(intensityRatio * 100))}%` }}
                      />
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      <Card className="lg:col-span-12">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>周期专注洞察 (Focus Insights)</CardTitle>
            <p className="mt-1 text-xs text-slate-500">聚焦本{periodMode === 'week' ? '周' : '月'}的专注节律与任务时间分配</p>
          </div>
          <SegmentedTabs className="w-fit" compact tabs={focusInsightTabs} value={focusInsightMode} onChange={setFocusInsightMode} />
        </CardHeader>
        <CardContent className="space-y-3">
          {focusInsightMode === 'allocation' && allocationData.legend.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {allocationData.legend.map((item) => (
                <span
                  key={item.taskKey}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600"
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="max-w-[120px] truncate" title={item.taskName}>
                    {item.taskName}
                  </span>
                </span>
              ))}
            </div>
          ) : null}

          <div ref={chartSurfaceRef} className="relative h-80 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/40">
            {focusInsightMode === 'rhythm' ? (
              rhythmData.points.length === 0 ? (
                <p className="flex h-full items-center justify-center px-4 text-sm text-slate-400">当前周期暂无可视化专注节律数据</p>
              ) : (
                <svg viewBox={`0 0 ${rhythmWidth} ${rhythmHeight}`} className="chart-fade-in h-full w-full">
                  {Array.from({ length: rhythmRowCount + 1 }, (_, index) => {
                    const y = rhythmPaddingTop + rhythmRowHeight * index
                    return <line key={`rh-grid-${index}`} x1={rhythmPaddingLeft} y1={y} x2={rhythmWidth - rhythmPaddingRight} y2={y} stroke="rgba(148,163,184,0.14)" />
                  })}

                  {Array.from({ length: 25 }, (_, hour) => {
                    if (hour % 4 !== 0 && hour !== 24) return null
                    const x = rhythmPaddingLeft + rhythmColumnWidth * hour
                    return (
                      <g key={`rh-hour-${hour}`}>
                        <line x1={x} y1={rhythmPaddingTop} x2={x} y2={rhythmHeight - rhythmPaddingBottom} stroke="rgba(148,163,184,0.12)" />
                        <text x={x} y={rhythmHeight - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">
                          {`${`${hour}`.padStart(2, '0')}:00`}
                        </text>
                      </g>
                    )
                  })}

                  {focusPeriod.days.map((day, index) => {
                    if (index % rhythmRowLabelStep !== 0 && index !== focusPeriod.days.length - 1) return null
                    const y = rhythmPaddingTop + rhythmRowHeight * (index + 0.5) + 3
                    return (
                      <text key={`rh-row-${day.key}`} x={rhythmPaddingLeft - 8} y={y} textAnchor="end" className="fill-slate-500 text-[10px]">
                        {day.rowLabel}
                      </text>
                    )
                  })}

                  {rhythmData.points.map((point) => {
                    const ratio = rhythmData.maxSeconds > 0 ? point.seconds / rhythmData.maxSeconds : 0
                    const cx = rhythmPaddingLeft + rhythmColumnWidth * (point.hour + 0.5)
                    const cy = rhythmPaddingTop + rhythmRowHeight * (point.rowIndex + 0.5)
                    const radius = Math.max(2, Math.min(rhythmColumnWidth, rhythmRowHeight) * (0.18 + 0.34 * Math.sqrt(ratio)))
                    const endHour = point.hour + 1
                    const hourRange = `${`${point.hour}`.padStart(2, '0')}:00-${`${endHour}`.padStart(2, '0')}:00`
                    const lines = [`累计专注 ${formatMinutesLabel(point.seconds)}`]
                    return (
                      <circle
                        key={`rh-point-${point.rowIndex}-${point.hour}`}
                        cx={cx}
                        cy={cy}
                        r={radius}
                        fill="var(--edp-brand)"
                        fillOpacity={0.2 + ratio * 0.75}
                        stroke="var(--edp-brand)"
                        strokeOpacity={0.25 + ratio * 0.45}
                        onMouseMove={(event) => showTooltip(event, `${point.tooltipLabel} ${hourRange}`, lines)}
                        onMouseLeave={hideTooltip}
                      />
                    )
                  })}
                </svg>
              )
            ) : allocationData.days.every((day) => day.totalSeconds <= 0) ? (
              <p className="flex h-full items-center justify-center px-4 text-sm text-slate-400">当前周期暂无可视化时间分配数据</p>
            ) : (
              <svg viewBox={`0 0 ${allocationWidth} ${allocationHeight}`} className="chart-fade-in h-full w-full">
                {Array.from({ length: 5 }, (_, index) => {
                  const ratio = index / 4
                  const y = allocationPaddingTop + allocationPlotHeight * (1 - ratio)
                  const value = allocationMaxSeconds * ratio
                  return (
                    <g key={`alloc-grid-${index}`}>
                      <line x1={allocationPaddingLeft} y1={y} x2={allocationWidth - allocationPaddingRight} y2={y} stroke="rgba(148,163,184,0.16)" />
                      <text x={allocationPaddingLeft - 8} y={y + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
                        {formatHoursLabel(value)}
                      </text>
                    </g>
                  )
                })}

                {allocationData.days.map((day, index) => {
                  const barX = allocationPaddingLeft + allocationBandWidth * index + (allocationBandWidth - allocationBarWidth) / 2
                  let stackBottom = allocationPaddingTop + allocationPlotHeight
                  return (
                    <g key={`alloc-day-${day.day.key}`}>
                      {day.stacks.map((stack) => {
                        const height = (stack.seconds / allocationMaxSeconds) * allocationPlotHeight
                        if (height <= 0) return null
                        const y = stackBottom - height
                        stackBottom = y
                        return (
                          <rect
                            key={`${day.day.key}-${stack.taskKey}`}
                            x={barX}
                            y={y}
                            width={allocationBarWidth}
                            height={Math.max(1, height)}
                            fill={stack.color}
                            fillOpacity={0.92}
                          />
                        )
                      })}
                      <rect
                        x={barX}
                        y={allocationPaddingTop}
                        width={allocationBarWidth}
                        height={allocationPlotHeight}
                        fill="transparent"
                        onMouseMove={(event) => {
                          const lines =
                            day.totalSeconds > 0
                              ? [
                                  `总计 ${formatDuration(day.totalSeconds)}`,
                                  ...day.stacks.map((stack) => `${stack.taskName}: ${formatDuration(stack.seconds)}`)
                                ]
                              : ['当日暂无专注记录']
                          showTooltip(event, day.day.tooltipLabel, lines)
                        }}
                        onMouseLeave={hideTooltip}
                      />
                      {(index % allocationLabelStep === 0 || index === allocationData.days.length - 1) && (
                        <text
                          x={barX + allocationBarWidth / 2}
                          y={allocationHeight - 10}
                          textAnchor="middle"
                          className="fill-slate-400 text-[10px]"
                        >
                          {day.day.axisLabel}
                        </text>
                      )}
                    </g>
                  )
                })}
              </svg>
            )}

            {tooltip ? (
              <div
                className="pointer-events-none absolute z-20 max-w-[230px] rounded-lg border border-slate-200 bg-white/95 px-2.5 py-2 text-xs text-slate-700 shadow-sm backdrop-blur"
                style={{ left: tooltip.x, top: tooltip.y }}
              >
                <p className="font-semibold text-slate-900">{tooltip.title}</p>
                {tooltip.lines.map((line, index) => (
                  <p key={`${tooltip.title}-${index}`} className="mt-0.5 text-slate-600">
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
          </div>

          {focusInsightMode === 'rhythm' ? (
            <div className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-700">打卡热力图（近一年）</p>
                <span className="text-[11px] text-slate-500">有效打卡天数：{checkInHeatmapActiveCount}</span>
              </div>
              <div className="overflow-x-auto">
                <svg viewBox="0 0 760 110" className="chart-fade-in h-28 min-w-[760px] w-full">
                  {checkInHeatmapCells.map((cell) => (
                    <rect
                      key={cell.dateKey}
                      x={12 + cell.x}
                      y={8 + cell.y}
                      width="11"
                      height="11"
                      rx="2"
                      fill={heatCellFill(cell.level, cell.isFuture, statsThemeColor)}
                    >
                      <title>{`${cell.dateKey} · ${cell.level != null && cell.level > 0 ? `已打卡（强度 ${Math.round(cell.level * 100)}%）` : '未打卡'}`}</title>
                    </rect>
                  ))}
                </svg>
              </div>
              <div className="flex items-center justify-end gap-2 text-[11px] text-slate-500">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-200" />
                <span>低</span>
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: heatCellFill(1, false, statsThemeColor) }}
                />
                <span>高</span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!isGlobalScope ? (
        <Card className="lg:col-span-12">
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="inline-flex items-center gap-2">
                <Bot className="h-4 w-4 text-amber-500" />
                AI 复盘
              </CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                先提供任务级属性复盘入口选择一个属性后，即可基于当前日期生成 AI 建议
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input-clean h-9 min-w-[180px] py-0 text-xs"
                value={selectedAiAttrId ?? ''}
                onChange={(e) => {
                  setSelectedAiAttrId(e.target.value ? Number(e.target.value) : null)
                  setAiSummary(null)
                  setAiSummaryError('')
                }}
                disabled={aiReviewAttrs.length === 0 || aiSummaryLoading}
              >
                {aiReviewAttrs.length === 0 ? (
                  <option value="">暂无可复盘属性</option>
                ) : (
                  aiReviewAttrs.map((attr) => (
                    <option key={`stats-ai-review-attr-${attr.attr_id}`} value={attr.attr_id}>
                      {attr.attr_name}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--edp-brand)] px-3 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleGenerateAiSummary()}
                disabled={selectedAiAttrId == null || aiSummaryLoading}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {aiSummaryLoading ? '生成中...' : aiSummary ? '刷新 AI 复盘' : '生成 AI 复盘'}
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleCopyAiSummary()}
                disabled={!aiSummary}
              >
                {aiCopied ? '已复制' : '复制总结'}
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleExportAiSummary}
                disabled={!aiSummary}
              >
                {aiExported ? '已导出' : '导出 Markdown'}
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {aiSummaryError ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                {aiSummaryError}
              </div>
            ) : aiSummary ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        aiSummary.mode_used === 'model'
                          ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border border-amber-200 bg-amber-50 text-amber-700'
                      }`}
                    >
                      {aiSummary.mode_used === 'model' ? 'AI 模型已生效' : '已降级为本地规则'}
                    </span>
                    {aiSummary.provider_id ? (
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                        服务商：{getAiProviderLabel(aiSummary.provider_id)}
                      </span>
                    ) : null}
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">
                      生成时间：{formatLocalDateTime(aiSummary.generated_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{aiSummary.sections.overview}</p>
                  <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-600">{aiSummary.summary_text}</p>
                </div>

                {aiSummary.fallback_reason ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                    {aiSummary.fallback_reason}
                  </div>
                ) : null}

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-700">关键信号</p>
                    <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-600">
                      {aiSummary.sections.signals.map((item, index) => (
                        <li key={`stats-ai-signal-${index}`}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-700">下一步建议</p>
                    <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-600">
                      {aiSummary.sections.actions.map((item, index) => (
                        <li key={`stats-ai-action-${index}`}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <p className="text-xs text-slate-500">
                  {aiSummary.runtime_message}
                  {aiSummary.confirmation_required ? ' 所有 AI 建议都需要你确认后才会进入真实数据' : ''}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-400">选中一个属性后生成 AI 复盘，这里会显示总结、信号和下一步建议</p>
            )}

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-700">本地历史记录</p>
                <button
                  type="button"
                  className="text-[11px] text-slate-500 transition hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleClearHistory}
                  disabled={aiHistory.length === 0}
                >
                  清空历史
                </button>
              </div>
              {aiHistory.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">还没有历史记录生成一次 AI 复盘后会自动保存到本地</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {aiHistory.slice(0, 6).map((item) => (
                    <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-slate-800">
                            {item.summary.task_name} / {item.summary.attr_name}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            保存时间：{formatLocalDateTime(item.saved_at)} · 生成时间：{formatLocalDateTime(item.summary.generated_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50"
                            onClick={() => handleApplyHistory(item)}
                          >
                            查看
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50"
                            onClick={() => void handleCopyFromHistory(item)}
                          >
                            复制
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50"
                            onClick={() => handleExportFromHistory(item)}
                          >
                            导出
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!isGlobalScope ? (
        <Card className="lg:col-span-12">
          <CardHeader>
            <CardTitle>🎓 过往里程碑 (Archived Goals)</CardTitle>
            <p className="mt-1 text-xs text-slate-500">仅展示已归档属性的生命周期结果，作为长期积累的荣誉记录</p>
          </CardHeader>
          <CardContent>
            {archivedMilestones.length === 0 ? (
              <p className="text-sm text-slate-400">暂无归档里程碑</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {archivedMilestones.map((item) => (
                  <li key={`archived-goal-${item.attrId}`} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900" title={item.name}>
                        {item.name}
                      </p>
                      <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
                        {item.ratio == null ? '-' : `${Math.round(item.ratio)}%`}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">周期：{item.periodLabel}</p>
                    <p className="mt-2 text-sm font-medium text-slate-800">{item.valueLabel}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
