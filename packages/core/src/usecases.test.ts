import { describe, expect, it, vi } from 'vitest'
import type { CoreRepository } from './repository'
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
import { createCoreUseCases } from './usecases'

function task(taskId: number, name = `Task-${taskId}`): Task {
  return {
    task_id: taskId,
    task_name: name,
    attr_num: 0,
    create_time: '2026-04-15T00:00:00.000Z',
    task_desc: `${name} desc`,
    task_color: '#5d9372'
  }
}

function attr(taskId: number, attrId = 1): TaskAttrRelation {
  return {
    task_id: taskId,
    attr_id: attrId,
    attr_name: '专注时长',
    display_order: 1,
    attr_sign: 1,
    attr_record: 0,
    target_value: 0,
    attr_unit: '秒',
    calc_type: '10010000',
    calc_config: '{}',
    weight: 1
  }
}

function todo(taskId: number, id = 1): TodoItem {
  return {
    id,
    task_id: taskId,
    title: `Todo-${id}`,
    description: '',
    due_date: null,
    completed: false,
    completed_date: null,
    created_at: '2026-04-15T00:00:00.000Z',
    updated_at: '2026-04-15T00:00:00.000Z'
  }
}

function focus(taskId: number, id = 1): FocusSession {
  return {
    id,
    task_id: taskId,
    task_name: `Task-${taskId}`,
    task_color: '#5d9372',
    start_time: '2026-04-15T10:00:00.000Z',
    duration_seconds: 1500,
    created_at: '2026-04-15T10:25:00.000Z'
  }
}

function record(taskId: number, attrId = 1, date = '2026-04-15'): DailyRecord {
  return {
    task_id: taskId,
    attr_id: attrId,
    attr_name: '专注时长',
    data_value: 42,
    record_date: date,
    create_time: `${date}T00:00:00.000Z`
  }
}

function createMockRepository(overrides: Partial<CoreRepository> = {}) {
  const stubs = {
    listTasks: vi.fn(async () => [] as Task[]),
    createTask: vi.fn(async (payload: CreateTaskInput) => task(99, payload.name)),
    updateTask: vi.fn(async (taskId: number, payload: UpdateTaskInput) => ({
      ...task(taskId, payload.name),
      task_desc: payload.desc,
      task_color: payload.task_color
    })),
    deleteTask: vi.fn(async () => ({ deleted: true })),
    listTaskAttrs: vi.fn(async () => [] as TaskAttrRelation[]),
    createTaskAttr: vi.fn(async (taskId: number, payload: CreateTaskAttrInput) => ({
      ...attr(taskId, 88),
      attr_name: payload.attr_name
    })),
    updateTaskAttr: vi.fn(async (taskId: number, attrId: number, payload: UpdateTaskAttrInput) => ({
      ...attr(taskId, attrId),
      attr_name: payload.attr_name ?? '专注时长',
      display_order: payload.display_order ?? 1,
      attr_sign: payload.attr_sign ?? 0,
      attr_record: payload.attr_record ?? 1,
      target_value: payload.target_value ?? -1,
      attr_unit: payload.unit ?? '',
      calc_type: payload.calc_type ?? '10010000',
      calc_config: payload.calc_config ?? '{}',
      weight: payload.weight ?? 0
    })),
    deleteTaskAttr: vi.fn(async () => ({ deleted: true })),
    listRecords: vi.fn(async () => [] as DailyRecord[]),
    listTodos: vi.fn(async () => [] as TodoItem[]),
    createTodo: vi.fn(async (payload: CreateTodoInput) => todo(payload.task_id, 123)),
    updateTodo: vi.fn(async (todoId: number) => todo(2, todoId)),
    deleteTodo: vi.fn(async () => ({ deleted: true })),
    todoStats: vi.fn(async () => ({ total: 0, completed: 0, todayCompleted: 0 } as TodoStats)),
    createFocusSession: vi.fn(async (payload: CreateFocusSessionInput) => focus(payload.task_id, 12)),
    listFocusSessions: vi.fn(async () => [] as FocusSession[]),
    focusStats: vi.fn(async () => ({ todaySeconds: 0, totalSeconds: 0 } as FocusStats)),
    upsertDailyRecords: vi.fn(async () => ({ updated: true }))
  }

  const repository: CoreRepository = {
    ...stubs,
    ...overrides
  }

  return { stubs, usecases: createCoreUseCases(repository) }
}

