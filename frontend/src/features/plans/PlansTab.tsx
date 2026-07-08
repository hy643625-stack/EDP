import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  BellRing,
  CalendarDays,
  CheckSquare2,
  ChevronDown,
  Clock3,
  FileText,
  Flag,
  History,
  Play,
  Plus,
  RefreshCw,
  Square,
  Sparkles,
  TimerReset,
  X
} from 'lucide-react'

import { api } from '@/api/client'
import type {
  PlanDashboard,
  PlanDashboardStep,
  PlanDetail,
  PlanReview,
  PlanSnapshot,
  PlanStep,
  PlanSummary
} from '@/api/types'
import type { Task } from '../../../../packages/core/src/types'
import { Button, Card, CardContent, CardHeader, CardTitle, SegmentedTabs, type SegmentedTabItem } from '../../../../packages/ui/src'
import { collectSteps, defaultTargetDate, formatMinutes, formatRate, formatSeconds, localDateKey, updateSnapshotStep } from './planUtils'

type ViewKey = 'today' | 'roadmap' | 'progress' | 'reviews'
export type PlanTimeContext = {
  planId: string
  stepId: string
  planTitle: string
  stepTitle: string
  taskId: number
  attrId: number
}

const VIEW_TABS: Array<SegmentedTabItem<ViewKey>> = [
  { key: 'today', label: '今日', icon: CalendarDays },
  { key: 'roadmap', label: '路线', icon: Flag },
  { key: 'progress', label: '进度', icon: Clock3 },
  { key: 'reviews', label: '复盘', icon: History }
]
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
function progressTone(value: number): string {
  if (value >= 80) return 'bg-emerald-500'
  if (value >= 40) return 'bg-blue-500'
  return 'bg-amber-500'
}

function formatWeight(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1)
}

function reviewReason(status: PlanDetail['review_status']): string {
  if (status.pending_review_id) return '有一份重排预览等待确认'
  if (status.reasons.includes('coverage_low')) {
    return status.detailed_days_remaining > 0
      ? `未来详细安排只剩 ${status.detailed_days_remaining} 天`
      : '已经没有未来的详细执行步骤'
  }
  return '本周尚未复盘'
}

