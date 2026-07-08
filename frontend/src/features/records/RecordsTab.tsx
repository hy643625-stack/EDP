import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, MoreHorizontal, PencilLine, Plus, Settings2, Trash2, X } from 'lucide-react'
import dayjs from 'dayjs'

import { formatDate, formatDateTime, todayDateString } from '@/lib/format'
import { formatPeriodLabel } from '@/lib/period'
import { normalizeThemeHex, rgbaFromThemeHex } from '@/lib/theme'
import {
  computeTaskAttrProgressForDate,
  isTaskAttrActiveOnDate,
  formatWeekdayGroupKey,
  parseScheduleConfig,
  toIsoWeekday,
  type AttributeScheduleConfig,
  type AttributeScheduleType
} from '../../../../packages/core/src/schedule'
import type { DailyRecord, TaskAttrRelation } from '../../../../packages/core/src/types'
import { Button, Card, CardContent, CardHeader, CardTitle } from '../../../../packages/ui/src'
import { DEFAULT_TASK_COLOR } from '../overview/taskColorPresets'

type RecordsTabProps = {
  isOverview: boolean
  taskColor?: string | null
  attrs: TaskAttrRelation[]
  recordableAttrs: TaskAttrRelation[]
  lockedRecordAttrIds: number[]
  recentRecords: DailyRecord[]
  overviewRecordTaskStatuses: Array<{
    taskId: number
    taskName: string
    taskColor: string
    signed: boolean
    completion: number | null
  }>
  overviewHeatmapLevels: Record<string, number>
  overviewRecordsLoading: boolean
  recordsDate: string
  recordValues: Record<number, string>
  selectedDateRecords: DailyRecord[]
  checkedInForDate: boolean
  attrName: string
  attrUnit: string
  attrHasTarget: boolean
  attrTarget: number
  attrWeight: number
  attrAdvancedOpen: boolean
  attrScheduleType: AttributeScheduleType
  attrActiveWeekdays: number[]
  attrPeriodStart: string
  attrPeriodEnd: string
  attrOverrideRules: AttrOverrideRule[]
  editingAttrId: number | null
  onAttrNameChange: (value: string) => void
  onAttrUnitChange: (value: string) => void
  onAttrHasTargetChange: (value: boolean) => void
  onAttrTargetChange: (value: number) => void
  onAttrWeightChange: (value: number) => void
  onAttrAdvancedOpenChange: (value: boolean) => void
  onAttrScheduleTypeChange: (value: AttributeScheduleType) => void
  onAttrActiveWeekdaysChange: (value: number[]) => void
  onAttrPeriodStartChange: (value: string) => void
  onAttrPeriodEndChange: (value: string) => void
  onAttrOverrideRulesChange: (value: AttrOverrideRule[]) => void
  onRecordsDateChange: (value: string) => void
  onRecordValueChange: (attrId: number, value: string) => void
  onSubmitAttr: () => Promise<void>
  onStartEditAttr: (attr: TaskAttrRelation) => void
  onCancelEditAttr: () => void
  onDeleteAttr: (attrId: number) => Promise<void>
  onRenewAttr: (attr: TaskAttrRelation) => Promise<void>
  onArchiveAttr: (attr: TaskAttrRelation) => Promise<void>
  onCheckIn: () => Promise<void>
  onUpdateRecords: () => Promise<boolean>
}

type AttrOverrideRuleMode = 'independent' | 'shared'
type AttrOverrideRule = {
  id: string
  weekdays: number[]
  mode: AttrOverrideRuleMode
  target: string
}

