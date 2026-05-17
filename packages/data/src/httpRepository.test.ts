import { describe, expect, it, vi } from 'vitest'
import { createHttpRepository } from './httpRepository'

describe('createHttpRepository', () => {
  it('forwards task endpoints to api client', async () => {
    const api = {
      listTasks: vi.fn(async () => [{ task_id: 1, task_name: '总览' }]),
      createTask: vi.fn(async () => ({ task_id: 2, task_name: '新任务' })),
      updateTask: vi.fn(async () => ({ task_id: 2, task_name: '重命名任务' })),
      deleteTask: vi.fn(async () => ({ deleted: true })),
      listTaskAttrs: vi.fn(async () => []),
      createTaskAttr: vi.fn(async () => ({ attr_id: 1 })),
      updateTaskAttr: vi.fn(async () => ({ attr_id: 1 })),
      deleteTaskAttr: vi.fn(async () => ({ deleted: true })),
      listRecords: vi.fn(async () => []),
      listTodos: vi.fn(async () => []),
      createTodo: vi.fn(async () => ({ id: 1 })),
      updateTodo: vi.fn(async () => ({ id: 1 })),
      deleteTodo: vi.fn(async () => ({ deleted: true })),
      todoStats: vi.fn(async () => ({ total: 0, completed: 0, todayCompleted: 0 })),
      createFocusSession: vi.fn(async () => ({ id: 1 })),
      listFocusSessions: vi.fn(async () => []),
      focusStats: vi.fn(async () => ({ todaySeconds: 0, totalSeconds: 0 })),
      upsertDailyRecords: vi.fn(async () => ({ updated: true }))
    }
    const repo = createHttpRepository(api as never)

    await repo.listTasks()
    await repo.createTask({ name: 'A', desc: 'B', task_color: '#123' })
    await repo.updateTask(3, { name: 'A2', desc: 'B2', task_color: '#456' })
    await repo.updateTaskAttr(3, 7, { target_value: 5, unit: '次' })
    await repo.deleteTask(3)
    await repo.deleteTaskAttr(3, 7)

    expect(api.listTasks).toHaveBeenCalledTimes(1)
    expect(api.createTask).toHaveBeenCalledWith({ name: 'A', desc: 'B', task_color: '#123' })
    expect(api.updateTask).toHaveBeenCalledWith(3, { name: 'A2', desc: 'B2', task_color: '#456' })
    expect(api.updateTaskAttr).toHaveBeenCalledWith(3, 7, { target_value: 5, unit: '次' })
    expect(api.deleteTask).toHaveBeenCalledWith(3)
    expect(api.deleteTaskAttr).toHaveBeenCalledWith(3, 7)
  })

  it('forwards todo/focus scoped parameters without mutation', async () => {
    const api = {
      listTasks: vi.fn(async () => []),
      createTask: vi.fn(async () => ({ task_id: 1 })),
      updateTask: vi.fn(async () => ({ task_id: 1 })),
      deleteTask: vi.fn(async () => ({ deleted: true })),
      listTaskAttrs: vi.fn(async () => []),
      createTaskAttr: vi.fn(async () => ({})),
      updateTaskAttr: vi.fn(async () => ({})),
      deleteTaskAttr: vi.fn(async () => ({ deleted: true })),
      listRecords: vi.fn(async () => []),
      listTodos: vi.fn(async () => []),
      createTodo: vi.fn(async () => ({})),
      updateTodo: vi.fn(async () => ({})),
      deleteTodo: vi.fn(async () => ({ deleted: true })),
      todoStats: vi.fn(async () => ({ total: 0, completed: 0, todayCompleted: 0 })),
      createFocusSession: vi.fn(async () => ({})),
      listFocusSessions: vi.fn(async () => []),
      focusStats: vi.fn(async () => ({ todaySeconds: 0, totalSeconds: 0 })),
      upsertDailyRecords: vi.fn(async () => ({ updated: true }))
    }
    const repo = createHttpRepository(api as never)

    await repo.listTodos(7)
    await repo.listRecords(7, '2026-04-01', '2026-04-15')
    await repo.todoStats(7, '2026-04-15')
    await repo.listFocusSessions({ task_id: 7, start_date: '2026-04-01', end_date: '2026-04-30' })
    await repo.focusStats(7, '2026-04-15')

    expect(api.listRecords).toHaveBeenCalledWith(7, '2026-04-01', '2026-04-15')
    expect(api.listTodos).toHaveBeenCalledWith(7)
    expect(api.todoStats).toHaveBeenCalledWith(7, '2026-04-15')
    expect(api.listFocusSessions).toHaveBeenCalledWith({
      task_id: 7,
      start_date: '2026-04-01',
      end_date: '2026-04-30'
    })
    expect(api.focusStats).toHaveBeenCalledWith(7, '2026-04-15')
  })

  it('forwards daily records payload exactly', async () => {
    const api = {
      listTasks: vi.fn(async () => []),
      createTask: vi.fn(async () => ({ task_id: 1 })),
      updateTask: vi.fn(async () => ({ task_id: 1 })),
      deleteTask: vi.fn(async () => ({ deleted: true })),
      listTaskAttrs: vi.fn(async () => []),
      createTaskAttr: vi.fn(async () => ({})),
      updateTaskAttr: vi.fn(async () => ({})),
      deleteTaskAttr: vi.fn(async () => ({ deleted: true })),
      listRecords: vi.fn(async () => []),
      listTodos: vi.fn(async () => []),
      createTodo: vi.fn(async () => ({})),
      updateTodo: vi.fn(async () => ({})),
      deleteTodo: vi.fn(async () => ({ deleted: true })),
      todoStats: vi.fn(async () => ({ total: 0, completed: 0, todayCompleted: 0 })),
      createFocusSession: vi.fn(async () => ({})),
      listFocusSessions: vi.fn(async () => []),
      focusStats: vi.fn(async () => ({ todaySeconds: 0, totalSeconds: 0 })),
      upsertDailyRecords: vi.fn(async () => ({ updated: true }))
    }
    const repo = createHttpRepository(api as never)
    const values = [
      { attr_id: 11, value: 1 },
      { attr_id: 12, value: 2 }
    ]

    const result = await repo.upsertDailyRecords(9, '2026-04-15', values)

    expect(api.upsertDailyRecords).toHaveBeenCalledWith(9, '2026-04-15', values)
    expect(result).toEqual({ updated: true })
  })
})
