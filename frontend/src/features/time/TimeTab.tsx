import dayjs from 'dayjs'
import { AlarmClockPlus, Play, Square } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'

import type { FocusSession, Task, TaskAttrRelation } from '../../../../packages/core/src/types'
import type { PlanTimeContext } from '@/features/plans/PlansTab'
import { formatDuration, todayDateString } from '@/lib/format'
import { Button, Card, CardContent, CardHeader, CardTitle, SegmentedTabs, type SegmentedTabItem } from '../../../../packages/ui/src'

type TimerMode = 'countup' | 'countdown'

type TimeTabProps = {
  timerModeTabs: Array<SegmentedTabItem<TimerMode>>
  timerMode: TimerMode
  countdownMinutes: number
  timerRunning: boolean
  timerElapsed: number
  timerRemain: number
  timerMessage: string
  isGlobalScope: boolean
  currentTaskId: number | null
  tasks: Task[]
  attrs: TaskAttrRelation[]
  scopeTaskId: number
  timerAttrId: number | null
  planContext: PlanTimeContext | null
  currentTaskName?: string
  focusSessions: FocusSession[]
  onScopeTaskIdChange: (taskId: number) => void
  onTimerAttrIdChange: (attrId: number | null) => void
  onClearPlanContext: () => void
  onTimerModeChange: (mode: TimerMode) => void
  onCountdownMinutesChange: (minutes: number) => void
  onStartTimer: () => Promise<void>
  onStopTimer: (manualStop: boolean) => Promise<void>
  onCreateManualSession: (input: {
    taskId: number
    attrId?: number
    startTime: string
    recordDate: string
    durationSeconds: number
    planContext?: PlanTimeContext | null
  }) => Promise<void>
  displayClock: (seconds: number) => string
}

