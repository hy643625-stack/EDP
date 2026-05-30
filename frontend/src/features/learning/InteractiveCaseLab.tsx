import { useState } from 'react'
import type { LearningResourceCard } from '@/api/types'

type Props = { resource: LearningResourceCard }

type StepItem = { step_id: string; description: string; is_done: boolean }
type DelItem = { item_id: string; description: string; is_done: boolean }
type RefItem = { question: string; answer: string }

export function InteractiveCaseLab({ resource }: Props) {
  const int = resource.interaction as Record<string, unknown> | null
  const items = int?.items as Array<{ steps: StepItem[]; deliverables: DelItem[]; reflections: RefItem[] }> | undefined
  const data = items?.[0]
  const [steps, setSteps] = useState<StepItem[]>(data?.steps || [])
  const [deliverables, setDeliverables] = useState<DelItem[]>(data?.deliverables || [])
  const [reflections, setReflections] = useState<RefItem[]>(data?.reflections || [])

  if (!data) return null

  const stepsDone = steps.filter(s => s.is_done).length
  const delsDone = deliverables.filter(d => d.is_done).length
  const total = steps.length + deliverables.length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">完成进度：</span>
        <span className="text-sm font-semibold text-slate-800">{stepsDone + delsDone}/{total}</span>
        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${total ? ((stepsDone + delsDone) / total) * 100 : 0}%` }} />
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-600">实验步骤</h4>
        {steps.map(s => (
          <label key={s.step_id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:border-slate-300">
            <input type="checkbox" checked={s.is_done} onChange={() => setSteps(steps.map(x => x.step_id === s.step_id ? { ...x, is_done: !x.is_done } : x))} className="mt-0.5" />
            <span className={`text-sm ${s.is_done ? 'line-through text-slate-400' : 'text-slate-700'}`}>{s.description}</span>
          </label>
        ))}
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-600">提交物</h4>
        {deliverables.map(d => (
          <label key={d.item_id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:border-slate-300">
            <input type="checkbox" checked={d.is_done} onChange={() => setDeliverables(deliverables.map(x => x.item_id === d.item_id ? { ...x, is_done: !x.is_done } : x))} className="mt-0.5" />
            <span className={`text-sm ${d.is_done ? 'line-through text-slate-400' : 'text-slate-700'}`}>{d.description}</span>
          </label>
        ))}
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-600">反思问题</h4>
        {reflections.map((r, idx) => (
          <div key={idx} className="rounded-lg border border-slate-200 p-3">
            <p className="text-sm text-slate-700 mb-2">{r.question}</p>
            <textarea
              className="input-clean w-full text-sm min-h-[60px] resize-y"
              placeholder="写下你的思考..."
              value={r.answer}
              onChange={e => setReflections(reflections.map((x, i) => i === idx ? { ...x, answer: e.target.value } : x))}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
