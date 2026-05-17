import { CheckCircle2, ListChecks, Play, Plus } from 'lucide-react'

import type { TaskAttrRelation } from '../../../../packages/core/src/types'
import { Button, Card, CardContent, CardHeader, CardTitle } from '../../../../packages/ui/src'

type QuickActionsCardProps = {
  currentTaskId: number | null
  isOverview: boolean
  timerRunning: boolean
  quickTodoTitle: string
  quickTodoDate: string
  quickRecordAttrId: number | ''
  quickRecordValue: string
  recordableAttrs: TaskAttrRelation[]
  pendingTodoCount: number
  onQuickTodoTitleChange: (value: string) => void
  onQuickTodoDateChange: (value: string) => void
  onQuickRecordAttrIdChange: (value: number | '') => void
  onQuickRecordValueChange: (value: string) => void
  onQuickCreateTodo: () => void
  onQuickStartFocus: () => void
  onQuickOpenRecords: () => void
  onOpenTodos: () => void
  onQuickSaveRecord: () => void
}

export function QuickActionsCard({
  currentTaskId,
  isOverview,
  timerRunning,
  quickTodoTitle,
  quickTodoDate,
  quickRecordAttrId,
  quickRecordValue,
  recordableAttrs,
  pendingTodoCount,
  onQuickTodoTitleChange,
  onQuickTodoDateChange,
  onQuickRecordAttrIdChange,
  onQuickRecordValueChange,
  onQuickCreateTodo,
  onQuickStartFocus,
  onQuickOpenRecords,
  onOpenTodos,
  onQuickSaveRecord
}: QuickActionsCardProps) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Action Center</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 shadow-sm">
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500">待办速记</p>
          <div className="space-y-2">
            <input
              className="input-clean w-full"
              value={quickTodoTitle}
              onChange={(e) => onQuickTodoTitleChange(e.target.value)}
              placeholder="输入待办标题"
            />
            <input className="input-clean w-full" type="date" lang="zh-CN" value={quickTodoDate} onChange={(e) => onQuickTodoDateChange(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Button className="w-full" iconLeft={<Plus className="h-4 w-4" />} disabled={!currentTaskId} onClick={onQuickCreateTodo}>
                快速添加
              </Button>
              <Button className="w-full" variant="ghost" disabled={!currentTaskId} onClick={onOpenTodos}>
                查看全部
              </Button>
            </div>
            <p className="text-xs text-slate-500">当前待完成 {pendingTodoCount} 项</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 shadow-sm">
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500">开始专注</p>
          <p className="mb-3 text-xs text-slate-500">{isOverview ? '总览任务不可直接计时，请切换具体任务' : '跳转到 Time 页面并立即启动计时'}</p>
          <Button className="w-full" iconLeft={<Play className="h-4 w-4" />} disabled={!currentTaskId || isOverview || timerRunning} onClick={onQuickStartFocus}>
            {timerRunning ? '计时中' : '开始计时'}
          </Button>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 shadow-sm">
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500">写今日记录</p>
          <div className="space-y-2">
            <select
              className="input-clean w-full"
              disabled={isOverview || recordableAttrs.length === 0}
              value={quickRecordAttrId}
              onChange={(e) => {
                const raw = e.target.value
                onQuickRecordAttrIdChange(raw ? Number(raw) : '')
              }}
            >
              {recordableAttrs.length === 0 ? <option value="">暂无可记录属性</option> : null}
              {recordableAttrs.map((attr) => (
                <option key={attr.attr_id} value={attr.attr_id}>
                  {attr.attr_name}
                </option>
              ))}
            </select>
            <input
              className="input-clean w-full"
              type="number"
              step="0.01"
              value={quickRecordValue}
              disabled={isOverview || recordableAttrs.length === 0}
              onChange={(e) => onQuickRecordValueChange(e.target.value)}
              placeholder="输入数值"
            />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" className="w-full" disabled={isOverview} iconLeft={<ListChecks className="h-4 w-4" />} onClick={onQuickOpenRecords}>
                打开记录页
              </Button>
              <Button
                className="w-full"
                iconLeft={<CheckCircle2 className="h-4 w-4" />}
                disabled={isOverview || recordableAttrs.length === 0 || quickRecordValue.trim() === ''}
                onClick={onQuickSaveRecord}
              >
                立即保存
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
