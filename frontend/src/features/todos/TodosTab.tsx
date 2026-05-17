import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Plus } from 'lucide-react'

import { cn } from '@/lib/cn'
import { clampText, fallbackText } from '@/lib/format'
import type { Task, TodoItem } from '../../../../packages/core/src/types'
import { Button, Card, CardContent, CardHeader, CardTitle, SegmentedTabs, type SegmentedTabItem } from '../../../../packages/ui/src'

type TodoSection = 'pending' | 'completed'

const sectionTabs: Array<SegmentedTabItem<TodoSection>> = [
  { key: 'pending', label: '未完成' },
  { key: 'completed', label: '已完成' }
]

type TodosTabProps = {
  todoTitle: string
  todoDesc: string
  todoDate: string
  todos: TodoItem[]
  taskOptions: Task[]
  todoTaskId: number | null
  onTodoTitleChange: (value: string) => void
  onTodoDescChange: (value: string) => void
  onTodoDateChange: (value: string) => void
  onTodoTaskIdChange: (value: number | null) => void
  onCreateTodo: () => Promise<void>
  onToggleTodo: (item: TodoItem) => Promise<void>
  onDeleteTodo: (todoId: number) => Promise<void>
}

export function TodosTab({
  todoTitle,
  todoDesc,
  todoDate,
  todos,
  taskOptions,
  todoTaskId,
  onTodoTitleChange,
  onTodoDescChange,
  onTodoDateChange,
  onTodoTaskIdChange,
  onCreateTodo,
  onToggleTodo,
  onDeleteTodo
}: TodosTabProps) {
  const [section, setSection] = useState<TodoSection>('pending')
  const [addExpanded, setAddExpanded] = useState(false)

  const pendingTodos = useMemo(() => todos.filter((item) => !item.completed), [todos])
  const completedTodos = useMemo(() => todos.filter((item) => item.completed), [todos])
  const visibleTodos = section === 'pending' ? pendingTodos : completedTodos

  async function handleInlineCreate() {
    if (!todoTitle.trim()) return
    await onCreateTodo()
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Card>
        <CardHeader>
          <div className="space-y-3">
            <CardTitle>待办中心</CardTitle>
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
              <label className="mb-2 block">
                <span className="mb-1 block text-[11px] font-medium text-slate-500">所属任务</span>
                <select
                  className="input-clean w-full"
                  value={todoTaskId ?? ''}
                  onChange={(e) => onTodoTaskIdChange(e.target.value ? Number(e.target.value) : null)}
                >
                  {taskOptions.length === 0 ? <option value="">暂无任务可选</option> : null}
                  {taskOptions.map((task) => (
                    <option key={`todo-task-${task.task_id}`} value={task.task_id}>
                      {task.task_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="relative block">
                <Plus className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  className="input-clean w-full pl-9"
                  value={todoTitle}
                  onFocus={() => setAddExpanded(true)}
                  onChange={(e) => onTodoTitleChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void handleInlineCreate()
                    }
                  }}
                  placeholder="准备做什么？"
                />
              </label>
              {addExpanded ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
                  <input
                    className="input-clean w-full"
                    value={todoDesc}
                    onChange={(e) => onTodoDescChange(e.target.value)}
                    placeholder="描述（可选）"
                  />
                  <input
                    className="input-clean w-full"
                    type="date"
                    lang="zh-CN"
                    value={todoDate}
                    onChange={(e) => onTodoDateChange(e.target.value)}
                  />
                  <Button
                    className="w-full sm:w-auto"
                    iconLeft={<Plus className="h-4 w-4" />}
                    disabled={!todoTitle.trim() || !todoTaskId}
                    onClick={() => void handleInlineCreate()}
                  >
                    添加
                  </Button>
                </div>
              ) : null}
            </div>
            <SegmentedTabs
              className="w-fit"
              compact
              tabs={sectionTabs.map((tab) => ({
                ...tab,
                label: tab.key === 'pending' ? `未完成 (${pendingTodos.length})` : `已完成 (${completedTodos.length})`
              }))}
              value={section}
              onChange={setSection}
            />
          </div>
        </CardHeader>
        {visibleTodos.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-400 sm:px-5">
            {section === 'pending' ? '暂无未完成待办' : '暂无已完成待办'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visibleTodos.map((todo) => (
              <li key={todo.id} className="group px-4 py-4 sm:px-5">
                <div className="flex items-start gap-3">
                  <input
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    type="checkbox"
                    checked={todo.completed}
                    style={{ accentColor: 'var(--edp-brand)' }}
                    onChange={() => void onToggleTodo(todo)}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p
                      className={cn('truncate text-sm font-medium', todo.completed ? 'text-slate-400 line-through' : 'text-slate-800')}
                      title={todo.title}
                    >
                      {clampText(todo.title, 64)}
                    </p>
                    <p className="truncate text-xs text-slate-500" title={todo.description || ''}>
                      {fallbackText(clampText(todo.description || '', 72))}
                    </p>
                    <p className="text-[11px] text-slate-500">截止：{todo.due_date ? dayjs(todo.due_date).format('MM月DD日') : '-'}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                    onClick={() => void onDeleteTodo(todo.id)}
                  >
                    删除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
