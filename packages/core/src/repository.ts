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

export interface CoreRepository {
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
