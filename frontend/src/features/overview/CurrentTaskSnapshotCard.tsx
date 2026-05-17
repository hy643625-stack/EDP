import dayjs from 'dayjs'

import { cn } from '@/lib/cn'
import { clampText, fallbackText, formatDateTime } from '@/lib/format'
import type { Task, TodoItem } from '../../../../packages/core/src/types'
import { Button, Card, CardContent, CardHeader, CardTitle, StatWidget, type StatWidgetData } from '../../../../packages/ui/src'

type CurrentTaskSnapshotCardProps = {
  currentTask: Task | null
  snapshotMetrics: StatWidgetData[]
  todos: TodoItem[]
  isOverview: boolean
  onToggleTodo: (item: TodoItem) => Promise<void>
  onOpenTodos: () => void
}

export function CurrentTaskSnapshotCard({
  currentTask,
  snapshotMetrics,
  todos,
  isOverview,
  onToggleTodo,
  onOpenTodos
}: CurrentTaskSnapshotCardProps) {
  const todoPreview = todos.slice(0, 8)
  const pendingCount = todos.filter((item) => !item.completed).length

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>数据概览</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="label-muted">当前任务</p>
              <p className="value-strong truncate" title={currentTask?.task_name}>
                {fallbackText(currentTask?.task_name)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="label-muted">创建时间</p>
              <p className="value-strong">{formatDateTime(currentTask?.create_time)}</p>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <p className="label-muted">描述</p>
              <p className="value-strong truncate" title={currentTask?.task_desc}>
                {fallbackText(currentTask?.task_desc)}
              </p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {snapshotMetrics.map((metric) => (
            <StatWidget key={metric.label} label={metric.label} value={metric.value} unit={metric.unit} icon={metric.icon} />
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200/80 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{isOverview ? '全部任务待办' : '当前任务待办'}</p>
              <p className="mt-0.5 text-xs text-slate-500">待完成 {pendingCount} 项</p>
            </div>
            <Button size="sm" variant="ghost" onClick={onOpenTodos}>
              打开 Todos
            </Button>
          </div>
          {todoPreview.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-400">暂无待办事项</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {todoPreview.map((todo) => (
                <li key={todo.id} className="px-4 py-3">
                  <label className="flex items-start gap-3">
                    <input
                      className="mt-0.5 h-4 w-4 rounded border-slate-300"
                      type="checkbox"
                      checked={todo.completed}
                      style={{ accentColor: 'var(--edp-brand)' }}
                      onChange={() => void onToggleTodo(todo)}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn('block truncate text-sm font-medium', todo.completed ? 'text-slate-400 line-through' : 'text-slate-800')}
                        title={todo.title}
                      >
                        {clampText(todo.title, 56)}
                      </span>
                      <span className="mt-1 block text-[11px] text-slate-500">
                        截止：{todo.due_date ? dayjs(todo.due_date).format('MM月DD日') : '-'}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  )
}
