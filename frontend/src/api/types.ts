export interface ApiErrorPayload {
  code: string
  message: string
}

export interface ApiResponse<T> {
  success: boolean
  data: T
  error: ApiErrorPayload | null
}

export interface Task {
  task_id: number
  task_name: string
  attr_num: number
  create_time: string
  task_desc: string
  task_color: string
}

export interface TaskAttrRelation {
  task_id: number
  attr_id: number
  attr_name: string
  display_order: number
  attr_sign: number
  attr_record: number
  target_value: number
  attr_unit: string
  calc_type: string
  calc_config: string
  weight: number
}

export interface DailyRecord {
  task_id: number
  attr_id: number
  attr_name: string
  data_value: number
  record_date: string
  create_time: string
}

export interface TodoItem {
  id: number
  task_id: number
  title: string
  description: string
  due_date: string | null
  completed: boolean
  completed_date: string | null
  created_at: string
  updated_at: string
}

export interface TodoStats {
  total: number
  completed: number
  todayCompleted: number
}

export interface FocusSession {
  id: number
  task_id: number
  task_name: string | null
  task_color: string | null
  start_time: string
  duration_seconds: number
  created_at: string
}

export interface FocusStats {
  todaySeconds: number
  totalSeconds: number
}

export type AttrInputType = 'boolean' | 'number' | 'timer'

export interface AttrUxConfig {
  input_type: AttrInputType
  quick_step: number
  detail_enabled: boolean
}

export interface InboxEvent {
  event_id: string
  type: 'pending_settlement' | 'critical_error'
  severity: 'warning' | 'error'
  task_id: number
  task_name: string
  attr_id: number
  attr_name: string
  title: string
  message: string
  period_start?: string | null
  period_end?: string | null
}

export interface GlobalRecordCard {
  card_id: string
  task_id: number
  task_name: string
  task_color: string
  attr_id: number
  attr_name: string
  attr_unit: string
  target_value: number
  weight: number
  calc_type: string
  calc_config: string
  ux_config: AttrUxConfig
  period_start: string | null
  period_end: string | null
  is_pending_settlement: boolean
  today_value: number | null
  today_record_time: string | null
  last_record_time: string | null
}

export interface PendingReviewCard {
  card_id: string
  task_id: number
  task_name: string
  task_color: string
  attr_id: number
  attr_name: string
  attr_unit: string
  period_start: string | null
  period_end: string | null
  ended_days_ago: number
  title: string
  cta_label: string
}

export type SettlementAction = 'renew' | 'archive' | 'evolve'

export interface SettlementReport {
  task_id: number
  task_name: string
  attr_id: number
  attr_name: string
  period_start: string
  period_end: string
  period_start_source: 'config' | 'earliest_record'
  total_actual: number
  total_target: number | null
  completion_rate: number | null
  over_target_value: number | null
  review_copy: string
  recommended_action: SettlementAction
  recommendation_reason: string
}

export interface FocusCaptureResult {
  task_id: number
  timer_attr_id: number | null
  focus_attr_id: number
  record_date: string
  duration_seconds: number
  focus_session_id: number
  timer_attr_value_today: number | null
  focus_attr_value_today: number
}

export interface HomeSnapshot {
  date: string
  tasks: Array<Pick<Task, 'task_id' | 'task_name' | 'task_color' | 'task_desc' | 'create_time'>>
  filters: {
    selected_task_ids: number[]
    available_task_ids: number[]
  }
  inbox_events: InboxEvent[]
  pending_review_cards: PendingReviewCard[]
  record_cards: GlobalRecordCard[]
  todo_summary: TodoStats
  focus_summary: FocusStats
}

export interface BatchRecordEntry {
  task_id: number
  attr_id: number
  value: number | null
}

export type AiMode = 'off' | 'cloud' | 'local' | 'auto'

export interface AiModeOption {
  mode: AiMode
  label: string
  description: string
}

export type AiProviderDeployment = 'cloud' | 'local'
export type AiProviderTransport = 'openai_compatible' | 'ollama'
export type AiFieldInputType = 'text' | 'password' | 'url' | 'number' | 'toggle'

export interface AiProviderField {
  key: string
  label: string
  input_type: AiFieldInputType
  placeholder?: string
  help_text?: string
  required: boolean
  secret?: boolean
  min_value?: number
  max_value?: number
  step?: number
}

export interface AiProviderDescriptor {
  provider_id: string
  label: string
  deployment: AiProviderDeployment
  transport: AiProviderTransport
  description: string
  fields: AiProviderField[]
}

export interface AiProviderConfigView {
  base_url: string
  model_name: string
  temperature: number
  max_tokens: number
  stream: boolean
  timeout_seconds: number
  api_key_configured: boolean
  api_key_masked: string | null
}

export interface AiRuntimeState {
  uses_local_rules: boolean
  fallback_enabled: boolean
  status: 'rules_only' | 'fallback' | 'ready'
  message: string
}

export interface AiSettingsPayload {
  mode_options: AiModeOption[]
  mode: AiMode
  provider_id: string | null
  providers: AiProviderDescriptor[]
  provider_configs: Record<string, AiProviderConfigView>
  rules_enabled: boolean
  confirmation_required: boolean
  privacy_notice: string
  effective_runtime: AiRuntimeState
}