function ImportPlanModal({
  open,
  tasks,
  onClose,
  onActivated
}: {
  open: boolean
  tasks: Task[]
  onClose: () => void
  onActivated: (planId: string) => Promise<void>
}) {
  const today = localDateKey()
  const [sourceText, setSourceText] = useState('')
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [startDate, setStartDate] = useState(today)
  const [targetDate, setTargetDate] = useState(defaultTargetDate(today))
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5, 6])
  const [dailyMinutes, setDailyMinutes] = useState(180)
  const [bindingMode, setBindingMode] = useState<'create' | 'existing'>('create')
  const [taskName, setTaskName] = useState('')
  const [existingTaskId, setExistingTaskId] = useState<number | null>(null)
  const [draft, setDraft] = useState<PlanDetail | null>(null)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!open) return
    setMessage('')
  }, [open])

  if (!open) return null

  function toggleWeekday(day: number) {
    setWeekdays((current) => {
      if (current.includes(day)) {
        if (current.length === 1) return current
        return current.filter((item) => item !== day)
      }
      return [...current, day].sort((a, b) => a - b)
    })
  }

  async function generateDraft() {
    if (!sourceText.trim()) {
      setMessage('请先粘贴计划文本')
      return
    }
    setWorking(true)
    setMessage('')
    try {
      const result = await api.importPlan({
        source_text: sourceText,
        title: title.trim() || undefined,
        goal: goal.trim() || undefined,
        start_date: startDate,
        target_end_date: targetDate,
        preferred_weekdays: weekdays,
        daily_minutes: dailyMinutes,
        task_binding: bindingMode === 'existing'
          ? { mode: 'existing', task_id: existingTaskId ?? undefined }
          : { mode: 'create', task_name: taskName.trim() || title.trim() || undefined }
      })
      setDraft(result)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '计划生成失败')
    } finally {
      setWorking(false)
    }
  }

  function updatePreviewStep(stepId: string, updates: Partial<PlanStep>) {
    setDraft((current) => {
      if (!current) return current
      const snapshot = updateSnapshotStep(current.snapshot, stepId, updates)
      return { ...current, snapshot }
    })
  }

  async function saveDraft(activate: boolean) {
    if (!draft) return
    setWorking(true)
    setMessage('')
    try {
      const saved = await api.updatePlanDraft(draft.plan.id, draft.snapshot)
      if (!activate) {
        setDraft(saved)
        setMessage('草稿已保存')
        return
      }
      await api.activatePlan(draft.plan.id)
      await onActivated(draft.plan.id)
      onClose()
      setDraft(null)
      setSourceText('')
      setTitle('')
      setGoal('')
      setTaskName('')
      setBindingMode('create')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setWorking(false)
    }
  }

  const previewSteps = draft ? collectSteps(draft.snapshot) : []

  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-slate-950/35 sm:items-center sm:justify-center sm:p-4">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col rounded-t-xl border border-slate-200 bg-white shadow-2xl sm:rounded-lg">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">导入长期计划</h2>
            <p className="mt-1 text-xs text-slate-500">粘贴路线，生成全年阶段与未来 14 天行动</p>
          </div>
          <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="关闭导入">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="overflow-y-auto px-4 py-4 sm:px-5">
          {!draft ? (
            <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
              <label className="space-y-2">
                <span className="text-xs font-semibold text-slate-600">计划原文</span>
                <textarea
                  className="min-h-[420px] w-full resize-y rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-800 outline-none focus:border-[var(--edp-brand)] focus:ring-2 focus:ring-[var(--edp-brand-ring)]"
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                  placeholder="粘贴 Markdown 或纯文本计划..."
                  maxLength={100000}
                />
                <span className="block text-right text-[11px] text-slate-400">{sourceText.length.toLocaleString()} / 100,000</span>
              </label>

              <div className="space-y-4">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600">计划名称</span>
                  <input className="input-clean w-full" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="自动识别，可修改" />
                </label>
                <div className="space-y-2">
                  <span className="text-xs font-medium text-slate-600">绑定基础任务</span>
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                    <button type="button" className={`rounded-md px-2 py-1.5 text-xs font-medium ${bindingMode === 'create' ? 'bg-white text-[var(--edp-brand-strong)] shadow-sm' : 'text-slate-500'}`} onClick={() => setBindingMode('create')}>新建任务</button>
                    <button type="button" className={`rounded-md px-2 py-1.5 text-xs font-medium ${bindingMode === 'existing' ? 'bg-white text-[var(--edp-brand-strong)] shadow-sm' : 'text-slate-500'}`} onClick={() => {
                      setBindingMode('existing')
                      setExistingTaskId((current) => current ?? tasks.find((task) => task.task_id !== 1)?.task_id ?? null)
                    }}>已有任务</button>
                  </div>
                  {bindingMode === 'create' ? (
                    <input className="input-clean w-full" value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder={title.trim() || '默认使用计划名称'} maxLength={64} />
                  ) : (
                    <select className="input-clean w-full" value={existingTaskId ?? ''} onChange={(event) => setExistingTaskId(Number(event.target.value) || null)}>
                      {tasks.filter((task) => task.task_id !== 1).map((task) => <option key={task.task_id} value={task.task_id}>{task.task_name}</option>)}
                    </select>
                  )}
                  <p className="text-[11px] text-slate-400">任务和近期周目标计时属性会在激活计划时创建</p>
                </div>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600">长期目标</span>
                  <textarea className="min-h-20 w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-[var(--edp-brand)]" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="这份计划最终要带你到哪里？" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-xs text-slate-600">
                    <span>开始日期</span>
                    <input type="date" className="input-clean w-full" value={startDate} onChange={(event) => {
                      setStartDate(event.target.value)
                      setTargetDate(defaultTargetDate(event.target.value))
                    }} />
                  </label>
                  <label className="space-y-1 text-xs text-slate-600">
                    <span>预计完成日期</span>
                    <input type="date" className="input-clean w-full" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
                  </label>
                </div>
                <div className="space-y-2">
                  <span className="text-xs font-medium text-slate-600">每周学习日</span>
                  <div className="grid grid-cols-7 gap-1">
                    {WEEKDAY_LABELS.map((label, index) => {
                      const day = index + 1
                      const selected = weekdays.includes(day)
                      return (
                        <button key={day} type="button" onClick={() => toggleWeekday(day)} className={`h-9 rounded-md border text-xs font-medium ${selected ? 'border-[var(--edp-brand-border)] bg-[var(--edp-brand-subtle)] text-[var(--edp-brand-strong)]' : 'border-slate-200 text-slate-500'}`}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600">每日可用时间</span>
                  <div className="flex items-center gap-2">
                    <input type="number" min={15} max={480} step={15} className="input-clean w-full" value={dailyMinutes} onChange={(event) => setDailyMinutes(Number(event.target.value))} />
                    <span className="text-sm text-slate-500">分钟</span>
                  </div>
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 border-b border-slate-200 pb-4 sm:grid-cols-4">
                <div><p className="text-[11px] text-slate-500">阶段</p><p className="mt-1 text-lg font-semibold text-slate-900">{draft.snapshot.phases.length}</p></div>
                <div><p className="text-[11px] text-slate-500">近期步骤</p><p className="mt-1 text-lg font-semibold text-slate-900">{previewSteps.length}</p></div>
                <div><p className="text-[11px] text-slate-500">预计时间</p><p className="mt-1 text-lg font-semibold text-slate-900">{formatMinutes(draft.progress.estimated_minutes)}</p></div>
                <div><p className="text-[11px] text-slate-500">详细计划截至</p><p className="mt-1 text-sm font-semibold text-slate-900">{draft.snapshot.horizon_end}</p></div>
              </div>
              <p className="text-xs text-slate-500">基础任务：{draft.plan.task_binding_mode === 'existing' ? draft.plan.task_name || '已有任务' : `${draft.plan.task_name_draft || draft.plan.title}（激活时创建）`}</p>

              <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${draft.mode_used === 'model' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold">{draft.mode_used === 'model' ? 'AI 已参与整理' : 'AI 未介入，本次由本地规则兜底'}</p>
                  {draft.fallback_reason ? <p className="mt-1 text-[11px] opacity-80">原因：{draft.fallback_reason}</p> : null}
                </div>
              </div>

              {(draft.warnings ?? draft.snapshot.warnings ?? []).map((warning) => (
                <p key={warning} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{warning}</p>
              ))}

              <section>
                <h3 className="text-sm font-semibold text-slate-900">全年骨架</h3>
                <div className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
                  {draft.snapshot.phases.map((phase) => (
                    <div key={phase.phase_id} className="grid gap-1 py-3 sm:grid-cols-[160px_1fr_auto] sm:items-center">
                      <span className="text-xs text-slate-500">{phase.start_date} 至 {phase.end_date}</span>
                      <span className="text-sm font-medium text-slate-800">{phase.title}</span>
                      <span className="text-xs text-slate-500">{phase.milestones.length} 个里程碑</span>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <div className="flex items-end justify-between gap-2">
                  <div><h3 className="text-sm font-semibold text-slate-900">未来 14 天步骤</h3><p className="mt-1 text-xs text-slate-500">激活前可以修改标题、日期和预计时间</p></div>
                </div>
                <div className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
                  {previewSteps.map((step) => (
                    <div key={step.step_id} className="grid gap-2 py-3 md:grid-cols-[140px_1fr_130px] md:items-center">
                      <input type="date" className="input-clean h-9 w-full" value={step.scheduled_date} onChange={(event) => updatePreviewStep(step.step_id, { scheduled_date: event.target.value, due_date: event.target.value })} />
                      <input className="input-clean h-9 w-full" value={step.title} onChange={(event) => updatePreviewStep(step.step_id, { title: event.target.value })} />
                      <div className="flex items-center gap-1">
                        <input type="number" min={1} max={240} className="input-clean h-9 w-full" value={step.estimated_minutes} onChange={(event) => updatePreviewStep(step.step_id, { estimated_minutes: Number(event.target.value) })} />
                        <span className="text-xs text-slate-500">分钟</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 sm:px-5">
          <p className={`text-xs ${message.includes('失败') || message.includes('请先') ? 'text-rose-600' : 'text-slate-500'}`}>{message}</p>
          <div className="flex items-center gap-2">
            {draft ? <Button variant="ghost" onClick={() => setDraft(null)} disabled={working}>返回修改</Button> : null}
            {draft ? <Button variant="ghost" onClick={() => void saveDraft(false)} disabled={working}>保存草稿</Button> : null}
            <Button iconLeft={<Sparkles className="h-4 w-4" />} onClick={() => void (draft ? saveDraft(true) : generateDraft())} disabled={working || (!draft && !sourceText.trim())}>
              {working ? '处理中...' : draft ? '激活计划' : '生成预览'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function StepRow({
  step,
  onOpenTime,
  onComplete,
  onReopen
}: {
  step: PlanDashboardStep | PlanStep
  onOpenTime: () => void
  onComplete: () => void
  onReopen?: () => void
}) {
  const isCompleted = step.status === 'completed'
  return (
    <div className="grid gap-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <button
        type="button"
        role="checkbox"
        aria-checked={isCompleted}
        aria-label={isCompleted ? `重新打开 ${step.title}` : `完成 ${step.title}`}
        title={isCompleted ? '重新打开步骤' : '完成步骤'}
        disabled={isCompleted && !onReopen}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-[var(--edp-brand-strong)] disabled:cursor-default disabled:opacity-50"
        onClick={isCompleted ? onReopen : onComplete}
      >
        {isCompleted ? <CheckSquare2 className="h-5 w-5 text-emerald-600" /> : <Square className="h-5 w-5" />}
      </button>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className={`truncate text-sm font-medium ${isCompleted ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{step.title}</p>
          {step.status === 'in_progress' ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">进行中</span> : null}
        </div>
        <p className="mt-1 text-xs text-slate-500">{step.scheduled_date} · 预计时间 {formatMinutes(step.estimated_minutes)} · 实际耗时 {formatSeconds(step.actual_seconds ?? 0)}</p>
      </div>
      <div className="flex items-center gap-2">
        {!isCompleted ? <Button size="sm" variant="ghost" iconLeft={<Play className="h-3.5 w-3.5" />} onClick={onOpenTime} disabled={!step.task_id || !step.timer_attr_id}>去 Time</Button> : null}
      </div>
    </div>
  )
}

export function PlansTab({
  tasks,
  onOpenTime,
  onTasksChanged
}: {
  tasks: Task[]
  onOpenTime: (context: PlanTimeContext) => void
  onTasksChanged: (taskId?: number | null) => Promise<void>
}) {
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string>('all')
  const [detail, setDetail] = useState<PlanDetail | null>(null)
  const [dashboard, setDashboard] = useState<PlanDashboard | null>(null)
  const [activeView, setActiveView] = useState<ViewKey>('today')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [reviewSummary, setReviewSummary] = useState('')
  const [reviewBlockers, setReviewBlockers] = useState('')
  const [reviewMinutes, setReviewMinutes] = useState(120)
  const [pendingReview, setPendingReview] = useState<PlanReview | null>(null)

  const selectedPlan = plans.find((item) => item.id === selectedPlanId) ?? null

  async function loadPlans(preferredId?: string) {
    const result = await api.listPlans()
    setPlans(result)
    const requested = preferredId ?? selectedPlanId
    if (requested !== 'all' && result.some((item) => item.id === requested)) {
      setSelectedPlanId(requested)
      return
    }
    const first = result.find((item) => item.status === 'active') ?? result[0]
    setSelectedPlanId(first?.id ?? 'all')
  }

  async function refresh(preferredId?: string) {
    setLoading(true)
    setMessage('')
    try {
      await loadPlans(preferredId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '计划加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadSelection(planId: string) {
    setLoading(true)
    setMessage('')
    try {
      const [nextDashboard, nextDetail] = await Promise.all([
        api.getPlanDashboard(localDateKey(), planId === 'all' ? undefined : planId),
        planId === 'all' ? Promise.resolve(null) : api.getPlan(planId, localDateKey())
      ])
      setDashboard(nextDashboard)
      setDetail(nextDetail)
      setPendingReview(nextDetail?.reviews.find((item) => item.status === 'pending') ?? null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '计划详情加载失败')
    } finally {
      setLoading(false)
    }
  }

  const mountedRef = useRef(false)

  useEffect(() => {
    void refresh().then(() => {
      mountedRef.current = true
    })
  }, [])

  useEffect(() => {
    if (!mountedRef.current) return
    if (selectedPlanId === 'all') {
      setDetail(null)
      return
    }
    void loadSelection(selectedPlanId)
  }, [selectedPlanId])

  useEffect(() => {
    if (!detail) return
    setReviewSummary(detail.review_status.prefill.summary)
    setReviewBlockers(detail.review_status.prefill.blockers)
    setReviewMinutes(detail.review_status.prefill.next_week_minutes)
  }, [detail?.plan.id])

  function openStepInTime(step: PlanDashboardStep | PlanStep) {
    const planId = 'plan_id' in step ? step.plan_id : detail?.plan.id
    const planTitle = 'plan_title' in step ? step.plan_title : detail?.plan.title
    if (!planId || !planTitle || !step.task_id || !step.timer_attr_id) {
      setMessage('该步骤尚未建立任务计时属性，请先激活计划或刷新页面')
      return
    }
    onOpenTime({
      planId,
      stepId: step.step_id,
      planTitle,
      stepTitle: step.title,
      taskId: step.task_id,
      attrId: step.timer_attr_id
    })
  }

  async function completeStep(step: PlanDashboardStep | PlanStep) {
    const planId = 'plan_id' in step ? step.plan_id : selectedPlanId
    setLoading(true)
    try {
      await api.completePlanStep(planId, step.step_id, {})
      await loadSelection(selectedPlanId)
      await loadPlans(selectedPlanId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '步骤完成失败')
    } finally {
      setLoading(false)
    }
  }

  async function reopenStep(step: PlanStep) {
    if (!detail) return
    setLoading(true)
    try {
      await api.reopenPlanStep(detail.plan.id, step.step_id)
      await loadSelection(detail.plan.id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重新打开失败')
    } finally {
      setLoading(false)
    }
  }

  async function createReview() {
    if (!detail) return
    setLoading(true)
    try {
      const review = await api.createPlanReview(detail.plan.id, {
        review_date: localDateKey(),
        summary: reviewSummary,
        blockers: reviewBlockers,
        next_week_minutes: reviewMinutes
      })
      setPendingReview(review)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '复盘建议生成失败')
    } finally {
      setLoading(false)
    }
  }

  async function resolveReview(action: 'apply' | 'reject') {
    if (!detail || !pendingReview) return
    setLoading(true)
    try {
      if (action === 'apply') await api.applyPlanReview(detail.plan.id, pendingReview.id)
      else await api.rejectPlanReview(detail.plan.id, pendingReview.id)
      setPendingReview(null)
      setReviewSummary('')
      setReviewBlockers('')
      await loadSelection(detail.plan.id)
      await loadPlans(detail.plan.id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '复盘处理失败')
    } finally {
      setLoading(false)
    }
  }

  const reviewAttention = useMemo(
    () => dashboard?.plans.filter((item) => item.review_status.due || item.review_status.pending_review_id) ?? [],
    [dashboard]
  )
  const viewTabs = useMemo(
    () => VIEW_TABS.map((tab) => tab.key === 'reviews' && reviewAttention.length > 0
      ? { ...tab, label: `复盘 ${reviewAttention.length}` }
      : tab),
    [reviewAttention.length]
  )

  function openReview(planId: string) {
    setActiveView('reviews')
    if (selectedPlanId !== planId) setSelectedPlanId(planId)
  }

  function renderStepGroup(title: string, items: PlanDashboardStep[], tone: 'rose' | 'slate' | 'blue') {
    if (items.length === 0) return null
    const toneClass = tone === 'rose' ? 'text-rose-700' : tone === 'blue' ? 'text-blue-700' : 'text-slate-700'
    return (
      <section>
        <h3 className={`text-xs font-semibold uppercase ${toneClass}`}>{title} · {items.length}</h3>
        <div className="mt-1 divide-y divide-slate-200 border-y border-slate-200">
          {items.map((step) => (
            <StepRow
              key={`${step.plan_id}-${step.step_id}`}
              step={step}
              onOpenTime={() => openStepInTime(step)}
              onComplete={() => void completeStep(step)}
            />
          ))}
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>长期计划</CardTitle>
              <p className="mt-1 text-xs text-slate-500">把年度路线变成今天可以完成的一步</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-9 w-9 px-0" iconLeft={<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />} onClick={() => void loadSelection(selectedPlanId)} aria-label="刷新计划" />
              <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setImportOpen(true)}>导入计划</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input-clean min-w-[240px]" value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)}>
              <option value="all">全部活跃计划</option>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title} · {plan.status === 'draft' ? '草稿' : plan.status === 'active' ? '执行中' : plan.status}</option>)}
            </select>
            {selectedPlan ? <span className="text-xs text-slate-500">预计完成日期 {selectedPlan.target_end_date}</span> : null}
            {selectedPlan?.status === 'active' ? (
              <button type="button" className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="归档计划" aria-label="归档计划" onClick={() => void api.updatePlanStatus(selectedPlan.id, 'archived').then(() => refresh())}>
                <Archive className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      {message ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">{message}</div> : null}

      {reviewAttention.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-y border-amber-200 bg-amber-50 px-4 py-3">
          <BellRing className="h-4 w-4 flex-shrink-0 text-amber-700" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">
              {reviewAttention.length === 1 ? reviewAttention[0].plan.title : `${reviewAttention.length} 个计划需要复盘`}
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              {reviewAttention.length === 1 ? reviewReason(reviewAttention[0].review_status) : '逐个检查近期安排，再决定是否应用调整'}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => openReview(reviewAttention[0].plan.id)}>去复盘</Button>
        </div>
      ) : null}

      {plans.length === 0 && !loading ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto h-7 w-7 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">还没有长期计划</p>
            <p className="mt-1 text-xs text-slate-500">粘贴一份路线，先生成可编辑预览</p>
            <Button className="mt-4" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setImportOpen(true)}>导入第一份计划</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <SegmentedTabs tabs={viewTabs} value={activeView} onChange={(value) => {
            if (selectedPlanId === 'all' && value !== 'today') {
              setMessage('请先选择一个具体计划查看路线、进度或复盘')
              return
            }
            setActiveView(value)
          }} />

          {activeView === 'today' ? (
            <div className="space-y-4">
              {dashboard?.plans.length ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {dashboard.plans.map((item) => (
                    <button key={item.plan.id} type="button" onClick={() => setSelectedPlanId(item.plan.id)} className="rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-[var(--edp-brand-border)]">
                      <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-semibold text-slate-900">{item.plan.title}</p><span className="text-xs font-semibold text-slate-600">{formatRate(item.progress.completion_rate)}</span></div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100"><span className={`block h-full ${progressTone(item.progress.completion_rate)}`} style={{ width: `${Math.min(100, item.progress.completion_rate)}%` }} /></div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span>实际耗时 {formatSeconds(item.progress.actual_seconds)}</span>
                        {item.review_status.due || item.review_status.pending_review_id ? <span className="font-medium text-amber-700">需要复盘</span> : null}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
              <Card>
                <CardHeader><CardTitle>今日清单</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                  {renderStepGroup('已逾期', dashboard?.overdue ?? [], 'rose')}
                  {renderStepGroup('今天', dashboard?.today ?? [], 'slate')}
                  {renderStepGroup('未来两天', dashboard?.upcoming ?? [], 'blue')}
                  {(dashboard?.overdue.length ?? 0) + (dashboard?.today.length ?? 0) + (dashboard?.upcoming.length ?? 0) === 0 ? <p className="py-6 text-center text-sm text-slate-400">未来两天没有待执行步骤</p> : null}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {activeView === 'roadmap' && detail ? (
            <div className="space-y-4">
              {detail.plan.status === 'draft' ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm text-amber-800">这份计划仍是草稿，激活后才会进入今日清单</p>
                  <Button size="sm" onClick={() => void api.activatePlan(detail.plan.id).then(async (activated) => {
                    await onTasksChanged(activated.plan.task_id)
                    await refresh(detail.plan.id)
                  })}>激活计划</Button>
                </div>
              ) : null}
              {detail.snapshot.phases.map((phase, phaseIndex) => (
                <Card key={phase.phase_id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><p className="text-xs font-semibold text-[var(--edp-brand-strong)]">阶段 {phaseIndex + 1}</p><CardTitle className="mt-1">{phase.title}</CardTitle><p className="mt-1 text-xs text-slate-500">{phase.start_date} 至 {phase.end_date}</p></div>
                      <span className="text-xs font-medium text-slate-500">预计时间 {formatMinutes(phase.estimated_minutes)}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-slate-600">{phase.objective}</p>
                    <div className="divide-y divide-slate-200 border-y border-slate-200">
                      {phase.milestones.map((milestone) => (
                        <details key={milestone.milestone_id} className="group">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3">
                            <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{milestone.title}</p><p className="mt-1 text-xs text-slate-500">{milestone.start_date} 至 {milestone.end_date} · {milestone.weekly_goals.length} 周</p></div>
                            <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400 transition group-open:rotate-180" />
                          </summary>
                          <div className="pb-4 pl-3 sm:pl-5">
                            {milestone.weekly_goals.map((goal) => (
                              <div key={goal.goal_id} className="border-l border-slate-200 py-2 pl-3">
                                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-700">{goal.title}</p><span className="text-[11px] text-slate-400">{goal.window_start} 至 {goal.window_end}</span></div>
                                {goal.expanded ? (
                                  <div className="mt-1 divide-y divide-slate-100">
                                    {goal.steps.map((step) => (
                                      <StepRow key={step.step_id} step={step} onOpenTime={() => openStepInTime(step)} onComplete={() => void completeStep(step)} onReopen={() => void reopenStep(step)} />
                                    ))}
                                  </div>
                                ) : <p className="mt-1 text-[11px] text-slate-400">预计时间 {formatMinutes(goal.estimated_minutes)} · 等待滚动展开</p>}
                              </div>
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}

          {activeView === 'progress' && detail ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
              <Card>
                <CardHeader><CardTitle>任务完成度</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-4xl font-bold text-slate-900">{formatRate(detail.progress.completion_rate)}</p>
                  <div className="mt-3 h-2 overflow-hidden rounded bg-slate-100"><span className={`block h-full ${progressTone(detail.progress.completion_rate)}`} style={{ width: `${Math.min(100, detail.progress.completion_rate)}%` }} /></div>
                  <dl className="mt-5 space-y-3 text-sm">
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">周目标覆盖</dt><dd className="font-medium text-slate-800">{formatWeight(detail.progress.completed_task_weight)} / {formatWeight(detail.progress.total_task_weight)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">工作量完成度</dt><dd className="font-medium text-slate-800">{formatRate(detail.progress.workload_completion_rate)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">预计时间</dt><dd className="font-medium text-slate-800">{formatMinutes(detail.progress.estimated_minutes)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">实际耗时</dt><dd className="font-medium text-slate-800">{formatSeconds(detail.progress.actual_seconds)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">已完成步骤</dt><dd className="font-medium text-slate-800">{detail.progress.completed_steps}</dd></div>
                  </dl>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>阶段进度</CardTitle></CardHeader>
                <CardContent className="divide-y divide-slate-200">
                  {detail.progress.phases.map((phase) => (
                    <div key={phase.phase_id} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-slate-800">{phase.title}</p><span className="text-xs font-semibold text-slate-600">{formatRate(phase.completion_rate)}</span></div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100"><span className={`block h-full ${progressTone(phase.completion_rate)}`} style={{ width: `${Math.min(100, phase.completion_rate)}%` }} /></div>
                      <p className="mt-2 text-[11px] text-slate-500">周目标覆盖 {formatWeight(phase.completed_task_weight)} / {formatWeight(phase.total_task_weight)} · 工作量 {formatRate(phase.workload_completion_rate)}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {activeView === 'reviews' && detail ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_1.35fr]">
              <Card>
                <CardHeader><CardTitle>本周复盘</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 border-y border-slate-200 py-2 text-xs text-slate-500">
                    <span>计划 {detail.review_status.prefill.planned_steps}</span>
                    <span>完成 {detail.review_status.prefill.completed_steps}</span>
                    <span>逾期 {detail.review_status.prefill.overdue_steps}</span>
                    <span>阻塞 {detail.review_status.prefill.blocked_steps}</span>
                    <span>投入 {formatSeconds(detail.review_status.prefill.actual_seconds)}</span>
                  </div>
                  <label className="block space-y-1"><span className="text-xs font-medium text-slate-600">本周完成情况</span><textarea className="min-h-24 w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-[var(--edp-brand)]" value={reviewSummary} onChange={(event) => setReviewSummary(event.target.value)} /></label>
                  <label className="block space-y-1"><span className="text-xs font-medium text-slate-600">遇到的阻碍</span><textarea className="min-h-20 w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-[var(--edp-brand)]" value={reviewBlockers} onChange={(event) => setReviewBlockers(event.target.value)} /></label>
                  <label className="block space-y-1"><span className="text-xs font-medium text-slate-600">下周每日可用时间</span><div className="flex items-center gap-2"><input type="number" min={15} max={480} className="input-clean w-full" value={reviewMinutes} onChange={(event) => setReviewMinutes(Number(event.target.value))} /><span className="text-sm text-slate-500">分钟</span></div></label>
                  <Button className="w-full" iconLeft={<TimerReset className="h-4 w-4" />} onClick={() => void createReview()} disabled={loading || !!pendingReview}>生成重排预览</Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>调整建议</CardTitle></CardHeader>
                <CardContent>
                  {!pendingReview ? <p className="py-8 text-center text-sm text-slate-400">提交复盘后，系统会列出所有日期变化；确认前不会修改计划</p> : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-amber-700">待确认 · 基于 v{pendingReview.base_revision}</span><span className="text-xs text-slate-500">{pendingReview.proposal.changes.length} 项变化</span></div>
                      <div className="max-h-[360px] divide-y divide-slate-200 overflow-y-auto border-y border-slate-200">
                        {pendingReview.proposal.changes.length === 0 ? <p className="py-4 text-sm text-slate-500">当前安排无需移动，确认后仍会记录一次复盘版本</p> : pendingReview.proposal.changes.map((change) => (
                          <div key={`${change.type}-${change.item_id}`} className="py-3"><p className="text-sm font-medium text-slate-800">{change.title}</p><p className="mt-1 text-xs text-slate-500">{change.type === 'expanded' ? '展开为近期可执行步骤' : `${change.from ?? ''} → ${change.to ?? ''}`}</p></div>
                        ))}
                      </div>
                      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => void resolveReview('reject')}>拒绝</Button><Button onClick={() => void resolveReview('apply')}>确认调整</Button></div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </>
      )}

      <ImportPlanModal open={importOpen} tasks={tasks} onClose={() => setImportOpen(false)} onActivated={async (planId) => {
        const activated = await api.getPlan(planId)
        await onTasksChanged(activated.plan.task_id)
        await refresh(planId)
        setSelectedPlanId(planId)
        setActiveView('today')
        await loadSelection(planId)
      }} />
    </div>
  )
}