function hasTarget(attr: TaskAttrRelation): boolean {
  return attr.attr_record === 1 && attr.target_value > 0
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日']
function createEmptyOverrideRule(): AttrOverrideRule {
  return {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    weekdays: [],
    mode: 'independent',
    target: ''
  }
}

function hasScheduleRules(config: AttributeScheduleConfig): boolean {
  return (
    config.type !== 'daily' ||
    config.shared_weekday_groups.length > 0 ||
    Object.keys(config.target_overrides).length > 0 ||
    config.period_start != null ||
    config.period_end != null
  )
}

function formatWeekdays(weekdays: number[]): string {
  const normalized = Array.from(new Set(weekdays))
    .filter((day) => day >= 1 && day <= 7)
    .sort((a, b) => a - b)
  if (normalized.length === 0) return '-'
  return `周${normalized.map((day) => weekdayLabels[day - 1]).join('、周')}`
}

function buildScheduleSettingText(attr: TaskAttrRelation, config: AttributeScheduleConfig): string {
  const unit = attr.attr_unit || ''
  const hasTarget = attr.target_value > 0
  const activeWeekdays =
    config.active_weekdays.length > 0 ? config.active_weekdays : [1, 2, 3, 4, 5, 6, 7]

  if (!hasTarget) {
    const activeText = config.type === 'daily' ? '每日生效' : `${formatWeekdays(activeWeekdays)}生效`
    return `当前设定：${activeText}（无目标）`
  }

  const overrides = config.target_overrides || {}
  const parts: string[] = []
  const claimedWeekdays = new Set<number>()

  for (const group of config.shared_weekday_groups) {
    const normalizedGroup = Array.from(new Set(group))
      .filter((day) => day >= 1 && day <= 7)
      .sort((a, b) => a - b)
    if (normalizedGroup.length < 2) continue
    const groupTarget = overrides[formatWeekdayGroupKey(normalizedGroup)] ?? attr.target_value
    const groupLabel = `周${normalizedGroup.map((day) => weekdayLabels[day - 1]).join('')}`
    parts.push(`${groupLabel}共享${groupTarget}${unit}`)
    normalizedGroup.forEach((day) => claimedWeekdays.add(day))
  }

  const independentParts: Array<{ day: number; text: string }> = []
  let hasDefaultDays = false
  for (const day of activeWeekdays) {
    if (claimedWeekdays.has(day)) continue
    const specificTarget = overrides[String(day)]
    if (specificTarget != null) {
      independentParts.push({ day, text: `周${weekdayLabels[day - 1]}独立${specificTarget}${unit}` })
      continue
    }
    hasDefaultDays = true
  }

  independentParts.sort((a, b) => a.day - b.day)
  independentParts.forEach((item) => parts.push(item.text))
  if (hasDefaultDays) {
    parts.push(`其余日子默认${attr.target_value}${unit}`)
  }

  if (parts.length === 0) {
    parts.push(`每日默认${attr.target_value}${unit}`)
  }
  return `当前设定：${parts.join('，')}`
}

function formatWeekdayGroupLabel(weekdays: number[]): string {
  const normalized = Array.from(new Set(weekdays))
    .filter((day) => day >= 1 && day <= 7)
    .sort((a, b) => a - b)
  if (normalized.length === 0) return '-'
  return normalized.map((day) => `周${weekdayLabels[day - 1]}`).join('、')
}

function formatSharedGroupBadgeLabel(weekdays: number[]): string {
  return `共享组: ${formatWeekdayGroupLabel(weekdays)}`
}

type MiniWeekDotsProps = {
  dateKey: string
  activeWeekdays: number[]
  sharedWeekdays: number[]
  themeColor: string
}

function MiniWeekDots({
  dateKey,
  activeWeekdays,
  sharedWeekdays,
  themeColor
}: MiniWeekDotsProps) {
  const todayWeekday = toIsoWeekday(dateKey)
  const activeSet = new Set(activeWeekdays)
  const sharedSet = new Set(sharedWeekdays)

  return (
    <div className="inline-flex items-center gap-1" title="本周生效日分布">
      {weekdayLabels.map((label, index) => {
        const weekday = index + 1
        const active = activeSet.has(weekday)
        const shared = sharedSet.has(weekday)
        const isToday = todayWeekday === weekday
        const ringStyle = isToday ? { boxShadow: `0 0 0 2px ${rgbaFromThemeHex(themeColor, 0.32)}` } : undefined
        return (
          <span
            key={`mini-week-${weekday}`}
            title={`周${label}${isToday ? '（今日）' : ''}`}
            style={ringStyle}
            className={`inline-block rounded-full border transition ${
              shared
                ? 'h-2.5 w-2.5 border-amber-300 bg-amber-100'
                : active
                  ? 'h-2 w-2 border-[var(--edp-brand-border)] bg-[var(--edp-brand-subtle)]'
                  : 'h-2 w-2 border-slate-200 bg-slate-100'
            }`}
          />
        )
      })}
    </div>
  )
}

export function RecordsTab({
  isOverview,
  taskColor,
  attrs,
  recordableAttrs,
  lockedRecordAttrIds,
  recentRecords,
  overviewRecordTaskStatuses,
  overviewHeatmapLevels,
  overviewRecordsLoading,
  recordsDate,
  recordValues,
  selectedDateRecords,
  checkedInForDate,
  attrName,
  attrUnit,
  attrHasTarget,
  attrTarget,
  attrWeight,
  attrAdvancedOpen,
  attrScheduleType,
  attrActiveWeekdays,
  attrPeriodStart,
  attrPeriodEnd,
  attrOverrideRules,
  editingAttrId,
  onAttrNameChange,
  onAttrUnitChange,
  onAttrHasTargetChange,
  onAttrTargetChange,
  onAttrWeightChange,
  onAttrAdvancedOpenChange,
  onAttrScheduleTypeChange,
  onAttrActiveWeekdaysChange,
  onAttrPeriodStartChange,
  onAttrPeriodEndChange,
  onAttrOverrideRulesChange,
  onRecordsDateChange,
  onRecordValueChange,
  onSubmitAttr,
  onStartEditAttr,
  onCancelEditAttr,
  onDeleteAttr,
  onRenewAttr,
  onArchiveAttr,
  onCheckIn,
  onUpdateRecords
}: RecordsTabProps) {
  const [configOpen, setConfigOpen] = useState(false)
  const [configReady, setConfigReady] = useState(false)
  const [attrActionMenuId, setAttrActionMenuId] = useState<number | null>(null)
  const [editingSignedRecords, setEditingSignedRecords] = useState(false)
  const [trendAttrId, setTrendAttrId] = useState<number | ''>('')
  const [trendDays, setTrendDays] = useState<7 | 30>(7)
  const [showOffScheduleAttrs, setShowOffScheduleAttrs] = useState(false)
  const [settlementAttrId, setSettlementAttrId] = useState<number | null>(null)
  const [settlementActionLoading, setSettlementActionLoading] = useState<'renew' | 'archive' | null>(null)
  const configOpenRafRef = useRef<number | null>(null)
  const recordsThemeColor = useMemo(
    () => normalizeThemeHex(taskColor, DEFAULT_TASK_COLOR),
    [taskColor]
  )
  const recordsThemeFill = useMemo(
    () => rgbaFromThemeHex(recordsThemeColor, 0.25),
    [recordsThemeColor]
  )

  useEffect(() => {
    if (!configOpen) {
      setAttrActionMenuId(null)
    }
  }, [configOpen])

  useEffect(() => {
    return () => {
      if (configOpenRafRef.current != null) {
        window.cancelAnimationFrame(configOpenRafRef.current)
        configOpenRafRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (isOverview || !checkedInForDate) {
      setEditingSignedRecords(false)
    }
  }, [isOverview, checkedInForDate, recordsDate])

  useEffect(() => {
    setShowOffScheduleAttrs(false)
  }, [recordsDate])

  useEffect(() => {
    if (recordableAttrs.length === 0) {
      setTrendAttrId('')
      return
    }
    setTrendAttrId((prev) => {
      if (typeof prev === 'number' && recordableAttrs.some((item) => item.attr_id === prev)) {
        return prev
      }
      return recordableAttrs[0].attr_id
    })
  }, [recordableAttrs])

  const todayKey = todayDateString()
  const pendingReviewAttrs = useMemo(() => {
    if (recordsDate !== todayKey) return []
    return recordableAttrs
      .map((attr) => {
        const schedule = parseScheduleConfig(attr.calc_config)
        if (!schedule.period_end) return null
        if (!dayjs(todayKey).isAfter(dayjs(schedule.period_end), 'day')) return null
        return {
          attr,
          schedule,
          endedAt: schedule.period_end
        }
      })
      .filter((item): item is { attr: TaskAttrRelation; schedule: AttributeScheduleConfig; endedAt: string } => item != null)
      .sort((a, b) => {
        const left = dayjs(a.endedAt)
        const right = dayjs(b.endedAt)
        return left.valueOf() - right.valueOf()
      })
  }, [recordableAttrs, recordsDate, todayKey])
  const pendingAttrIdSet = useMemo(
    () => new Set(pendingReviewAttrs.map((item) => item.attr.attr_id)),
    [pendingReviewAttrs]
  )
  useEffect(() => {
    if (settlementAttrId == null) return
    const exists = pendingReviewAttrs.some((item) => item.attr.attr_id === settlementAttrId)
    if (!exists) {
      setSettlementAttrId(null)
    }
  }, [pendingReviewAttrs, settlementAttrId])
  const activeRecordableAttrs = useMemo(
    () =>
      recordableAttrs.filter((attr) => {
        if (pendingAttrIdSet.has(attr.attr_id)) return false
        return isTaskAttrActiveOnDate(attr, recordsDate)
      }),
    [recordableAttrs, recordsDate, pendingAttrIdSet]
  )
  const inactiveRecordableAttrs = useMemo(
    () =>
      recordableAttrs.filter((attr) => {
        if (pendingAttrIdSet.has(attr.attr_id)) return false
        if (isTaskAttrActiveOnDate(attr, recordsDate)) return false
        return attr.attr_record === 1
      }),
    [recordableAttrs, recordsDate, pendingAttrIdSet]
  )
  const selectedRecordMap = useMemo(() => {
    const map = new Map<number, number>()
    for (const item of selectedDateRecords) {
      map.set(item.attr_id, (map.get(item.attr_id) ?? 0) + item.data_value)
    }
    return map
  }, [selectedDateRecords])

  const selectedDateRecordRows = useMemo(() => {
    const candidateAttrs = recordableAttrs.filter((attr) => {
      if (pendingAttrIdSet.has(attr.attr_id)) return false
      if (isTaskAttrActiveOnDate(attr, recordsDate)) return true
      return selectedRecordMap.has(attr.attr_id)
    })

    return candidateAttrs
      .map((attr) => {
        const isActive = isTaskAttrActiveOnDate(attr, recordsDate)
        const progress = computeTaskAttrProgressForDate(attr, recentRecords, recordsDate)
        const schedule = parseScheduleConfig(attr.calc_config)
        const hasScheduleRule = hasScheduleRules(schedule)
        const activeWeekdays =
          schedule.type === 'daily'
            ? [1, 2, 3, 4, 5, 6, 7]
            : schedule.active_weekdays.length > 0
              ? schedule.active_weekdays
              : [1, 2, 3, 4, 5, 6, 7]
        const todayValue = selectedRecordMap.get(attr.attr_id) ?? 0
        const sharedBadgeLabel =
          progress.isSharedGroup && progress.sharedWeekdays.length > 1
            ? formatSharedGroupBadgeLabel(progress.sharedWeekdays)
            : null
        const sharedHint =
          progress.isSharedGroup && progress.sharedWeekdays.length > 1
            ? `共享进度按 ${formatWeekdayGroupLabel(progress.sharedWeekdays)} 合并计算`
            : null
        const rawRatio =
          isActive && progress.targetValue != null && progress.targetValue > 0
            ? (progress.value / progress.targetValue) * 100
            : null
        const overflowValue =
          rawRatio != null && progress.targetValue != null && progress.value > progress.targetValue
            ? progress.value - progress.targetValue
            : 0
        return {
          attrId: attr.attr_id,
          attrName: attr.attr_name,
          unit: attr.attr_unit || '',
          value: progress.value,
          todayValue,
          ratio: rawRatio == null ? null : clampPercent(rawRatio),
          rawRatio,
          targetValue: progress.targetValue,
          isShared: progress.isSharedGroup,
          sharedBadgeLabel,
          sharedHint,
          activeWeekdays,
          sharedWeekdays: progress.sharedWeekdays,
          scheduleRuleEnabled: hasScheduleRule,
          isOffSchedule: !isActive,
          overflowValue,
          scheduleType: schedule.type
        }
      })
      .filter((item) => item.value != null || item.todayValue !== 0)
      .sort((a, b) => Number(a.isOffSchedule) - Number(b.isOffSchedule))
  }, [recordableAttrs, recentRecords, recordsDate, selectedRecordMap, pendingAttrIdSet])
  const settlementAttr = useMemo(
    () => pendingReviewAttrs.find((item) => item.attr.attr_id === settlementAttrId)?.attr ?? null,
    [pendingReviewAttrs, settlementAttrId]
  )

  const trendBaseDate = dayjs(recordsDate).isValid() ? dayjs(recordsDate) : dayjs()
  const lockedRecordAttrIdSet = useMemo(() => new Set(lockedRecordAttrIds), [lockedRecordAttrIds])
  const canEditSignedRecords = !isOverview && checkedInForDate
  const readOnlySignedSummary = canEditSignedRecords && !editingSignedRecords
  const isEditingAttr = editingAttrId != null
  const trendAttr = useMemo(
    () => (typeof trendAttrId === 'number' ? recordableAttrs.find((item) => item.attr_id === trendAttrId) ?? null : null),
    [recordableAttrs, trendAttrId]
  )
  const trendUsesCompletionRate = useMemo(() => {
    if (!trendAttr || trendAttr.target_value <= 0) return false
    const targetSet = new Set<number>()
    for (let i = trendDays - 1; i >= 0; i -= 1) {
      const date = trendBaseDate.subtract(i, 'day')
      const dateKey = date.format('YYYY-MM-DD')
      if (!isTaskAttrActiveOnDate(trendAttr, dateKey)) continue
      const progress = computeTaskAttrProgressForDate(trendAttr, recentRecords, dateKey)
      if (progress.targetValue != null && progress.targetValue > 0) {
        targetSet.add(Number(progress.targetValue.toFixed(4)))
      }
    }
    return targetSet.size > 1
  }, [trendAttr, trendDays, trendBaseDate, recentRecords])
  const trendData = useMemo(() => {
    if (typeof trendAttrId !== 'number') return []
    const attrRecords = recentRecords.filter((item) => item.attr_id === trendAttrId)
    const dateToValue = new Map<string, { value: number; createTime: string }>()
    for (const item of attrRecords) {
      const prev = dateToValue.get(item.record_date)
      if (!prev || dayjs(item.create_time).isAfter(dayjs(prev.createTime))) {
        dateToValue.set(item.record_date, {
          value: item.data_value,
          createTime: item.create_time
        })
      }
    }

    const rows: Array<{ key: string; label: string; value: number }> = []
    for (let i = trendDays - 1; i >= 0; i -= 1) {
      const date = trendBaseDate.subtract(i, 'day')
      const key = date.format('YYYY-MM-DD')
      if (trendAttr && trendUsesCompletionRate && trendAttr.target_value > 0) {
        const progress = computeTaskAttrProgressForDate(trendAttr, recentRecords, key)
        const ratio =
          progress.targetValue != null && progress.targetValue > 0
            ? Math.max(0, (progress.value / progress.targetValue) * 100)
            : 0
        rows.push({
          key,
          label: date.format('MM-DD'),
          value: ratio
        })
        continue
      }
      rows.push({
        key,
        label: date.format('MM-DD'),
        value: dateToValue.get(key)?.value ?? 0
      })
    }
    return rows
  }, [recentRecords, trendAttrId, trendDays, trendBaseDate, trendAttr, trendUsesCompletionRate])

  const trendChart = useMemo(() => {
    if (trendData.length === 0) return null
    const width = 540
    const height = 132
    const padX = 14
    const padY = 14
    const innerW = width - padX * 2
    const innerH = height - padY * 2
    const maxValue = trendUsesCompletionRate
      ? Math.max(100, ...trendData.map((item) => item.value), 1)
      : Math.max(...trendData.map((item) => item.value), 1)
    const points = trendData.map((item, idx) => {
      const x = padX + (idx / Math.max(trendData.length - 1, 1)) * innerW
      const y = padY + innerH - (item.value / maxValue) * innerH
      return { ...item, x, y }
    })
    const linePath = points
      .map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ')
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${(padY + innerH).toFixed(2)} L ${points[0].x.toFixed(2)} ${(padY + innerH).toFixed(2)} Z`
    const labelIndexes =
      points.length <= 7
        ? points.map((_, idx) => idx)
        : Array.from(
            new Set([0, Math.floor((points.length - 1) / 2), points.length - 1].filter((idx) => idx >= 0))
          )
    return {
      width,
      height,
      padX,
      padY,
      innerH,
      maxValue,
      points,
      linePath,
      areaPath,
      labelIndexes,
      metricLabel: trendUsesCompletionRate ? '完成率' : '记录值'
    }
  }, [trendData, trendUsesCompletionRate])

  const radarData = useMemo(() => {
    const anchorDate = dayjs(recordsDate).isValid() ? dayjs(recordsDate) : dayjs()
    const monday = anchorDate.startOf('day').subtract((anchorDate.day() + 6) % 7, 'day')
    const weekDateKeys = Array.from({ length: 7 }, (_, index) => monday.add(index, 'day').format('YYYY-MM-DD'))
    const targetAttrs = recordableAttrs
      .filter((item) => hasTarget(item))
      .filter((attr) =>
        weekDateKeys.some((dateKey) => {
          if (!isTaskAttrActiveOnDate(attr, dateKey)) return false
          const progress = computeTaskAttrProgressForDate(attr, recentRecords, dateKey)
          return progress.targetValue != null && progress.targetValue > 0
        })
      )
      .slice(0, 6)
    if (targetAttrs.length === 0) return []
    return targetAttrs.map((attr) => {
      const progressToday = computeTaskAttrProgressForDate(attr, recentRecords, recordsDate)
      const completionRatios: number[] = []
      for (const dateKey of weekDateKeys) {
        if (!isTaskAttrActiveOnDate(attr, dateKey)) continue
        const progress = computeTaskAttrProgressForDate(attr, recentRecords, dateKey)
        if (progress.targetValue != null && progress.targetValue > 0) {
          completionRatios.push(clampPercent((progress.value / progress.targetValue) * 100))
        }
      }
      const ratio =
        completionRatios.length > 0
          ? completionRatios.reduce((sum, value) => sum + value, 0) / completionRatios.length
          : 0
      return {
        attrId: attr.attr_id,
        name: attr.attr_name,
        ratio,
        value: progressToday.value,
        unit: attr.attr_unit || '',
        target: progressToday.targetValue ?? attr.target_value
      }
    })
  }, [recordableAttrs, recentRecords, recordsDate])

  const radarPlot = useMemo(() => {
    if (radarData.length < 3) return null
    const center = 110
    const radius = 80
    const points = radarData.map((item, idx) => {
      const angle = (-Math.PI / 2) + (idx / radarData.length) * Math.PI * 2
      const axisX = center + Math.cos(angle) * radius
      const axisY = center + Math.sin(angle) * radius
      const dataX = center + Math.cos(angle) * radius * (item.ratio / 100)
      const dataY = center + Math.sin(angle) * radius * (item.ratio / 100)
      const labelX = center + Math.cos(angle) * (radius + 16)
      const labelY = center + Math.sin(angle) * (radius + 16)
      return {
        ...item,
        axisX,
        axisY,
        dataX,
        dataY,
        labelX,
        labelY
      }
    })

    const polygon = points.map((item) => `${item.dataX.toFixed(2)},${item.dataY.toFixed(2)}`).join(' ')
    const rings = [0.25, 0.5, 0.75, 1].map((scale) =>
      points.map((item) => {
        const x = center + ((item.axisX - center) * scale)
        const y = center + ((item.axisY - center) * scale)
        return `${x.toFixed(2)},${y.toFixed(2)}`
      })
    )
    return { center, points, polygon, rings }
  }, [radarData])

  const normalizedPlanningWeekdays = useMemo(
    () => Array.from(new Set(attrActiveWeekdays)).filter((item) => item >= 1 && item <= 7).sort((a, b) => a - b),
    [attrActiveWeekdays]
  )
  const normalizedOverrideRules = useMemo(
    () =>
      attrOverrideRules.map((rule) => ({
        ...rule,
        weekdays: Array.from(new Set(rule.weekdays))
          .filter((item) => item >= 1 && item <= 7)
          .sort((a, b) => a - b)
      })),
    [attrOverrideRules]
  )
  const weekdayOwnerByRule = useMemo(() => {
    const owner = new Map<number, { ruleId: string; order: number }>()
    normalizedOverrideRules.forEach((rule, index) => {
      for (const weekday of rule.weekdays) {
        if (!owner.has(weekday)) {
          owner.set(weekday, { ruleId: rule.id, order: index + 1 })
        }
      }
    })
    return owner
  }, [normalizedOverrideRules])
  const overrideSummaryText = useMemo(() => {
    const unit = attrUnit.trim()
    const unitSuffix = unit ? ` ${unit}` : ''
    const rangeSuffix = `；区间 ${formatPeriodLabel(attrPeriodStart, attrPeriodEnd)}`
    const hasTargetEnabled = attrHasTarget && attrTarget > 0

    if (!attrAdvancedOpen) {
      if (hasTargetEnabled) {
        return `当前设定：未开启时间规划，使用每日基础目标 ${attrTarget}${unitSuffix}`
      }
      return '当前设定：未开启时间规划（无目标）'
    }

    if (!hasTargetEnabled) {
      if (normalizedPlanningWeekdays.length === 0) {
        return `当前设定：尚未选择生效星期（无目标）${rangeSuffix}`
      }
      const dayLabel =
        normalizedPlanningWeekdays.length === weekdayLabels.length
          ? '每日生效'
          : `周${normalizedPlanningWeekdays.map((day) => weekdayLabels[day - 1]).join('、周')}生效`
      return `当前设定：${dayLabel}（无目标）${rangeSuffix}`
    }

    const validRules = normalizedOverrideRules
      .map((rule) => ({
        ...rule,
        numeric: Number(rule.target)
      }))
      .filter((rule) => rule.weekdays.length > 0 && Number.isFinite(rule.numeric) && rule.numeric > 0)

    if (validRules.length === 0) {
      return `当前设定：尚未形成有效规则，当前基础目标 ${attrTarget}${unitSuffix}${rangeSuffix}`
    }

    const parts = validRules.map((rule) => {
      const daysLabel = `周${rule.weekdays.map((day) => weekdayLabels[day - 1]).join('、周')}`
      const modeLabel = rule.mode === 'shared' && rule.weekdays.length >= 2 ? '共享' : '独立'
      return `${daysLabel}${modeLabel} ${rule.numeric}${unitSuffix}`
    })
    return `当前设定：${parts.join('，')}${rangeSuffix}`
  }, [
    attrAdvancedOpen,
    attrHasTarget,
    attrPeriodEnd,
    attrPeriodStart,
    attrTarget,
    attrUnit,
    normalizedOverrideRules,
    normalizedPlanningWeekdays
  ])

  function togglePlanningWeekday(weekday: number) {
    const next = new Set(normalizedPlanningWeekdays)
    if (next.has(weekday)) {
      next.delete(weekday)
    } else {
      next.add(weekday)
    }
    onAttrActiveWeekdaysChange(Array.from(next).sort((a, b) => a - b))
  }

  function updateOverrideRule(
    ruleId: string,
    updater: (rule: AttrOverrideRule) => AttrOverrideRule
  ) {
    onAttrOverrideRulesChange(
      normalizedOverrideRules.map((rule) => (rule.id === ruleId ? updater(rule) : rule))
    )
  }

  function addOverrideRule() {
    onAttrOverrideRulesChange([...normalizedOverrideRules, createEmptyOverrideRule()])
  }

  function deleteOverrideRule(ruleId: string) {
    const next = normalizedOverrideRules.filter((rule) => rule.id !== ruleId)
    onAttrOverrideRulesChange(next)
  }

  function toggleRuleWeekday(ruleId: string, weekday: number) {
    updateOverrideRule(ruleId, (rule) => {
      const selected = rule.weekdays.includes(weekday)
      if (selected) {
        return { ...rule, weekdays: rule.weekdays.filter((item) => item !== weekday) }
      }
      const owner = weekdayOwnerByRule.get(weekday)
      if (owner && owner.ruleId !== ruleId) {
        return rule
      }
      return { ...rule, weekdays: [...rule.weekdays, weekday].sort((a, b) => a - b) }
    })
  }

  function updateRuleMode(ruleId: string, mode: AttrOverrideRuleMode) {
    updateOverrideRule(ruleId, (rule) => ({ ...rule, mode }))
  }

  function updateRuleTarget(ruleId: string, target: string) {
    updateOverrideRule(ruleId, (rule) => ({ ...rule, target }))
  }

  function clearConfigOpenRaf() {
    if (configOpenRafRef.current != null) {
      window.cancelAnimationFrame(configOpenRafRef.current)
      configOpenRafRef.current = null
    }
  }

  function openConfigDrawer() {
    clearConfigOpenRaf()
    setConfigOpen(true)
    setConfigReady(false)
    if (typeof window === 'undefined') {
      setConfigReady(true)
      return
    }
    configOpenRafRef.current = window.requestAnimationFrame(() => {
      configOpenRafRef.current = window.requestAnimationFrame(() => {
        setConfigReady(true)
        configOpenRafRef.current = null
      })
    })
  }

  function closeConfigDrawer() {
    clearConfigOpenRaf()
    setConfigOpen(false)
    setConfigReady(false)
    onCancelEditAttr()
  }

  async function handleSubmitRecords() {
    if (checkedInForDate) {
      const updated = await onUpdateRecords()
      if (updated) {
        setEditingSignedRecords(false)
      }
      return
    }
    await onCheckIn()
  }

  async function handleRenewPendingAttr() {
    if (!settlementAttr) return
    setSettlementActionLoading('renew')
    try {
      await onRenewAttr(settlementAttr)
    } finally {
      setSettlementActionLoading(null)
    }
  }

  async function handleArchivePendingAttr() {
    if (!settlementAttr) return
    setSettlementActionLoading('archive')
    try {
      await onArchiveAttr(settlementAttr)
    } finally {
      setSettlementActionLoading(null)
    }
  }

  function handleEvolvePendingAttr() {
    if (!settlementAttr) return
    onStartEditAttr(settlementAttr)
    onAttrAdvancedOpenChange(true)
    openConfigDrawer()
    setSettlementAttrId(null)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>{isOverview ? '总览签到看板' : '每日签到'}</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              {isOverview ? '汇总今日任务签到状态和完成情况' : '在此记录数据'}
            </p>
          </div>
          {!isOverview ? (
            <div className="flex flex-wrap items-center gap-2">
              {canEditSignedRecords ? (
                <Button
                  variant={editingSignedRecords ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setEditingSignedRecords((prev) => !prev)}
                >
                  {editingSignedRecords ? '退出编辑' : '修改数据'}
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" iconLeft={<Settings2 className="h-4 w-4" />} onClick={openConfigDrawer}>
                配置
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-end">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">签到日期</label>
              <input
                className="input-clean w-full"
                type="date"
                lang="zh-CN"
                value={recordsDate}
                disabled={overviewRecordsLoading}
                onChange={(e) => onRecordsDateChange(e.target.value)}
              />
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {isOverview
                ? '任务总览'
                : checkedInForDate && !editingSignedRecords
                  ? '今日已成功记录'
                  : checkedInForDate && editingSignedRecords
                    ? '你正在编辑已签到数据，保存后会覆盖当天记录值'
                  : '填写数据并保存完成今日记录'}
            </div>
          </div>

          {!isOverview && pendingReviewAttrs.length > 0 ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-3 sm:p-4">
              <div className="mb-2">
                <p className="text-xs font-semibold tracking-wide text-amber-700">待结算属性</p>
                <p className="mt-1 text-xs text-amber-800/90">检测到已有周期结束的属性，请先完成结算再继续日常记录</p>
              </div>
              <ul className="space-y-2">
                {pendingReviewAttrs.map((item) => (
                  <li key={`pending-review-${item.attr.attr_id}`} className="rounded-xl border border-amber-200 bg-white/85 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900" title={item.attr.attr_name}>
                          {item.attr.attr_name}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-600">
                          周期：{formatPeriodLabel(item.schedule.period_start, item.schedule.period_end)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="border border-amber-300 bg-amber-100/70 text-amber-800 hover:bg-amber-200/70"
                        onClick={() => setSettlementAttrId(item.attr.attr_id)}
                      >
                        🎁 周期结束，点击结算
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {isOverview ? (
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 sm:p-4">
              {overviewRecordsLoading ? (
                <p className="text-sm text-slate-500">正在汇总任务签到数据...</p>
              ) : overviewRecordTaskStatuses.length === 0 ? (
                <p className="text-sm text-slate-400">暂无可统计任务</p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {overviewRecordTaskStatuses.map((task) => {
                    const completion = task.completion == null ? null : Math.max(0, Math.min(100, task.completion))
                    return (
                      <li
                        key={task.taskId}
                        className="rounded-xl border border-slate-200 bg-[var(--edp-brand-subtle)]/45 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">
                            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: task.taskColor }} />
                            <span className="truncate" title={task.taskName}>
                              {task.taskName}
                            </span>
                          </p>
                          <p className="rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
                            {completion == null ? '-' : `${Math.round(completion)}%`}
                          </p>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">{task.signed ? '今日已签到' : '今日未签到'}</p>
                        {completion != null ? (
                          <>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/90">
                              <div
                                className="h-full rounded-full transition-[width] duration-500"
                                style={{ width: `${completion}%`, backgroundColor: task.taskColor || recordsThemeColor }}
                              />
                            </div>
                            <p className="mt-1 text-[11px] text-slate-500">完成度 {Math.round(completion)}%</p>
                          </>
                        ) : (
                          <p className="mt-2 text-[11px] text-slate-500">无目标</p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ) : readOnlySignedSummary ? (
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 sm:p-4">
              <p className="text-xs font-semibold tracking-wide text-slate-500">今日成就（{formatDate(recordsDate)}）</p>
              {selectedDateRecordRows.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">-</p>
              ) : (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {selectedDateRecordRows.map((row) => (
                    <li
                      key={row.attrId}
                      className="rounded-xl border border-slate-200 bg-[var(--edp-brand-subtle)]/45 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900" title={row.attrName}>
                            {row.attrName}
                            {row.isShared ? (
                              <span className="ml-1 inline-flex rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title={row.sharedHint || undefined}>
                                共享
                              </span>
                            ) : null}
                            {row.isOffSchedule ? (
                              <span className="ml-1 inline-flex rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                                破例
                              </span>
                            ) : null}
                          </p>
                          {row.sharedBadgeLabel ? (
                            <p className="mt-1 text-[11px] text-amber-700">{row.sharedBadgeLabel}</p>
                          ) : null}
                          {row.scheduleRuleEnabled ? (
                            <div className="mt-1">
                              <MiniWeekDots
                                dateKey={recordsDate}
                                activeWeekdays={row.activeWeekdays}
                                sharedWeekdays={row.sharedWeekdays}
                                themeColor={recordsThemeColor}
                              />
                            </div>
                          ) : null}
                        </div>
                        <p className="rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
                          {row.ratio == null ? '-' : `${Math.round(row.ratio)}%`}
                        </p>
                      </div>
                      <p className="mt-2 text-lg font-bold tracking-tight text-slate-900">
                        {row.isShared ? row.value : row.todayValue}
                        {row.unit}
                        {row.targetValue != null ? (
                          <span className="ml-1 text-xs font-medium text-slate-500">
                            / {row.targetValue}
                            {row.unit}
                          </span>
                        ) : null}
                      </p>
                      {row.ratio != null ? (
                        <>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/90">
                            <div
                              className="h-full rounded-full transition-[width] duration-500"
                              style={{
                                width: `${row.ratio}%`,
                                background:
                                  row.overflowValue > 0
                                    ? `linear-gradient(90deg, ${recordsThemeColor} 0%, #8b5cf6 60%, #f59e0b 100%)`
                                    : recordsThemeColor
                              }}
                            />
                          </div>
                          {row.overflowValue > 0 ? (
                            <p className="mt-1 inline-flex rounded-full bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                              +{row.overflowValue}
                              {row.unit} 超额完成
                            </p>
                          ) : null}
                          <p className="mt-1 text-[11px] text-slate-500">
                            {row.isShared
                              ? `${row.value} / ${row.targetValue}${row.unit}（今日:+${row.todayValue}${row.unit}）`
                              : `目标 ${row.targetValue}${row.unit} · 今日 ${row.todayValue}${row.unit}`}
                          </p>
                          {row.sharedHint ? <p className="mt-1 text-[11px] text-slate-500">{row.sharedHint}</p> : null}
                        </>
                      ) : (
                        <p className="mt-2 text-[11px] text-slate-500">
                          {row.isOffSchedule ? '未安排日破例记录（Bonus）' : '无目标'}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-slate-500">
                最后记录时间：{selectedDateRecords[0] ? formatDateTime(selectedDateRecords[0].create_time) : '-'}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {activeRecordableAttrs.length === 0 ? (
                  <p className="text-sm text-slate-400">该日期暂无生效属性，请调整周期设置或切换日期</p>
                ) : (
                  activeRecordableAttrs.map((attr) => {
                    const lockedAttr = lockedRecordAttrIdSet.has(attr.attr_id)
                    const progress = computeTaskAttrProgressForDate(attr, recentRecords, recordsDate)
                    return (
                      <div key={attr.attr_id} className="grid gap-2 sm:grid-cols-[1fr_220px] sm:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800" title={attr.attr_name}>
                            {attr.attr_name}
                            {progress.isSharedGroup ? (
                              <span
                                className="ml-1 inline-flex rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                                title={`该目标由周${progress.sharedWeekdays.map((day) => weekdayLabels[day - 1]).join('、周')}共享`}
                              >
                                共享
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-slate-500">
                            {lockedAttr
                              ? '系统维护 · 签到自动累加'
                              : progress.targetValue != null
                                ? `目标 ${progress.targetValue}${attr.attr_unit || ''} · 当前 ${progress.value}${attr.attr_unit || ''}`
                                : '无目标'}
                          </p>
                        </div>
                        <input
                          className="input-clean"
                          type="number"
                          step="0.01"
                          disabled={isOverview || lockedAttr}
                          placeholder={lockedAttr ? '系统维护' : undefined}
                          value={recordValues[attr.attr_id] ?? ''}
                          onChange={(e) => onRecordValueChange(attr.attr_id, e.target.value)}
                        />
                      </div>
                    )
                  })
                )}

                {inactiveRecordableAttrs.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 transition hover:text-slate-900"
                      onClick={() => setShowOffScheduleAttrs((prev) => !prev)}
                    >
                      <ChevronDown className={`h-3.5 w-3.5 transition ${showOffScheduleAttrs ? 'rotate-180' : ''}`} />
                      📦 查看今日未安排的任务（{inactiveRecordableAttrs.length}）
                    </button>
                    {showOffScheduleAttrs ? (
                      <div className="mt-2 space-y-2 border-t border-slate-200/80 pt-2">
                        {inactiveRecordableAttrs.map((attr) => {
                          const lockedAttr = lockedRecordAttrIdSet.has(attr.attr_id)
                          const currentValue = selectedRecordMap.get(attr.attr_id) ?? 0
                          return (
                            <div key={`off-schedule-${attr.attr_id}`} className="grid gap-2 sm:grid-cols-[1fr_220px] sm:items-center">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-800" title={attr.attr_name}>
                                  {attr.attr_name}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {lockedAttr
                                    ? '系统维护 · 签到自动累加'
                                    : currentValue !== 0
                                      ? `已录入 ${currentValue}${attr.attr_unit || ''} · 未安排日破例`
                                      : '未安排日破例记录（Bonus）'}
                                </p>
                              </div>
                              <input
                                className="input-clean"
                                type="number"
                                step="0.01"
                                disabled={isOverview || lockedAttr}
                                placeholder={lockedAttr ? '系统维护' : '可选录入'}
                                value={recordValues[attr.attr_id] ?? ''}
                                onChange={(e) => onRecordValueChange(attr.attr_id, e.target.value)}
                              />
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={isOverview} onClick={() => void handleSubmitRecords()}>
                  {checkedInForDate ? '保存修改' : '签到并保存'}
                </Button>
                {checkedInForDate ? (
                  <Button variant="ghost" onClick={() => setEditingSignedRecords(false)}>
                    取消
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {!isOverview ? (
        <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>趋势追踪（轻量）</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                用来快速看最近变化，深度复盘建议去 Stats 页面
                {trendUsesCompletionRate ? ' 检测到动态目标，已自动切换为完成率视图' : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input-clean h-9 min-w-[150px] text-xs"
                value={trendAttrId}
                onChange={(e) => {
                  const raw = e.target.value
                  setTrendAttrId(raw ? Number(raw) : '')
                }}
                disabled={recordableAttrs.length === 0}
              >
                {recordableAttrs.length === 0 ? <option value="">暂无可记录属性</option> : null}
                {recordableAttrs.map((attr) => (
                  <option key={attr.attr_id} value={attr.attr_id}>
                    {attr.attr_name}
                  </option>
                ))}
              </select>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  className={`rounded-md px-2 py-1 text-xs font-medium transition ${trendDays === 7 ? 'text-[var(--edp-brand-strong)]' : 'text-slate-600 hover:bg-slate-100'}`}
                  style={trendDays === 7 ? { backgroundColor: 'var(--edp-brand-subtle)' } : undefined}
                  onClick={() => setTrendDays(7)}
                >
                  7 天
                </button>
                <button
                  type="button"
                  className={`rounded-md px-2 py-1 text-xs font-medium transition ${trendDays === 30 ? 'text-[var(--edp-brand-strong)]' : 'text-slate-600 hover:bg-slate-100'}`}
                  style={trendDays === 30 ? { backgroundColor: 'var(--edp-brand-subtle)' } : undefined}
                  onClick={() => setTrendDays(30)}
                >
                  30 天
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!trendChart ? (
              <p className="text-sm text-slate-400">-</p>
            ) : (
              <div className="space-y-1.5">
                <div className="overflow-x-auto rounded-lg border border-slate-100/80 bg-white/65 px-2 py-2">
                  <svg
                    key={`${trendAttrId}-${trendDays}-${recordsDate}`}
                    viewBox={`0 0 ${trendChart.width} ${trendChart.height}`}
                    className="chart-fade-in h-32 min-w-[540px] w-full"
                  >
                    <defs>
                      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={recordsThemeColor} stopOpacity="0.2" />
                        <stop offset="100%" stopColor={recordsThemeColor} stopOpacity="0.02" />
                      </linearGradient>
                    </defs>
                    <line
                      x1={trendChart.padX}
                      y1={trendChart.padY + trendChart.innerH}
                      x2={trendChart.width - trendChart.padX}
                      y2={trendChart.padY + trendChart.innerH}
                      stroke="rgba(148,163,184,0.32)"
                    />
                    <path d={trendChart.areaPath} fill="url(#trendFill)" />
                    <path d={trendChart.linePath} fill="none" stroke={recordsThemeColor} strokeWidth="2" strokeLinecap="round" />
                    {trendChart.points.map((point, idx) => (
                      <g key={point.key}>
                        {idx === trendChart.points.length - 1 ? <circle cx={point.x} cy={point.y} r="2.8" fill={recordsThemeColor} /> : null}
                        {trendChart.labelIndexes.includes(idx) ? (
                          <text x={point.x} y={trendChart.height - 4} textAnchor="middle" fontSize="9" fill="#64748b">
                            {point.label}
                          </text>
                        ) : null}
                      </g>
                    ))}
                  </svg>
                </div>
                <p className="text-[11px] text-slate-500">
                  峰值 {trendChart.maxValue.toFixed(2)}
                  {trendUsesCompletionRate ? '%' : ''} · 指标 {trendChart.metricLabel} · 截止 {trendBaseDate.format('YYYY-MM-DD')}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>目标雷达</CardTitle>
            <p className="mt-1 text-xs text-slate-500">按本周活跃属性计算，避免每日启用属性波动导致图形闪烁</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {!radarPlot ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-center">
                <svg viewBox="0 0 220 180" className="mx-auto h-40 w-52">
                  <g transform="translate(110 90)">
                    {[22, 40, 58, 76].map((radius) => (
                      <polygon
                        key={radius}
                        points={Array.from({ length: 6 })
                          .map((_, idx) => {
                            const angle = (-Math.PI / 2) + (idx / 6) * Math.PI * 2
                            const x = Math.cos(angle) * radius
                            const y = Math.sin(angle) * radius
                            return `${x.toFixed(2)},${y.toFixed(2)}`
                          })
                          .join(' ')}
                        fill="none"
                        stroke="rgba(148,163,184,0.5)"
                        strokeDasharray="4 4"
                      />
                    ))}
                    {Array.from({ length: 6 }).map((_, idx) => {
                      const angle = (-Math.PI / 2) + (idx / 6) * Math.PI * 2
                      const x = Math.cos(angle) * 76
                      const y = Math.sin(angle) * 76
                      return <line key={idx} x1="0" y1="0" x2={x} y2={y} stroke="rgba(148,163,184,0.35)" />
                    })}
                    <circle cx="0" cy="0" r="5" fill="#94a3b8" />
                  </g>
                </svg>
                <p className="mt-1 text-sm font-medium text-slate-700">雷达图等待目标属性</p>
                <p className="mt-1 text-xs text-slate-500">先给至少 3 个记录属性设置目标值，这里就会显示完成分布</p>
                <Button variant="ghost" size="sm" className="mt-3" onClick={() => setConfigOpen(true)}>
                  去配置目标属性
                </Button>
              </div>
            ) : (
              <>
                <svg key={`${recordsDate}-${radarData.length}`} viewBox="0 0 220 220" className="chart-fade-in mx-auto h-56 w-56">
                  {radarPlot.rings.map((ring, idx) => (
                    <polygon key={idx} points={ring.join(' ')} fill="none" stroke="rgba(148,163,184,0.35)" strokeWidth="1" />
                  ))}
                  {radarPlot.points.map((point) => (
                    <line key={point.attrId} x1={radarPlot.center} y1={radarPlot.center} x2={point.axisX} y2={point.axisY} stroke="rgba(148,163,184,0.5)" />
                  ))}
                  <polygon points={radarPlot.polygon} fill={recordsThemeFill} stroke={recordsThemeColor} strokeWidth="2" />
                  {radarPlot.points.map((point) => (
                    <g key={`${point.attrId}-label`}>
                      <circle cx={point.dataX} cy={point.dataY} r="2.8" fill={recordsThemeColor} />
                      <text x={point.labelX} y={point.labelY} textAnchor="middle" fontSize="9.5" fill="#334155">
                        {point.name.length > 6 ? `${point.name.slice(0, 6)}…` : point.name}
                      </text>
                    </g>
                  ))}
                </svg>
                <ul className="space-y-1">
                  {radarData.map((item) => (
                    <li key={item.attrId} className="flex items-center justify-between text-xs">
                      <span className="truncate text-slate-600" title={item.name}>
                        {item.name}
                      </span>
                      <span className="font-medium text-slate-900">{Math.round(item.ratio)}%</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      ) : null}

      {settlementAttr ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/35 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-5">
            <div className="mb-3">
              <p className="text-sm font-semibold text-slate-900">周期结算</p>
              <p className="mt-1 text-xs text-slate-500">
                属性「{settlementAttr.attr_name}」已到周期终点请选择下一步操作
              </p>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                className="w-full rounded-xl border border-[var(--edp-brand-border)] bg-[var(--edp-brand-subtle)] px-3 py-2 text-left transition hover:bg-[var(--edp-brand-subtle)]/80"
                onClick={() => void handleRenewPendingAttr()}
                disabled={settlementActionLoading != null}
              >
                <p className="text-sm font-medium text-[var(--edp-brand-strong)]">一键续期 (Renew)</p>
                <p className="mt-1 text-xs text-slate-600">保留原有周期规则，从今天开始自动顺延一个周期</p>
              </button>

              <button
                type="button"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:bg-slate-100"
                onClick={handleEvolvePendingAttr}
                disabled={settlementActionLoading != null}
              >
                <p className="text-sm font-medium text-slate-900">进入修改 (Evolve)</p>
                <p className="mt-1 text-xs text-slate-600">打开属性编辑表单，手动调整目标值和时间规则</p>
              </button>

              <button
                type="button"
                className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-left transition hover:bg-rose-100"
                onClick={() => void handleArchivePendingAttr()}
                disabled={settlementActionLoading != null}
              >
                <p className="text-sm font-medium text-rose-700">荣耀归档 (Archive)</p>
                <p className="mt-1 text-xs text-slate-600">归档后不再参与日常记录，但历史数据仍保留在统计视图</p>
              </button>
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                variant="ghost"
                onClick={() => setSettlementAttrId(null)}
                disabled={settlementActionLoading != null}
              >
                取消
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {configOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="关闭属性配置抽屉"
            className="absolute inset-0 bg-slate-900/30"
            onClick={closeConfigDrawer}
          />
          <aside className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl [will-change:transform]">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">属性管理</h3>
                <p className="mt-1 text-xs text-slate-500">在这里新增或调整记录属性，平时不需要频繁改</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<X className="h-4 w-4" />}
                onClick={closeConfigDrawer}
              >
                关闭
              </Button>
            </div>

            <div className="space-y-4 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
              {!configReady ? (
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 text-sm text-slate-500">
                  正在准备配置界面...
                </div>
              ) : (
                <>
              <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
                {isEditingAttr ? (
                  <div className="rounded-lg border border-[var(--edp-brand-border)] bg-[var(--edp-brand-subtle)] px-2.5 py-2 text-xs text-[var(--edp-brand-strong)]">
                    正在编辑属性，保存后会覆盖该属性的配置
                  </div>
                ) : null}
                <input
                  className="input-clean w-full"
                  value={attrName}
                  onChange={(e) => onAttrNameChange(e.target.value)}
                  placeholder="属性名称（例：学习时长）"
                  disabled={isOverview}
                />
                <input
                  className="input-clean w-full"
                  value={attrUnit}
                  onChange={(e) => onAttrUnitChange(e.target.value)}
                  placeholder="单位（例：分钟）"
                  disabled={isOverview}
                />
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={attrHasTarget}
                    disabled={isOverview}
                    onChange={(e) => onAttrHasTargetChange(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  设置目标值
                </label>
                {attrHasTarget ? (
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-600">每日（无时间规划）目标值</p>
                      <p className="text-[11px] text-slate-500">
                        不开启时间规划时默认需要每日完成，填入每天要达成的目标，若要自定义请打开时间规划
                      </p>
                      <input
                        className="input-clean"
                        type="number"
                        min={1}
                        value={attrTarget}
                        onChange={(e) => onAttrTargetChange(Number(e.target.value || 0))}
                        placeholder="输入每日目标值"
                        disabled={isOverview || attrAdvancedOpen}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-600">权重</p>
                      <p className="text-[11px] text-slate-500">
                        将按照该属性完成度*权重占总体权重比值计算每日任务完成度
                      </p>
                      <input
                        className="input-clean"
                        type="number"
                        min={1}
                        value={attrWeight}
                        onChange={(e) => onAttrWeightChange(Number(e.target.value || 1))}
                        placeholder="输入权重"
                        disabled={isOverview}
                      />
                    </div>
                  </div>
                ) : null}
                {attrHasTarget && attrAdvancedOpen ? (
                  <p className="text-[11px] text-slate-500">已启用属性时间规划，基础“每日目标值”已失效，请以下方规则为准</p>
                ) : null}

                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 transition hover:text-slate-900"
                  disabled={isOverview}
                  onClick={() => onAttrAdvancedOpenChange(!attrAdvancedOpen)}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {attrAdvancedOpen ? '收起属性时间规划' : '展开属性时间规划'}
                </button>

                {attrAdvancedOpen ? (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                      <p className="text-xs font-medium text-slate-600">生效时间范围</p>
                      <p className="text-[11px] text-slate-500">
                        留空即为不设限
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="space-y-1 text-[11px] text-slate-500">
                          <span>开始日期（可选）</span>
                          <input
                            className="input-clean h-9"
                            type="date"
                            value={attrPeriodStart}
                            disabled={isOverview}
                            onChange={(e) => onAttrPeriodStartChange(e.target.value)}
                          />
                        </label>
                        <label className="space-y-1 text-[11px] text-slate-500">
                          <span>终止日期（可选）</span>
                          <input
                            className="input-clean h-9"
                            type="date"
                            value={attrPeriodEnd}
                            disabled={isOverview}
                            onChange={(e) => onAttrPeriodEndChange(e.target.value)}
                          />
                        </label>
                      </div>
                    </div>

                    {!attrHasTarget ? (
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <p className="text-xs text-slate-600">当前未开启目标值，时间规划仅用于选择属性生效日期</p>
                        <p className="text-[11px] text-slate-500">如需添加属性时间规则，请先勾选“设置目标值”</p>
                        <div className="grid grid-cols-7 gap-1.5">
                          {weekdayLabels.map((label, weekdayIndex) => {
                            const weekday = weekdayIndex + 1
                            const selected = normalizedPlanningWeekdays.includes(weekday)
                            return (
                              <button
                                key={`active-${weekday}`}
                                type="button"
                                className={`rounded-lg border px-1.5 py-1 text-xs font-medium transition ${
                                  selected
                                    ? 'border-[var(--edp-brand-border)] bg-[var(--edp-brand-subtle)] text-[var(--edp-brand-strong)]'
                                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                                }`}
                                onClick={() => togglePlanningWeekday(weekday)}
                              >
                                周{label}
                              </button>
                            )
                          })}
                        </div>
                        {normalizedPlanningWeekdays.length === 0 ? (
                          <p className="text-[11px] text-amber-700">请至少选择一个生效星期</p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <div className="space-y-2">
                          {normalizedOverrideRules.length === 0 ? (
                            <p className="text-[11px] text-slate-500">尚未添加规则</p>
                          ) : null}
                          {normalizedOverrideRules.map((rule, index) => (
                            <div key={rule.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-2.5">
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-medium text-slate-600">规则{index + 1}</p>
                                <button
                                  type="button"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                                  onClick={() => deleteOverrideRule(rule.id)}
                                  aria-label={`删除规则${index + 1}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-[11px] font-medium text-slate-500">天数选择</p>
                                <div className="grid grid-cols-7 gap-1.5">
                                  {weekdayLabels.map((label, weekdayIndex) => {
                                    const weekday = weekdayIndex + 1
                                    const selected = rule.weekdays.includes(weekday)
                                    const owner = weekdayOwnerByRule.get(weekday)
                                    const blocked = !!owner && owner.ruleId !== rule.id
                                    const disabled = blocked
                                    const title = blocked ? `已在规则${owner.order}中定义` : undefined
                                    return (
                                      <button
                                        key={`${rule.id}-${weekday}`}
                                        type="button"
                                        disabled={disabled}
                                        title={title}
                                        className={`rounded-lg border px-1.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                                          selected
                                            ? 'border-[var(--edp-brand-border)] bg-[var(--edp-brand-subtle)] text-[var(--edp-brand-strong)]'
                                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                                        }`}
                                        onClick={() => toggleRuleWeekday(rule.id, weekday)}
                                      >
                                        周{label}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                              <div className="grid grid-cols-[1fr_120px] gap-2">
                                <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                                  <button
                                    type="button"
                                    className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                                      rule.mode === 'independent' ? 'bg-white text-[var(--edp-brand-strong)] shadow-sm' : 'text-slate-600 hover:bg-white'
                                    }`}
                                    onClick={() => updateRuleMode(rule.id, 'independent')}
                                  >
                                    独立结算
                                  </button>
                                  <button
                                    type="button"
                                    className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                                      rule.mode === 'shared' ? 'bg-white text-[var(--edp-brand-strong)] shadow-sm' : 'text-slate-600 hover:bg-white'
                                    }`}
                                    onClick={() => updateRuleMode(rule.id, 'shared')}
                                  >
                                    共享目标
                                  </button>
                                </div>
                                <input
                                  className="input-clean h-8"
                                  type="number"
                                  min={1}
                                  value={rule.target}
                                  onChange={(e) => updateRuleTarget(rule.id, e.target.value)}
                                  placeholder="目标值"
                                  disabled={isOverview}
                                />
                              </div>
                              {rule.mode === 'shared' && rule.weekdays.length > 0 && rule.weekdays.length < 2 ? (
                                <p className="text-[11px] text-amber-700">共享目标至少需要选择两个星期</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                        <Button size="sm" variant="ghost" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={addOverrideRule}>
                          添加属性时间规则
                        </Button>
                        <p className="text-[11px] text-slate-500">{overrideSummaryText}</p>
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    className="w-full"
                    iconLeft={isEditingAttr ? <PencilLine className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    disabled={isOverview || !attrName.trim()}
                    onClick={() => void onSubmitAttr()}
                  >
                    {isEditingAttr ? '保存属性' : '添加属性'}
                  </Button>
                  {isEditingAttr ? (
                    <Button variant="ghost" className="w-full" onClick={onCancelEditAttr}>
                      取消编辑
                    </Button>
                  ) : null}
                </div>
                {isOverview ? <p className="text-xs text-slate-400">总览任务不可编辑属性</p> : null}
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70">
                <div className="border-b border-slate-200/80 px-3 py-2 text-xs font-semibold tracking-wide text-slate-500">当前属性</div>
                {attrs.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-slate-400">-</p>
                ) : (
                  <ul className="divide-y divide-slate-200/70">
                    {attrs.map((attr) => {
                      const schedule = parseScheduleConfig(attr.calc_config)
                      const scheduleRuleEnabled = hasScheduleRules(schedule)
                      const weekdaysLabel =
                        schedule.type === 'daily'
                          ? '每日'
                          : `周${schedule.active_weekdays.map((day) => weekdayLabels[day - 1]).join('、周')}`
                      const sharedHint =
                        schedule.shared_weekday_groups.length > 0
                          ? `共享: ${schedule.shared_weekday_groups
                              .map((group) => `周${group.map((day) => weekdayLabels[day - 1]).join('、周')}`)
                              .join('；')}`
                          : null
                      const legacyMetaText = `${
                        hasTarget(attr)
                          ? `目标 ${attr.target_value}${attr.attr_unit || ''} · 权重 ${attr.weight > 0 ? attr.weight : 1}`
                          : '无目标'
                      } · ${weekdaysLabel}`
                      const scheduleMetaText = buildScheduleSettingText(attr, schedule)
                      return (
                      <li key={attr.attr_id} className="group px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-800">
                              {attr.attr_name}
                              {schedule.type === 'shared_days' ? (
                                <span className="ml-1 inline-flex rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title={sharedHint || undefined}>
                                  共享
                                </span>
                              ) : null}
                            </p>
                            <p className="text-xs text-slate-500" title={scheduleRuleEnabled ? scheduleMetaText : legacyMetaText}>
                              {scheduleRuleEnabled ? scheduleMetaText : legacyMetaText}
                            </p>
                          </div>
                          <div className="relative">
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 md:hidden"
                              onClick={() => setAttrActionMenuId((prev) => (prev === attr.attr_id ? null : attr.attr_id))}
                              disabled={attr.attr_sign !== 0 || isOverview}
                              aria-label="打开属性操作菜单"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>

                            {attrActionMenuId === attr.attr_id ? (
                              <div className="absolute right-0 top-9 z-20 min-w-[110px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg md:hidden">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="w-full justify-start"
                                  iconLeft={<PencilLine className="h-3.5 w-3.5" />}
                                  disabled={attr.attr_sign !== 0 || isOverview}
                                  onClick={() => {
                                    setAttrActionMenuId(null)
                                    onStartEditAttr(attr)
                                  }}
                                >
                                  编辑
                                </Button>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  className="w-full justify-start"
                                  iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                                  disabled={attr.attr_sign !== 0 || isOverview}
                                  onClick={() => {
                                    setAttrActionMenuId(null)
                                    void onDeleteAttr(attr.attr_id)
                                  }}
                                >
                                  删除
                                </Button>
                              </div>
                            ) : null}

                            <div className="hidden items-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 md:flex">
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={attr.attr_sign !== 0 || isOverview}
                                iconLeft={<PencilLine className="h-3.5 w-3.5" />}
                                onClick={() => onStartEditAttr(attr)}
                              >
                                编辑
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={attr.attr_sign !== 0 || isOverview}
                                iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                                onClick={() => void onDeleteAttr(attr.attr_id)}
                              >
                                删除
                              </Button>
                            </div>
                          </div>
                        </div>
                      </li>
                    )})}
                  </ul>
                )}
              </div>
                </>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