export interface AiConnectionTestResult {
  ok: boolean
  message: string
  degraded_to_rules: boolean
}

export interface AiSummarySections {
  overview: string
  signals: string[]
  actions: string[]
}

export interface AiSummaryPayload {
  task_id: number
  task_name: string
  attr_id: number
  attr_name: string
  record_date: string
  mode_requested: AiMode
  mode_used: 'local_rules' | 'model'
  provider_id: string | null
  fallback_reason: string | null
  runtime_message: string
  confirmation_required: boolean
  summary_text: string
  sections: AiSummarySections
  settlement_report: SettlementReport
  generated_at: string
}

export interface AiProviderConfigInput {
  api_key_input?: string
  clear_api_key?: boolean
  base_url?: string
  model_name?: string
  temperature?: number
  max_tokens?: number
  stream?: boolean
  timeout_seconds?: number
}

export interface LearningCourseModule {
  module_id: string
  title: string
  core_points: string[]
  outcome: string
}

export interface LearningCourse {
  course_id: string
  title: string
  category: string
  difficulty: string
  summary: string
  tags: string[]
  module_count: number
  modules: LearningCourseModule[]
}

export interface LearningAgentDescriptor {
  agent_id: string
  name: string
  responsibility: string
}

export interface LearningProfileDimension {
  key: string
  label: string
  value: string
  evidence: string
  confidence: number
}

export interface LearningProfileCore {
  overview: string
  dimensions: LearningProfileDimension[]
  strengths: string[]
  risks: string[]
  follow_up_questions: string[]
  focus_modules: LearningCourseModule[]
  weekly_days: number
  daily_minutes: number
}

export interface LearningProfilePayload {
  course: LearningCourse
  profile: LearningProfileCore
  mode_requested: AiMode
  mode_used: 'local_rules' | 'model'
  provider_id: string | null
  runtime_message: string
  fallback_reason: string | null
  generated_at: string
}

export interface LearningResourceCard {
  resource_id: string
  type: string
  title: string
  summary: string
  estimated_minutes: number
  agent_id: string
  content_markdown: string
  source_refs?: string[]
  safety_review?: LearningSafetyReview
}

export interface LearningPathStage {
  stage_id: string
  title: string
  objective: string
  focus_modules: string[]
  deliverables: string[]
  study_plan: string
  coach_tip: string
}

export interface LearningAgentRun {
  agent_id: string
  name?: string
  status: 'completed' | 'fallback' | 'failed'
  summary?: string
  duration_ms?: number
  input_summary?: string
  output_summary?: string
  fallback_reason?: string
  source_refs?: string[]
}

export interface LearningEvaluationPanel {
  mastery_signals: string[]
  self_check_questions: string[]
  rubric: Array<{
    level: string
    description: string
  }>
}

export interface LearningResourcePackage {
  package_overview: string
  coach_message: string
  resource_count: number
  resources: LearningResourceCard[]
  learning_path: LearningPathStage[]
  agent_runs: LearningAgentRun[]
  evaluation: LearningEvaluationPanel
  source_digest: {
    conversation_excerpt: string
    focus_module_titles: string[]
  }
}

export interface LearningResourcePackagePayload {
  course: LearningCourse
  profile: LearningProfileCore
  package: LearningResourcePackage
  mode_requested: AiMode
  mode_used: 'local_rules' | 'model'
  provider_id: string | null
  runtime_message: string
  fallback_reason: string | null
  generated_at: string
  agent_runs?: LearningAgentRun[]
}

export interface LearningWorkbenchPayload {
  courses: LearningCourse[]
  agents: LearningAgentDescriptor[]
  profile_dimensions: Array<{
    key: string
    label: string
  }>
  privacy_notice: string
  runtime: {
    mode: AiMode
    provider_id: string | null
    uses_local_rules: boolean
    fallback_enabled: boolean
    runtime_status: string
    runtime_message: string
    confirmation_required: boolean
  }
  feature_flags: {
    profile_builder: boolean
    resource_package: boolean
    learning_path: boolean
    evaluation_panel: boolean
  }
}

// ── Phase 2: Session-based types ──────────────────────

export interface LearningSessionSummary {
  id: string
  course_id: string
  title: string
  status: string
  created_at: string
  updated_at: string
}

export interface LearningProfileVersion {
  version: number
  snapshot: LearningProfileCore
  input_summary: string
  created_at: string
}

export interface LearningSafetyReview {
  grounding_passed: boolean
  warnings: string[]
  source_refs: string[]
}

export interface LearningSessionDetail {
  session: LearningSessionSummary
  profile_versions: LearningProfileVersion[]
  latest_package: LearningResourcePackagePayload | null
  agent_runs: LearningAgentRun[]
}

export interface LearningSessionCreateResponse {
  session: LearningSessionSummary
  profile: LearningProfileCore
  profile_version: number
  course: LearningCourse
  mode_requested: string
  mode_used: string
  provider_id: string | null
  runtime_message: string
  fallback_reason: string | null
  generated_at: string
}
