import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'

import { cn } from '@/lib/cn'
import { clampText, fallbackText, formatDateTime } from '@/lib/format'
import type { Task, TodoStats } from '../../../../packages/core/src/types'
import { Button, Card, CardContent, CardHeader, CardTitle } from '../../../../packages/ui/src'

type TaskHubCardProps = {
  tasks: Task[]
  currentTaskId: number | null
  todoStats: TodoStats
  onOpenCreateModal: () => void
  onSwitchTask: (taskId: number) => void
  onDeleteTask: (taskId: number) => Promise<void>
}

export function TaskHubCard({
  tasks,
  currentTaskId,
  todoStats,
  onOpenCreateModal,
  onSwitchTask,
  onDeleteTask
}: TaskHubCardProps) {
  const [searchKeyword, setSearchKeyword] = useState('')
  const [sortBy, setSortBy] = useState<'recent' | 'name'>('recent')

  const visibleTasks = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()
    const matched = tasks.filter((task) => {
      if (!keyword) return true
      return task.task_name.toLowerCase().includes(keyword) || task.task_desc.toLowerCase().includes(keyword)
    })

    const summary = matched.find((task) => task.task_id === 1)
    const others = matched.filter((task) => task.task_id !== 1)

    if (sortBy === 'name') {
      others.sort((a, b) => a.task_name.localeCompare(b.task_name, 'zh-CN'))
    } else {
      others.sort((a, b) => {
        const left = Number.isNaN(Date.parse(a.create_time)) ? 0 : Date.parse(a.create_time)
        const right = Number.isNaN(Date.parse(b.create_time)) ? 0 : Date.parse(b.create_time)
        return right - left
      })
    }

    return summary ? [summary, ...others] : others
  }, [tasks, searchKeyword, sortBy])

  return (
    <Card className="xl:col-span-4 2xl:col-span-3">
      <CardHeader className="flex items-center justify-between gap-3">
        <div>
          <CardTitle>任务管理</CardTitle>
          <p className="mt-1 text-xs text-slate-500">任务切换、创建、删除统一在这里完成</p>
        </div>
        <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={onOpenCreateModal}>
          新建
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
            <p className="text-[11px] text-slate-500">任务总数</p>
            <p className="text-lg font-semibold text-slate-900">{tasks.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
            <p className="text-[11px] text-slate-500">当前待办</p>
            <p className="text-lg font-semibold text-slate-900">{currentTaskId == null ? '-' : todoStats.total}</p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
            <p className="text-[11px] text-slate-500">今日完成</p>
            <p className="text-lg font-semibold text-slate-900">{currentTaskId == null ? '-' : todoStats.todayCompleted}</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input-clean w-full pl-9"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="搜索任务"
            />
          </label>
          <select className="input-clean" value={sortBy} onChange={(e) => setSortBy(e.target.value as 'recent' | 'name')}>
            <option value="recent">最近创建</option>
            <option value="name">名称排序</option>
          </select>
        </div>
        <p className="text-xs text-slate-500">展示 {visibleTasks.length} / {tasks.length} 个任务</p>
        <div className="max-h-[460px] overflow-y-auto rounded-xl border border-slate-200/80">
          {visibleTasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">无匹配任务</div>
          ) : (
          <ul className="divide-y divide-slate-100">
            {visibleTasks.map((task) => {
              const active = task.task_id === currentTaskId
              return (
                <li key={task.task_id} className={cn('px-3 py-3 sm:px-4', active ? 'bg-[var(--edp-brand-subtle)]' : 'bg-white')}>
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSwitchTask(task.task_id)}>
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: task.task_color }} />
                        <span className="truncate" title={task.task_name}>
                          {clampText(task.task_name, 40)}
                        </span>
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500" title={task.task_desc}>
                        {fallbackText(task.task_desc)}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">创建于 {formatDateTime(task.create_time)}</p>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant={active ? 'primary' : 'ghost'} onClick={() => onSwitchTask(task.task_id)}>
                        {active ? '当前' : '切换'}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={task.task_id === 1}
                        onClick={async () => {
                          if (task.task_id === 1) return
                          await onDeleteTask(task.task_id)
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
