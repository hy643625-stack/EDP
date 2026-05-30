import { BookOpen, Brain, ClipboardList, Code2, FileText, Map, Presentation } from 'lucide-react'
import type { ReactNode } from 'react'

type ResourceTileProps = {
  type: string
  title: string
  summary: string
  estimatedMinutes: number
  sourceRefs?: string[]
  safetyPassed?: boolean
  onClick: () => void
}

const TYPE_ICONS: Record<string, { icon: ReactNode; label: string; accent: string; bg: string }> = {
  course_brief:  { icon: <BookOpen className="h-4 w-4" />,     label: '讲解讲义', accent: 'text-sky-600',    bg: 'bg-sky-50' },
  mind_map:      { icon: <Map className="h-4 w-4" />,           label: '知识脑图', accent: 'text-violet-600', bg: 'bg-violet-50' },
  practice_pack: { icon: <Brain className="h-4 w-4" />,         label: '分层练习', accent: 'text-emerald-600',bg: 'bg-emerald-50' },
  reading_guide: { icon: <FileText className="h-4 w-4" />,      label: '阅读指南', accent: 'text-amber-600',  bg: 'bg-amber-50' },
  case_lab:      { icon: <Code2 className="h-4 w-4" />,         label: '实验任务', accent: 'text-rose-600',   bg: 'bg-rose-50' },
  review_sheet:  { icon: <ClipboardList className="h-4 w-4" />, label: '复盘清单', accent: 'text-teal-600',   bg: 'bg-teal-50' },
  slide_outline: { icon: <Presentation className="h-4 w-4" />,  label: 'PPT 大纲',  accent: 'text-indigo-600', bg: 'bg-indigo-50' },
}

const DEFAULT_ICON = { icon: <BookOpen className="h-4 w-4" />, label: '资源', accent: 'text-slate-500', bg: 'bg-slate-50' }

export function ResourceTile({ type, title, summary, estimatedMinutes, sourceRefs, safetyPassed, onClick }: ResourceTileProps) {
  const { icon, label, accent, bg } = TYPE_ICONS[type] ?? DEFAULT_ICON
  const refCount = sourceRefs?.length ?? 0

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-slate-200 bg-white p-4
        hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 shrink-0 ${accent}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${accent} ${bg}`}>
              {label}
            </span>
            <span className="text-[11px] text-slate-400">{estimatedMinutes} 分钟</span>
            {refCount > 0 ? (
              <span className="text-[11px] text-slate-400">{refCount} 引用</span>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm font-medium text-slate-900 truncate">{title}</p>
          <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">{summary}</p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {safetyPassed !== undefined ? (
            <span className={`inline-block w-2 h-2 rounded-full ${safetyPassed ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          ) : null}
        </div>
      </div>
    </button>
  )
}
