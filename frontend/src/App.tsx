import { useEffect, useMemo, useRef, useState } from 'react'
import { AlarmClock, BarChart3, Bot, ChevronDown, ListChecks, ListTodo, PencilLine, Plus, Settings2, Trash2, X } from 'lucide-react'
import dayjs from 'dayjs'

import { api } from '@/api/client'
import type {
  AiMode,
  AiProviderConfigInput,
  AiProviderConfigView,
  AiProviderDescriptor,
  AiSummaryPayload,
  AiSettingsPayload,
  AiRuntimeState,
  AttrInputType,
  AttrUxConfig,
  BatchRecordEntry,
  HomeSnapshot,
  SettlementReport
} from '@/api/types'
import { formatDuration, todayDateString } from '@/lib/format'
import { formatPeriodLabel } from '@/lib/period'
import { buildTaskThemeStyle } from '@/lib/theme'
import { createCoreUseCases } from '../../packages/core/src/usecases'
import { formatWeekdayGroupKey, parseScheduleConfig, type AttributeScheduleType } from '../../packages/core/src/schedule'
import type { DailyRecord, FocusSession, FocusStats, Task, TaskAttrRelation, TodoItem, TodoStats } from '../../packages/core/src/types'
import { createHttpRepository } from '../../packages/data/src/httpRepository'
import { createSqliteLocalRepository } from '../../packages/data/src/sqliteLocalRepository'
import { Button, SegmentedTabs, type SegmentedTabItem } from '../../packages/ui/src'
import { CommandCenterTab } from '@/features/home/CommandCenterTab'
import { CreateTaskModal } from '@/features/overview/CreateTaskModal'
import { DEFAULT_TASK_COLOR } from '@/features/overview/taskColorPresets'
import { AiSettingsModal, type AiProviderConfigDraft } from '@/features/settings/AiSettingsModal'
import { LearningStudioTab } from '@/features/learning/LearningStudioTab'
import { StatsTab } from '@/features/stats/StatsTab'
import { TimeTab } from '@/features/time/TimeTab'
import { TodosTab } from '@/features/todos/TodosTab'

type TabKey = 'records' | 'todos' | 'time' | 'stats' | 'learning'
type TimerMode = 'countup' | 'countdown'

const tabs: Array<SegmentedTabItem<TabKey>> = [
  { key: 'records', label: 'Records', icon: ListChecks },
  { key: 'todos', label: 'Todos', icon: ListTodo },
  { key: 'time', label: 'Time', icon: AlarmClock },
  { key: 'stats', label: 'Stats', icon: BarChart3 },
  { key: 'learning', label: 'Learning', icon: Bot }
]

const timerModeTabs: Array<SegmentedTabItem<TimerMode>> = [
  { key: 'countup', label: '正计时' },
  { key: 'countdown', label: '倒计时' }
]

const ERROR_AUTO_CLEAR_MS = 3500
const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const RECORD_WINDOW_DEFAULT_DAYS = 14
const RECORD_WINDOW_STATS_DAYS = 220

type AttrOverrideRuleMode = 'independent' | 'shared'
type AttrOverrideRule = {
  id: string
  weekdays: number[]
  mode: AttrOverrideRuleMode
  target: string
}

function createEmptyOverrideRule(): AttrOverrideRule {
  return {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    weekdays: [],
    mode: 'independent',
    target: ''
  }
}

function hasScheduleRules(config: {
  type: AttributeScheduleType
  active_weekdays: number[]
  shared_weekday_groups: number[][]
  period_start: string | null
  period_end: string | null
  target_overrides: Record<string, number>
}): boolean {
  return (
    config.type !== 'daily' ||
    config.shared_weekday_groups.length > 0 ||
    Object.keys(config.target_overrides).length > 0 ||
    config.period_start != null ||
    config.period_end != null
  )
}

function extractUxConfig(calcConfigRaw: string | null | undefined): AttrUxConfig {
  if (!calcConfigRaw) {
    return { input_type: 'number', quick_step: 1, detail_enabled: true }
  }
  try {
    const raw = JSON.parse(calcConfigRaw)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { input_type: 'number', quick_step: 1, detail_enabled: true }
    }
    const source =
      raw && typeof raw === 'object' && !Array.isArray(raw) && 'schedule_config' in raw
        ? (raw as Record<string, unknown>).schedule_config
        : raw
    const schedule = source && typeof source === 'object' && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : {}
    const uxRaw = schedule.ux_config
    const ux = uxRaw && typeof uxRaw === 'object' && !Array.isArray(uxRaw)
      ? (uxRaw as Record<string, unknown>)
      : {}

    let inputType: AttrInputType = 'number'
    if (ux.input_type === 'boolean' || ux.input_type === 'number' || ux.input_type === 'timer') {
      inputType = ux.input_type
    } else if (ux.input_mode === 'toggle') {
      inputType = 'boolean'
    } else if (ux.input_mode === 'number') {
      inputType = 'number'
    }
    const quickStepNumber = Number(ux.quick_step)
    const quickStep = Number.isFinite(quickStepNumber) && quickStepNumber > 0 ? quickStepNumber : 1
    const detailEnabled = typeof ux.detail_enabled === 'boolean' ? ux.detail_enabled : true
    return {
      input_type: inputType,
      quick_step: quickStep,
      detail_enabled: detailEnabled
    }
  } catch {
    return { input_type: 'number', quick_step: 1, detail_enabled: true }
  }
}

function getScopeTaskId(tab: TabKey, timeScopeTaskId: number, statsScopeTaskId: number): number {
  if (tab === 'time') return timeScopeTaskId
  if (tab === 'stats') return statsScopeTaskId
  return 1
}

function hexWithAlpha(hexColor: string | null | undefined, alpha: number): string {
  if (!hexColor) return `rgba(148, 163, 184, ${alpha})`
  const normalized = hexColor.trim()
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(hex)) {
    return `rgba(148, 163, 184, ${alpha})`
  }

  const full = hex.length === 3 ? hex.split('').map((ch) => `${ch}${ch}`).join('') : hex
  const r = Number.parseInt(full.slice(0, 2), 16)
  const g = Number.parseInt(full.slice(2, 4), 16)
  const b = Number.parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function buildTagColorStyle(hexColor: string | null | undefined): {
  backgroundColor: string
  borderColor: string
} {
  return {
    backgroundColor: hexWithAlpha(hexColor, 0.16),
    borderColor: hexWithAlpha(hexColor, 0.34)
  }
}

function sortTasksById(items: Task[]): Task[] {
  return [...items].sort((left, right) => left.task_id - right.task_id)
}

function createAiConfigDraft(config?: AiProviderConfigView): AiProviderConfigDraft {
  const temperature = config?.temperature
  const maxTokens = config?.max_tokens
  const timeoutSeconds = config?.timeout_seconds
  return {
    base_url: config?.base_url || '',
    model_name: config?.model_name || '',
    temperature: typeof temperature === 'number' && Number.isFinite(temperature) ? temperature : 0.2,
    max_tokens: typeof maxTokens === 'number' && Number.isFinite(maxTokens) ? maxTokens : 1200,
    stream: config?.stream ?? false,
    timeout_seconds: typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds) ? timeoutSeconds : 30,
    api_key_configured: config?.api_key_configured ?? false,
    api_key_masked: config?.api_key_masked ?? null,
    api_key_input: '',
    clear_api_key: false
  }
}

function pickAiProviderId(mode: AiMode, preferredId: string | null, providers: AiProviderDescriptor[]): string | null {
  if (providers.length === 0) return null
  const eligible =
    mode === 'cloud'
      ? providers.filter((provider) => provider.deployment === 'cloud')
      : mode === 'local'
        ? providers.filter((provider) => provider.deployment === 'local')
        : providers
  if (eligible.length === 0) return null
  if (preferredId && eligible.some((provider) => provider.provider_id === preferredId)) return preferredId
  return eligible[0]?.provider_id ?? null
}

