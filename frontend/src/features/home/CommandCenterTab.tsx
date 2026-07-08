import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Pause, Play, RefreshCw, Save, Settings2, Sparkles, X } from 'lucide-react'

import {
  buildAiSummaryClipboardText,
  buildAiSummaryMarkdown,
  buildAiSummaryMarkdownFilename,
  downloadTextFile,
  getAiProviderLabel
} from '@/lib/ai'
import { formatLocalDateTime } from '@/lib/format'
import { formatPeriodLabel } from '@/lib/period'
import { parseScheduleConfig, toIsoWeekday } from '../../../../packages/core/src/schedule'
import {
  deriveTimeLinkageLabelMeta,
  deriveTimeLinkageMeta,
  getSystemTodayKey,
  type TimeLinkageMeta
} from './timeLinkage'
import { Button, Card, CardContent, CardHeader, CardTitle } from '../../../../packages/ui/src'
import type {
  AiSummaryPayload,
  BatchRecordEntry,
  FocusCaptureResult,
  GlobalRecordCard,
  HomeSnapshot,
  PendingReviewCard,
  SettlementReport
} from '@/api/types'

type CommandCenterTabProps = {
  snapshot: HomeSnapshot | null
  loading: boolean
  recordDate: string
  selectedTaskIds: number[]
  onRecordDateChange: (value: string) => void
  onSelectedTaskIdsChange: (taskIds: number[]) => void
  onRefresh: () => Promise<void>
  onSaveEntries: (entries: BatchRecordEntry[]) => Promise<boolean>
  onLoadSettlementReport: (taskId: number, attrId: number) => Promise<SettlementReport>
  onLoadAiSummary: (taskId: number, attrId: number) => Promise<AiSummaryPayload>
  onFocusCapture: (input: {
    taskId: number
    timerAttrId?: number
    startTime: string
    durationSeconds: number
    recordDate: string
  }) => Promise<FocusCaptureResult>
  onApplySettlementAction: (input: { taskId: number; attrId: number; action: 'renew' | 'archive' }) => Promise<void>
  onEvolvePending: (taskId: number, attrId: number) => void
  onOpenProjectManager: () => void
  onOpenTime: (taskId: number, attrId?: number) => void
}

type TaskSwimlane = {
  task_id: number
  task_name: string
  task_color: string
  items: GlobalRecordCard[]
}

type FocusSheetState = {
  open_token: number
  task_id: number
  task_name: string
  task_color: string
  trigger: 'number' | 'timer'
  initial_timer_attr_id: number | null
  auto_start: boolean
}

