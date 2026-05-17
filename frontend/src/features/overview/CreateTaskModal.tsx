import { Check, Paintbrush, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '../../../../packages/ui/src'
import { TASK_COLOR_PRESETS } from './taskColorPresets'

type CreateTaskModalProps = {
  open: boolean
  mode: 'create' | 'edit'
  taskName: string
  taskDesc: string
  taskColor: string
  onTaskNameChange: (value: string) => void
  onTaskDescChange: (value: string) => void
  onTaskColorChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}

export function CreateTaskModal({
  open,
  mode,
  taskName,
  taskDesc,
  taskColor,
  onTaskNameChange,
  onTaskDescChange,
  onTaskColorChange,
  onClose,
  onSubmit
}: CreateTaskModalProps) {
  const [showCustomPicker, setShowCustomPicker] = useState(false)
  const isPresetColor = useMemo(
    () => TASK_COLOR_PRESETS.some((preset) => preset.value.toLowerCase() === taskColor.toLowerCase()),
    [taskColor]
  )
  const isEditMode = mode === 'edit'

  useEffect(() => {
    if (!open) return
    setShowCustomPicker(!isPresetColor)
  }, [open, isPresetColor])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-3 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={isEditMode ? '编辑任务' : '新建任务'}
    >
      <section className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-4 shadow-soft sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4">
          <h3 className="text-base font-semibold text-slate-900">{isEditMode ? '编辑任务' : '新建任务'}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {isEditMode ? '修改任务名称、描述和主题色，保存后立即生效' : '新建任务会自动附带“专注时长”和“待办”固有属性'}
          </p>
        </div>
        <div className="space-y-3">
          <input className="input-clean w-full" value={taskName} onChange={(e) => onTaskNameChange(e.target.value)} placeholder="任务名称" />
          <input className="input-clean w-full" value={taskDesc} onChange={(e) => onTaskDescChange(e.target.value)} placeholder="任务描述（可选）" />
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">颜色</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700"
                onClick={() => setShowCustomPicker((prev) => !prev)}
              >
                <Paintbrush className="h-3.5 w-3.5" />
                {showCustomPicker ? '收起自定义' : '自定义'}
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {TASK_COLOR_PRESETS.map((preset) => {
                const active = preset.value.toLowerCase() === taskColor.toLowerCase()
                return (
                  <button
                    key={preset.value}
                    type="button"
                    aria-label={preset.label}
                    title={preset.label}
                    className="relative h-8 rounded-lg border border-white/80 shadow-sm transition hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-slate-300"
                    style={{ backgroundColor: preset.value }}
                    onClick={() => {
                      onTaskColorChange(preset.value)
                      setShowCustomPicker(false)
                    }}
                  >
                    {active ? <Check className="mx-auto h-4 w-4 text-white drop-shadow-sm" /> : null}
                  </button>
                )
              })}
            </div>

            {showCustomPicker ? (
              <div className="mt-3 flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                <input
                  className="h-8 w-12 cursor-pointer rounded-md border-none p-0"
                  type="color"
                  value={taskColor}
                  onChange={(e) => onTaskColorChange(e.target.value)}
                />
                <span className="text-xs font-medium text-slate-500">{taskColor.toUpperCase()}</span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button iconLeft={isEditMode ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />} disabled={!taskName.trim()} onClick={onSubmit}>
            {isEditMode ? '保存修改' : '创建任务'}
          </Button>
        </div>
      </section>
    </div>
  )
}
