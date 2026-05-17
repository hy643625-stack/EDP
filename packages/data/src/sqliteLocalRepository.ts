import type { CoreRepository } from '../../core/src/repository'
import type {
  CreateFocusSessionInput,
  CreateTaskAttrInput,
  CreateTaskInput,
  UpdateTaskAttrInput,
  UpdateTaskInput,
  CreateTodoInput,
  DailyRecord,
  DailyRecordValueInput,
  FocusSession,
  FocusStats,
  Task,
  TaskAttrRelation,
  TodoItem,
  TodoStats
} from '../../core/src/types'

type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

type LocalRecord = {
  task_id: number
  attr_id: number
  record_date: string
  data_value: number
  create_time: string
}

type LocalState = {
  version: number
  nextTaskId: number
  nextAttrId: number
  nextTodoId: number
  nextFocusId: number
  tasks: Task[]
  attrs: TaskAttrRelation[]
  todos: TodoItem[]
  focusSessions: FocusSession[]
  records: LocalRecord[]
}

const DEFAULT_STORAGE_KEY = 'everydayperfect.local.sqlite.v1'
const SUMMARY_TASK_ID = 1

const memoryStoreData = new Map<string, string>()
const memoryStore: StorageLike = {
  getItem: (key) => memoryStoreData.get(key) ?? null,
  setItem: (key, value) => {
    memoryStoreData.set(key, value)
  }
}

function resolveStore(input?: StorageLike): StorageLike {
  if (input) return input
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  return memoryStore
}

function nowIso(): string {
  return new Date().toISOString()
}

function datePart(iso: string): string {
  return iso.slice(0, 10)
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function createInitialState(): LocalState {
  const created = nowIso()
  return {
    version: 1,
    nextTaskId: 2,
    nextAttrId: 1,
    nextTodoId: 1,
    nextFocusId: 1,
    tasks: [
      {
        task_id: SUMMARY_TASK_ID,
        task_name: '总览',
        attr_num: 0,
        create_time: created,
        task_desc: '系统汇总任务',
        task_color: '#5d9372'
      }
    ],
    attrs: [],
    todos: [],
    focusSessions: [],
    records: []
  }
}

function ensureSummaryTask(state: LocalState): void {
  if (!state.tasks.some((item) => item.task_id === SUMMARY_TASK_ID)) {
    state.tasks.unshift({
      task_id: SUMMARY_TASK_ID,
      task_name: '总览',
      attr_num: 0,
      create_time: nowIso(),
      task_desc: '系统汇总任务',
      task_color: '#5d9372'
    })
  }
}

function recalcTaskAttrNum(state: LocalState, taskId: number): void {
  const task = state.tasks.find((item) => item.task_id === taskId)
  if (!task) return
  task.attr_num = state.attrs.filter((item) => item.task_id === taskId).length
}

function loadState(store: StorageLike, storageKey: string): LocalState {
  const raw = store.getItem(storageKey)
  if (!raw) {
    const seeded = createInitialState()
    store.setItem(storageKey, JSON.stringify(seeded))
    return seeded
  }

  try {
    const parsed = JSON.parse(raw) as LocalState
    if (!parsed || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.attrs) || !Array.isArray(parsed.todos) || !Array.isArray(parsed.focusSessions) || !Array.isArray(parsed.records)) {
      throw new Error('invalid local repository state')
    }
    ensureSummaryTask(parsed)
    return parsed
  } catch {
    const reset = createInitialState()
    store.setItem(storageKey, JSON.stringify(reset))
    return reset
  }
}

function saveState(store: StorageLike, storageKey: string, state: LocalState): void {
  store.setItem(storageKey, JSON.stringify(state))
}

