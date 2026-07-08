import axios from 'axios'

import type {
  ApiResponse,
  AiConnectionTestResult,
  AiProviderConfigInput,
  AiSummaryPayload,
  AiSettingsPayload,
  BatchRecordEntry,
  DailyRecord,
  FocusCaptureResult,
  FocusSession,
  FocusStats,
  HomeSnapshot,
  LearningProfilePayload,
  LearningResourcePackagePayload,
  LearningSessionCreateResponse,
  LearningSessionDetail,
  LearningSessionSummary,
  LearningTutorResponse,
  LearningWorkbenchPayload,
  PlanDashboard,
  PlanDetail,
  PlanReview,
  PlanSummary,
  SettlementReport,
  Task,
  TaskAttrRelation,
  TodoItem,
  TodoStats
} from './types'

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function isDesktopRuntime(hostname: string, port: string): boolean {
  if (typeof window === 'undefined') return false
  const ua = (navigator.userAgent || '').toLowerCase()
  const hasPywebviewUa = ua.includes('pywebview')
  const hasPywebviewBridge = typeof (window as Window & { pywebview?: unknown }).pywebview !== 'undefined'
  // In packaged app we serve UI from embedded backend (non-vite dev port).
  const servedByEmbeddedBackend = !import.meta.env.DEV && port !== '' && port !== '5173'
  return hasPywebviewUa || hasPywebviewBridge || (isLoopbackHost(hostname) && servedByEmbeddedBackend)
}

function resolveApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL || '').trim()
  const normalizedConfigured = configured.replace(/\/$/, '')

  if (typeof window !== 'undefined') {
    const currentHost = window.location.hostname
    const currentOrigin = window.location.origin
    const currentProtocol = window.location.protocol || 'http:'
    const currentPort = window.location.port
    const isLanClient = currentHost !== '' && !isLoopbackHost(currentHost)
    const desktopRuntime = isDesktopRuntime(currentHost, currentPort)

    // In desktop runtime we must not trust stale configured LAN hosts.
    if (desktopRuntime) {
      if (currentPort) {
        return currentOrigin
      }
      return 'http://127.0.0.1:18765'
    }

    // If frontend itself is accessed from backend port, use same origin.
    if (currentPort === '18765' && /^https?:$/i.test(currentProtocol)) {
      return currentOrigin
    }

    if (configured) {
      if (/^https?:\/\//i.test(normalizedConfigured)) {
        try {
          const parsed = new URL(normalizedConfigured)
          if (isLanClient && isLoopbackHost(parsed.hostname)) {
            return `${currentProtocol}//${currentHost}:18765`
          }
        } catch {
          // Keep configured when URL parsing fails.
        }
      }
      return normalizedConfigured
    }

    if (isLanClient) {
      return `${currentProtocol}//${currentHost}:18765`
    }

  }

  if (normalizedConfigured) return normalizedConfigured
  return 'http://127.0.0.1:18765'
}

const base = resolveApiBaseUrl()
export const API_BASE_URL = base
const REQUEST_TIMEOUT_MS = 30000
const REQUEST_RETRY_COUNT = 2
const REQUEST_RETRY_DELAY_MS = 450

const http = axios.create({
  baseURL: base,
  timeout: REQUEST_TIMEOUT_MS
})

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms)
  })
}

function shouldRetryRequest(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false
  if (!error.response) return true
  if (error.code === 'ECONNABORTED') return true

  const status = error.response.status
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504
}

function resolveApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const payload = error.response?.data as
      | {
          error?: { message?: string }
          message?: string
        }
      | undefined

    const serverMessage = payload?.error?.message || payload?.message
    if (typeof serverMessage === 'string' && serverMessage.trim()) {
      return serverMessage.trim()
    }

    if (error.code === 'ECONNABORTED') {
      return `Request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds.`
    }
    if (!error.response) {
      return `Cannot reach the service. Current API base: ${base}`
    }
    if (status === 404) {
      return 'Requested resource was not found.'
    }
    if (status != null && status >= 500) {
      return 'The service is temporarily unavailable.'
    }
    return 'Request failed.'
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  return 'Request failed.'
}

