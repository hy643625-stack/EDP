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
  attr_id?: number | null
  attr_name?: string | null
  start_time: string
  record_date?: string | null
  duration_seconds: number
  source_type?: string
  source_id?: string | null
  note?: string
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

export interface HomeSnapshot {
  date: string
  tasks: Array<Pick<Task, 'task_id' | 'task_name' | 'task_color' | 'task_desc' | 'create_time'>>
  filters: {
    selected_task_ids: number[]
    available_task_ids: number[]
  }
  inbox_events: InboxEvent[]
  record_cards: GlobalRecordCard[]
  todo_summary: TodoStats
  focus_summary: FocusStats
}

export type BatchRecordEntry = {
  task_id: number
  attr_id: number
  value: number | null
}

export type CreateTaskInput = {
  name: string
  desc: string
  task_color: string
}

export type UpdateTaskInput = {
  name: string
  desc: string
  task_color: string
}

export type CreateTodoInput = {
  task_id: number
  title: string
  description: string
  due_date?: string
}

export type CreateFocusSessionInput = {
  task_id: number
  attr_id?: number
  start_time: string
  record_date?: string
  duration_seconds: number
  plan_id?: string
  step_id?: string
  note?: string
}

export type CreateTaskAttrInput = {
  attr_name: string
  display_order: number
  attr_sign: number
  attr_record: number
  target_value: number
  unit: string
  calc_type: string
  calc_config: string
  weight: number
}

export type UpdateTaskAttrInput = {
  attr_name?: string
  display_order?: number
  attr_sign?: number
  attr_record?: number
  target_value?: number
  unit?: string
  calc_type?: string
  calc_config?: string
  weight?: number
}

export type DailyRecordValueInput = {
  attr_id: number
  value: number
}
