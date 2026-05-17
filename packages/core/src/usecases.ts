import type { CoreRepository } from './repository'
import { calculateWeightedCompletionForDate } from './schedule'
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
} from './types'

export type ScopedSnapshot = {
  attrs: TaskAttrRelation[]
  records: DailyRecord[]
  todos: TodoItem[]
  todoStats: TodoStats
  focusStats: FocusStats
  focusSessions: FocusSession[]
}

export function hasTargetValue(attr: TaskAttrRelation): boolean {
  return attr.attr_record === 1 && attr.target_value > 0
}

export function calculateWeightedCompletion(
  attrs: TaskAttrRelation[],
  records: DailyRecord[],
  recordDate: string
): number | null {
  return calculateWeightedCompletionForDate(attrs, records, recordDate)
}

function formatLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isFutureRecordDate(recordDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) return false
  return recordDate > formatLocalDateKey()
}

export function createCoreUseCases(repository: CoreRepository) {
  async function loadGlobalAttrsAndRecords(input: {
    recordStartDate: string
    recordEndDate: string
  }): Promise<{ attrs: TaskAttrRelation[]; records: DailyRecord[] }> {
    const tasks = await repository.listTasks()
    const scopeTaskIds = tasks.map((item) => item.task_id).filter((taskId) => taskId !== 1)
    if (scopeTaskIds.length === 0) {
      return { attrs: [], records: [] }
    }

    const [attrsByTask, recordsByTask] = await Promise.all([
      Promise.all(scopeTaskIds.map((taskId) => repository.listTaskAttrs(taskId))),
      Promise.all(
        scopeTaskIds.map((taskId) =>
          repository.listRecords(taskId, input.recordStartDate, input.recordEndDate)
        )
      )
    ])

    return {
      attrs: attrsByTask.flat(),
      records: recordsByTask.flat()
    }
  }

  async function bootstrap(preferredTaskId?: number): Promise<{ tasks: Task[]; selectedTaskId: number | null }> {
    const tasks = await repository.listTasks()
    if (tasks.length === 0) return { tasks, selectedTaskId: null }

    if (preferredTaskId && tasks.some((item) => item.task_id === preferredTaskId)) {
      return { tasks, selectedTaskId: preferredTaskId }
    }
    return { tasks, selectedTaskId: tasks[0].task_id }
  }

  async function refreshTaskScopedData(input: {
    currentTaskId: number
    statsDate: string
    sessionStartDate: string
    recordStartDate?: string
    recordEndDate?: string
  }): Promise<ScopedSnapshot> {
    const scopedTaskId = input.currentTaskId === 1 ? undefined : input.currentTaskId
    const recordStartDate = input.recordStartDate ?? input.sessionStartDate
    const recordEndDate = input.recordEndDate ?? input.statsDate

    const attrsAndRecordsPromise =
      scopedTaskId == null
        ? loadGlobalAttrsAndRecords({
            recordStartDate,
            recordEndDate
          })
        : Promise.all([
            repository.listTaskAttrs(input.currentTaskId),
            repository.listRecords(input.currentTaskId, recordStartDate, recordEndDate)
          ]).then(([attrs, records]) => ({ attrs, records }))

    const [{ attrs, records }, todos, todoStats, focusStats, focusSessions] = await Promise.all([
      attrsAndRecordsPromise,
      repository.listTodos(scopedTaskId),
      repository.todoStats(scopedTaskId, input.statsDate),
      repository.focusStats(scopedTaskId, input.statsDate),
      repository.listFocusSessions({
        task_id: scopedTaskId,
        start_date: input.sessionStartDate
      })
    ])

    return { attrs, records, todos, todoStats, focusStats, focusSessions }
  }

  async function createTaskAndReload(input: {
    payload: CreateTaskInput
    fallbackTaskId?: number
  }): Promise<{ tasks: Task[]; selectedTaskId: number | null }> {
    const created = await repository.createTask(input.payload)
    return bootstrap(created.task_id || input.fallbackTaskId)
  }

  async function updateTaskAndReload(input: {
    taskId: number
    payload: UpdateTaskInput
    fallbackTaskId?: number
  }): Promise<{ tasks: Task[]; selectedTaskId: number | null }> {
    const updated = await repository.updateTask(input.taskId, input.payload)
    return bootstrap(updated.task_id || input.fallbackTaskId)
  }

  async function deleteTaskAndReload(input: {
    taskId: number
    fallbackTaskId?: number
  }): Promise<{ tasks: Task[]; selectedTaskId: number | null }> {
    await repository.deleteTask(input.taskId)
    return bootstrap(input.fallbackTaskId)
  }

  async function createTodoAndRefresh(input: {
    payload: CreateTodoInput
    currentTaskId: number
    statsDate: string
    sessionStartDate: string
  }): Promise<ScopedSnapshot> {
    await repository.createTodo(input.payload)
    return refreshTaskScopedData({
      currentTaskId: input.currentTaskId,
      statsDate: input.statsDate,
      sessionStartDate: input.sessionStartDate
    })
  }

  async function toggleTodoAndRefresh(input: {
    todoId: number
    completed: boolean
    currentTaskId: number
    statsDate: string
    sessionStartDate: string
  }): Promise<ScopedSnapshot> {
    await repository.updateTodo(input.todoId, { completed: !input.completed })
    return refreshTaskScopedData({
      currentTaskId: input.currentTaskId,
      statsDate: input.statsDate,
      sessionStartDate: input.sessionStartDate
    })
  }

  async function deleteTodoAndRefresh(input: {
    todoId: number
    currentTaskId: number
    statsDate: string
    sessionStartDate: string
  }): Promise<ScopedSnapshot> {
    await repository.deleteTodo(input.todoId)
    return refreshTaskScopedData({
      currentTaskId: input.currentTaskId,
      statsDate: input.statsDate,
      sessionStartDate: input.sessionStartDate
    })
  }

  async function createFocusSessionAndRefresh(input: {
    payload: CreateFocusSessionInput
    currentTaskId: number
    statsDate: string
    sessionStartDate: string
  }): Promise<ScopedSnapshot> {
    await repository.createFocusSession(input.payload)
    return refreshTaskScopedData({
      currentTaskId: input.currentTaskId,
      statsDate: input.statsDate,
      sessionStartDate: input.sessionStartDate
    })
  }

  async function createTaskAttrAndReload(input: {
    taskId: number
    payload: CreateTaskAttrInput
  }): Promise<TaskAttrRelation[]> {
    await repository.createTaskAttr(input.taskId, input.payload)
    return repository.listTaskAttrs(input.taskId)
  }

  async function updateTaskAttrAndReload(input: {
    taskId: number
    attrId: number
    payload: UpdateTaskAttrInput
  }): Promise<TaskAttrRelation[]> {
    await repository.updateTaskAttr(input.taskId, input.attrId, input.payload)
    return repository.listTaskAttrs(input.taskId)
  }

  async function deleteTaskAttrAndReload(input: {
    taskId: number
    attrId: number
  }): Promise<TaskAttrRelation[]> {
    await repository.deleteTaskAttr(input.taskId, input.attrId)
    return repository.listTaskAttrs(input.taskId)
  }

  async function upsertDailyRecords(input: {
    taskId: number
    recordDate: string
    values: DailyRecordValueInput[]
  }): Promise<{ updated: boolean }> {
    if (isFutureRecordDate(input.recordDate)) {
      throw new Error('无法为未来签到')
    }
    return repository.upsertDailyRecords(input.taskId, input.recordDate, input.values)
  }

  async function checkInAndRefresh(input: {
    taskId: number
    recordDate: string
    values: DailyRecordValueInput[]
    currentTaskId: number
    statsDate: string
    sessionStartDate: string
  }): Promise<ScopedSnapshot> {
    if (isFutureRecordDate(input.recordDate)) {
      throw new Error('无法为未来签到')
    }

    const attrs = await repository.listTaskAttrs(input.taskId)
    const streakAttr = attrs.find((item) => item.attr_id === 1 || item.attr_name === '坚持天数')
    if (!streakAttr) {
      throw new Error('当前任务缺少“坚持天数”属性，无法签到')
    }

    const dayRecords = await repository.listRecords(input.taskId, input.recordDate, input.recordDate)
    const signedToday = dayRecords.some((item) => item.attr_id === streakAttr.attr_id)
    if (signedToday) {
      throw new Error('今日已签到，不能重复签到')
    }

    const streakHistory = await repository.listRecords(input.taskId)
    const prevStreak = streakHistory
      .filter((item) => item.attr_id === streakAttr.attr_id)
      .reduce((max, item) => {
        const value = Number(item.data_value)
        if (!Number.isFinite(value)) return max
        return Math.max(max, Math.floor(value))
      }, 0)

    const merged = new Map<number, number>()
    for (const item of input.values) {
      if (!Number.isFinite(item.value)) continue
      merged.set(item.attr_id, item.value)
    }
    merged.set(streakAttr.attr_id, prevStreak + 1)

    await repository.upsertDailyRecords(
      input.taskId,
      input.recordDate,
      Array.from(merged.entries()).map(([attr_id, value]) => ({ attr_id, value }))
    )

    return refreshTaskScopedData({
      currentTaskId: input.currentTaskId,
      statsDate: input.statsDate,
      sessionStartDate: input.sessionStartDate
    })
  }

  return {
    bootstrap,
    refreshTaskScopedData,
    createTaskAndReload,
    updateTaskAndReload,
    deleteTaskAndReload,
    createTodoAndRefresh,
    toggleTodoAndRefresh,
    deleteTodoAndRefresh,
    createFocusSessionAndRefresh,
    createTaskAttrAndReload,
    updateTaskAttrAndReload,
    deleteTaskAttrAndReload,
    upsertDailyRecords,
    checkInAndRefresh,
    calculateWeightedCompletion
  }
}