type FocusTimerMode = 'countup' | 'countdown'
type CardPeriodMeta = {
  showWeekView: boolean
  activeWeekdays: number[]
  anchorWeekday: number
  sharedWeekdaysOfAnchor: number[]
  sharedBadge: string | null
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

function isSameValue(left: number | null, right: number | null): boolean {
  if (left == null && right == null) return true
  if (left == null || right == null) return false
  return Number(left) === Number(right)
}

function toDisplayValue(value: number | null): string {
  if (value == null) return ''
  if (Number.isInteger(value)) return String(Math.trunc(value))
  return String(value)
}

function formatMetric(value: number | null | undefined, suffix = ''): string {
  if (value == null) return '-'
  if (Number.isInteger(value)) return `${Math.trunc(value)}${suffix}`
  return `${value.toFixed(2)}${suffix}`
}

function normalizeWeekdays(weekdays: number[]): number[] {
  return Array.from(new Set(weekdays))
    .filter((day) => Number.isFinite(day) && day >= 1 && day <= 7)
    .sort((a, b) => a - b)
}

function hasSchedulePlanning(schedule: ReturnType<typeof parseScheduleConfig>): boolean {
  return (
    schedule.type !== 'daily' ||
    schedule.shared_weekday_groups.length > 0 ||
    Object.keys(schedule.target_overrides).length > 0 ||
    schedule.period_start != null ||
    schedule.period_end != null
  )
}

function formatWeekdaySpan(weekdays: number[]): string {
  const normalized = normalizeWeekdays(weekdays)
  if (normalized.length === 0) return '-'
  if (normalized.length === 1) return `周${WEEKDAY_LABELS[normalized[0] - 1]}`

  let contiguous = true
  for (let idx = 1; idx < normalized.length; idx += 1) {
    if (normalized[idx] !== normalized[idx - 1] + 1) {
      contiguous = false
      break
    }
  }
  if (contiguous) {
    const first = WEEKDAY_LABELS[normalized[0] - 1]
    const last = WEEKDAY_LABELS[normalized[normalized.length - 1] - 1]
    return `周${first}至周${last}`
  }
  return normalized.map((day) => `周${WEEKDAY_LABELS[day - 1]}`).join('、')
}

function resolveCardPeriodMeta(card: GlobalRecordCard, dateKey: string): CardPeriodMeta {
  const schedule = parseScheduleConfig(card.calc_config)
  const showWeekView = hasSchedulePlanning(schedule)
  if (!showWeekView) {
    return {
      showWeekView: false,
      activeWeekdays: [],
      anchorWeekday: toIsoWeekday(dateKey),
      sharedWeekdaysOfAnchor: [],
      sharedBadge: null
    }
  }

  const activeWeekdays = schedule.type === 'daily'
    ? [...ALL_WEEKDAYS]
    : schedule.active_weekdays.length > 0
      ? normalizeWeekdays(schedule.active_weekdays)
      : [...ALL_WEEKDAYS]

  const anchorWeekday = toIsoWeekday(dateKey)
  const sharedWeekdaysOfAnchor = normalizeWeekdays(
    schedule.shared_weekday_groups.find((group) => group.includes(anchorWeekday) && group.length > 1) ?? []
  )

  return {
    showWeekView: true,
    activeWeekdays,
    anchorWeekday,
    sharedWeekdaysOfAnchor,
    sharedBadge: sharedWeekdaysOfAnchor.length > 1 ? `共享组: ${formatWeekdaySpan(sharedWeekdaysOfAnchor)}` : null
  }
}

function MiniWeekDots({
  meta
}: {
  meta: CardPeriodMeta
}) {
  if (!meta.showWeekView) return null

  const activeSet = new Set(meta.activeWeekdays)
  const sharedSet = new Set(meta.sharedWeekdaysOfAnchor)

  return (
    <div className="inline-flex items-center gap-1" title="生效星期与共享组">
      {WEEKDAY_LABELS.map((label, index) => {
        const weekday = index + 1
        const isActive = activeSet.has(weekday)
        const isShared = sharedSet.has(weekday)
        const isAnchor = meta.anchorWeekday === weekday

        return (
          <span
            key={`mini-week-${weekday}`}
            title={`周${label}${isAnchor ? '（今日）' : ''}${isShared ? '（共享组）' : isActive ? '（生效）' : ''}`}
            className={`inline-block rounded-full border transition ${
              isShared
                ? 'h-2.5 w-2.5 border-amber-300 bg-amber-100'
                : isActive
                  ? 'h-2 w-2 border-[var(--edp-brand-border)] bg-[var(--edp-brand-subtle)]'
                  : 'h-2 w-2 border-slate-200 bg-slate-100'
            } ${isAnchor ? 'ring-2 ring-slate-300/80' : ''}`}
          />
        )
      })}
    </div>
  )
}

function TimeLinkageTitleBadge({
  labelText
}: {
  labelText: string
}) {
  return (
    <>
      <span className="inline-flex h-[18px] items-center rounded-full border border-slate-300 bg-white px-1.5 text-[11px] font-medium text-slate-600">
        时间联动
      </span>
      <span className="text-[11px] font-medium text-slate-500 opacity-0 transition-opacity duration-200 group-hover/time-card:opacity-100 group-focus-within/time-card:opacity-100">
        {labelText}
      </span>
    </>
  )
}

function TaskPropertyTimeLinkage({
  meta,
  pulseToken
}: {
  meta: TimeLinkageMeta
  pulseToken: number
}) {
  const [pointerPulseActive, setPointerPulseActive] = useState(false)

  useEffect(() => {
    if (pulseToken <= 0) return
    setPointerPulseActive(true)
    const handle = window.setTimeout(() => {
      setPointerPulseActive(false)
    }, 760)
    return () => {
      window.clearTimeout(handle)
    }
  }, [pulseToken])

  return (
    <div className="relative mt-1.5 h-[2px] rounded-full bg-[rgba(0,0,0,0.05)]">
      <span
        className={`absolute -top-[4px] h-[10px] w-[2px] rounded-full transition-colors duration-200 ${
          meta.status === 'behind'
            ? 'bg-amber-500 shadow-[0_0_0_1px_rgba(245,158,11,0.15)]'
            : 'bg-[var(--edp-brand)]'
        } ${meta.status === 'ahead' ? 'time-pointer-glow' : ''} ${pointerPulseActive ? 'time-pointer-day-pulse' : ''}`}
        style={{ left: `calc(${meta.timePercent}% - 1px)` }}
        aria-hidden="true"
      />
    </div>
  )
}

function buildEntries(cards: GlobalRecordCard[], drafts: Record<string, number | null>): BatchRecordEntry[] {
  const entries: BatchRecordEntry[] = []
  for (const card of cards) {
    if (!(card.card_id in drafts)) continue
    const nextValue = drafts[card.card_id]
    if (isSameValue(card.today_value, nextValue)) continue
    entries.push({
      task_id: card.task_id,
      attr_id: card.attr_id,
      value: nextValue
    })
  }
  return entries
}

function pendingKey(taskId: number, attrId: number): string {
  return `${taskId}:${attrId}`
}

function resolveInputType(card: GlobalRecordCard): 'boolean' | 'number' | 'timer' {
  const raw = card.ux_config?.input_type
  if (raw === 'boolean' || raw === 'timer' || raw === 'number') return raw
  return 'number'
}

function resolveCurrentValue(card: GlobalRecordCard, draftValues: Record<string, number | null>): number {
  const raw = card.card_id in draftValues ? draftValues[card.card_id] : card.today_value
  if (resolveInputType(card) === 'boolean') {
    return raw != null && raw > 0 ? 1 : 0
  }
  return raw ?? 0
}

function resolveProgressMeta(card: GlobalRecordCard, currentValue: number): {
  targetValue: number | null
  basePct: number
  overPct: number
  overValue: number
  ratio: number | null
} {
  let targetValue: number | null = card.target_value > 0 ? card.target_value : null
  if (targetValue == null && resolveInputType(card) === 'boolean') {
    targetValue = 1
  }

  if (targetValue == null || targetValue <= 0) {
    return {
      targetValue: null,
      basePct: currentValue > 0 ? 100 : 0,
      overPct: 0,
      overValue: 0,
      ratio: null
    }
  }

  const ratio = (currentValue / targetValue) * 100
  const basePct = Math.max(0, Math.min(100, ratio))
  const overPct = ratio > 100 ? Math.max(0, Math.min(100, ratio - 100)) : 0
  const overValue = Math.max(0, currentValue - targetValue)
  return {
    targetValue,
    basePct,
    overPct,
    overValue,
    ratio
  }
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds))
  const h = `${Math.floor(safe / 3600)}`.padStart(2, '0')
  const m = `${Math.floor((safe % 3600) / 60)}`.padStart(2, '0')
  const s = `${safe % 60}`.padStart(2, '0')
  return `${h}:${m}:${s}`
}