async function unwrap<T>(
  requestFactory: () => Promise<{ data: ApiResponse<T> }>,
  options?: { retries?: number }
): Promise<T> {
  const retries = options?.retries ?? 0

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await requestFactory()
      if (!result.data.success || result.data.error) {
        throw new Error(result.data.error?.message || 'Unexpected API response.')
      }
      return result.data.data
    } catch (error) {
      const canRetry = attempt < retries && shouldRetryRequest(error)
      if (canRetry) {
        await wait(REQUEST_RETRY_DELAY_MS * (attempt + 1))
        continue
      }
      throw new Error(resolveApiErrorMessage(error))
    }
  }

  throw new Error('Request failed.')
}

export const api = {
  health: () => unwrap<{ status: string }>(() => http.get('/health'), { retries: REQUEST_RETRY_COUNT }),

  listTasks: () => unwrap<Task[]>(() => http.get('/v1/tasks'), { retries: REQUEST_RETRY_COUNT }),
  createTask: (payload: { name: string; desc: string; task_color: string }) =>
    unwrap<Task>(() => http.post('/v1/tasks', payload)),
  updateTask: (taskId: number, payload: { name?: string; desc?: string; task_color?: string }) =>
    unwrap<Task>(() => http.patch(`/v1/tasks/${taskId}`, payload)),
  deleteTask: (taskId: number) => unwrap<{ deleted: boolean }>(() => http.delete(`/v1/tasks/${taskId}`)),

  listTaskAttrs: (taskId: number) =>
    unwrap<TaskAttrRelation[]>(() => http.get(`/v1/tasks/${taskId}/attrs`), { retries: REQUEST_RETRY_COUNT }),
  createTaskAttr: (taskId: number, payload: Record<string, unknown>) =>
    unwrap<TaskAttrRelation>(() => http.post(`/v1/tasks/${taskId}/attrs`, payload)),
  updateTaskAttr: (taskId: number, attrId: number, payload: Record<string, unknown>) =>
    unwrap<TaskAttrRelation>(() => http.patch(`/v1/tasks/${taskId}/attrs/${attrId}`, payload)),
  deleteTaskAttr: (taskId: number, attrId: number) =>
    unwrap<{ deleted: boolean }>(() => http.delete(`/v1/tasks/${taskId}/attrs/${attrId}`)),

  listRecords: (taskId: number, startDate?: string, endDate?: string) =>
    unwrap<DailyRecord[]>(
      () => http.get(`/v1/tasks/${taskId}/records`, {
        params: { start_date: startDate, end_date: endDate }
      }),
      { retries: REQUEST_RETRY_COUNT }
    ),
  upsertDailyRecords: (taskId: number, recordDate: string, values: Array<{ attr_id: number; value: number }>) =>
    unwrap<{ updated: boolean }>(() => http.put(`/v1/tasks/${taskId}/records/${recordDate}`, { values })),

  listTodos: (taskId?: number) =>
    unwrap<TodoItem[]>(
      () => http.get('/v1/todos', {
        params: { task_id: taskId }
      }),
      { retries: REQUEST_RETRY_COUNT }
    ),
  createTodo: (payload: { task_id: number; title: string; description: string; due_date?: string | null }) =>
    unwrap<TodoItem>(() => http.post('/v1/todos', payload)),
  updateTodo: (todoId: number, payload: Record<string, unknown>) =>
    unwrap<TodoItem>(() => http.patch(`/v1/todos/${todoId}`, payload)),
  deleteTodo: (todoId: number) => unwrap<{ deleted: boolean }>(() => http.delete(`/v1/todos/${todoId}`)),
  todoStats: (taskId?: number, targetDate?: string) =>
    unwrap<TodoStats>(
      () => http.get('/v1/todos/stats', {
        params: { task_id: taskId, target_date: targetDate }
      }),
      { retries: REQUEST_RETRY_COUNT }
    ),

  createFocusSession: (payload: {
    task_id: number
    attr_id?: number
    start_time: string
    record_date?: string
    duration_seconds: number
    plan_id?: string
    step_id?: string
    note?: string
  }) =>
    unwrap<FocusSession>(() => http.post('/v1/focus/sessions', payload)),
  listFocusSessions: (params?: { task_id?: number; start_date?: string; end_date?: string }) =>
    unwrap<FocusSession[]>(() => http.get('/v1/focus/sessions', { params }), { retries: REQUEST_RETRY_COUNT }),
  focusStats: (taskId?: number, targetDate?: string) =>
    unwrap<FocusStats>(
      () => http.get('/v1/focus/stats', {
        params: { task_id: taskId, target_date: targetDate }
      }),
      { retries: REQUEST_RETRY_COUNT }
    ),

  getCommandCenter: (date: string, taskIds?: number[]) =>
    unwrap<HomeSnapshot>(
      () => http.get('/v1/home/command-center', {
        params: {
          date,
          task_ids: taskIds && taskIds.length > 0 ? taskIds.join(',') : undefined
        }
      }),
      { retries: REQUEST_RETRY_COUNT }
    ),

  upsertHomeRecords: (recordDate: string, entries: BatchRecordEntry[]) =>
    unwrap<{ record_date: string; updated: number; deleted: number; entries: number }>(
      () => http.put(`/v1/home/records/${recordDate}`, { entries })
    ),

  getSettlementReport: (taskId: number, attrId: number, date: string) =>
    unwrap<SettlementReport>(
      () => http.get(`/v1/home/settlement-report/${taskId}/${attrId}`, {
        params: { date }
      }),
      { retries: REQUEST_RETRY_COUNT }
    ),

  applySettlementAction: (payload: { task_id: number; attr_id: number; action: 'renew' | 'archive'; anchor_date?: string }) =>
    unwrap<{
      task_id: number
      attr_id: number
      action: 'renew' | 'archive'
      period_start?: string
      period_end?: string
      cycle_days?: number
      attr_sign: number
    }>(() => http.post('/v1/home/settlement-actions', payload)),
  focusCapture: (payload: {
    task_id: number
    timer_attr_id?: number
    start_time: string
    duration_seconds: number
    record_date: string
  }) => unwrap<FocusCaptureResult>(() => http.post('/v1/home/focus-capture', payload)),

  getAiSettings: () => unwrap<AiSettingsPayload>(() => http.get('/v1/ai/settings'), { retries: REQUEST_RETRY_COUNT }),
  updateAiSettings: (payload: {
    mode: AiSettingsPayload['mode']
    provider_id: string | null
    provider_configs: Record<string, AiProviderConfigInput>
  }) => unwrap<AiSettingsPayload>(() => http.put('/v1/ai/settings', payload)),
  testAiSettingsConnection: (payload: {
    mode: AiSettingsPayload['mode']
    provider_id: string | null
    config: AiProviderConfigInput
  }) => unwrap<AiConnectionTestResult>(() => http.post('/v1/ai/settings/test', payload))
  ,
  getAiSummary: (payload: { task_id: number; attr_id: number; record_date: string }) =>
    unwrap<AiSummaryPayload>(() => http.post('/v1/ai/summary', payload)),

  listPlans: () => unwrap<PlanSummary[]>(() => http.get('/v1/plans'), { retries: REQUEST_RETRY_COUNT }),
  getPlan: (planId: string, date?: string) =>
    unwrap<PlanDetail>(() => http.get(`/v1/plans/${planId}`, { params: { date } }), { retries: REQUEST_RETRY_COUNT }),
  getPlanDashboard: (date: string, planId?: string) =>
    unwrap<PlanDashboard>(() => http.get('/v1/plans/dashboard', { params: { date, plan_id: planId } }), { retries: REQUEST_RETRY_COUNT }),
  importPlan: (payload: {
    source_text: string
    title?: string
    goal?: string
    start_date: string
    target_end_date: string
    preferred_weekdays: number[]
    daily_minutes: number
    task_binding: {
      mode: 'create' | 'existing'
      task_name?: string
      task_id?: number
    }
  }) => unwrap<PlanDetail>(() => http.post('/v1/plans/import', payload)),
  updatePlanDraft: (planId: string, snapshot: PlanDetail['snapshot']) =>
    unwrap<PlanDetail>(() => http.put(`/v1/plans/${planId}/draft`, { snapshot })),
  activatePlan: (planId: string) => unwrap<PlanDetail>(() => http.post(`/v1/plans/${planId}/activate`)),
  updatePlanStatus: (planId: string, status: 'active' | 'completed' | 'archived') =>
    unwrap<PlanDetail>(() => http.patch(`/v1/plans/${planId}/status`, { status })),
  addPlanTimeLog: (planId: string, payload: {
    step_id: string
    start_time: string
    duration_seconds: number
    source: 'timer' | 'manual'
    note?: string
  }) => unwrap<{ time_log: unknown; plan: PlanDetail }>(() => http.post(`/v1/plans/${planId}/time-logs`, payload)),
  completePlanStep: (planId: string, stepId: string, payload: {
    actual_minutes?: number
    time_note?: string
    evidence_text?: string
    evidence_url?: string
  }) => unwrap<{ step_state: unknown; plan: PlanDetail }>(() => http.post(`/v1/plans/${planId}/steps/${stepId}/complete`, payload)),
  reopenPlanStep: (planId: string, stepId: string) =>
    unwrap<{ step_state: unknown; plan: PlanDetail }>(() => http.post(`/v1/plans/${planId}/steps/${stepId}/reopen`)),
  createPlanReview: (planId: string, payload: {
    review_date: string
    summary?: string
    blockers?: string
    next_week_minutes?: number
  }) => unwrap<PlanReview>(() => http.post(`/v1/plans/${planId}/reviews`, payload)),
  applyPlanReview: (planId: string, reviewId: number) =>
    unwrap<{ revision: number; plan: PlanDetail }>(() => http.post(`/v1/plans/${planId}/reviews/${reviewId}/apply`)),
  rejectPlanReview: (planId: string, reviewId: number) =>
    unwrap<{ review_id: number; status: 'rejected' }>(() => http.post(`/v1/plans/${planId}/reviews/${reviewId}/reject`)),

  getLearningWorkbench: () =>
    unwrap<LearningWorkbenchPayload>(() => http.get('/v1/learning/workbench'), { retries: REQUEST_RETRY_COUNT }),
  buildLearningProfile: (payload: {
    course_id: string
    conversation: string
    preferred_goal?: string
    weekly_days?: number
    daily_minutes?: number
  }) => unwrap<LearningProfilePayload>(() => http.post('/v1/learning/profile', payload)),
  generateLearningResourcePackage: (payload: {
    course_id: string
    conversation: string
    preferred_goal?: string
    weekly_days?: number
    daily_minutes?: number
  }) => unwrap<LearningResourcePackagePayload>(() => http.post('/v1/learning/resource-package', payload)),

  // Phase 2: Session endpoints
  listLearningSessions: () =>
    unwrap<LearningSessionSummary[]>(() => http.get('/v1/learning/sessions')),
  createLearningSession: (payload: {
    course_id: string
    conversation: string
    preferred_goal?: string
    weekly_days?: number
    daily_minutes?: number
    title?: string
  }) => unwrap<LearningSessionCreateResponse>(() => http.post('/v1/learning/sessions', payload)),
  getLearningSession: (sessionId: string) =>
    unwrap<LearningSessionDetail>(() => http.get(`/v1/learning/sessions/${sessionId}`)),
  updateLearningSessionProfile: (sessionId: string, payload: {
    conversation: string
    preferred_goal?: string
    weekly_days?: number
    daily_minutes?: number
  }) => unwrap<LearningProfilePayload>(() => http.post(`/v1/learning/sessions/${sessionId}/profile`, payload)),
  generateSessionResourcePackage: (sessionId: string) =>
    unwrap<LearningResourcePackagePayload>(() => http.post(`/v1/learning/sessions/${sessionId}/resource-package`)),

  // Phase 3: Tutor
  tutorLearningSession: (sessionId: string, question: string) =>
    unwrap<LearningTutorResponse>(() => http.post(`/v1/learning/sessions/${sessionId}/tutor`, { question })),

  // Phase 6: Contest (longer timeouts: CF API + LLM + 对拍)
  postContestFetchProblem: (url: string, handle?: string) =>
    unwrap<Record<string, unknown>>(() => http.post('/v1/contest/problems/fetch', { url, handle: handle || '' }, { timeout: 60000 })),
  postContestFetchCfSubmissions: (handle: string) =>
    unwrap<Record<string, unknown>[]>(() => http.post('/v1/contest/submissions/fetch-cf', { handle })),
  postContestDiagnose: (payload: Record<string, unknown>) =>
    unwrap<Record<string, unknown>>(() => http.post('/v1/contest/diagnose', payload, { timeout: 180000 })),
}
