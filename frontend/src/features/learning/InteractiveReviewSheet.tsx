import { useState } from 'react'
import type { LearningResourceCard } from '@/api/types'

type Props = { resource: LearningResourceCard }

type ReviewItem = {
  item_id: string; description: string; module: string
  mastered: boolean; score: number | null
}

export function InteractiveReviewSheet({ resource }: Props) {
  const int = resource.interaction as Record<string, unknown> | null
  const rawItems = int?.items as ReviewItem[] | undefined
  const [items, setItems] = useState<ReviewItem[]>(rawItems || [])

  if (!items.length) return null

  const notMastered = items.filter(i => !i.mastered).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">共 {items.length} 项</span>
        <span className={`text-xs font-medium ${notMastered > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
          {notMastered > 0 ? `${notMastered} 项未掌握` : '全部掌握'}
        </span>
      </div>

      <div className="space-y-2">
        {items.map(item => (
          <div key={item.item_id} className={`rounded-lg border p-3 ${item.mastered ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <span className="text-[10px] text-slate-400">{item.module}</span>
                <p className="mt-1 text-sm text-slate-700">{item.description}</p>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              <button
                onClick={() => setItems(items.map(x => x.item_id === item.item_id ? { ...x, mastered: !x.mastered } : x))}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors
                  ${item.mastered ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                {item.mastered ? '已掌握' : '需复习'}
              </button>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-400">掌握度</span>
                {[1, 2, 3, 4, 5].map(s => (
                  <button key={s}
                    onClick={() => setItems(items.map(x => x.item_id === item.item_id ? { ...x, score: s } : x))}
                    className={`w-5 h-5 rounded text-[11px] font-medium transition-colors
                      ${item.score === s ? 'bg-[var(--edp-brand-strong)] text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