export function CommandCenterTab({
  snapshot,
  loading,
  recordDate,
  selectedTaskIds,
  onRecordDateChange,
  onSelectedTaskIdsChange,
  onRefresh,
  onSaveEntries,
  onLoadSettlementReport,
  onLoadAiSummary,
  onFocusCapture,
  onApplySettlementAction,
  onEvolvePending,
  onOpenProjectManager,
  onOpenTime
}: CommandCenterTabProps) {
  const [draftValues, setDraftValues] = useState<Record<string, number | null>>({})
  const [inboxExpanded, setInboxExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const [settlementTarget, setSettlementTarget] = useState<PendingReviewCard | null>(null)
  const [settlementReport, setSettlementReport] = useState<SettlementReport | null>(null)
  const [aiSummary, setAiSummary] = useState<AiSummaryPayload | null>(null)
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)
  const [aiSummaryError, setAiSummaryError] = useState('')
  const [aiCopied, setAiCopied] = useState(false)
  const [aiExported, setAiExported] = useState(false)
  const [settlementLoading, setSettlementLoading] = useState(false)
  const [settlementLoadError, setSettlementLoadError] = useState('')
  const [settlementActionLoading, setSettlementActionLoading] = useState<'renew' | 'archive' | null>(null)

  const [optimisticHiddenPending, setOptimisticHiddenPending] = useState<Set<string>>(new Set())
  const settlementRequestSeq = useRef(0)

  const focusSheetSeq = useRef(0)
  const [focusSheet, setFocusSheet] = useState<FocusSheetState | null>(null)
  const [focusTimerAttrId, setFocusTimerAttrId] = useState<number | null>(null)
  const [focusTimerMode, setFocusTimerMode] = useState<FocusTimerMode>('countup')
  const [focusCountdownMinutes, setFocusCountdownMinutes] = useState(25)
  const [focusTimerRunning, setFocusTimerRunning] = useState(false)
  const [focusTimerElapsed, setFocusTimerElapsed] = useState(0)
  const [focusTimerRemain, setFocusTimerRemain] = useState(0)
  const [focusTimerMessage, setFocusTimerMessage] = useState('')
  const [focusTimerSaving, setFocusTimerSaving] = useState(false)
  const [focusSavingRecords, setFocusSavingRecords] = useState(false)
  const [systemTodayKey, setSystemTodayKey] = useState(() => getSystemTodayKey())
  const [dayPulseToken, setDayPulseToken] = useState(0)
  const [progressSpringSeqByCardId, setProgressSpringSeqByCardId] = useState<Record<string, number>>({})

  const focusTimerHandleRef = useRef<number | null>(null)
  const focusTimerStartMsRef = useRef<number>(0)
  const focusTimerStartIsoRef = useRef<string>('')
  const focusTimerPlannedSecRef = useRef<number>(0)
  const focusTimerStoppingRef = useRef(false)
  const focusAutoStartedTokenRef = useRef<number | null>(null)
  const dayBoundaryTimerRef = useRef<number | null>(null)

  const cards = snapshot?.record_cards ?? []
  const availableTasks = snapshot?.tasks ?? []
  const inboxEvents = snapshot?.inbox_events ?? []
  const pendingCardsRaw = snapshot?.pending_review_cards ?? []
  const changedEntries = useMemo(() => buildEntries(cards, draftValues), [cards, draftValues])

  const cardIdByTaskAttr = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of cards) {
      map.set(pendingKey(item.task_id, item.attr_id), item.card_id)
    }
    return map
  }, [cards])

  useEffect(() => {
    const rawKeys = new Set(pendingCardsRaw.map((item) => pendingKey(item.task_id, item.attr_id)))
    setOptimisticHiddenPending((prev) => {
      const next = new Set<string>()
      for (const key of prev) {
        if (rawKeys.has(key)) next.add(key)
      }
      // Only update state if the set actually changed
      if (next.size === prev.size) {
        const allMatch = Array.from(next).every(k => prev.has(k))
        if (allMatch) return prev
      }
      return next
    })
  }, [pendingCardsRaw])

  useEffect(() => {
    if (!settlementTarget) return
    const exists = pendingCardsRaw.some(
      (item) => item.task_id === settlementTarget.task_id && item.attr_id === settlementTarget.attr_id
    )
    if (!exists) {
      setSettlementTarget(null)
      setSettlementReport(null)
      setAiSummary(null)
      setAiSummaryError('')
      setSettlementLoadError('')
    }
  }, [pendingCardsRaw, settlementTarget])

  useEffect(() => {
    return () => {
      if (focusTimerHandleRef.current != null) {
        window.clearInterval(focusTimerHandleRef.current)
        focusTimerHandleRef.current = null
      }
      if (dayBoundaryTimerRef.current != null) {
        window.clearTimeout(dayBoundaryTimerRef.current)
        dayBoundaryTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (dayBoundaryTimerRef.current != null) {
      window.clearTimeout(dayBoundaryTimerRef.current)
      dayBoundaryTimerRef.current = null
    }

    const now = new Date()
    const nextBoundary = new Date(now)
    nextBoundary.setHours(24, 0, 1, 0)
    const delay = Math.max(1000, nextBoundary.getTime() - now.getTime())

    dayBoundaryTimerRef.current = window.setTimeout(() => {
      const nextKey = getSystemTodayKey()
      setSystemTodayKey((prev) => {
        if (prev === nextKey) return prev
        setDayPulseToken((token) => token + 1)
        return nextKey
      })
    }, delay)

    return () => {
      if (dayBoundaryTimerRef.current != null) {
        window.clearTimeout(dayBoundaryTimerRef.current)
        dayBoundaryTimerRef.current = null
      }
    }
  }, [systemTodayKey])

  const pendingCards = useMemo(
    () => pendingCardsRaw.filter((item) => !optimisticHiddenPending.has(pendingKey(item.task_id, item.attr_id))),
    [optimisticHiddenPending, pendingCardsRaw]
  )

  const taskOrder = useMemo(() => {
    const map = new Map<number, number>()
    availableTasks.forEach((task, index) => {
      map.set(task.task_id, index)
    })
    return map
  }, [availableTasks])

  const swimlanes = useMemo<TaskSwimlane[]>(() => {
    const byTask = new Map<number, TaskSwimlane>()
    for (const card of cards) {
      const existing = byTask.get(card.task_id)
      if (existing) {
        existing.items.push(card)
        continue
      }
      byTask.set(card.task_id, {
        task_id: card.task_id,
        task_name: card.task_name,
        task_color: card.task_color,
        items: [card]
      })
    }

    return Array.from(byTask.values()).sort((left, right) => {
      const leftOrder = taskOrder.get(left.task_id) ?? Number.MAX_SAFE_INTEGER
      const rightOrder = taskOrder.get(right.task_id) ?? Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      return left.task_id - right.task_id
    })
  }, [cards, taskOrder])

  const periodMetaByCardId = useMemo(() => {
    const map = new Map<string, CardPeriodMeta>()
    for (const card of cards) {
      map.set(card.card_id, resolveCardPeriodMeta(card, recordDate))
    }
    return map
  }, [cards, recordDate])

  const timeLinkageMetaByCardId = useMemo(() => {
    const map = new Map<string, TimeLinkageMeta>()
    for (const card of cards) {
      const currentValue = resolveCurrentValue(card, draftValues)
      const progress = resolveProgressMeta(card, currentValue)
      const meta = deriveTimeLinkageMeta(card, progress.ratio, systemTodayKey)
      if (meta) {
        map.set(card.card_id, meta)
      }
    }
    return map
  }, [cards, draftValues, systemTodayKey])
  const timeLinkageLabelByCardId = useMemo(() => {
    const map = new Map<string, string>()
    for (const card of cards) {
      const label = deriveTimeLinkageLabelMeta(card)
      if (!label) continue
      map.set(card.card_id, label.labelText)
    }
    return map
  }, [cards])

  const focusSheetCards = useMemo(() => {
    if (!focusSheet) return []
    return cards.filter((item) => item.task_id === focusSheet.task_id)
  }, [cards, focusSheet])

  const focusSheetTimerCards = useMemo(
    () => focusSheetCards.filter((item) => resolveInputType(item) === 'timer'),
    [focusSheetCards]
  )
  const focusSelectedTimerCard = useMemo(
    () => focusSheetTimerCards.find((item) => item.attr_id === focusTimerAttrId) ?? focusSheetTimerCards[0] ?? null,
    [focusTimerAttrId, focusSheetTimerCards]
  )
  const focusTimerPeriodMeta = useMemo(() => {
    if (!focusSelectedTimerCard) return null
    return periodMetaByCardId.get(focusSelectedTimerCard.card_id) ?? resolveCardPeriodMeta(focusSelectedTimerCard, recordDate)
  }, [focusSelectedTimerCard, periodMetaByCardId, recordDate])
  const focusTimerTimeLinkageMeta = useMemo(() => {
    if (!focusSelectedTimerCard) return null
    return timeLinkageMetaByCardId.get(focusSelectedTimerCard.card_id) ?? null
  }, [focusSelectedTimerCard, timeLinkageMetaByCardId])
  const focusTimerTimeLinkageLabel = useMemo(() => {
    if (!focusSelectedTimerCard) return null
    return timeLinkageLabelByCardId.get(focusSelectedTimerCard.card_id) ?? null
  }, [focusSelectedTimerCard, timeLinkageLabelByCardId])

  const focusSheetNumberCards = useMemo(
    () => focusSheetCards.filter((item) => resolveInputType(item) === 'number'),
    [focusSheetCards]
  )

  const focusSheetBooleanCards = useMemo(
    () => focusSheetCards.filter((item) => resolveInputType(item) === 'boolean'),
    [focusSheetCards]
  )

  const focusSheetEditableCards = useMemo(
    () => [...focusSheetNumberCards, ...focusSheetBooleanCards],
    [focusSheetBooleanCards, focusSheetNumberCards]
  )

  const focusSheetChangedEntries = useMemo(
    () => buildEntries(focusSheetEditableCards, draftValues),
    [draftValues, focusSheetEditableCards]
  )

  useEffect(() => {
    if (!focusSheet) {
      setFocusTimerAttrId(null)
      return
    }

    if (focusSheetTimerCards.length === 0) {
      setFocusTimerAttrId(null)
      return
    }

    const initialId =
      focusSheet.initial_timer_attr_id != null &&
      focusSheetTimerCards.some((item) => item.attr_id === focusSheet.initial_timer_attr_id)
        ? focusSheet.initial_timer_attr_id
        : focusSheetTimerCards[0].attr_id

    setFocusTimerAttrId(initialId)
  }, [focusSheet, focusSheetTimerCards])

  useEffect(() => {
    if (!focusSheet || !focusSheet.auto_start) return
    if (focusAutoStartedTokenRef.current === focusSheet.open_token) return
    if (focusTimerRunning) return
    if (focusTimerAttrId == null) return

    focusAutoStartedTokenRef.current = focusSheet.open_token
    void startFocusTimer()
  }, [focusSheet, focusTimerAttrId, focusTimerRunning])

  function toggleTask(taskId: number) {
    const selected = new Set(selectedTaskIds)
    if (selected.has(taskId)) {
      if (selected.size <= 1) return
      selected.delete(taskId)
    } else {
      selected.add(taskId)
    }
    onSelectedTaskIdsChange(Array.from(selected).sort((a, b) => a - b))
  }

  function setNumberDraft(card: GlobalRecordCard, raw: string) {
    const value = raw.trim()
    if (value === '') {
      setDraftValues((prev) => ({ ...prev, [card.card_id]: null }))
      return
    }
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return
    setDraftValues((prev) => ({ ...prev, [card.card_id]: numeric }))
  }

  function addQuickStep(card: GlobalRecordCard) {
    const step = Number.isFinite(card.ux_config.quick_step) && card.ux_config.quick_step > 0 ? card.ux_config.quick_step : 1
    const current = draftValues[card.card_id] ?? card.today_value ?? 0
    setDraftValues((prev) => ({ ...prev, [card.card_id]: current + step }))
    setProgressSpringSeqByCardId((prev) => ({
      ...prev,
      [card.card_id]: (prev[card.card_id] ?? 0) + 1
    }))
  }

  function toggleBooleanDraft(card: GlobalRecordCard) {
    const step = Number.isFinite(card.ux_config.quick_step) && card.ux_config.quick_step > 0 ? card.ux_config.quick_step : 1
    const current = draftValues[card.card_id] ?? card.today_value
    const checked = current != null && current > 0
    setDraftValues((prev) => ({ ...prev, [card.card_id]: checked ? null : step }))
  }

  function openFocusSheet(card: GlobalRecordCard, trigger: 'number' | 'timer') {
    focusSheetSeq.current += 1
    setFocusTimerMode('countup')
    setFocusCountdownMinutes(25)
    setFocusTimerMessage('')
    setFocusSheet({
      open_token: focusSheetSeq.current,
      task_id: card.task_id,
      task_name: card.task_name,
      task_color: card.task_color,
      trigger,
      initial_timer_attr_id: trigger === 'timer' ? card.attr_id : null,
      auto_start: trigger === 'timer'
    })
  }

  async function handleSave() {
    if (changedEntries.length === 0) return
    setSaving(true)
    try {
      const ok = await onSaveEntries(changedEntries)
      if (ok) setDraftValues({})
    } finally {
      setSaving(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await onRefresh()
      setDraftValues({})
    } finally {
      setRefreshing(false)
    }
  }

  function clearFocusTimerInterval() {
    if (focusTimerHandleRef.current != null) {
      window.clearInterval(focusTimerHandleRef.current)
      focusTimerHandleRef.current = null
    }
  }

  function tickFocusTimer() {
    const elapsed = Math.max(0, Math.floor((Date.now() - focusTimerStartMsRef.current) / 1000))
    setFocusTimerElapsed(elapsed)
    if (focusTimerMode === 'countdown') {
      const remain = Math.max(0, focusTimerPlannedSecRef.current - elapsed)
      setFocusTimerRemain(remain)
      if (remain <= 0) {
        void stopFocusTimer(false)
      }
    }
  }

  async function startFocusTimer() {
    if (!focusSheet) return
    if (focusTimerRunning || focusTimerSaving) return
    if (focusTimerAttrId == null && focusSheetTimerCards.length > 0) return

    setFocusTimerMessage('')
    setFocusTimerRunning(true)
    setFocusTimerElapsed(0)
    focusTimerStartMsRef.current = Date.now()
    focusTimerStartIsoRef.current = new Date(focusTimerStartMsRef.current).toISOString()
    focusTimerPlannedSecRef.current = focusTimerMode === 'countdown' ? Math.max(60, Math.round(focusCountdownMinutes * 60)) : 0
    setFocusTimerRemain(focusTimerPlannedSecRef.current)
    clearFocusTimerInterval()
    focusTimerHandleRef.current = window.setInterval(tickFocusTimer, 1000)
  }

  async function stopFocusTimer(manualStop: boolean) {
    if (!focusSheet) return
    if (!focusTimerRunning || focusTimerStoppingRef.current) return

    focusTimerStoppingRef.current = true
    setFocusTimerSaving(true)
    clearFocusTimerInterval()
    setFocusTimerRunning(false)

    const durationSeconds = Math.max(1, focusTimerElapsed)
    try {
      const result = await onFocusCapture({
        taskId: focusSheet.task_id,
        timerAttrId: focusTimerAttrId ?? undefined,
        startTime: focusTimerStartIsoRef.current,
        durationSeconds,
        recordDate
      })

      if (result.timer_attr_id != null && result.timer_attr_value_today != null) {
        const key = pendingKey(result.task_id, result.timer_attr_id)
        const cardId = cardIdByTaskAttr.get(key)
        if (cardId) {
          setDraftValues((prev) => ({ ...prev, [cardId]: result.timer_attr_value_today }))
        }
      }

      if (focusTimerMode === 'countdown') {
        setFocusTimerMessage(manualStop ? `倒计时提前结束，记录 ${formatMetric(durationSeconds, 's')}` : `倒计时完成，记录 ${formatMetric(durationSeconds, 's')}`)
      } else {
        setFocusTimerMessage(`正计时结束，记录 ${formatMetric(durationSeconds, 's')}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '专注记录失败'
      setFocusTimerMessage(message || '专注记录失败')
    } finally {
      setFocusTimerElapsed(0)
      setFocusTimerRemain(0)
      setFocusTimerSaving(false)
      focusTimerStoppingRef.current = false
    }
  }

  async function closeFocusSheet() {
    if (focusTimerRunning) {
      await stopFocusTimer(true)
    }
    clearFocusTimerInterval()
    setFocusSheet(null)
    setFocusTimerRunning(false)
    setFocusTimerSaving(false)
    setFocusTimerElapsed(0)
    setFocusTimerRemain(0)
    setFocusTimerMessage('')
  }

  async function saveFocusSheetEntries() {
    if (focusSheetChangedEntries.length === 0) return
    setFocusSavingRecords(true)
    try {
      const ok = await onSaveEntries(focusSheetChangedEntries)
      if (!ok) return
      const changedKeys = new Set(focusSheetChangedEntries.map((item) => pendingKey(item.task_id, item.attr_id)))
      setDraftValues((prev) => {
        const next = { ...prev }
        for (const card of focusSheetEditableCards) {
          if (changedKeys.has(pendingKey(card.task_id, card.attr_id))) {
            delete next[card.card_id]
          }
        }
        return next
      })
    } finally {
      setFocusSavingRecords(false)
    }
  }

  async function openSettlement(card: PendingReviewCard) {
    setSettlementTarget(card)
    setSettlementReport(null)
    setAiSummary(null)
    setAiSummaryError('')
    setSettlementLoadError('')
    setSettlementLoading(true)
    setAiSummaryLoading(true)

    settlementRequestSeq.current += 1
    const seq = settlementRequestSeq.current

    try {
      const report = await onLoadSettlementReport(card.task_id, card.attr_id)
      if (settlementRequestSeq.current !== seq) return
      setSettlementReport(report)
      try {
        const summary = await onLoadAiSummary(card.task_id, card.attr_id)
        if (settlementRequestSeq.current !== seq) return
        setAiSummary(summary)
      } catch (summaryError) {
        if (settlementRequestSeq.current !== seq) return
        const summaryMessage = summaryError instanceof Error ? summaryError.message : 'AI 复盘加载失败'
        setAiSummaryError(summaryMessage || 'AI 复盘加载失败')
      }
    } catch (error) {
      if (settlementRequestSeq.current !== seq) return
      const message = error instanceof Error ? error.message : '结算报告加载失败'
      setSettlementLoadError(message || '结算报告加载失败')
    } finally {
      if (settlementRequestSeq.current === seq) {
        setSettlementLoading(false)
        setAiSummaryLoading(false)
      }
    }
  }

  async function refreshAiSummary() {
    if (!settlementTarget) return
    setAiSummaryLoading(true)
    setAiSummaryError('')
    try {
      const summary = await onLoadAiSummary(settlementTarget.task_id, settlementTarget.attr_id)
      setAiSummary(summary)
    } catch (summaryError) {
      const summaryMessage = summaryError instanceof Error ? summaryError.message : 'AI 复盘加载失败'
      setAiSummaryError(summaryMessage || 'AI 复盘加载失败')
    } finally {
      setAiSummaryLoading(false)
    }
  }

  async function copyAiSummary() {
    if (!aiSummary) return
    await navigator.clipboard.writeText(buildAiSummaryClipboardText(aiSummary))
    setAiCopied(true)
    window.setTimeout(() => setAiCopied(false), 1500)
  }

  function exportAiSummary() {
    if (!aiSummary) return
    downloadTextFile(
      buildAiSummaryMarkdown(aiSummary),
      buildAiSummaryMarkdownFilename(aiSummary),
      'text/markdown;charset=utf-8'
    )
    setAiExported(true)
    window.setTimeout(() => setAiExported(false), 1500)
  }

  async function runSettlementAction(action: 'renew' | 'archive') {
    if (!settlementTarget) return
    const target = settlementTarget
    const key = pendingKey(target.task_id, target.attr_id)

    setSettlementActionLoading(action)
    setOptimisticHiddenPending((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
    setSettlementTarget(null)
    setSettlementReport(null)
    setAiSummary(null)
    setAiSummaryError('')
    setSettlementLoadError('')

    try {
      await onApplySettlementAction({
        taskId: target.task_id,
        attrId: target.attr_id,
        action
      })
    } catch {
      setOptimisticHiddenPending((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    } finally {
      setSettlementActionLoading(null)
    }
  }

  function runEvolveAction() {
    if (!settlementTarget) return
    const target = settlementTarget
    setSettlementTarget(null)
    setSettlementReport(null)
    setAiSummary(null)
    setAiSummaryError('')
    setSettlementLoadError('')
    onEvolvePending(target.task_id, target.attr_id)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>今日指挥中心</CardTitle>
              <p className="mt-1 text-xs text-slate-500">全局查看今天要处理的所有属性，任务仅作为筛选标签</p>
            </div>
            <Button variant="ghost" size="sm" iconLeft={<Settings2 className="h-4 w-4" />} onClick={onOpenProjectManager}>
              项目管理
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[220px_auto] sm:items-center">
            <input
              className="input-clean"
              type="date"
              value={recordDate}
              onChange={(e) => onRecordDateChange(e.target.value)}
              disabled={loading || refreshing}
            />
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />}
              disabled={loading || refreshing}
              onClick={() => void handleRefresh()}
            >
              刷新
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {availableTasks.map((task) => {
              const selected = selectedTaskIds.includes(task.task_id)
              return (
                <button
                  key={`home-filter-${task.task_id}`}
                  type="button"
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                    selected
                      ? 'border-[var(--edp-brand-border)] bg-[var(--edp-brand-subtle)] text-[var(--edp-brand-strong)]'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
                  }`}
                  onClick={() => toggleTask(task.task_id)}
                >
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: task.task_color || '#94a3b8' }} />
                  {task.task_name}
                </button>
              )
            })}
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <CardTitle>待结算彩蛋</CardTitle>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">{pendingCards.length}</span>
            </div>
            <span className="text-[11px] text-slate-500">始终全局展示，不受任务筛选影响</span>
          </div>
        </CardHeader>
        <CardContent>
          {pendingCards.length === 0 ? (
            <p className="text-sm text-slate-400">当前没有待结算周期，继续保持今天的节奏</p>
          ) : (
            <ul className="space-y-3">
              {pendingCards.map((card) => (
                <li key={card.card_id} className="pending-ritual-card rounded-2xl p-[1px]">
                  <div className="pending-ritual-inner rounded-2xl bg-white px-3 py-3 sm:px-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{card.title}</p>
                        <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: card.task_color || '#94a3b8' }} />
                          {card.task_name} · {card.attr_name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          周期 {formatPeriodLabel(card.period_start, card.period_end)} · 已过期 {card.ended_days_ago} 天
                        </p>
                      </div>
                      <Button
                        size="sm"
                        className="pending-ritual-cta"
                        onClick={() => void openSettlement(card)}
                        disabled={settlementActionLoading != null}
                      >
                        {card.cta_label}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>今日属性面板</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              待办 {snapshot?.todo_summary.total ?? 0} · 已完成 {snapshot?.todo_summary.completed ?? 0} · 今日专注 {snapshot?.focus_summary.todaySeconds ?? 0}s
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{changedEntries.length > 0 ? `${changedEntries.length} 条待保存` : '已同步'}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              iconLeft={<Save className="h-4 w-4" />}
              disabled={saving || changedEntries.length === 0}
              onClick={() => void handleSave()}
              aria-label="保存今日属性"
              title={changedEntries.length > 0 ? `保存 ${changedEntries.length} 条修改` : '无修改可保存'}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">正在加载指挥中心数据...</p>
          ) : cards.length === 0 ? (
            <p className="text-sm text-slate-400">当前筛选下没有可记录属性</p>
          ) : (
            <div className="space-y-8">
              {swimlanes.map((lane) => {
                const completedCount = lane.items.reduce((count, card) => {
                  const draft = card.card_id in draftValues ? draftValues[card.card_id] : card.today_value
                  if (resolveInputType(card) === 'boolean') {
                    return draft != null && draft > 0 ? count + 1 : count
                  }
                  return draft != null ? count + 1 : count
                }, 0)

                return (
                  <section key={`swimlane-${lane.task_id}`} className="space-y-3">
                    <header className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: lane.task_color || '#94a3b8' }}
                        />
                        <h3 className="truncate text-sm font-semibold text-slate-800">{lane.task_name}</h3>
                      </div>
                      <span className="text-xs text-slate-500">{completedCount}/{lane.items.length} 已填写</span>
                    </header>

                    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {lane.items.map((card) => {
                        const inputType = resolveInputType(card)
                        const draftRaw = card.card_id in draftValues ? draftValues[card.card_id] : card.today_value
                        const toggleChecked = draftRaw != null && draftRaw > 0
                        const currentValue = resolveCurrentValue(card, draftValues)
                        const progress = resolveProgressMeta(card, currentValue)
                        const unit = card.attr_unit || ''
                        const periodMeta = periodMetaByCardId.get(card.card_id) ?? resolveCardPeriodMeta(card, recordDate)
                        const timeLinkageMeta = timeLinkageMetaByCardId.get(card.card_id) ?? null
                        const timeLinkageLabel = timeLinkageLabelByCardId.get(card.card_id) ?? null
                        const progressSpringSeq = progressSpringSeqByCardId[card.card_id] ?? 0

                        return (
                          <li key={card.card_id} className="group/time-card rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <p className="truncate text-sm font-semibold text-slate-900" title={card.attr_name}>
                                  {card.attr_name}
                                </p>
                                {timeLinkageLabel ? <TimeLinkageTitleBadge labelText={timeLinkageLabel} /> : null}
                              </div>
                              {periodMeta.showWeekView ? (
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  {periodMeta.sharedBadge ? (
                                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                      {periodMeta.sharedBadge}
                                    </span>
                                  ) : null}
                                  <MiniWeekDots meta={periodMeta} />
                                </div>
                              ) : null}
                            </div>

                            <div className="mt-3 space-y-2">
                              {inputType === 'boolean' ? (
                                <button
                                  type="button"
                                  onClick={() => toggleBooleanDraft(card)}
                                  className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${
                                    toggleChecked
                                      ? 'border-[var(--edp-brand-border)] bg-[var(--edp-brand-subtle)] text-[var(--edp-brand-strong)]'
                                      : 'border-slate-300 bg-white text-slate-400 hover:border-slate-400'
                                  }`}
                                  title={toggleChecked ? '已完成，点击撤销' : '点击完成'}
                                >
                                  <Check className="h-5 w-5" />
                                </button>
                              ) : inputType === 'timer' ? (
                                <Button size="sm" className="h-10" iconLeft={<Play className="h-4 w-4" />} onClick={() => onOpenTime(card.task_id, card.attr_id)}>
                                  开始专注
                                </Button>
                              ) : (
                                <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                                  <button
                                    type="button"
                                    className="min-h-10 rounded-lg px-1 text-left transition hover:bg-slate-100/70"
                                    onClick={() => openFocusSheet(card, 'number')}
                                    title="点击进入任务专注空间"
                                  >
                                    <span className="inline-flex items-baseline gap-1.5">
                                      <span className="text-3xl font-bold leading-none text-slate-900 tabular-nums">
                                        {formatMetric(currentValue, unit)}
                                      </span>
                                      <span className="text-sm font-medium text-slate-400 tabular-nums">
                                        {progress.targetValue == null ? '' : `/ ${formatMetric(progress.targetValue, unit)}`}
                                      </span>
                                    </span>
                                  </button>
                                  <Button size="sm" variant="ghost" onClick={() => addQuickStep(card)}>
                                    +{Number.isFinite(card.ux_config.quick_step) && card.ux_config.quick_step > 0 ? card.ux_config.quick_step : 1}
                                  </Button>
                                </div>
                              )}
                            </div>

                            <div className="mt-2 space-y-1">
                              <div className="relative h-1.5 overflow-hidden rounded-full bg-slate-200">
                                <span
                                  key={`progress-base-${card.card_id}-${progressSpringSeq}`}
                                  className="progress-fill-spring absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
                                  style={{
                                    width: `${progress.basePct}%`,
                                    backgroundColor: card.task_color || 'var(--edp-brand)'
                                  }}
                                />
                                {progress.overPct > 0 ? (
                                  <span
                                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-300 via-yellow-300 to-emerald-400 transition-[width] duration-300 ease-out"
                                    style={{ width: `${progress.overPct}%` }}
                                  />
                                ) : null}
                              </div>
                              {progress.overValue > 0 ? (
                                <p className="text-[11px] font-medium text-emerald-700">再跑一圈 +{formatMetric(progress.overValue, unit)}</p>
                              ) : null}
                              {timeLinkageMeta ? <TaskPropertyTimeLinkage meta={timeLinkageMeta} pulseToken={dayPulseToken} /> : null}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <CardTitle>Inbox 摘要</CardTitle>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">{inboxEvents.length}</span>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            onClick={() => setInboxExpanded((prev) => !prev)}
          >
            <ChevronDown className={`h-4 w-4 transition ${inboxExpanded ? 'rotate-180' : ''}`} />
            {inboxExpanded ? '收起' : '展开'}
          </button>
        </CardHeader>
        {inboxExpanded ? (
          <CardContent>
            {inboxEvents.length === 0 ? (
              <p className="text-sm text-slate-400">暂无跨任务事件</p>
            ) : (
              <ul className="space-y-2">
                {inboxEvents.map((event) => (
                  <li
                    key={event.event_id}
                    className={`rounded-xl border p-3 ${
                      event.severity === 'error' ? 'border-rose-200 bg-rose-50/70' : 'border-amber-200 bg-amber-50/70'
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                    <p className="mt-1 text-xs text-slate-600">{event.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        ) : null}
      </Card>

      {focusSheet ? (
        <div className="fixed inset-0 z-[65] flex items-end bg-slate-900/35 sm:items-center sm:justify-center sm:p-4">
          <div className="focus-sheet-panel w-full rounded-t-3xl border border-slate-200 bg-white p-4 shadow-2xl sm:max-w-3xl sm:rounded-2xl sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">任务专注空间</p>
                <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: focusSheet.task_color || '#94a3b8' }} />
                  {focusSheet.task_name}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void closeFocusSheet()} disabled={focusTimerSaving || focusSavingRecords}>
                收起
              </Button>
            </div>

            <section className="group/time-card rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium text-slate-600">计时区</p>
                  {focusTimerTimeLinkageLabel ? <TimeLinkageTitleBadge labelText={focusTimerTimeLinkageLabel} /> : null}
                </div>
                {focusSheetTimerCards.length > 1 ? (
                  <select
                    className="input-clean h-8 w-auto min-w-[180px] px-2 text-xs"
                    value={focusTimerAttrId ?? ''}
                    onChange={(e) => setFocusTimerAttrId(e.target.value ? Number(e.target.value) : null)}
                    disabled={focusTimerRunning || focusTimerSaving}
                  >
                    {focusSheetTimerCards.map((item) => (
                      <option key={`focus-timer-${item.attr_id}`} value={item.attr_id}>
                        计时属性：{item.attr_name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              {focusTimerPeriodMeta?.showWeekView ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {focusTimerPeriodMeta.sharedBadge ? (
                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      {focusTimerPeriodMeta.sharedBadge}
                    </span>
                  ) : null}
                  <MiniWeekDots meta={focusTimerPeriodMeta} />
                </div>
              ) : null}
              {focusTimerTimeLinkageMeta ? (
                <TaskPropertyTimeLinkage meta={focusTimerTimeLinkageMeta} pulseToken={dayPulseToken} />
              ) : null}

              {focusSheetTimerCards.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">当前任务没有 timer 属性，可先在项目管理中新增计时属性</p>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-1">
                    <button
                      type="button"
                      className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                        focusTimerMode === 'countup' ? 'bg-[var(--edp-brand-subtle)] text-[var(--edp-brand-strong)]' : 'text-slate-500 hover:bg-slate-100'
                      }`}
                      disabled={focusTimerRunning || focusTimerSaving}
                      onClick={() => setFocusTimerMode('countup')}
                    >
                      正计时
                    </button>
                    <button
                      type="button"
                      className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                        focusTimerMode === 'countdown' ? 'bg-[var(--edp-brand-subtle)] text-[var(--edp-brand-strong)]' : 'text-slate-500 hover:bg-slate-100'
                      }`}
                      disabled={focusTimerRunning || focusTimerSaving}
                      onClick={() => setFocusTimerMode('countdown')}
                    >
                      倒计时
                    </button>
                  </div>

                  {focusTimerMode === 'countdown' ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">分钟</span>
                      <input
                        className="input-clean h-9 w-24"
                        type="number"
                        min={1}
                        value={focusCountdownMinutes}
                        onChange={(e) => setFocusCountdownMinutes(Math.max(1, Number(e.target.value || 1)))}
                        disabled={focusTimerRunning || focusTimerSaving}
                      />
                    </div>
                  ) : null}

                  <p className="text-center text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
                    {focusTimerMode === 'countdown' ? formatClock(focusTimerRemain) : formatClock(focusTimerElapsed)}
                  </p>

                  <div className="flex items-center gap-2"><Button size="sm" iconLeft={<Play className="h-4 w-4" />} onClick={() => {
                    onOpenTime(focusSheet.task_id, focusTimerAttrId ?? undefined)
                    void closeFocusSheet()
                  }}>前往 Time 计时</Button><span className="text-xs text-slate-500">计时统一在 Time 页面完成</span></div>

                  {focusTimerMessage ? <p className="text-xs text-[var(--edp-brand-strong)]">{focusTimerMessage}</p> : null}
                </div>
              )}
            </section>

            <section className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-600">属性聚合填写</p>
                <Button
                  size="sm"
                  variant="ghost"
                  iconLeft={<Save className="h-3.5 w-3.5" />}
                  disabled={focusSavingRecords || focusSheetChangedEntries.length === 0}
                  onClick={() => void saveFocusSheetEntries()}
                >
                  保存 {focusSheetChangedEntries.length}
                </Button>
              </div>

              {focusSheetEditableCards.length === 0 ? (
                <p className="text-xs text-slate-500">当前任务没有 number/boolean 属性可填写</p>
              ) : (
                <ul className="space-y-2">
                  {focusSheetEditableCards.map((card) => {
                    const inputType = resolveInputType(card)
                    const draft = card.card_id in draftValues ? draftValues[card.card_id] : card.today_value
                    const checked = draft != null && draft > 0
                    const value = toDisplayValue(draft)
                    const periodMeta = periodMetaByCardId.get(card.card_id) ?? resolveCardPeriodMeta(card, recordDate)
                    const timeLinkageMeta = timeLinkageMetaByCardId.get(card.card_id) ?? null
                    const timeLinkageLabel = timeLinkageLabelByCardId.get(card.card_id) ?? null
                    return (
                      <li key={`focus-attr-${card.card_id}`} className="group/time-card rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <p className="truncate text-sm font-medium text-slate-800" title={card.attr_name}>{card.attr_name}</p>
                              {timeLinkageLabel ? <TimeLinkageTitleBadge labelText={timeLinkageLabel} /> : null}
                            </div>
                            {periodMeta.showWeekView ? (
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                {periodMeta.sharedBadge ? (
                                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                    {periodMeta.sharedBadge}
                                  </span>
                                ) : null}
                                <MiniWeekDots meta={periodMeta} />
                              </div>
                            ) : null}
                            {timeLinkageMeta ? <TaskPropertyTimeLinkage meta={timeLinkageMeta} pulseToken={dayPulseToken} /> : null}
                          </div>
                          <span className="text-xs text-slate-500">目标 {card.target_value > 0 ? formatMetric(card.target_value, card.attr_unit || '') : '-'}</span>
                        </div>

                        {inputType === 'boolean' ? (
                          <button
                            type="button"
                            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                              checked
                                ? 'border-[var(--edp-brand-border)] bg-[var(--edp-brand-subtle)] text-[var(--edp-brand-strong)]'
                                : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                            }`}
                            onClick={() => toggleBooleanDraft(card)}
                          >
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${
                                checked ? 'border-[var(--edp-brand-border)] bg-white' : 'border-slate-300 bg-slate-100'
                              }`}
                            >
                              <Check className="h-4 w-4" />
                            </span>
                            {checked ? '已完成（点击撤销）' : '点击完成'}
                          </button>
                        ) : (
                          <div className="grid grid-cols-[1fr_auto] gap-2">
                            <input
                              className="input-clean"
                              type="number"
                              step="0.01"
                              value={value}
                              onChange={(e) => setNumberDraft(card, e.target.value)}
                              placeholder="输入数值"
                            />
                            <Button size="sm" variant="ghost" onClick={() => addQuickStep(card)}>
                              +{Number.isFinite(card.ux_config.quick_step) && card.ux_config.quick_step > 0 ? card.ux_config.quick_step : 1}
                            </Button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      ) : null}

      {settlementTarget ? (
        <div
          className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center bg-slate-900/35 p-4"
          onClick={() => {
            if (settlementActionLoading != null) return
            setSettlementTarget(null)
            setSettlementReport(null)
            setAiSummary(null)
            setAiSummaryError('')
            setSettlementLoadError('')
          }}
        >
          <div
            className="settlement-modal w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">属性结算仪式</p>
                <p className="mt-1 text-xs text-slate-500">
                  {settlementTarget.task_name} · {settlementTarget.attr_name}
                </p>
              </div>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                onClick={() => {
                  setSettlementTarget(null)
                  setSettlementReport(null)
                  setAiSummary(null)
                  setAiSummaryError('')
                  setSettlementLoadError('')
                }}
                disabled={settlementActionLoading != null}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {settlementLoading ? (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                <p>正在生成周期复盘...</p>
              </div>
            ) : settlementLoadError ? (
              <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                <p>{settlementLoadError}</p>
              </div>
            ) : settlementReport ? (
              <div className="space-y-4">
                <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">周期区间：{formatPeriodLabel(settlementReport.period_start, settlementReport.period_end)}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-white px-3 py-2">
                      <p className="text-[11px] text-slate-500">实际完成</p>
                      <p className="text-2xl font-bold text-slate-900">{formatMetric(settlementReport.total_actual)}</p>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2">
                      <p className="text-[11px] text-slate-500">综合达成率</p>
                      <p className="text-2xl font-bold text-slate-900">
                        {settlementReport.completion_rate == null ? '未设目标' : `${formatMetric(settlementReport.completion_rate, '%')}`}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-600">{settlementReport.review_copy}</p>
                  {settlementReport.over_target_value != null && settlementReport.over_target_value > 0 ? (
                    <p className="mt-1 text-xs font-medium text-emerald-700">超额完成：{formatMetric(settlementReport.over_target_value)}</p>
                  ) : null}
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900">
                        <Sparkles className="h-4 w-4 text-amber-500" />
                        AI 复盘建议
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        先给建议，不自动改库；真实修改仍然以你的确认和结算动作为准
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {aiSummary?.mode_used ? (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                          {aiSummary.mode_used === 'local_rules' ? '本地规则' : '模型输出'}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void refreshAiSummary()}
                        disabled={aiSummaryLoading || !settlementTarget}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${aiSummaryLoading ? 'animate-spin' : ''}`} />
                        刷新复盘
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void copyAiSummary()}
                        disabled={!aiSummary}
                      >
                        {aiCopied ? '已复制' : '复制总结'}
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={exportAiSummary}
                        disabled={!aiSummary}
                      >
                        {aiExported ? '已导出' : '导出 Markdown'}
                      </button>
                    </div>
                  </div>

                  {aiSummaryLoading ? (
                    <p className="mt-3 text-sm text-slate-500">正在生成 AI 复盘...</p>
                  ) : aiSummaryError ? (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                      <p>{aiSummaryError}</p>
                    </div>
                  ) : aiSummary ? (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
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
                        <p className="mt-2 text-xs font-medium text-slate-700">{aiSummary.sections.overview}</p>
                        <p className="mt-2 whitespace-pre-line text-xs leading-6 text-slate-600">{aiSummary.summary_text}</p>
                      </div>

                      {aiSummary.fallback_reason ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                          <p>{aiSummary.fallback_reason}</p>
                        </div>
                      ) : null}

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-xs font-semibold text-slate-700">关键信号</p>
                          <ul className="mt-2 space-y-1.5 text-xs leading-6 text-slate-600">
                            {aiSummary.sections.signals.map((item, index) => (
                              <li key={`ai-signal-${index}`}>• {item}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-xs font-semibold text-slate-700">下一步建议</p>
                          <ul className="mt-2 space-y-1.5 text-xs leading-6 text-slate-600">
                            {aiSummary.sections.actions.map((item, index) => (
                              <li key={`ai-action-${index}`}>• {item}</li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-500">
                        {aiSummary.runtime_message}
                        {aiSummary.confirmation_required ? ' 所有 AI 建议都需要你确认后才会进入真实数据' : ''}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-400">暂未生成 AI 复盘</p>
                  )}
                </section>

                <section className="space-y-2">
                  <button
                    type="button"
                    className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                      settlementReport.recommended_action === 'renew'
                        ? 'settlement-action-highlight border-[var(--edp-brand-border)] bg-[var(--edp-brand-subtle)]'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                    onClick={() => void runSettlementAction('renew')}
                    disabled={settlementActionLoading != null}
                  >
                    <p className="text-sm font-medium text-[var(--edp-brand-strong)]">🌱 保持节奏 (Renew)</p>
                    <p className="mt-1 text-xs text-slate-600">沿用当前规则，从今天开始续期开启下一周期</p>
                  </button>

                  <button
                    type="button"
                    className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                      settlementReport.recommended_action === 'evolve'
                        ? 'settlement-action-highlight border-sky-200 bg-sky-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                    onClick={runEvolveAction}
                    disabled={settlementActionLoading != null}
                  >
                    <p className="text-sm font-medium text-slate-900">🔥 强度进阶 (Evolve)</p>
                    <p className="mt-1 text-xs text-slate-600">打开属性编辑并默认展开高级周期设置，升级下一阶段规则</p>
                  </button>

                  <button
                    type="button"
                    className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                      settlementReport.recommended_action === 'archive'
                        ? 'settlement-action-highlight border-rose-200 bg-rose-50'
                        : 'border-rose-200 bg-rose-50 hover:bg-rose-100'
                    }`}
                    onClick={() => void runSettlementAction('archive')}
                    disabled={settlementActionLoading != null}
                  >
                    <p className="text-sm font-medium text-rose-700">🎓 荣耀毕业 (Archive)</p>
                    <p className="mt-1 text-xs text-slate-600">结束本段旅程并归档，历史记录会继续保留在统计视图中</p>
                  </button>

                  <p className="text-[11px] text-slate-500">推荐原因：{settlementReport.recommendation_reason}</p>
                </section>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