function App() {
  const dataMode = (import.meta.env.VITE_DATA_MODE || 'http').toLowerCase()
  const repository = useMemo(() => {
    if (dataMode === 'local') return createSqliteLocalRepository()
    return createHttpRepository(api)
  }, [dataMode])
  const core = useMemo(() => createCoreUseCases(repository), [repository])

  const [activeTab, setActiveTab] = useState<TabKey>('records')
  const [tasks, setTasks] = useState<Task[]>([])
  const [currentTaskId, setCurrentTaskId] = useState<number>(1)
  const [attrs, setAttrs] = useState<TaskAttrRelation[]>([])
  const [recentRecords, setRecentRecords] = useState<DailyRecord[]>([])
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [todoStats, setTodoStats] = useState<TodoStats>({ total: 0, completed: 0, todayCompleted: 0 })
  const [focusStats, setFocusStats] = useState<FocusStats>({ todaySeconds: 0, totalSeconds: 0 })
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>([])

  const [recordsDate, setRecordsDate] = useState(todayDateString())
  const [homeSnapshot, setHomeSnapshot] = useState<HomeSnapshot | null>(null)
  const [homeSelectedTaskIds, setHomeSelectedTaskIds] = useState<number[]>([])
  const [homeLoading, setHomeLoading] = useState(false)

  const [projectOpen, setProjectOpen] = useState(false)
  const [projectTaskId, setProjectTaskId] = useState<number | null>(null)
  const [projectAttrs, setProjectAttrs] = useState<TaskAttrRelation[]>([])
  const [projectAttrsTaskId, setProjectAttrsTaskId] = useState<number | null>(null)
  const [projectAttrLoading, setProjectAttrLoading] = useState(false)
  const [projectTasksExpanded, setProjectTasksExpanded] = useState(false)
  const [projectAttrsExpanded, setProjectAttrsExpanded] = useState(false)
  const [projectEditingAttrId, setProjectEditingAttrId] = useState<number | null>(null)
  const [projectAttrName, setProjectAttrName] = useState('')
  const [projectAttrUnit, setProjectAttrUnit] = useState('')
  const [projectAttrTarget, setProjectAttrTarget] = useState(100)
  const [projectAttrWeight, setProjectAttrWeight] = useState(1)
  const [projectAttrInputType, setProjectAttrInputType] = useState<AttrInputType>('number')
  const [projectAttrDetailEnabled, setProjectAttrDetailEnabled] = useState(true)
  const [projectAttrAdvancedOpen, setProjectAttrAdvancedOpen] = useState(false)
  const [projectAttrActiveWeekdays, setProjectAttrActiveWeekdays] = useState<number[]>([...ALL_WEEKDAYS])
  const [projectAttrPeriodStart, setProjectAttrPeriodStart] = useState('')
  const [projectAttrPeriodEnd, setProjectAttrPeriodEnd] = useState('')
  const [projectAttrOverrideRules, setProjectAttrOverrideRules] = useState<AttrOverrideRule[]>([])

  const [taskName, setTaskName] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [taskColor, setTaskColor] = useState(DEFAULT_TASK_COLOR)
  const [taskModalMode, setTaskModalMode] = useState<'create' | 'edit'>('create')
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null)
  const [taskModalOpen, setTaskModalOpen] = useState(false)

  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [aiSettingsLoading, setAiSettingsLoading] = useState(false)
  const [aiSettingsSaving, setAiSettingsSaving] = useState(false)
  const [aiSettingsTesting, setAiSettingsTesting] = useState(false)
  const [aiSettingsMode, setAiSettingsMode] = useState<AiMode>('off')
  const [aiSettingsProviderId, setAiSettingsProviderId] = useState<string | null>(null)
  const [aiModeOptions, setAiModeOptions] = useState<AiSettingsPayload['mode_options']>([])
  const [aiProviders, setAiProviders] = useState<AiProviderDescriptor[]>([])
  const [aiProviderConfigs, setAiProviderConfigs] = useState<Record<string, AiProviderConfigDraft>>({})
  const [aiRuntimeState, setAiRuntimeState] = useState<AiRuntimeState | null>(null)
  const [aiPrivacyNotice, setAiPrivacyNotice] = useState('')
  const [aiStatusMessage, setAiStatusMessage] = useState('')
  const [aiTestMessage, setAiTestMessage] = useState('')

  const [todoTaskId, setTodoTaskId] = useState<number | null>(null)
  const [todoTitle, setTodoTitle] = useState('')
  const [todoDesc, setTodoDesc] = useState('')
  const [todoDate, setTodoDate] = useState('')

  const [timeScopeTaskId, setTimeScopeTaskId] = useState<number>(1)
  const [statsScopeTaskId, setStatsScopeTaskId] = useState<number>(1)

  const [timerMode, setTimerMode] = useState<TimerMode>('countup')
  const [countdownMinutes, setCountdownMinutes] = useState(25)
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerElapsed, setTimerElapsed] = useState(0)
  const [timerRemain, setTimerRemain] = useState(0)
  const [timerMessage, setTimerMessage] = useState('')
  const timerHandleRef = useRef<number | null>(null)
  const timerStartMsRef = useRef<number>(0)
  const timerStartIsoRef = useRef<string>('')
  const timerPlannedSecRef = useRef<number>(0)
  const stoppingRef = useRef(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const errorTimerRef = useRef<number | null>(null)

  const visibleTasks = useMemo(() => tasks.filter((task) => task.task_id !== 1), [tasks])
  const activeThemeTask = useMemo(() => {
    if (!homeSnapshot || homeSelectedTaskIds.length !== 1) return null
    return homeSnapshot.tasks.find((task) => task.task_id === homeSelectedTaskIds[0]) ?? null
  }, [homeSnapshot, homeSelectedTaskIds])
  const appThemeStyle = useMemo(() => buildTaskThemeStyle(activeThemeTask?.task_color), [activeThemeTask?.task_color])
  const projectThemeTask = useMemo(() => {
    if (projectTaskId != null) {
      const selected = visibleTasks.find((task) => task.task_id === projectTaskId)
      if (selected) return selected
    }
    return visibleTasks[0] ?? null
  }, [projectTaskId, visibleTasks])
  const projectTagStyle = useMemo(
    () => buildTagColorStyle(projectThemeTask?.task_color),
    [projectThemeTask?.task_color]
  )
  const projectTaskTagStyleById = useMemo(() => {
    const map = new Map<number, { backgroundColor: string; borderColor: string }>()
    for (const task of visibleTasks) {
      map.set(task.task_id, buildTagColorStyle(task.task_color))
    }
    return map
  }, [visibleTasks])
  const currentTaskName = useMemo(
    () => tasks.find((item) => item.task_id === currentTaskId)?.task_name,
    [tasks, currentTaskId]
  )
  const normalizedPlanningWeekdays = useMemo(
    () => Array.from(new Set(projectAttrActiveWeekdays)).filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b),
    [projectAttrActiveWeekdays]
  )
  const normalizedOverrideRules = useMemo(
    () =>
      projectAttrOverrideRules.map((rule) => ({
        ...rule,
        weekdays: Array.from(new Set(rule.weekdays)).filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b)
      })),
    [projectAttrOverrideRules]
  )
  const weekdayOwnerByRule = useMemo(() => {
    const owner = new Map<number, { ruleId: string; order: number }>()
    normalizedOverrideRules.forEach((rule, index) => {
      for (const weekday of rule.weekdays) {
        if (!owner.has(weekday)) owner.set(weekday, { ruleId: rule.id, order: index + 1 })
      }
    })
    return owner
  }, [normalizedOverrideRules])
  const overrideSummaryText = useMemo(() => {
    const unit = projectAttrUnit?.trim() || ''
    const unitSuffix = unit ? ` ${unit}` : ''
    const rangeSuffix = projectAttrAdvancedOpen ? `；区间 ${formatPeriodLabel(projectAttrPeriodStart, projectAttrPeriodEnd)}` : ''

    if (!projectAttrAdvancedOpen) {
      if (projectAttrTarget > 0) {
        return `当前设定：未开启时间规划，使用每日基础目标 ${projectAttrTarget}${unitSuffix}`
      }
      return '当前设定：未开启时间规划（无目标）'
    }

    if (projectAttrTarget <= 0) {
      if (normalizedPlanningWeekdays.length === 0) {
        return `当前设定：尚未选择生效星期（无目标）${rangeSuffix}`
      }
      const dayLabel =
        normalizedPlanningWeekdays.length === ALL_WEEKDAYS.length
          ? '每日生效'
          : `周${normalizedPlanningWeekdays.map((day) => WEEKDAY_LABELS[day - 1]).join('、周')}生效`
      return `当前设定：${dayLabel}（无目标）${rangeSuffix}`
    }

    const validRules = normalizedOverrideRules
      .map((rule) => ({
        ...rule,
        numeric: Number(rule.target)
      }))
      .filter((rule) => rule.weekdays.length > 0 && Number.isFinite(rule.numeric) && rule.numeric > 0)

    if (validRules.length === 0) {
      return `当前设定：尚未形成有效规则，当前基础目标 ${projectAttrTarget}${unitSuffix}${rangeSuffix}`
    }

    const parts = validRules.map((rule) => {
      const dayLabel = `周${rule.weekdays.map((day) => WEEKDAY_LABELS[day - 1]).join('、周')}`
      if (rule.mode === 'shared' && rule.weekdays.length >= 2) {
        return `${dayLabel}共享 ${rule.numeric}${unitSuffix}`
      }
      return `${dayLabel}独立 ${rule.numeric}${unitSuffix}`
    })

    return `当前设定：${parts.join('，')}${rangeSuffix}`
  }, [
    normalizedOverrideRules,
    projectAttrAdvancedOpen,
    projectAttrTarget,
    projectAttrUnit,
    projectAttrPeriodStart,
    projectAttrPeriodEnd,
    normalizedPlanningWeekdays
  ])
  const projectAttrPreviewItems = useMemo(() => {
    const targetTaskId = projectTaskId ?? projectThemeTask?.task_id ?? null
    if (targetTaskId == null || !homeSnapshot) return []
    const map = new Map<number, { attr_id: number; attr_name: string }>()
    for (const card of homeSnapshot.record_cards) {
      if (card.task_id !== targetTaskId) continue
      if (!map.has(card.attr_id)) {
        map.set(card.attr_id, { attr_id: card.attr_id, attr_name: card.attr_name })
      }
    }
    return Array.from(map.values())
  }, [homeSnapshot, projectTaskId, projectThemeTask?.task_id])

  useEffect(() => {
    void bootstrap()
    return () => {
      if (timerHandleRef.current != null) {
        window.clearInterval(timerHandleRef.current)
      }
      if (errorTimerRef.current != null) {
        window.clearTimeout(errorTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const scopeTaskId = getScopeTaskId(activeTab, timeScopeTaskId, statsScopeTaskId)
    setCurrentTaskId(scopeTaskId)
    void refreshTaskScopedData(scopeTaskId, activeTab)
  }, [activeTab, timeScopeTaskId, statsScopeTaskId])

  useEffect(() => {
    const root = document.documentElement
    for (const [key, value] of Object.entries(appThemeStyle)) {
      if (value == null) continue
      root.style.setProperty(key, String(value))
    }
  }, [appThemeStyle])

  useEffect(() => {
    if (!projectOpen || !projectAttrsExpanded || projectTaskId == null) return
    if (projectAttrsTaskId === projectTaskId) return
    void loadProjectAttrs(projectTaskId)
  }, [projectOpen, projectAttrsExpanded, projectTaskId, projectAttrsTaskId])

  function clearError() {
    if (errorTimerRef.current != null) {
      window.clearTimeout(errorTimerRef.current)
      errorTimerRef.current = null
    }
    setError('')
  }

  function showError(message: string) {
    if (errorTimerRef.current != null) {
      window.clearTimeout(errorTimerRef.current)
    }
    setError(message)
    errorTimerRef.current = window.setTimeout(() => {
      setError('')
      errorTimerRef.current = null
    }, ERROR_AUTO_CLEAR_MS)
  }

  function logAction(action: string, detail?: Record<string, unknown>) {
    console.info('[everydayperfect]', {
      action,
      at: new Date().toISOString(),
      mode: dataMode,
      tab: activeTab,
      ...detail
    })
  }

  function hydrateAiSettings(payload: AiSettingsPayload) {
    setAiModeOptions(payload.mode_options)
    setAiProviders(payload.providers)
    setAiPrivacyNotice(payload.privacy_notice)
    setAiRuntimeState(payload.effective_runtime)

    const drafts: Record<string, AiProviderConfigDraft> = {}
    for (const provider of payload.providers) {
      drafts[provider.provider_id] = createAiConfigDraft(payload.provider_configs[provider.provider_id])
    }
    setAiProviderConfigs(drafts)
    setAiSettingsMode(payload.mode)
    setAiSettingsProviderId(pickAiProviderId(payload.mode, payload.provider_id, payload.providers))
  }

  async function loadAiSettings(options?: { keepOpen?: boolean }) {
    setAiSettingsLoading(true)
    try {
      const payload = await api.getAiSettings()
      hydrateAiSettings(payload)
      if (options?.keepOpen) {
        setAiStatusMessage('')
        setAiTestMessage('')
      }
      clearError()
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      showError(raw?.trim() || 'AI 设置加载失败')
    } finally {
      setAiSettingsLoading(false)
    }
  }

  async function openAiSettings() {
    setAiSettingsOpen(true)
    setAiStatusMessage('')
    setAiTestMessage('')
    await loadAiSettings({ keepOpen: true })
  }

  function handleAiModeChange(nextMode: AiMode) {
    setAiSettingsMode(nextMode)
    setAiSettingsProviderId((current) => pickAiProviderId(nextMode, current, aiProviders))
    setAiStatusMessage('')
    setAiTestMessage('')
  }

  function handleAiProviderChange(providerId: string) {
    setAiSettingsProviderId(providerId)
    setAiStatusMessage('')
    setAiTestMessage('')
  }

  function handleAiConfigChange(providerId: string, key: keyof AiProviderConfigDraft, value: string | number | boolean) {
    setAiProviderConfigs((prev) => {
      const current = prev[providerId] ?? createAiConfigDraft()
      const next = { ...current, [key]: value }
      if (key === 'api_key_input' && typeof value === 'string' && value.trim()) {
        next.clear_api_key = false
      }
      return { ...prev, [providerId]: next }
    })
    setAiStatusMessage('')
    setAiTestMessage('')
  }

  function handleAiClearApiKey(providerId: string) {
    setAiProviderConfigs((prev) => {
      const current = prev[providerId] ?? createAiConfigDraft()
      return {
        ...prev,
        [providerId]: {
          ...current,
          api_key_input: '',
          api_key_configured: false,
          api_key_masked: null,
          clear_api_key: true
        }
      }
    })
    setAiStatusMessage('')
    setAiTestMessage('保存设置后会清空当前已保存的 API Key。')
  }

  function buildAiProviderConfigInput(providerId: string): AiProviderConfigInput {
    const draft = aiProviderConfigs[providerId] ?? createAiConfigDraft()
    return {
      api_key_input: draft.api_key_input.trim() || undefined,
      clear_api_key: draft.clear_api_key,
      base_url: draft.base_url.trim(),
      model_name: draft.model_name.trim(),
      temperature: draft.temperature,
      max_tokens: draft.max_tokens,
      stream: draft.stream,
      timeout_seconds: draft.timeout_seconds
    }
  }

  async function handleSaveAiSettings() {
    setAiSettingsSaving(true)
    setAiStatusMessage('')
    setAiTestMessage('')
    try {
      const payload = await api.updateAiSettings({
        mode: aiSettingsMode,
        provider_id: aiSettingsMode === 'off' ? aiSettingsProviderId : pickAiProviderId(aiSettingsMode, aiSettingsProviderId, aiProviders),
        provider_configs: Object.fromEntries(
          Object.keys(aiProviderConfigs).map((providerId) => [providerId, buildAiProviderConfigInput(providerId)])
        )
      })
      hydrateAiSettings(payload)
      setAiStatusMessage('AI 设置已保存。所有 AI 功能仍需用户确认后才会真正写入数据。')
      clearError()
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      showError(raw?.trim() || 'AI 设置保存失败')
    } finally {
      setAiSettingsSaving(false)
    }
  }

  async function handleTestAiSettings() {
    if (aiSettingsMode === 'off' || !aiSettingsProviderId) return
    setAiSettingsTesting(true)
    setAiStatusMessage('')
    setAiTestMessage('')
    try {
      const result = await api.testAiSettingsConnection({
        mode: aiSettingsMode,
        provider_id: aiSettingsProviderId,
        config: buildAiProviderConfigInput(aiSettingsProviderId)
      })
      setAiTestMessage(result.message)
      if (!result.ok) {
        showError(result.message)
      } else {
        clearError()
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      showError(raw?.trim() || 'AI 连接测试失败')
    } finally {
      setAiSettingsTesting(false)
    }
  }

  async function withBusy(work: () => Promise<void>) {
    setLoading(true)
    clearError()
    try {
      await work()
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      const message = raw?.trim() || '操作失败，请稍后重试'
      showError(message)
    } finally {
      setLoading(false)
    }
  }

  function resetTaskDraft() {
    setTaskName('')
    setTaskDesc('')
    setTaskColor(DEFAULT_TASK_COLOR)
    setTaskModalMode('create')
    setEditingTaskId(null)
  }

  function upsertTaskInState(nextTask: Task) {
    setTasks((prev) => sortTasksById([...prev.filter((item) => item.task_id !== nextTask.task_id), nextTask]))
  }

  function removeTaskFromState(taskId: number) {
    setTasks((prev) => prev.filter((item) => item.task_id !== taskId))
  }

  async function refreshViewsAfterTaskMutation(preferredTaskId?: number | null, selectedTaskIds?: number[]) {
    try {
      await reloadTasksFromServer(preferredTaskId)
    } catch (error) {
      console.warn('[everydayperfect] task list sync failed', error)
    }

    const nextSelectedTaskIds = selectedTaskIds ?? homeSelectedTaskIds
    await loadHomeSnapshot(recordsDate, nextSelectedTaskIds)

    const scopeTaskId = getScopeTaskId(activeTab, timeScopeTaskId, statsScopeTaskId)
    await refreshTaskScopedData(scopeTaskId, activeTab)
  }

  function resetProjectAttrDraft() {
    setProjectEditingAttrId(null)
    setProjectAttrName('')
    setProjectAttrUnit('')
    setProjectAttrTarget(100)
    setProjectAttrWeight(1)
    setProjectAttrInputType('number')
    setProjectAttrDetailEnabled(true)
    setProjectAttrAdvancedOpen(false)
    setProjectAttrActiveWeekdays([...ALL_WEEKDAYS])
    setProjectAttrPeriodStart('')
    setProjectAttrPeriodEnd('')
    setProjectAttrOverrideRules([])
  }

  function fillProjectAttrDraft(attr: TaskAttrRelation) {
    const ux = extractUxConfig(attr.calc_config)
    const schedule = parseScheduleConfig(attr.calc_config)
    const overrides = schedule.target_overrides || {}
    const sharedGroups = (schedule.shared_weekday_groups || [])
      .map((group) => Array.from(new Set(group)).filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b))
      .filter((group) => group.length >= 2)
    const claimedWeekdays = new Set<number>()
    const restoredRules: AttrOverrideRule[] = []
    for (const group of sharedGroups) {
      const key = formatWeekdayGroupKey(group)
      const target = overrides[key]
      restoredRules.push({
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        weekdays: group,
        mode: 'shared',
        target: target != null && target > 0 ? String(target) : attr.target_value > 0 ? String(attr.target_value) : ''
      })
      group.forEach((day) => claimedWeekdays.add(day))
    }
    const activeDays = schedule.type === 'daily'
      ? [...ALL_WEEKDAYS]
      : schedule.active_weekdays.length > 0
        ? Array.from(new Set(schedule.active_weekdays)).filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b)
        : [...ALL_WEEKDAYS]
    const independentGroupedByTarget = new Map<string, number[]>()
    for (const day of activeDays) {
      if (claimedWeekdays.has(day)) continue
      const target = overrides[String(day)]
      if (target == null || target <= 0) continue
      const key = String(target)
      if (!independentGroupedByTarget.has(key)) {
        independentGroupedByTarget.set(key, [])
      }
      independentGroupedByTarget.get(key)?.push(day)
    }
    for (const [target, weekdays] of independentGroupedByTarget.entries()) {
      restoredRules.push({
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        weekdays: Array.from(new Set(weekdays)).sort((a, b) => a - b),
        mode: 'independent',
        target
      })
    }

    setProjectEditingAttrId(attr.attr_id)
    setProjectAttrName(attr.attr_name)
    setProjectAttrUnit(attr.attr_unit || '')
    setProjectAttrTarget(attr.target_value > 0 ? attr.target_value : 100)
    setProjectAttrWeight(attr.weight > 0 ? attr.weight : 1)
    setProjectAttrInputType(ux.input_type)
    setProjectAttrDetailEnabled(ux.detail_enabled)
    setProjectAttrAdvancedOpen(hasScheduleRules(schedule))
    setProjectAttrActiveWeekdays(activeDays)
    setProjectAttrPeriodStart(schedule.period_start || '')
    setProjectAttrPeriodEnd(schedule.period_end || '')
    setProjectAttrOverrideRules(restoredRules)
  }

  function togglePlanningWeekday(weekday: number) {
    const next = new Set(normalizedPlanningWeekdays)
    if (next.has(weekday)) next.delete(weekday)
    else next.add(weekday)
    setProjectAttrActiveWeekdays(Array.from(next).sort((a, b) => a - b))
  }

  function updateOverrideRule(ruleId: string, updater: (rule: AttrOverrideRule) => AttrOverrideRule) {
    setProjectAttrOverrideRules((prev) => prev.map((rule) => (rule.id === ruleId ? updater(rule) : rule)))
  }

  function addOverrideRule() {
    setProjectAttrOverrideRules((prev) => [...prev, createEmptyOverrideRule()])
  }

  function deleteOverrideRule(ruleId: string) {
    setProjectAttrOverrideRules((prev) => prev.filter((rule) => rule.id !== ruleId))
  }

  function toggleRuleWeekday(ruleId: string, weekday: number) {
    updateOverrideRule(ruleId, (rule) => {
      const selected = rule.weekdays.includes(weekday)
      if (selected) {
        return { ...rule, weekdays: rule.weekdays.filter((item) => item !== weekday) }
      }
      const owner = weekdayOwnerByRule.get(weekday)
      if (owner && owner.ruleId !== ruleId) return rule
      return { ...rule, weekdays: [...rule.weekdays, weekday].sort((a, b) => a - b) }
    })
  }

  function updateRuleMode(ruleId: string, mode: AttrOverrideRuleMode) {
    updateOverrideRule(ruleId, (rule) => ({ ...rule, mode }))
  }

  function updateRuleTarget(ruleId: string, target: string) {
    updateOverrideRule(ruleId, (rule) => ({ ...rule, target }))
  }

  async function bootstrap() {
    await withBusy(async () => {
      const result = await core.bootstrap()
      setTasks(result.tasks)
      const firstTask = result.tasks.find((task) => task.task_id !== 1)
      if (firstTask) {
        setTodoTaskId(firstTask.task_id)
        setProjectTaskId(firstTask.task_id)
      }
      await loadHomeSnapshot(recordsDate, [])
      await refreshTaskScopedData(1, activeTab)
    })
  }

  function buildScopedRefreshInput(scopeTaskId: number, tab: TabKey) {
    const today = dayjs().startOf('day')
    const recordStart = tab === 'stats' ? today.subtract(RECORD_WINDOW_STATS_DAYS, 'day') : today.subtract(RECORD_WINDOW_DEFAULT_DAYS, 'day')
    return {
      currentTaskId: scopeTaskId,
      statsDate: todayDateString(),
      sessionStartDate: dayjs().subtract(365, 'day').format('YYYY-MM-DD'),
      recordStartDate: recordStart.format('YYYY-MM-DD'),
      recordEndDate: today.format('YYYY-MM-DD')
    }
  }

  async function refreshTaskScopedData(scopeTaskId: number, tab: TabKey) {
    try {
      const snapshot = await core.refreshTaskScopedData(buildScopedRefreshInput(scopeTaskId, tab))
      setAttrs(snapshot.attrs)
      setRecentRecords(snapshot.records)
      setTodos(snapshot.todos)
      setTodoStats(snapshot.todoStats)
      setFocusStats(snapshot.focusStats)
      setFocusSessions(snapshot.focusSessions)
      clearError()
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      showError(raw?.trim() || '数据刷新失败')
    }
  }

  async function loadHomeSnapshot(dateKey: string, taskIds: number[]) {
    setHomeLoading(true)
    try {
      const snapshot = await api.getCommandCenter(dateKey, taskIds.length > 0 ? taskIds : undefined)
      setHomeSnapshot(snapshot)
      if (taskIds.length > 0) {
        setHomeSelectedTaskIds(taskIds)
      } else {
        setHomeSelectedTaskIds(snapshot.filters.selected_task_ids)
      }
      logAction('inbox.fetch', {
        recordDate: dateKey,
        selectedTaskIds: taskIds.length > 0 ? taskIds : snapshot.filters.selected_task_ids,
        inboxEvents: snapshot.inbox_events.length
      })
      clearError()
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      showError(raw?.trim() || '指挥中心加载失败')
    } finally {
      setHomeLoading(false)
    }
  }

  async function loadProjectAttrs(taskId: number): Promise<TaskAttrRelation[]> {
    setProjectAttrLoading(true)
    try {
      const all = await api.listTaskAttrs(taskId)
      const editable = all.filter((attr) => attr.attr_sign === 0 && attr.attr_record === 1)
      setProjectAttrs(editable)
      setProjectAttrsTaskId(taskId)
      return editable
    } finally {
      setProjectAttrLoading(false)
    }
  }

  async function reloadTasksFromServer(preferredTaskId?: number | null): Promise<Task[]> {
    const latestTasks = await api.listTasks()
    setTasks(latestTasks)

    const latestVisibleTasks = latestTasks.filter((task) => task.task_id !== 1)
    if (latestVisibleTasks.length === 0) {
      setTodoTaskId(null)
      setProjectTaskId(null)
      return latestTasks
    }

    const resolvedTaskId =
      preferredTaskId != null && latestVisibleTasks.some((task) => task.task_id === preferredTaskId)
        ? preferredTaskId
        : latestVisibleTasks[0].task_id

    setTodoTaskId(resolvedTaskId)
    setProjectTaskId(resolvedTaskId)
    return latestTasks
  }

  async function openProjectAttrEditor(attrId: number) {
    if (!projectTaskId) return
    setProjectAttrsExpanded(true)
    let loaded = projectAttrs
    if (projectAttrsTaskId !== projectTaskId) {
      loaded = await loadProjectAttrs(projectTaskId)
    }
    const target = loaded.find((item) => item.attr_id === attrId)
    if (target) {
      fillProjectAttrDraft(target)
    }
  }

  async function openProjectManager(taskId?: number, attrId?: number) {
    setProjectOpen(true)
    setProjectTasksExpanded(false)
    setProjectAttrsExpanded(false)
    const latestTasks = await reloadTasksFromServer(taskId ?? projectTaskId ?? null)
    const latestVisibleTasks = latestTasks.filter((task) => task.task_id !== 1)
    const fallbackTaskId = taskId ?? projectTaskId ?? latestVisibleTasks[0]?.task_id ?? null
    if (fallbackTaskId == null) return
    setProjectTaskId(fallbackTaskId)
    if (attrId != null) {
      setProjectAttrsExpanded(true)
      const loaded = await loadProjectAttrs(fallbackTaskId)
      const target = loaded.find((item) => item.attr_id === attrId)
      if (target) {
        fillProjectAttrDraft(target)
        setProjectAttrAdvancedOpen(true)
      }
    } else if (projectAttrsTaskId !== fallbackTaskId) {
      setProjectAttrs([])
    }
  }

  async function handleCreateTask() {
    if (!taskName.trim()) return
    await withBusy(async () => {
      const nextName = taskName.trim()
      const nextDesc = taskDesc.trim()
      const created = await api.createTask({
        name: nextName,
        desc: nextDesc,
        task_color: taskColor
      })
      upsertTaskInState(created)
      setTodoTaskId(created.task_id)
      setProjectTaskId(created.task_id)
      setProjectTasksExpanded(true)
      setTaskModalOpen(false)
      resetTaskDraft()
      await refreshViewsAfterTaskMutation(created.task_id)
      logAction('task.create', { taskId: created.task_id, name: nextName })
    })
  }

  async function handleUpdateTask() {
    if (!taskName.trim() || editingTaskId == null) return
    await withBusy(async () => {
      const nextName = taskName.trim()
      const nextDesc = taskDesc.trim()
      const updated = await api.updateTask(editingTaskId, {
        name: nextName,
        desc: nextDesc,
        task_color: taskColor
      })
      upsertTaskInState(updated)
      setTaskModalOpen(false)
      resetTaskDraft()
      await refreshViewsAfterTaskMutation(updated.task_id)
      logAction('task.update', { taskId: editingTaskId })
    })
  }

  async function handleDeleteTask(taskId: number) {
    if (taskId <= 1) return
    const target = tasks.find((item) => item.task_id === taskId)
    const confirmed = window.confirm(`确认删除任务「${target?.task_name || taskId}」吗？该操作不可撤销`)
    if (!confirmed) return

    await withBusy(async () => {
      await api.deleteTask(taskId)
      removeTaskFromState(taskId)
      const nextSelectedTaskIds = homeSelectedTaskIds.filter((id) => id !== taskId)
      const latestTasks = tasks.filter((item) => item.task_id !== taskId)
      if (projectTaskId === taskId) {
        const nextTask = latestTasks.find((item) => item.task_id !== 1)
        setProjectTaskId(nextTask?.task_id ?? null)
        if (nextTask) {
          await loadProjectAttrs(nextTask.task_id)
        } else {
          setProjectAttrs([])
        }
      }
      await refreshViewsAfterTaskMutation(projectTaskId === taskId ? null : projectTaskId, nextSelectedTaskIds)
      logAction('task.delete', { taskId })
    })
  }

  async function handleSaveProjectAttr() {
    if (!projectTaskId || !projectAttrName.trim()) return
    await withBusy(async () => {
      const uxConfig: AttrUxConfig = {
        input_type: projectAttrInputType,
        quick_step: 1,
        detail_enabled: projectAttrDetailEnabled
      }
      const targetValue = projectAttrTarget > 0 ? projectAttrTarget : -1
      const weight = targetValue > 0 ? Math.max(1, projectAttrWeight) : 0
      const periodStart = projectAttrPeriodStart.trim() || null
      const periodEnd = projectAttrPeriodEnd.trim() || null
      if (periodStart && periodEnd && dayjs(periodStart).isAfter(dayjs(periodEnd), 'day')) {
        showError('开始日期不能晚于终止日期')
        return
      }

      let scheduleConfig: {
        type: AttributeScheduleType
        active_weekdays: number[]
        shared_weekday_groups: number[][]
        period_start: string | null
        period_end: string | null
        target_overrides: Record<string, number>
        ux_config: AttrUxConfig
      }

      if (!projectAttrAdvancedOpen) {
        scheduleConfig = {
          type: 'daily',
          active_weekdays: [...ALL_WEEKDAYS],
          shared_weekday_groups: [],
          period_start: null,
          period_end: null,
          target_overrides: {},
          ux_config: uxConfig
        }
      } else if (targetValue <= 0) {
        if (normalizedPlanningWeekdays.length === 0) {
          showError('请至少选择一个生效星期')
          return
        }
        const useDaily = normalizedPlanningWeekdays.length === ALL_WEEKDAYS.length
        scheduleConfig = {
          type: useDaily ? 'daily' : 'specific_days',
          active_weekdays: useDaily ? [...ALL_WEEKDAYS] : [...normalizedPlanningWeekdays],
          shared_weekday_groups: [],
          period_start: periodStart,
          period_end: periodEnd,
          target_overrides: {},
          ux_config: uxConfig
        }
      } else {
        const validRules = normalizedOverrideRules
          .map((rule) => ({
            ...rule,
            weekdays: Array.from(new Set(rule.weekdays)).filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b),
            numericTarget: Number(rule.target)
          }))
          .filter((rule) => rule.weekdays.length > 0 && Number.isFinite(rule.numericTarget) && rule.numericTarget > 0)

        if (validRules.length === 0) {
          showError('开启时间规划后，请至少添加一条有效规则')
          return
        }

        const activeSet = new Set<number>()
        const sharedGroups: number[][] = []
        const targetOverrides: Record<string, number> = {}

        for (const rule of validRules) {
          const weekdays = rule.weekdays
          weekdays.forEach((day) => activeSet.add(day))
          if (rule.mode === 'shared' && weekdays.length >= 2) {
            sharedGroups.push(weekdays)
            targetOverrides[formatWeekdayGroupKey(weekdays)] = rule.numericTarget
            continue
          }
          for (const day of weekdays) {
            targetOverrides[String(day)] = rule.numericTarget
          }
        }

        const activeWeekdays = Array.from(activeSet).sort((a, b) => a - b)
        scheduleConfig = {
          type: sharedGroups.length > 0 ? 'shared_days' : 'specific_days',
          active_weekdays: activeWeekdays.length > 0 ? activeWeekdays : [...ALL_WEEKDAYS],
          shared_weekday_groups: sharedGroups,
          period_start: periodStart,
          period_end: periodEnd,
          target_overrides: targetOverrides,
          ux_config: uxConfig
        }
      }

      const calcConfig = JSON.stringify({
        schedule_config: scheduleConfig
      })

      if (projectEditingAttrId == null) {
        const maxOrder = projectAttrs.reduce((max, item) => Math.max(max, item.display_order), 0)
        await api.createTaskAttr(projectTaskId, {
          attr_name: projectAttrName.trim(),
          display_order: maxOrder + 10,
          attr_sign: 0,
          attr_record: 1,
          target_value: targetValue,
          unit: projectAttrUnit.trim(),
          calc_type: '10010000',
          calc_config: calcConfig,
          weight
        })
        logAction('attr.create', { taskId: projectTaskId, name: projectAttrName.trim() })
      } else {
        await api.updateTaskAttr(projectTaskId, projectEditingAttrId, {
          attr_name: projectAttrName.trim(),
          target_value: targetValue,
          unit: projectAttrUnit.trim(),
          weight,
          calc_config: calcConfig
        })
        logAction('attr.update', { taskId: projectTaskId, attrId: projectEditingAttrId })
      }
      await loadProjectAttrs(projectTaskId)
      await loadHomeSnapshot(recordsDate, homeSelectedTaskIds)
      resetProjectAttrDraft()
    })
  }

  async function handleDeleteProjectAttr(attrId: number) {
    if (!projectTaskId) return
    await withBusy(async () => {
      await api.deleteTaskAttr(projectTaskId, attrId)
      await loadProjectAttrs(projectTaskId)
      await loadHomeSnapshot(recordsDate, homeSelectedTaskIds)
      if (projectEditingAttrId === attrId) {
        resetProjectAttrDraft()
      }
      logAction('attr.delete', { taskId: projectTaskId, attrId })
    })
  }

  async function handleSaveHomeEntries(entries: BatchRecordEntry[]): Promise<boolean> {
    let ok = false
    await withBusy(async () => {
      await api.upsertHomeRecords(recordsDate, entries)
      await loadHomeSnapshot(recordsDate, homeSelectedTaskIds)
      const scopeTaskId = getScopeTaskId(activeTab, timeScopeTaskId, statsScopeTaskId)
      await refreshTaskScopedData(scopeTaskId, activeTab)
      const undoCount = entries.reduce((count, item) => count + (item.value == null ? 1 : 0), 0)
      logAction('records.batch_save', {
        entries: entries.length,
        undoCount,
        recordDate: recordsDate
      })
      ok = true
    })
    return ok
  }

  async function handleLoadSettlementReport(taskId: number, attrId: number): Promise<SettlementReport> {
    return api.getSettlementReport(taskId, attrId, recordsDate)
  }

  async function handleLoadAiSummary(taskId: number, attrId: number): Promise<AiSummaryPayload> {
    return api.getAiSummary({
      task_id: taskId,
      attr_id: attrId,
      record_date: recordsDate
    })
  }

  async function handleFocusCapture(input: {
    taskId: number
    timerAttrId?: number
    startTime: string
    durationSeconds: number
    recordDate: string
  }) {
    setLoading(true)
    clearError()
    try {
      const result = await api.focusCapture({
        task_id: input.taskId,
        timer_attr_id: input.timerAttrId,
        start_time: input.startTime,
        duration_seconds: input.durationSeconds,
        record_date: input.recordDate
      })
      await loadHomeSnapshot(recordsDate, homeSelectedTaskIds)
      const scopeTaskId = getScopeTaskId(activeTab, timeScopeTaskId, statsScopeTaskId)
      await refreshTaskScopedData(scopeTaskId, activeTab)
      logAction('focus.capture', {
        taskId: input.taskId,
        timerAttrId: input.timerAttrId ?? null,
        durationSeconds: input.durationSeconds,
        recordDate: input.recordDate
      })
      return result
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      const message = raw?.trim() || '专注记录失败，请稍后重试'
      showError(message)
      throw e
    } finally {
      setLoading(false)
    }
  }

  async function handleApplySettlementAction(input: { taskId: number; attrId: number; action: 'renew' | 'archive' }) {
    setLoading(true)
    clearError()
    try {
      await api.applySettlementAction({
        task_id: input.taskId,
        attr_id: input.attrId,
        action: input.action,
        anchor_date: input.action === 'renew' ? recordsDate : undefined
      })
      await loadHomeSnapshot(recordsDate, homeSelectedTaskIds)
      if (projectTaskId === input.taskId) await loadProjectAttrs(input.taskId)
      logAction(`attr.${input.action}`, { taskId: input.taskId, attrId: input.attrId })
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      const message = raw?.trim() || '操作失败，请稍后重试'
      showError(message)
      throw e
    } finally {
      setLoading(false)
    }
  }

  function handleEvolvePending(taskId: number, attrId: number) {
    logAction('attr.evolve', { taskId, attrId })
    void openProjectManager(taskId, attrId)
  }

  async function handleCreateTodo() {
    if (!todoTaskId || !todoTitle.trim()) return
    await withBusy(async () => {
      const snapshot = await core.createTodoAndRefresh({
        payload: {
          task_id: todoTaskId,
          title: todoTitle.trim(),
          description: todoDesc.trim(),
          due_date: todoDate || undefined
        },
        ...buildScopedRefreshInput(1, 'todos')
      })
      setTodos(snapshot.todos)
      setTodoStats(snapshot.todoStats)
      setTodoTitle('')
      setTodoDesc('')
      setTodoDate('')
      await loadHomeSnapshot(recordsDate, homeSelectedTaskIds)
      logAction('todo.create', { taskId: todoTaskId })
    })
  }

  async function handleToggleTodo(item: TodoItem) {
    await withBusy(async () => {
      const snapshot = await core.toggleTodoAndRefresh({
        todoId: item.id,
        completed: item.completed,
        ...buildScopedRefreshInput(1, 'todos')
      })
      setTodos(snapshot.todos)
      setTodoStats(snapshot.todoStats)
      await loadHomeSnapshot(recordsDate, homeSelectedTaskIds)
      logAction('todo.toggle', { todoId: item.id, completed: !item.completed })
    })
  }

  async function handleDeleteTodo(todoId: number) {
    await withBusy(async () => {
      const snapshot = await core.deleteTodoAndRefresh({
        todoId,
        ...buildScopedRefreshInput(1, 'todos')
      })
      setTodos(snapshot.todos)
      setTodoStats(snapshot.todoStats)
      await loadHomeSnapshot(recordsDate, homeSelectedTaskIds)
      logAction('todo.delete', { todoId })
    })
  }

  function displayClock(seconds: number): string {
    const safe = Math.max(0, Math.round(seconds))
    const h = `${Math.floor(safe / 3600)}`.padStart(2, '0')
    const m = `${Math.floor((safe % 3600) / 60)}`.padStart(2, '0')
    const s = `${safe % 60}`.padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  function tickTimer() {
    const elapsed = Math.max(0, Math.floor((Date.now() - timerStartMsRef.current) / 1000))
    setTimerElapsed(elapsed)
    if (timerMode === 'countdown') {
      const remain = Math.max(0, timerPlannedSecRef.current - elapsed)
      setTimerRemain(remain)
      if (remain <= 0) {
        void stopTimer(false)
      }
    }
  }

  async function startTimer() {
    if (currentTaskId === 1) {
      showError('全局模式不能直接记录专注，请先在 Time 页选择具体任务')
      return
    }
    if (timerRunning) return
    clearError()
    setTimerMessage('')
    setTimerRunning(true)
    setTimerElapsed(0)
    timerStartMsRef.current = Date.now()
    timerStartIsoRef.current = new Date(timerStartMsRef.current).toISOString()
    timerPlannedSecRef.current = timerMode === 'countdown' ? Math.max(60, Math.round(countdownMinutes * 60)) : 0
    setTimerRemain(timerPlannedSecRef.current)
    timerHandleRef.current = window.setInterval(tickTimer, 1000)
    logAction('focus.start', { mode: timerMode, taskId: currentTaskId })
  }

  async function stopTimer(manualStop: boolean) {
    if (!timerRunning || stoppingRef.current) return
    if (currentTaskId === 1) return
    stoppingRef.current = true
    try {
      if (timerHandleRef.current != null) {
        window.clearInterval(timerHandleRef.current)
        timerHandleRef.current = null
      }
      setTimerRunning(false)
      const durationSeconds = Math.max(1, timerElapsed)
      await withBusy(async () => {
        const snapshot = await core.createFocusSessionAndRefresh({
          payload: {
            task_id: currentTaskId,
            start_time: timerStartIsoRef.current,
            duration_seconds: durationSeconds
          },
          ...buildScopedRefreshInput(timeScopeTaskId, 'time')
        })
        setFocusSessions(snapshot.focusSessions)
        setFocusStats(snapshot.focusStats)
        await loadHomeSnapshot(recordsDate, homeSelectedTaskIds)
      })
      if (timerMode === 'countdown') {
        setTimerMessage(manualStop ? `倒计时提前结束，记录 ${formatDuration(durationSeconds)}` : `倒计时完成，记录 ${formatDuration(durationSeconds)}`)
      } else {
        setTimerMessage(`正计时结束，记录 ${formatDuration(durationSeconds)}`)
      }
      setTimerElapsed(0)
      setTimerRemain(0)
      logAction('focus.stop', { mode: timerMode, durationSeconds, manualStop })
    } finally {
      stoppingRef.current = false
    }
  }

  async function handleCreateManualFocusSession(input: { taskId: number; startTime: string; durationSeconds: number }) {
    const { taskId, startTime, durationSeconds } = input
    if (taskId <= 1) {
      showError('请选择具体任务后再补记')
      return
    }
    await withBusy(async () => {
      const snapshot = await core.createFocusSessionAndRefresh({
        payload: {
          task_id: taskId,
          start_time: startTime,
          duration_seconds: Math.max(1, Math.round(durationSeconds))
        },
        ...buildScopedRefreshInput(timeScopeTaskId, 'time')
      })
      setFocusSessions(snapshot.focusSessions)
      setFocusStats(snapshot.focusStats)
      await loadHomeSnapshot(recordsDate, homeSelectedTaskIds)
      logAction('focus.manual', { taskId, durationSeconds: Math.max(1, Math.round(durationSeconds)) })
    })
  }

  return (
    <div className="mx-auto w-full max-w-[1560px] px-3 pb-24 pt-4 sm:px-6 sm:pb-12 sm:pt-6 lg:px-8">
      <header className="mb-4 rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-soft backdrop-blur sm:mb-5 sm:p-5">
        <div className="mb-3 space-y-1 sm:mb-4">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">EveryDay Perfect</h1>
          <p className="text-sm text-slate-500">Modern command center for focused daily execution.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" iconLeft={<Settings2 className="h-4 w-4" />} onClick={() => void openProjectManager()}>
            项目管理
          </Button>
          <Button variant="ghost" iconLeft={<Bot className="h-4 w-4" />} onClick={() => void openAiSettings()}>
            AI 设置
          </Button>
          <Button
            variant="ghost"
            iconLeft={<Plus className="h-4 w-4" />}
            onClick={() => {
              resetTaskDraft()
              setTaskModalMode('create')
              setTaskModalOpen(true)
            }}
          >
            新建任务
          </Button>
        </div>
      </header>

      <nav className="mb-5">
        <SegmentedTabs tabs={tabs} value={activeTab} onChange={setActiveTab} />
      </nav>

      {error ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <span>{error}</span>
          <button
            type="button"
            className="text-xs font-medium text-rose-500 hover:text-rose-700"
            onClick={clearError}
            aria-label="关闭错误提示"
          >
            关闭
          </button>
        </div>
      ) : null}

      <main className="space-y-4 sm:space-y-6" aria-busy={loading || homeLoading}>
        {activeTab === 'records' ? (
          <CommandCenterTab
            snapshot={homeSnapshot}
            loading={homeLoading}
            recordDate={recordsDate}
            selectedTaskIds={homeSelectedTaskIds}
            onRecordDateChange={(value) => {
              setRecordsDate(value)
              void loadHomeSnapshot(value, homeSelectedTaskIds)
            }}
            onSelectedTaskIdsChange={(taskIds) => {
              setHomeSelectedTaskIds(taskIds)
              void loadHomeSnapshot(recordsDate, taskIds)
            }}
            onRefresh={async () => {
              await loadHomeSnapshot(recordsDate, homeSelectedTaskIds)
            }}
            onSaveEntries={handleSaveHomeEntries}
            onLoadSettlementReport={handleLoadSettlementReport}
            onLoadAiSummary={handleLoadAiSummary}
            onFocusCapture={handleFocusCapture}
            onApplySettlementAction={handleApplySettlementAction}
            onEvolvePending={handleEvolvePending}
            onOpenProjectManager={() => {
              void openProjectManager()
            }}
          />
        ) : null}

        {activeTab === 'todos' ? (
          <TodosTab
            todoTitle={todoTitle}
            todoDesc={todoDesc}
            todoDate={todoDate}
            todos={todos}
            taskOptions={visibleTasks}
            todoTaskId={todoTaskId}
            onTodoTaskIdChange={setTodoTaskId}
            onTodoTitleChange={setTodoTitle}
            onTodoDescChange={setTodoDesc}
            onTodoDateChange={setTodoDate}
            onCreateTodo={handleCreateTodo}
            onToggleTodo={handleToggleTodo}
            onDeleteTodo={handleDeleteTodo}
          />
        ) : null}

        {activeTab === 'time' ? (
          <TimeTab
            timerModeTabs={timerModeTabs}
            timerMode={timerMode}
            countdownMinutes={countdownMinutes}
            timerRunning={timerRunning}
            timerElapsed={timerElapsed}
            timerRemain={timerRemain}
            timerMessage={timerMessage}
            isGlobalScope={currentTaskId === 1}
            currentTaskId={currentTaskId}
            tasks={tasks}
            scopeTaskId={timeScopeTaskId}
            currentTaskName={currentTaskName}
            focusSessions={focusSessions}
            onScopeTaskIdChange={setTimeScopeTaskId}
            onTimerModeChange={setTimerMode}
            onCountdownMinutesChange={setCountdownMinutes}
            onStartTimer={startTimer}
            onStopTimer={stopTimer}
            onCreateManualSession={handleCreateManualFocusSession}
            displayClock={displayClock}
          />
        ) : null}

        {activeTab === 'stats' ? (
          <StatsTab
            todos={todos}
            focusSessions={focusSessions}
            recentRecords={recentRecords}
            attrs={attrs}
            tasks={tasks}
            scopeTaskId={statsScopeTaskId}
            onScopeTaskIdChange={setStatsScopeTaskId}
            isGlobalScope={statsScopeTaskId === 1}
            onLoadAiSummary={handleLoadAiSummary}
          />
        ) : null}

        {activeTab === 'learning' ? (
          <LearningStudioTab onOpenAiSettings={() => void openAiSettings()} />
        ) : null}
      </main>

      {projectOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="关闭项目管理"
            className="absolute inset-0 bg-slate-900/30"
            onClick={() => {
              setProjectOpen(false)
              resetProjectAttrDraft()
              setProjectAttrsExpanded(false)
              setProjectTasksExpanded(false)
            }}
          />
          <aside className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">项目管理</h3>
                <p className="mt-1 text-xs text-slate-500">任务与属性管理已下沉到这里，不再占用主流程。</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<X className="h-4 w-4" />}
                onClick={() => {
                  setProjectOpen(false)
                  resetProjectAttrDraft()
                  setProjectAttrsExpanded(false)
                  setProjectTasksExpanded(false)
                }}
              >
                关闭
              </Button>
            </div>

            <div className="space-y-4 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-600">任务</p>
                    <p className="mt-1 text-[11px] text-slate-500">默认折叠，先看全量标签预览，展开后再做增删改。</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">
                      {visibleTasks.length} 项
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconLeft={<ChevronDown className={`h-3.5 w-3.5 transition ${projectTasksExpanded ? 'rotate-180' : ''}`} />}
                      onClick={() => setProjectTasksExpanded((prev) => !prev)}
                    >
                      {projectTasksExpanded ? '收起' : '展开'}
                    </Button>
                  </div>
                </div>
                {visibleTasks.length === 0 ? (
                  <p className="text-sm text-slate-400">暂无任务</p>
                ) : !projectTasksExpanded ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                    <div className="flex flex-wrap gap-2">
                      {visibleTasks.map((task) => (
                        <button
                          key={`project-task-pill-${task.task_id}`}
                          type="button"
                          className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs transition ${
                            projectTaskId === task.task_id
                              ? 'font-semibold text-slate-800 ring-1 ring-slate-300'
                              : 'text-slate-600 hover:text-slate-800'
                          }`}
                          style={projectTaskTagStyleById.get(task.task_id) ?? buildTagColorStyle(task.task_color)}
                          onClick={() => {
                            setProjectTaskId(task.task_id)
                            resetProjectAttrDraft()
                            if (projectAttrsExpanded) {
                              setProjectAttrsTaskId(null)
                            }
                          }}
                          title={task.task_name}
                        >
                          <span className="break-all text-left">#{task.task_name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        iconLeft={<Plus className="h-3.5 w-3.5" />}
                        onClick={() => {
                          resetTaskDraft()
                          setTaskModalMode('create')
                          setTaskModalOpen(true)
                        }}
                      >
                        新建
                      </Button>
                    </div>
                    <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {visibleTasks.map((task) => (
                        <li key={`project-task-${task.task_id}`} className="rounded-xl border border-slate-200 bg-white p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              className={`min-w-0 text-left ${projectTaskId === task.task_id ? 'text-[var(--edp-brand-strong)]' : 'text-slate-700'}`}
                              onClick={() => {
                                setProjectTaskId(task.task_id)
                                resetProjectAttrDraft()
                                if (projectAttrsExpanded) {
                                  setProjectAttrsTaskId(null)
                                }
                              }}
                            >
                              <p className="truncate text-sm font-semibold" title={task.task_name}>
                                <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: task.task_color || '#94a3b8' }} />
                                {task.task_name}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">{task.task_desc || '-'}</p>
                            </button>
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                variant="ghost"
                                iconLeft={<PencilLine className="h-3.5 w-3.5" />}
                                onClick={() => {
                                  setTaskModalMode('edit')
                                  setEditingTaskId(task.task_id)
                                  setTaskName(task.task_name)
                                  setTaskDesc(task.task_desc)
                                  setTaskColor(task.task_color || DEFAULT_TASK_COLOR)
                                  setTaskModalOpen(true)
                                }}
                              >
                                编辑
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                                onClick={() => void handleDeleteTask(task.task_id)}
                              >
                                删除
                              </Button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-600">属性</p>
                    <p className="mt-1 text-[11px] text-slate-500">默认折叠为标签预览，展开后进行属性配置与编辑。</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">
                      {projectAttrsExpanded ? projectAttrs.length : projectAttrPreviewItems.length} 项
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconLeft={<ChevronDown className={`h-3.5 w-3.5 transition ${projectAttrsExpanded ? 'rotate-180' : ''}`} />}
                      onClick={() => {
                        setProjectAttrsExpanded((prev) => {
                          const next = !prev
                          if (next) {
                            resetProjectAttrDraft()
                          }
                          return next
                        })
                      }}
                    >
                      {projectAttrsExpanded ? '收起' : '展开'}
                    </Button>
                  </div>
                </div>
                {projectTaskId == null ? (
                  <p className="text-sm text-slate-400">请先选择任务</p>
                ) : !projectAttrsExpanded ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                    {projectAttrLoading ? (
                      <p className="text-sm text-slate-400">加载中...</p>
                    ) : projectAttrPreviewItems.length === 0 ? (
                      <p className="text-sm text-slate-400">暂无可编辑属性</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {projectAttrPreviewItems.map((attr) => (
                          <button
                            key={`project-attr-pill-${attr.attr_id}`}
                            type="button"
                            className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs transition ${
                              projectEditingAttrId === attr.attr_id
                                ? 'font-semibold text-slate-800 ring-1 ring-slate-300'
                                : 'text-slate-600 hover:text-slate-800'
                            }`}
                            style={projectTagStyle}
                            onClick={() => {
                              void openProjectAttrEditor(attr.attr_id)
                            }}
                            title={attr.attr_name}
                          >
                            <span className="break-all text-left">#{attr.attr_name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-2.5">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-600">属性标签</p>
                        <div className="flex items-center gap-1.5">
                          {projectEditingAttrId != null ? (
                            <span className="rounded-full border border-[var(--edp-brand-border)] bg-[var(--edp-brand-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--edp-brand-strong)]">
                              编辑中
                            </span>
                          ) : null}
                          <Button size="sm" variant="ghost" iconLeft={<Plus className="h-3.5 w-3.5" />} onClick={resetProjectAttrDraft}>
                            创建属性
                          </Button>
                        </div>
                      </div>
                      {projectAttrLoading ? (
                        <p className="text-sm text-slate-400">加载中...</p>
                      ) : projectAttrs.length === 0 ? (
                        <p className="text-sm text-slate-400">暂无可编辑属性</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {projectAttrs.map((attr) => (
                            <button
                              key={`project-attr-edit-pill-${attr.attr_id}`}
                              type="button"
                              className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs transition ${
                                projectEditingAttrId === attr.attr_id
                                  ? 'font-semibold text-slate-800 ring-1 ring-slate-300'
                                  : 'text-slate-600 hover:text-slate-800'
                              }`}
                              style={projectTagStyle}
                              onClick={() => fillProjectAttrDraft(attr)}
                              title={attr.attr_name}
                            >
                              <span className="break-all text-left">#{attr.attr_name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-600">{projectEditingAttrId == null ? '创建属性' : '修改属性'}</p>
                        {projectEditingAttrId != null ? (
                          <button
                            type="button"
                            className="text-[11px] text-slate-500 underline-offset-2 hover:underline"
                            onClick={resetProjectAttrDraft}
                          >
                            切换到创建
                          </button>
                        ) : null}
                      </div>
                      <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-slate-600">属性名称</span>
                        <input
                          className="input-clean w-full"
                          value={projectAttrName}
                          onChange={(e) => setProjectAttrName(e.target.value)}
                          placeholder="例如：刷题数、阅读页数"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-slate-600">单位</span>
                        <input
                          className="input-clean w-full"
                          value={projectAttrUnit}
                          onChange={(e) => setProjectAttrUnit(e.target.value)}
                          placeholder="可选，例如：次 / 页 / 分钟"
                        />
                      </label>
                      <div className="grid gap-2 sm:grid-cols-2 sm:items-start">
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium text-slate-600">目标值（≤0 视为无目标）</p>
                          <input
                            className="input-clean w-full"
                            type="number"
                            min={-1}
                            value={projectAttrTarget}
                            onChange={(e) => setProjectAttrTarget(Number(e.target.value || 0))}
                            placeholder="默认 100"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium text-slate-600">权重</p>
                          <input
                            className="input-clean w-full"
                            type="number"
                            min={1}
                            value={projectAttrWeight}
                            onChange={(e) => setProjectAttrWeight(Number(e.target.value || 1))}
                            placeholder="默认 1"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] font-medium text-slate-600">输入类型</p>
                        <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                          {([
                            { key: 'number', label: '数值' },
                            { key: 'boolean', label: '打卡' },
                            { key: 'timer', label: '计时' }
                          ] as Array<{ key: AttrInputType; label: string }>).map((item) => (
                            <button
                              key={`input-type-${item.key}`}
                              type="button"
                              className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                                projectAttrInputType === item.key
                                  ? 'bg-white text-[var(--edp-brand-strong)] shadow-sm'
                                  : 'text-slate-600 hover:bg-white'
                              }`}
                              onClick={() => setProjectAttrInputType(item.key)}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={projectAttrDetailEnabled}
                          onChange={(e) => setProjectAttrDetailEnabled(e.target.checked)}
                        />
                        允许在 Home 展开详情
                      </label>
                      {projectAttrTarget > 0 && projectAttrAdvancedOpen ? (
                        <p className="text-[11px] text-slate-500">已启用属性时间规划，基础“每日目标值”已失效，请以下方规则为准</p>
                      ) : null}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 transition hover:text-slate-900"
                        onClick={() => setProjectAttrAdvancedOpen((prev) => !prev)}
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                        {projectAttrAdvancedOpen ? '收起属性时间规划' : '展开属性时间规划'}
                      </button>

                      {projectAttrAdvancedOpen ? (
                        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                            <p className="text-xs font-medium text-slate-600">生效时间范围</p>
                            <p className="text-[11px] text-slate-500">留空即为不设限</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <label className="space-y-1 text-[11px] text-slate-500">
                                <span>开始日期（可选）</span>
                                <input
                                  className="input-clean h-9"
                                  type="date"
                                  value={projectAttrPeriodStart}
                                  onChange={(e) => setProjectAttrPeriodStart(e.target.value)}
                                />
                              </label>
                              <label className="space-y-1 text-[11px] text-slate-500">
                                <span>终止日期（可选）</span>
                                <input
                                  className="input-clean h-9"
                                  type="date"
                                  value={projectAttrPeriodEnd}
                                  onChange={(e) => setProjectAttrPeriodEnd(e.target.value)}
                                />
                              </label>
                            </div>
                          </div>

                          {projectAttrTarget <= 0 ? (
                            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                              <p className="text-xs text-slate-600">当前未开启目标值，时间规划仅用于选择属性生效日期</p>
                              <div className="grid grid-cols-7 gap-1.5">
                                {WEEKDAY_LABELS.map((label, index) => {
                                  const weekday = index + 1
                                  const selected = normalizedPlanningWeekdays.includes(weekday)
                                  return (
                                    <button
                                      key={`plan-week-${weekday}`}
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
                                        {WEEKDAY_LABELS.map((label, weekdayIndex) => {
                                          const weekday = weekdayIndex + 1
                                          const selected = rule.weekdays.includes(weekday)
                                          const owner = weekdayOwnerByRule.get(weekday)
                                          const blocked = !!owner && owner.ruleId !== rule.id
                                          return (
                                            <button
                                              key={`${rule.id}-${weekday}`}
                                              type="button"
                                              disabled={blocked}
                                              title={blocked ? `已在规则${owner?.order}中定义` : undefined}
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

                      <div className={`grid grid-cols-1 gap-2 ${projectEditingAttrId == null ? 'sm:grid-cols-1' : 'sm:grid-cols-3'}`}>
                        <Button
                          className="w-full"
                          iconLeft={projectEditingAttrId == null ? <Plus className="h-4 w-4" /> : <PencilLine className="h-4 w-4" />}
                          disabled={!projectAttrName.trim()}
                          onClick={() => void handleSaveProjectAttr()}
                        >
                          {projectEditingAttrId == null ? '添加属性' : '保存属性'}
                        </Button>
                        {projectEditingAttrId != null ? (
                          <Button variant="ghost" className="w-full" onClick={resetProjectAttrDraft}>
                            取消编辑
                          </Button>
                        ) : null}
                        {projectEditingAttrId != null ? (
                          <Button
                            variant="danger"
                            className="w-full"
                            iconLeft={<Trash2 className="h-4 w-4" />}
                            onClick={() => void handleDeleteProjectAttr(projectEditingAttrId)}
                          >
                            删除属性
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <AiSettingsModal
        open={aiSettingsOpen}
        loading={aiSettingsLoading}
        saving={aiSettingsSaving}
        testing={aiSettingsTesting}
        modeOptions={aiModeOptions}
        selectedMode={aiSettingsMode}
        providers={aiProviders}
        selectedProviderId={aiSettingsProviderId}
        configs={aiProviderConfigs}
        runtime={aiRuntimeState}
        privacyNotice={aiPrivacyNotice}
        statusMessage={aiStatusMessage}
        testMessage={aiTestMessage}
        onClose={() => {
          setAiSettingsOpen(false)
          setAiStatusMessage('')
          setAiTestMessage('')
        }}
        onModeChange={handleAiModeChange}
        onProviderChange={handleAiProviderChange}
        onConfigChange={handleAiConfigChange}
        onClearApiKey={handleAiClearApiKey}
        onSave={() => void handleSaveAiSettings()}
        onTest={() => void handleTestAiSettings()}
      />

      <CreateTaskModal
        open={taskModalOpen}
        mode={taskModalMode}
        taskName={taskName}
        taskDesc={taskDesc}
        taskColor={taskColor}
        onTaskNameChange={setTaskName}
        onTaskDescChange={setTaskDesc}
        onTaskColorChange={setTaskColor}
        onClose={() => {
          setTaskModalOpen(false)
          resetTaskDraft()
        }}
        onSubmit={() => void (taskModalMode === 'edit' ? handleUpdateTask() : handleCreateTask())}
      />

      <footer className="mt-6 border-t border-slate-200/70 pt-4 text-xs text-slate-400 sm:mt-8">
        {loading || homeLoading ? 'Syncing data...' : `Ready (${dataMode})`}
      </footer>
    </div>
  )
}

export default App