function createBuiltinTaskAttrs(taskId: number, nextAttrId: number): { attrs: TaskAttrRelation[]; nextAttrId: number } {
  const streakAttr: TaskAttrRelation = {
    task_id: taskId,
    attr_id: nextAttrId,
    attr_name: '坚持天数',
    display_order: 1,
    attr_sign: 1,
    attr_record: -1,
    target_value: -1,
    attr_unit: '天',
    calc_type: '10010000',
    calc_config: '{}',
    weight: 0
  }

  const focusAttr: TaskAttrRelation = {
    task_id: taskId,
    attr_id: nextAttrId + 1,
    attr_name: '专注时长',
    display_order: 2,
    attr_sign: 1,
    attr_record: 0,
    target_value: -1,
    attr_unit: '秒',
    calc_type: '10010000',
    calc_config: '{}',
    weight: 0
  }

  const todoAttr: TaskAttrRelation = {
    task_id: taskId,
    attr_id: nextAttrId + 2,
    attr_name: '待办',
    display_order: 3,
    attr_sign: 1,
    attr_record: 0,
    target_value: -1,
    attr_unit: '',
    calc_type: '10010000',
    calc_config: '{}',
    weight: 0
  }

  return {
    attrs: [streakAttr, focusAttr, todoAttr],
    nextAttrId: nextAttrId + 3
  }
}

type CreateSqliteLocalRepositoryOptions = {
  storage?: StorageLike
  storageKey?: string
}

