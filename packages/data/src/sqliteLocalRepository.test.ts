import { describe, expect, it } from 'vitest'
import { createSqliteLocalRepository } from './sqliteLocalRepository'

type MemoryStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  dump(key: string): unknown
}

function createMemoryStorage(): MemoryStorage {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    dump: (key) => {
      const raw = data.get(key)
      return raw ? JSON.parse(raw) : null
    }
  }
}

function createRepoWithMemory(storageKey: string) {
  const storage = createMemoryStorage()
  const repo = createSqliteLocalRepository({
    storage,
    storageKey
  })
  return { repo, storage, storageKey }
}

describe('createSqliteLocalRepository', () => {
  it('seeds summary task on first boot', async () => {
    const { repo } = createRepoWithMemory('sqlite-local-test-a')
    const tasks = await repo.listTasks()

    expect(tasks).toHaveLength(1)
    expect(tasks[0].task_id).toBe(1)
    expect(tasks[0].task_name).toBe('总览')
  })

  it('creates task with built-in attrs (坚持天数/专注时长/待办)', async () => {
    const { repo } = createRepoWithMemory('sqlite-local-test-b')
    const created = await repo.createTask({
      name: 'Work',
      desc: 'primary task',
      task_color: '#225577'
    })
    const attrs = await repo.listTaskAttrs(created.task_id)
    const tasks = await repo.listTasks()
    const createdTask = tasks.find((item) => item.task_id === created.task_id)

    expect(attrs.map((item) => item.attr_name)).toEqual(['坚持天数', '专注时长', '待办'])
    expect(createdTask?.attr_num).toBe(3)
  })

  it('supports todo CRUD + today stats', async () => {
    const { repo } = createRepoWithMemory('sqlite-local-test-c')
    const createdTask = await repo.createTask({
      name: 'Errands',
      desc: '',
      task_color: '#117733'
    })
    const todo = await repo.createTodo({
      task_id: createdTask.task_id,
      title: 'Buy milk',
      description: '',
      due_date: '2026-04-20'
    })
    const completed = await repo.updateTodo(todo.id, { completed: true })
    const stats = await repo.todoStats(createdTask.task_id, completed.completed_date || undefined)

    expect(completed.completed).toBe(true)
    expect(stats).toEqual({ total: 1, completed: 1, todayCompleted: 1 })
  })

  it('records focus sessions and computes task/date filtered stats', async () => {
    const { repo } = createRepoWithMemory('sqlite-local-test-d')
    const createdTask = await repo.createTask({
      name: 'Deep Work',
      desc: '',
      task_color: '#0f4c5c'
    })

    const sessionA = await repo.createFocusSession({
      task_id: createdTask.task_id,
      start_time: '2026-04-15T08:00:00.000Z',
      duration_seconds: 0
    })
    const sessionB = await repo.createFocusSession({
      task_id: createdTask.task_id,
      start_time: '2026-04-16T08:00:00.000Z',
      duration_seconds: 120
    })
    const statsDay1 = await repo.focusStats(createdTask.task_id, '2026-04-15')
    const statsTotal = await repo.focusStats(createdTask.task_id)
    const fromDay2 = await repo.listFocusSessions({
      task_id: createdTask.task_id,
      start_date: '2026-04-16'
    })

    expect(sessionA.duration_seconds).toBe(1)
    expect(sessionB.duration_seconds).toBe(120)
    expect(statsDay1.todaySeconds).toBe(1)
    expect(statsTotal.totalSeconds).toBe(121)
    expect(fromDay2).toHaveLength(1)
    expect(fromDay2[0].start_time.startsWith('2026-04-16')).toBe(true)
  })

  it('upsertDailyRecords updates same attr/date record instead of duplicating', async () => {
    const { repo, storage, storageKey } = createRepoWithMemory('sqlite-local-test-e')
    const createdTask = await repo.createTask({
      name: 'Health',
      desc: '',
      task_color: '#3a7d44'
    })
    const attrs = await repo.listTaskAttrs(createdTask.task_id)
    const firstAttrId = attrs[0].attr_id

    await repo.upsertDailyRecords(createdTask.task_id, '2026-04-15', [{ attr_id: firstAttrId, value: 10 }])
    await repo.upsertDailyRecords(createdTask.task_id, '2026-04-15', [{ attr_id: firstAttrId, value: 18 }])
    const listed = await repo.listRecords(createdTask.task_id, '2026-04-15', '2026-04-15')

    const dumped = storage.dump(storageKey) as {
      records: Array<{ task_id: number; attr_id: number; record_date: string; data_value: number }>
    }
    const matched = dumped.records.filter(
      (item) => item.task_id === createdTask.task_id && item.attr_id === firstAttrId && item.record_date === '2026-04-15'
    )

    expect(matched).toHaveLength(1)
    expect(matched[0].data_value).toBe(18)
    expect(listed).toHaveLength(1)
    expect(listed[0].attr_id).toBe(firstAttrId)
    expect(listed[0].data_value).toBe(18)
  })

  it('deletes task with cascade but protects summary task', async () => {
    const { repo, storage, storageKey } = createRepoWithMemory('sqlite-local-test-f')
    const createdTask = await repo.createTask({
      name: 'Temp',
      desc: '',
      task_color: '#777777'
    })
    const attrs = await repo.listTaskAttrs(createdTask.task_id)
    await repo.createTodo({
      task_id: createdTask.task_id,
      title: 'clean up',
      description: ''
    })
    await repo.createFocusSession({
      task_id: createdTask.task_id,
      start_time: '2026-04-15T00:00:00.000Z',
      duration_seconds: 60
    })
    await repo.upsertDailyRecords(createdTask.task_id, '2026-04-15', [{ attr_id: attrs[0].attr_id, value: 1 }])

    const deleteSummary = await repo.deleteTask(1)
    const deleteCreated = await repo.deleteTask(createdTask.task_id)
    const tasks = await repo.listTasks()
    const dumped = storage.dump(storageKey) as {
      attrs: Array<{ task_id: number }>
      todos: Array<{ task_id: number }>
      focusSessions: Array<{ task_id: number }>
      records: Array<{ task_id: number }>
    }

    expect(deleteSummary.deleted).toBe(false)
    expect(deleteCreated.deleted).toBe(true)
    expect(tasks.some((item) => item.task_id === createdTask.task_id)).toBe(false)
    expect(dumped.attrs.some((item) => item.task_id === createdTask.task_id)).toBe(false)
    expect(dumped.todos.some((item) => item.task_id === createdTask.task_id)).toBe(false)
    expect(dumped.focusSessions.some((item) => item.task_id === createdTask.task_id)).toBe(false)
    expect(dumped.records.some((item) => item.task_id === createdTask.task_id)).toBe(false)
  })
})