describe('createCoreUseCases', () => {
  it('bootstrap returns null selectedTaskId when there are no tasks', async () => {
    const { usecases, stubs } = createMockRepository()
    stubs.listTasks.mockResolvedValueOnce([])

    const result = await usecases.bootstrap()
    expect(result).toEqual({ tasks: [], selectedTaskId: null })
  })

  it('bootstrap keeps preferred task id when it exists', async () => {
    const { usecases, stubs } = createMockRepository()
    const tasks = [task(1), task(2)]
    stubs.listTasks.mockResolvedValueOnce(tasks)

    const result = await usecases.bootstrap(2)
    expect(result).toEqual({ tasks, selectedTaskId: 2 })
  })

  it('bootstrap falls back to first task when preferred id is missing', async () => {
    const { usecases, stubs } = createMockRepository()
    const tasks = [task(1), task(2)]
    stubs.listTasks.mockResolvedValueOnce(tasks)

    const result = await usecases.bootstrap(99)
    expect(result).toEqual({ tasks, selectedTaskId: 1 })
  })

  it('refreshTaskScopedData uses global scope for summary task id 1', async () => {
    const { usecases, stubs } = createMockRepository()
    const globalTasks = [task(1), task(2), task(3)]
    const attrsTask2 = [attr(2, 21)]
    const attrsTask3 = [attr(3, 31)]
    const recordsTask2 = [record(2, 21, '2026-04-10')]
    const recordsTask3 = [record(3, 31, '2026-04-11')]
    const todos = [todo(2, 21)]
    const todoStats: TodoStats = { total: 5, completed: 2, todayCompleted: 1 }
    const focusStats: FocusStats = { todaySeconds: 1200, totalSeconds: 3600 }
    const sessions = [focus(2, 31)]

    stubs.listTasks.mockResolvedValueOnce(globalTasks)
    stubs.listTaskAttrs.mockResolvedValueOnce(attrsTask2)
    stubs.listTaskAttrs.mockResolvedValueOnce(attrsTask3)
    stubs.listRecords.mockResolvedValueOnce(recordsTask2)
    stubs.listRecords.mockResolvedValueOnce(recordsTask3)
    stubs.listTodos.mockResolvedValueOnce(todos)
    stubs.todoStats.mockResolvedValueOnce(todoStats)
    stubs.focusStats.mockResolvedValueOnce(focusStats)
    stubs.listFocusSessions.mockResolvedValueOnce(sessions)

    const result = await usecases.refreshTaskScopedData({
      currentTaskId: 1,
      statsDate: '2026-04-15',
      sessionStartDate: '2026-04-01'
    })

    expect(result).toEqual({
      attrs: [...attrsTask2, ...attrsTask3],
      records: [...recordsTask2, ...recordsTask3],
      todos,
      todoStats,
      focusStats,
      focusSessions: sessions
    })
    expect(stubs.listTasks).toHaveBeenCalledTimes(1)
    expect(stubs.listTaskAttrs).toHaveBeenCalledWith(2)
    expect(stubs.listTaskAttrs).toHaveBeenCalledWith(3)
    expect(stubs.listRecords).toHaveBeenCalledWith(2, '2026-04-01', '2026-04-15')
    expect(stubs.listRecords).toHaveBeenCalledWith(3, '2026-04-01', '2026-04-15')
    expect(stubs.listTodos).toHaveBeenCalledWith(undefined)
    expect(stubs.todoStats).toHaveBeenCalledWith(undefined, '2026-04-15')
    expect(stubs.focusStats).toHaveBeenCalledWith(undefined, '2026-04-15')
    expect(stubs.listFocusSessions).toHaveBeenCalledWith({
      task_id: undefined,
      start_date: '2026-04-01'
    })
  })

  it('refreshTaskScopedData scopes todo/focus requests by task for non-summary task', async () => {
    const { usecases, stubs } = createMockRepository()
    stubs.listTaskAttrs.mockResolvedValueOnce([attr(7)])
    stubs.listRecords.mockResolvedValueOnce([record(7)])
    stubs.listTodos.mockResolvedValueOnce([todo(7)])
    stubs.todoStats.mockResolvedValueOnce({ total: 1, completed: 0, todayCompleted: 0 })
    stubs.focusStats.mockResolvedValueOnce({ todaySeconds: 600, totalSeconds: 1200 })
    stubs.listFocusSessions.mockResolvedValueOnce([focus(7)])

    await usecases.refreshTaskScopedData({
      currentTaskId: 7,
      statsDate: '2026-04-15',
      sessionStartDate: '2026-04-01'
    })

    expect(stubs.listTodos).toHaveBeenCalledWith(7)
    expect(stubs.listRecords).toHaveBeenCalledWith(7, '2026-04-01', '2026-04-15')
    expect(stubs.todoStats).toHaveBeenCalledWith(7, '2026-04-15')
    expect(stubs.focusStats).toHaveBeenCalledWith(7, '2026-04-15')
    expect(stubs.listFocusSessions).toHaveBeenCalledWith({
      task_id: 7,
      start_date: '2026-04-01'
    })
  })

  it('createTaskAndReload creates task then selects newly created task', async () => {
    const { usecases, stubs } = createMockRepository()
    const created = task(9, 'New Task')
    stubs.createTask.mockResolvedValueOnce(created)
    stubs.listTasks.mockResolvedValueOnce([task(1), created])

    const result = await usecases.createTaskAndReload({
      payload: {
        name: 'New Task',
        desc: 'desc',
        task_color: '#123456'
      }
    })

    expect(stubs.createTask).toHaveBeenCalledWith({
      name: 'New Task',
      desc: 'desc',
      task_color: '#123456'
    })
    expect(result.selectedTaskId).toBe(9)
  })

  it('updateTaskAndReload updates task then keeps selected task id', async () => {
    const { usecases, stubs } = createMockRepository()
    const updated = {
      ...task(4, 'Renamed Task'),
      task_desc: 'new desc',
      task_color: '#abcdef'
    }
    stubs.updateTask.mockResolvedValueOnce(updated)
    stubs.listTasks.mockResolvedValueOnce([task(1), updated])

    const result = await usecases.updateTaskAndReload({
      taskId: 4,
      payload: {
        name: 'Renamed Task',
        desc: 'new desc',
        task_color: '#abcdef'
      },
      fallbackTaskId: 4
    })

    expect(stubs.updateTask).toHaveBeenCalledWith(4, {
      name: 'Renamed Task',
      desc: 'new desc',
      task_color: '#abcdef'
    })
    expect(result.selectedTaskId).toBe(4)
  })

  it('deleteTaskAndReload deletes and then uses fallback selection', async () => {
    const { usecases, stubs } = createMockRepository()
    stubs.listTasks.mockResolvedValueOnce([task(1), task(4)])

    const result = await usecases.deleteTaskAndReload({
      taskId: 9,
      fallbackTaskId: 4
    })

    expect(stubs.deleteTask).toHaveBeenCalledWith(9)
    expect(result.selectedTaskId).toBe(4)
  })

  it('toggleTodoAndRefresh flips completed flag before refreshing', async () => {
    const { usecases, stubs } = createMockRepository()
    stubs.listTaskAttrs.mockResolvedValueOnce([])
    stubs.listTodos.mockResolvedValueOnce([])
    stubs.todoStats.mockResolvedValueOnce({ total: 0, completed: 0, todayCompleted: 0 })
    stubs.focusStats.mockResolvedValueOnce({ todaySeconds: 0, totalSeconds: 0 })
    stubs.listFocusSessions.mockResolvedValueOnce([])

    await usecases.toggleTodoAndRefresh({
      todoId: 5,
      completed: false,
      currentTaskId: 2,
      statsDate: '2026-04-15',
      sessionStartDate: '2026-04-01'
    })

    expect(stubs.updateTodo).toHaveBeenCalledWith(5, { completed: true })
  })

  it('createTaskAttrAndReload reloads attr list after writing', async () => {
    const { usecases, stubs } = createMockRepository()
    const attrs = [attr(3, 10), attr(3, 11)]
    stubs.listTaskAttrs.mockResolvedValueOnce(attrs)

    const result = await usecases.createTaskAttrAndReload({
      taskId: 3,
      payload: {
        attr_name: '喝水',
        display_order: 3,
        attr_sign: 1,
        attr_record: 1,
        target_value: 8,
        unit: '杯',
        calc_type: '10010000',
        calc_config: '{}',
        weight: 1
      }
    })

    expect(stubs.createTaskAttr).toHaveBeenCalledWith(3, {
      attr_name: '喝水',
      display_order: 3,
      attr_sign: 1,
      attr_record: 1,
      target_value: 8,
      unit: '杯',
      calc_type: '10010000',
      calc_config: '{}',
      weight: 1
    })
    expect(result).toEqual(attrs)
  })

  it('updateTaskAttrAndReload reloads attr list after updating', async () => {
    const { usecases, stubs } = createMockRepository()
    const attrs = [attr(3, 10), attr(3, 11)]
    stubs.listTaskAttrs.mockResolvedValueOnce(attrs)

    const result = await usecases.updateTaskAttrAndReload({
      taskId: 3,
      attrId: 11,
      payload: {
        attr_name: '学习时长',
        target_value: 60,
        unit: '分钟',
        weight: 2
      }
    })

    expect(stubs.updateTaskAttr).toHaveBeenCalledWith(3, 11, {
      attr_name: '学习时长',
      target_value: 60,
      unit: '分钟',
      weight: 2
    })
    expect(result).toEqual(attrs)
  })

  it('upsertDailyRecords passes task/date/values to repository', async () => {
    const { usecases, stubs } = createMockRepository()
    const values: DailyRecordValueInput[] = [{ attr_id: 11, value: 42 }]
    stubs.upsertDailyRecords.mockResolvedValueOnce({ updated: true })

    const result = await usecases.upsertDailyRecords({
      taskId: 3,
      recordDate: '2026-04-15',
      values
    })

    expect(stubs.upsertDailyRecords).toHaveBeenCalledWith(3, '2026-04-15', values)
    expect(result).toEqual({ updated: true })
  })

  it('deleteTaskAttrAndReload deletes attr then reloads list', async () => {
    const { usecases, stubs } = createMockRepository()
    const attrs = [attr(6, 1), attr(6, 2)]
    stubs.listTaskAttrs.mockResolvedValueOnce(attrs)

    const result = await usecases.deleteTaskAttrAndReload({
      taskId: 6,
      attrId: 2
    })

    expect(stubs.deleteTaskAttr).toHaveBeenCalledWith(6, 2)
    expect(result).toEqual(attrs)
  })

  it('checkInAndRefresh increments 坚持天数 and merges custom values', async () => {
    const { usecases, stubs } = createMockRepository()
    stubs.listTaskAttrs.mockResolvedValueOnce([
      {
        ...attr(8, 1),
        attr_name: '坚持天数',
        attr_record: -1
      },
      {
        ...attr(8, 10),
        attr_name: '学习时长',
        attr_record: 1,
        target_value: 60
      }
    ])
    stubs.listRecords
      .mockResolvedValueOnce([]) // day records
      .mockResolvedValueOnce([{ ...record(8, 1, '2026-04-14'), data_value: 3 }]) // streak history
      .mockResolvedValueOnce([record(8, 10, '2026-04-16')]) // refresh scoped records
    stubs.listTodos.mockResolvedValueOnce([])
    stubs.todoStats.mockResolvedValueOnce({ total: 0, completed: 0, todayCompleted: 0 })
    stubs.focusStats.mockResolvedValueOnce({ todaySeconds: 0, totalSeconds: 0 })
    stubs.listFocusSessions.mockResolvedValueOnce([])

    await usecases.checkInAndRefresh({
      taskId: 8,
      recordDate: '2026-04-16',
      values: [{ attr_id: 10, value: 45 }],
      currentTaskId: 8,
      statsDate: '2026-04-16',
      sessionStartDate: '2026-04-01'
    })

    expect(stubs.upsertDailyRecords).toHaveBeenCalledWith(8, '2026-04-16', [
      { attr_id: 10, value: 45 },
      { attr_id: 1, value: 4 }
    ])
  })
})