// Temporary browser-side local implementation.
// It mirrors CoreRepository behavior using localStorage persistence.
// Desktop/mobile shells can later swap this to a native SQLite bridge.
export function createSqliteLocalRepository(options: CreateSqliteLocalRepositoryOptions = {}): CoreRepository {
  const storage = resolveStore(options.storage)
  const storageKey = options.storageKey || DEFAULT_STORAGE_KEY

  function read(): LocalState {
    return loadState(storage, storageKey)
  }

  function write(state: LocalState): void {
    saveState(storage, storageKey, state)
  }

  return {
    async listTasks(): Promise<Task[]> {
      const state = read()
      return clone([...state.tasks].sort((a, b) => a.task_id - b.task_id))
    },

    async createTask(payload: CreateTaskInput): Promise<Task> {
      const state = read()
      const taskId = state.nextTaskId++
      const created = nowIso()

      const task: Task = {
        task_id: taskId,
        task_name: payload.name,
        attr_num: 0,
        create_time: created,
        task_desc: payload.desc,
        task_color: payload.task_color
      }

      state.tasks.push(task)
      const builtins = createBuiltinTaskAttrs(taskId, state.nextAttrId)
      state.nextAttrId = builtins.nextAttrId
      state.attrs.push(...builtins.attrs)
      recalcTaskAttrNum(state, taskId)
      write(state)
      return clone(task)
    },

    async updateTask(taskId: number, payload: UpdateTaskInput): Promise<Task> {
      if (taskId === SUMMARY_TASK_ID) {
        throw new Error('总览任务不能修改')
      }
      const state = read()
      const target = state.tasks.find((item) => item.task_id === taskId)
      if (!target) {
        throw new Error(`Task not found: ${taskId}`)
      }
      target.task_name = payload.name
      target.task_desc = payload.desc
      target.task_color = payload.task_color
      write(state)
      return clone(target)
    },

    async deleteTask(taskId: number): Promise<{ deleted: boolean }> {
      if (taskId === SUMMARY_TASK_ID) {
        return { deleted: false }
      }
      const state = read()
      const before = state.tasks.length
      state.tasks = state.tasks.filter((item) => item.task_id !== taskId)
      if (state.tasks.length === before) {
        return { deleted: false }
      }

      state.attrs = state.attrs.filter((item) => item.task_id !== taskId)
      state.todos = state.todos.filter((item) => item.task_id !== taskId)
      state.focusSessions = state.focusSessions.filter((item) => item.task_id !== taskId)
      state.records = state.records.filter((item) => item.task_id !== taskId)
      write(state)
      return { deleted: true }
    },

    async listTaskAttrs(taskId: number): Promise<TaskAttrRelation[]> {
      const state = read()
      return clone(
        state.attrs
          .filter((item) => item.task_id === taskId)
          .sort((a, b) => a.display_order - b.display_order || a.attr_id - b.attr_id)
      )
    },

    async createTaskAttr(taskId: number, payload: CreateTaskAttrInput): Promise<TaskAttrRelation> {
      const state = read()
      const task = state.tasks.find((item) => item.task_id === taskId)
      if (!task) {
        throw new Error(`Task not found: ${taskId}`)
      }

      const attr: TaskAttrRelation = {
        task_id: taskId,
        attr_id: state.nextAttrId++,
        attr_name: payload.attr_name,
        display_order: payload.display_order,
        attr_sign: payload.attr_sign,
        attr_record: payload.attr_record,
        target_value: payload.target_value,
        attr_unit: payload.unit,
        calc_type: payload.calc_type,
        calc_config: payload.calc_config,
        weight: payload.weight
      }

      state.attrs.push(attr)
      recalcTaskAttrNum(state, taskId)
      write(state)
      return clone(attr)
    },

    async updateTaskAttr(taskId: number, attrId: number, payload: UpdateTaskAttrInput): Promise<TaskAttrRelation> {
      const state = read()
      const target = state.attrs.find((item) => item.task_id === taskId && item.attr_id === attrId)
      if (!target) {
        throw new Error(`Task attr not found: task=${taskId}, attr=${attrId}`)
      }
      if (target.attr_sign !== 0) {
        throw new Error('固有属性不允许修改')
      }

      if (typeof payload.attr_name === 'string' && payload.attr_name.trim()) {
        target.attr_name = payload.attr_name.trim()
      }
      if (typeof payload.display_order === 'number') {
        target.display_order = payload.display_order
      }
      if (typeof payload.attr_sign === 'number') {
        target.attr_sign = payload.attr_sign
      }
      if (typeof payload.attr_record === 'number') {
        target.attr_record = payload.attr_record
      }
      if (typeof payload.target_value === 'number') {
        target.target_value = payload.target_value
      }
      if (typeof payload.unit === 'string') {
        target.attr_unit = payload.unit
      }
      if (typeof payload.calc_type === 'string') {
        target.calc_type = payload.calc_type
      }
      if (typeof payload.calc_config === 'string') {
        target.calc_config = payload.calc_config
      }
      if (typeof payload.weight === 'number') {
        target.weight = payload.weight
      }

      write(state)
      return clone(target)
    },

    async deleteTaskAttr(taskId: number, attrId: number): Promise<{ deleted: boolean }> {
      const state = read()
      const target = state.attrs.find((item) => item.task_id === taskId && item.attr_id === attrId)
      if (!target) {
        return { deleted: false }
      }
      if (target.attr_sign !== 0) {
        throw new Error('固有属性不允许删除')
      }

      const before = state.attrs.length
      state.attrs = state.attrs.filter((item) => !(item.task_id === taskId && item.attr_id === attrId))
      state.records = state.records.filter((item) => !(item.task_id === taskId && item.attr_id === attrId))
      if (state.attrs.length === before) {
        return { deleted: false }
      }
      recalcTaskAttrNum(state, taskId)
      write(state)
      return { deleted: true }
    },

    async listRecords(taskId: number, startDate?: string, endDate?: string): Promise<DailyRecord[]> {
      const state = read()
      if (!state.tasks.some((item) => item.task_id === taskId)) {
        throw new Error(`Task not found: ${taskId}`)
      }

      const attrMap = new Map<number, string>(
        state.attrs.filter((item) => item.task_id === taskId).map((item) => [item.attr_id, item.attr_name])
      )

      let list = state.records.filter((item) => item.task_id === taskId)
      if (startDate) {
        list = list.filter((item) => item.record_date >= startDate)
      }
      if (endDate) {
        list = list.filter((item) => item.record_date <= endDate)
      }

      const records: DailyRecord[] = list
        .map((item) => ({
          task_id: item.task_id,
          attr_id: item.attr_id,
          attr_name: attrMap.get(item.attr_id) || `Attr #${item.attr_id}`,
          data_value: item.data_value,
          record_date: item.record_date,
          create_time: item.create_time
        }))
        .sort((a, b) => a.record_date.localeCompare(b.record_date) || a.attr_id - b.attr_id)

      return clone(records)
    },

    async listTodos(taskId?: number): Promise<TodoItem[]> {
      const state = read()
      const filtered = taskId == null ? state.todos : state.todos.filter((item) => item.task_id === taskId)
      return clone([...filtered].sort((a, b) => b.created_at.localeCompare(a.created_at)))
    },

    async createTodo(payload: CreateTodoInput): Promise<TodoItem> {
      const state = read()
      if (!state.tasks.some((item) => item.task_id === payload.task_id)) {
        throw new Error(`Task not found: ${payload.task_id}`)
      }

      const ts = nowIso()
      const todo: TodoItem = {
        id: state.nextTodoId++,
        task_id: payload.task_id,
        title: payload.title,
        description: payload.description || '',
        due_date: payload.due_date ?? null,
        completed: false,
        completed_date: null,
        created_at: ts,
        updated_at: ts
      }
      state.todos.push(todo)
      write(state)
      return clone(todo)
    },

    async updateTodo(todoId: number, payload: Record<string, unknown>): Promise<TodoItem> {
      const state = read()
      const todo = state.todos.find((item) => item.id === todoId)
      if (!todo) {
        throw new Error(`Todo not found: ${todoId}`)
      }

      if (typeof payload.title === 'string') {
        todo.title = payload.title
      }
      if (typeof payload.description === 'string') {
        todo.description = payload.description
      }
      if (typeof payload.due_date === 'string' || payload.due_date == null) {
        todo.due_date = payload.due_date ?? null
      }
      if (typeof payload.completed === 'boolean') {
        todo.completed = payload.completed
        todo.completed_date = payload.completed ? datePart(nowIso()) : null
      }
      todo.updated_at = nowIso()

      write(state)
      return clone(todo)
    },

    async deleteTodo(todoId: number): Promise<{ deleted: boolean }> {
      const state = read()
      const before = state.todos.length
      state.todos = state.todos.filter((item) => item.id !== todoId)
      if (state.todos.length === before) {
        return { deleted: false }
      }
      write(state)
      return { deleted: true }
    },

    async todoStats(taskId?: number, targetDate?: string): Promise<TodoStats> {
      const state = read()
      const filtered = taskId == null ? state.todos : state.todos.filter((item) => item.task_id === taskId)
      const date = targetDate || datePart(nowIso())
      return {
        total: filtered.length,
        completed: filtered.filter((item) => item.completed).length,
        todayCompleted: filtered.filter((item) => item.completed && item.completed_date === date).length
      }
    },

    async createFocusSession(payload: CreateFocusSessionInput): Promise<FocusSession> {
      const state = read()
      const task = state.tasks.find((item) => item.task_id === payload.task_id)
      if (!task) {
        throw new Error(`Task not found: ${payload.task_id}`)
      }

      const session: FocusSession = {
        id: state.nextFocusId++,
        task_id: payload.task_id,
        task_name: task.task_name,
        task_color: task.task_color,
        start_time: payload.start_time,
        duration_seconds: Math.max(1, Math.round(payload.duration_seconds)),
        created_at: nowIso()
      }
      state.focusSessions.push(session)
      write(state)
      return clone(session)
    },

    async listFocusSessions(params?: { task_id?: number; start_date?: string; end_date?: string }): Promise<FocusSession[]> {
      const state = read()
      let list = [...state.focusSessions]
      if (params?.task_id != null) {
        list = list.filter((item) => item.task_id === params.task_id)
      }
      if (params?.start_date) {
        list = list.filter((item) => datePart(item.start_time) >= params.start_date!)
      }
      if (params?.end_date) {
        list = list.filter((item) => datePart(item.start_time) <= params.end_date!)
      }
      list.sort((a, b) => a.start_time.localeCompare(b.start_time))
      return clone(list)
    },

    async focusStats(taskId?: number, targetDate?: string): Promise<FocusStats> {
      const state = read()
      const date = targetDate || datePart(nowIso())
      const filtered = taskId == null ? state.focusSessions : state.focusSessions.filter((item) => item.task_id === taskId)
      return {
        todaySeconds: filtered
          .filter((item) => datePart(item.start_time) === date)
          .reduce((sum, item) => sum + item.duration_seconds, 0),
        totalSeconds: filtered.reduce((sum, item) => sum + item.duration_seconds, 0)
      }
    },

    async upsertDailyRecords(taskId: number, recordDate: string, values: DailyRecordValueInput[]): Promise<{ updated: boolean }> {
      const state = read()
      if (!state.tasks.some((item) => item.task_id === taskId)) {
        throw new Error(`Task not found: ${taskId}`)
      }

      const ts = nowIso()
      for (const value of values) {
        if (!Number.isFinite(value.value)) continue
        const existing = state.records.find(
          (item) => item.task_id === taskId && item.attr_id === value.attr_id && item.record_date === recordDate
        )
        if (existing) {
          existing.data_value = value.value
          existing.create_time = ts
        } else {
          state.records.push({
            task_id: taskId,
            attr_id: value.attr_id,
            record_date: recordDate,
            data_value: value.value,
            create_time: ts
          })
        }
      }

      write(state)
      return { updated: true }
    }
  }
}
