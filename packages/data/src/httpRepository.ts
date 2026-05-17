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

type ApiClient = {
  listTasks(): Promise<Task[]>
  createTask(payload: CreateTaskInput): Promise<Task>
  updateTask(taskId: number, payload: UpdateTaskInput): Promise<Task>
  deleteTask(taskId: number): Promise<{ deleted: boolean }>

  listTaskAttrs(taskId: number): Promise<TaskAttrRelation[]>
  createTaskAttr(taskId: number, payload: CreateTaskAttrInput): Promise<TaskAttrRelation>
  updateTaskAttr(taskId: number, attrId: number, payload: UpdateTaskAttrInput): Promise<TaskAttrRelation>
  deleteTaskAttr(taskId: number, attrId: number): Promise<{ deleted: boolean }>
  listRecords(taskId: number, startDate?: string, endDate?: string): Promise<DailyRecord[]>

  listTodos(taskId?: number): Promise<TodoItem[]>
  createTodo(payload: CreateTodoInput): Promise<TodoItem>
  updateTodo(todoId: number, payload: Record<string, unknown>): Promise<TodoItem>
  deleteTodo(todoId: number): Promise<{ deleted: boolean }>
  todoStats(taskId?: number, targetDate?: string): Promise<TodoStats>

  createFocusSession(payload: CreateFocusSessionInput): Promise<FocusSession>
  listFocusSessions(params?: { task_id?: number; start_date?: string; end_date?: string }): Promise<FocusSession[]>
  focusStats(taskId?: number, targetDate?: string): Promise<FocusStats>

  upsertDailyRecords(taskId: number, recordDate: string, values: DailyRecordValueInput[]): Promise<{ updated: boolean }>
}

export function createHttpRepository(api: ApiClient): CoreRepository {
  return {
    listTasks: () => api.listTasks(),
    createTask: (payload) => api.createTask(payload),
    updateTask: (taskId, payload) => api.updateTask(taskId, payload),
    deleteTask: (taskId) => api.deleteTask(taskId),
    listTaskAttrs: (taskId) => api.listTaskAttrs(taskId),
    createTaskAttr: (taskId, payload) => api.createTaskAttr(taskId, payload),
    updateTaskAttr: (taskId, attrId, payload) => api.updateTaskAttr(taskId, attrId, payload),
    deleteTaskAttr: (taskId, attrId) => api.deleteTaskAttr(taskId, attrId),
    listRecords: (taskId, startDate, endDate) => api.listRecords(taskId, startDate, endDate),
    listTodos: (taskId) => api.listTodos(taskId),
    createTodo: (payload) => api.createTodo(payload),
    updateTodo: (todoId, payload) => api.updateTodo(todoId, payload),
    deleteTodo: (todoId) => api.deleteTodo(todoId),
    todoStats: (taskId, targetDate) => api.todoStats(taskId, targetDate),
    createFocusSession: (payload) => api.createFocusSession(payload),
    listFocusSessions: (params) => api.listFocusSessions(params),
    focusStats: (taskId, targetDate) => api.focusStats(taskId, targetDate),
    upsertDailyRecords: (taskId, recordDate, values) => api.upsertDailyRecords(taskId, recordDate, values)
  }
}