export function TimeTab({
  timerModeTabs,
  timerMode,
  countdownMinutes,
  timerRunning,
  timerElapsed,
  timerRemain,
  timerMessage,
  isGlobalScope,
  currentTaskId,
  tasks,
  attrs,
  scopeTaskId,
  timerAttrId,
  planContext,
  currentTaskName,
  focusSessions,
  onScopeTaskIdChange,
  onTimerAttrIdChange,
  onClearPlanContext,
  onTimerModeChange,
  onCountdownMinutesChange,
  onStartTimer,
  onStopTimer,
  onCreateManualSession,
  displayClock
}: TimeTabProps) {
  const [timelineDate, setTimelineDate] = useState(todayDateString())
  const [timelineStartHour, setTimelineStartHour] = useState(6)
  const [timelineEndHour, setTimelineEndHour] = useState(24)

  const [manualOpen, setManualOpen] = useState(false)
  const [manualTaskId, setManualTaskId] = useState<number | null>(null)
  const [manualDate, setManualDate] = useState(todayDateString())
  const [manualStartTime, setManualStartTime] = useState(dayjs().format('HH:mm'))
  const [manualDurationMinutes, setManualDurationMinutes] = useState(25)
  const [manualSubmitting, setManualSubmitting] = useState(false)

  const taskOptions = useMemo(() => tasks.filter((task) => task.task_id !== 1), [tasks])
  const timerAttrs = useMemo(() => attrs.filter((attr) => {
    try {
      const parsed = JSON.parse(attr.calc_config || '{}') as Record<string, unknown>
      const schedule = (parsed.schedule_config && typeof parsed.schedule_config === 'object' ? parsed.schedule_config : parsed) as Record<string, unknown>
      const ux = schedule.ux_config && typeof schedule.ux_config === 'object' ? schedule.ux_config as Record<string, unknown> : null
      return ux?.input_type === 'timer'
    } catch {
      return false
    }
  }), [attrs])
  const safeStartHour = Math.max(0, Math.min(23, timelineStartHour))
  const safeEndHour = Math.max(safeStartHour + 1, Math.min(24, timelineEndHour))
  const hourSpan = safeEndHour - safeStartHour
  const hourLabels = useMemo(() => {
    const labels: number[] = []
    for (let hour = safeStartHour; hour <= safeEndHour; hour += 1) {
      labels.push(hour)
    }
    return labels
  }, [safeStartHour, safeEndHour])

  const timelineRange = useMemo(() => {
    const dayStart = dayjs(`${timelineDate}T00:00:00`)
    const windowStart = dayStart.add(safeStartHour, 'hour')
    const windowEnd = dayStart.add(safeEndHour, 'hour')
    return {
      windowStart,
      windowEnd,
      totalMs: Math.max(1, windowEnd.diff(windowStart, 'millisecond'))
    }
  }, [timelineDate, safeStartHour, safeEndHour])

  const timelineRows = useMemo(() => {
    const grouped = new Map<
      number,
      {
        taskId: number
        taskName: string
        taskColor: string
        totalSeconds: number
        segments: Array<{
          id: number
          leftPct: number
          widthPct: number
          durationSeconds: number
          label: string
          startAt: number
        }>
      }
    >()

    for (const session of focusSessions) {
      const sessionStart = dayjs(session.start_time)
      if (!sessionStart.isValid()) continue
      const sessionEnd = sessionStart.add(session.duration_seconds, 'second')
      if (!sessionEnd.isAfter(timelineRange.windowStart) || !sessionStart.isBefore(timelineRange.windowEnd)) {
        continue
      }

      const clippedStart = sessionStart.isAfter(timelineRange.windowStart) ? sessionStart : timelineRange.windowStart
      const clippedEnd = sessionEnd.isBefore(timelineRange.windowEnd) ? sessionEnd : timelineRange.windowEnd
      const clippedMs = clippedEnd.diff(clippedStart, 'millisecond')
      if (clippedMs <= 0) continue

      const leftPct = ((clippedStart.valueOf() - timelineRange.windowStart.valueOf()) / timelineRange.totalMs) * 100
      const rawWidthPct = (clippedMs / timelineRange.totalMs) * 100
      const rowColor = session.task_color || 'var(--edp-brand)'
      const existing = grouped.get(session.task_id) ?? {
        taskId: session.task_id,
        taskName: session.task_name || `Task #${session.task_id}`,
        taskColor: rowColor,
        totalSeconds: 0,
        segments: []
      }

      existing.totalSeconds += Math.round(clippedMs / 1000)
      existing.segments.push({
        id: session.id,
        leftPct,
        widthPct: Math.max(rawWidthPct, 1),
        durationSeconds: Math.round(clippedMs / 1000),
        label: `${dayjs(session.start_time).format('HH:mm')} · ${formatDuration(Math.round(clippedMs / 1000))}${session.attr_name ? ` · ${session.attr_name}` : ''}${session.note ? ` · ${session.note}` : ''}`,
        startAt: sessionStart.valueOf()
      })
      grouped.set(session.task_id, existing)
    }

    return Array.from(grouped.values())
      .map((row) => ({
        ...row,
        segments: [...row.segments].sort((a, b) => a.startAt - b.startAt)
      }))
      .sort((a, b) => a.taskName.localeCompare(b.taskName, 'zh-Hans-CN'))
  }, [focusSessions, timelineRange])

  const totalVisibleDuration = useMemo(
    () => timelineRows.reduce((sum, row) => sum + row.totalSeconds, 0),
    [timelineRows]
  )

  function openManualModal() {
    const fallbackTaskId =
      currentTaskId && currentTaskId !== 1 ? currentTaskId : taskOptions[0]?.task_id ?? null
    setManualTaskId(fallbackTaskId)
    setManualDate(todayDateString())
    setManualStartTime(dayjs().format('HH:mm'))
    setManualDurationMinutes(25)
    setManualOpen(true)
  }

  async function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!manualTaskId) return
    const start = dayjs(`${manualDate}T${manualStartTime}:00`)
    if (!start.isValid()) return
    const durationSeconds = Math.max(1, Math.round(manualDurationMinutes * 60))

    setManualSubmitting(true)
    try {
      await onCreateManualSession({
        taskId: manualTaskId,
        attrId: manualTaskId === scopeTaskId ? timerAttrId ?? undefined : undefined,
        startTime: start.toISOString(),
        recordDate: manualDate,
        durationSeconds,
        planContext: manualTaskId === scopeTaskId ? planContext : null
      })
      setManualOpen(false)
    } finally {
      setManualSubmitting(false)
    }
  }

  function handleStartHourChange(next: number) {
    const normalized = Math.max(0, Math.min(23, next))
    setTimelineStartHour(normalized)
    if (normalized >= timelineEndHour) {
      setTimelineEndHour(Math.min(24, normalized + 1))
    }
  }

  function handleEndHourChange(next: number) {
    const normalized = Math.max(1, Math.min(24, next))
    setTimelineEndHour(normalized)
    if (normalized <= timelineStartHour) {
      setTimelineStartHour(Math.max(0, normalized - 1))
    }
  }

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-12 xl:gap-6">
      <Card className="xl:col-span-4">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-2">
              <CardTitle>专注计时</CardTitle>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <span>筛选</span>
                <select
                  className="input-clean h-8 min-w-[150px] py-0 text-xs"
                  value={scopeTaskId}
                  onChange={(e) => onScopeTaskIdChange(Number(e.target.value))}
                >
                  <option value={1}>全局</option>
                  {taskOptions.map((task) => (
                    <option key={`time-filter-${task.task_id}`} value={task.task_id}>
                      {task.task_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<AlarmClockPlus className="h-4 w-4" />}
              disabled={taskOptions.length === 0}
              onClick={openManualModal}
            >
              专注补记
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <SegmentedTabs className="w-fit" compact tabs={timerModeTabs} value={timerMode} onChange={onTimerModeChange} />

          {planContext ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
              <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold text-blue-800">来自 Plan：{planContext.planTitle}</p><p className="mt-1 text-[11px] text-blue-700">{planContext.stepTitle}</p></div><button type="button" className="text-[11px] font-medium text-blue-600" onClick={onClearPlanContext} disabled={timerRunning}>清除</button></div>
            </div>
          ) : null}

          {!isGlobalScope ? (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-500">计时属性</span>
              <select className="input-clean w-full" value={timerAttrId ?? ''} onChange={(event) => {
                onTimerAttrIdChange(event.target.value ? Number(event.target.value) : null)
                if (planContext && Number(event.target.value) !== planContext.attrId) onClearPlanContext()
              }} disabled={timerRunning}>
                <option value="">仅记录任务专注时长</option>
                {timerAttrs.map((attr) => <option key={attr.attr_id} value={attr.attr_id}>{attr.attr_name}</option>)}
              </select>
            </label>
          ) : null}

          {timerMode === 'countdown' ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">倒计时（分钟）</label>
              <input
                className="input-clean w-full"
                type="number"
                min={1}
                value={countdownMinutes}
                disabled={timerRunning}
                onChange={(e) => onCountdownMinutesChange(Number(e.target.value || 1))}
              />
            </div>
          ) : null}

          <p className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-5 text-center text-3xl font-bold tracking-wider text-slate-900 sm:text-4xl">
            {timerMode === 'countdown' ? displayClock(timerRemain) : displayClock(timerElapsed)}
          </p>

          <p className="text-xs text-slate-500">{isGlobalScope ? '全局模式仅查看统计，记录请先选择具体任务' : `当前任务：${currentTaskName || '-'}`}</p>
          {timerMessage ? <p className="text-xs text-[var(--edp-brand-strong)]">{timerMessage}</p> : null}

          <div className="md:flex">
            {timerRunning ? (
              <Button className="w-full sm:w-auto" variant="danger" disabled={isGlobalScope} iconLeft={<Square className="h-4 w-4" />} onClick={() => void onStopTimer(true)}>
                终止并记录
              </Button>
            ) : (
              <Button className="w-full sm:w-auto" disabled={isGlobalScope} iconLeft={<Play className="h-4 w-4" />} onClick={() => void onStartTimer()}>
                开始计时
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="xl:col-span-8">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>专注时间线</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                {isGlobalScope ? '全局默认展示今日所有任务的专注分布' : '按时间线查看当前任务专注分布'}
              </p>
            </div>
            <div className="grid w-full gap-2 text-xs text-slate-600 sm:w-auto sm:grid-cols-3">
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                日期
                <input
                  type="date"
                  className="h-7 min-w-0 flex-1 border-none bg-transparent text-sm text-slate-700 outline-none"
                  value={timelineDate}
                  onChange={(e) => setTimelineDate(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                起始
                <select
                  className="h-7 min-w-0 flex-1 border-none bg-transparent text-sm text-slate-700 outline-none"
                  value={safeStartHour}
                  onChange={(e) => handleStartHourChange(Number(e.target.value))}
                >
                  {Array.from({ length: 24 }, (_, index) => (
                    <option key={index} value={index}>
                        {String(index).padStart(2, '0')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                终止
                <select
                  className="h-7 min-w-0 flex-1 border-none bg-transparent text-sm text-slate-700 outline-none"
                  value={safeEndHour}
                  onChange={(e) => handleEndHourChange(Number(e.target.value))}
                >
                  {Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => (
                    <option key={hour} value={hour}>
                      {String(hour).padStart(2, '0')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-500">
            共 {timelineRows.length} 条任务轨道，当前窗口累计 {formatDuration(totalVisibleDuration)}
          </p>
          <div className="grid grid-cols-[minmax(100px,auto)_1fr] items-end gap-3 px-1">
            <span className="text-[11px] font-medium tracking-wide text-slate-400">任务</span>
            <div className="relative h-5">
              {hourLabels.map((hour, index) => {
                const left = (index / hourSpan) * 100
                return (
                  <span key={hour} className="absolute -translate-x-1/2 text-[11px] text-slate-400" style={{ left: `${left}%` }}>
                    {String(hour).padStart(2, '0')}
                  </span>
                )
              })}
            </div>
          </div>

          {timelineRows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-sm text-slate-400">
              当前日期与时间范围内暂无专注记录
            </p>
          ) : (
            <div className="space-y-2">
              {timelineRows.map((row) => (
                <div key={row.taskId} className="grid grid-cols-[minmax(100px,auto)_1fr] items-center gap-3">
                  <div className="truncate text-xs font-medium text-slate-600" title={row.taskName}>
                    {row.taskName}
                  </div>
                  <div className="relative h-10 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    {hourLabels.map((hour, index) => {
                      const left = (index / hourSpan) * 100
                      return (
                        <span
                          key={hour}
                          className="absolute inset-y-0 border-l border-slate-200/70"
                          style={{ left: `${left}%` }}
                          aria-hidden
                        />
                      )
                    })}
                    {row.segments.map((segment) => (
                      <span
                        key={segment.id}
                        className="absolute top-1/2 h-5 -translate-y-1/2 rounded-md shadow-sm"
                        style={{
                          left: `${segment.leftPct}%`,
                          width: `${segment.widthPct}%`,
                          backgroundColor: row.taskColor
                        }}
                        title={segment.label}
                        aria-label={`${row.taskName} ${segment.label}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      {manualOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-3 backdrop-blur-sm"
          onClick={() => setManualOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="专注补记"
        >
          <section
            className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-4 shadow-soft sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4">
              <h3 className="text-base font-semibold text-slate-900">专注补记</h3>
              <p className="mt-1 text-xs text-slate-500">补录历史专注时段，便于后续统计和时间线复盘</p>
            </div>
            <form className="space-y-3" onSubmit={(event) => void handleManualSubmit(event)}>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">任务</label>
                <select
                  className="input-clean w-full"
                  value={manualTaskId ?? ''}
                  onChange={(event) => setManualTaskId(Number(event.target.value || 0) || null)}
                  required
                >
                  {taskOptions.map((task) => (
                    <option key={task.task_id} value={task.task_id}>
                      {task.task_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">日期</label>
                  <input
                    className="input-clean w-full"
                    type="date"
                    value={manualDate}
                    onChange={(event) => setManualDate(event.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">开始时间</label>
                  <input
                    className="input-clean w-full"
                    type="time"
                    value={manualStartTime}
                    onChange={(event) => setManualStartTime(event.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">专注时长（分钟）</label>
                <input
                  className="input-clean w-full"
                  type="number"
                  min={1}
                  max={24 * 60}
                  value={manualDurationMinutes}
                  onChange={(event) => setManualDurationMinutes(Number(event.target.value || 1))}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button variant="ghost" onClick={() => setManualOpen(false)}>
                  取消
                </Button>
                <Button type="submit" disabled={manualSubmitting || !manualTaskId || taskOptions.length === 0}>
                  {manualSubmitting ? '保存中...' : '保存补记'}
                </Button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  )
}
