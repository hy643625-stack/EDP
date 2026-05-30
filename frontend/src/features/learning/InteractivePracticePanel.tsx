import { useState } from 'react'
import type { LearningResourceCard } from '@/api/types'

type Props = { resource: LearningResourceCard }

type ExerciseItem = {
  exercise_id: string; module_id: string; module_title: string
  level: string; type: string; prompt: string; target_concepts: string[]
  hint: string; answer_outline: string
  feedback: { correct: string; stuck: string; common_mistake: string }
  source_refs: string[]
}

export function InteractivePracticePanel({ resource }: Props) {
  const items = (resource.interaction as Record<string, unknown> | null)?.items as ExerciseItem[] | undefined
  const [filter, setFilter] = useState<string>('all')
  const [selfAssess, setSelfAssess] = useState<Record<string, 'correct' | 'unsure' | 'wrong' | null>>({})
  const [showAnswer, setShowAnswer] = useState<Record<string, boolean>>({})
  const [showHint, setShowHint] = useState<Record<string, boolean>>({})

  if (!items?.length) return null

  const filtered = filter === 'all' ? items : items.filter(i => i.level === filter)
  const done = Object.values(selfAssess).filter(Boolean).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {['all', 'basic', 'standard', 'transfer'].map(l => (
            <button key={l}
              onClick={() => setFilter(l)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors
                ${filter === l ? 'bg-[var(--edp-brand-strong)] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {l === 'all' ? '全部' : l === 'basic' ? '基础' : l === 'standard' ? '标准' : '迁移'}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-slate-500">已自评 {done}/{items.length}</span>
      </div>

      <div className="space-y-3">
        {filtered.map((item, idx) => {
          const aid = item.exercise_id
          const isDone = !!selfAssess[aid]
          return (
            <div key={aid} className={`rounded-xl border p-4 ${isDone ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] text-slate-400 shrink-0">#{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full
                      ${item.level === 'basic' ? 'bg-emerald-100 text-emerald-700' :
                        item.level === 'transfer' ? 'bg-purple-100 text-purple-700' :
                        'bg-blue-100 text-blue-700'}`}>
                      {item.level === 'basic' ? '基础' : item.level === 'transfer' ? '迁移' : '标准'}
                    </span>
                    <span className="text-[10px] text-slate-400">{item.module_title}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-800">{item.prompt}</p>
                  {item.target_concepts?.length ? (
                    <p className="mt-1 text-[11px] text-slate-400">关联概念：{item.target_concepts.join(', ')}</p>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <button onClick={() => setShowHint(h => ({ ...h, [aid]: !h[aid] }))}
                  className="text-[11px] px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100">
                  {showHint[aid] ? '收起提示' : '查看提示'}
                </button>
                <button onClick={() => setShowAnswer(a => ({ ...a, [aid]: !a[aid] }))}
                  className="text-[11px] px-2 py-1 rounded bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100">
                  {showAnswer[aid] ? '收起答案' : '查看答案'}
                </button>
              </div>

              {showHint[aid] ? (
                <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">{item.hint}</div>
              ) : null}
              {showAnswer[aid] ? (
                <div className="mt-2 rounded-lg bg-sky-50 border border-sky-200 p-3">
                  <p className="text-xs font-medium text-sky-700">答案要点</p>
                  <p className="mt-1 text-xs text-sky-800">{item.answer_outline}</p>
                  <p className="mt-2 text-[11px] text-sky-600">做对时：{item.feedback.correct}</p>
                  <p className="text-[11px] text-sky-600">不会时：{item.feedback.stuck}</p>
                  <p className="text-[11px] text-sky-600">常见错误：{item.feedback.common_mistake}</p>
                </div>
              ) : null}

              {!isDone ? (
                <div className="mt-3 flex gap-1.5">
                  {(['correct', 'unsure', 'wrong'] as const).map(s => (
                    <button key={s} onClick={() => setSelfAssess(a => ({ ...a, [aid]: s }))}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors
                        ${s === 'correct' ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50' :
                          s === 'unsure' ? 'border-amber-300 text-amber-700 hover:bg-amber-50' :
                          'border-rose-300 text-rose-700 hover:bg-rose-50'}`}>
                      {s === 'correct' ? '我做对了' : s === 'unsure' ? '不确定' : '不会'}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[11px] text-emerald-600 font-medium">
                  {selfAssess[aid] === 'correct' ? '已标记：做对了' : selfAssess[aid] === 'unsure' ? '已标记：不确定' : '已标记：不会'}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
