import type { ReactNode } from 'react'
import { BookOpen, Brain, ClipboardList, Code2, FileText, Map } from 'lucide-react'
import type { LearningSafetyReview } from '@/api/types'
import { MarkdownRenderer } from './MarkdownRenderer'

type ResourceDisplayMeta = {
  icon?: string
  accent?: string
  layout?: string
  density?: string
}

type ResourceCardProps = {
  type: string
  title: string
  summary: string
  estimatedMinutes: number
  contentMarkdown: string
  sourceRefs?: string[]
  safetyReview?: LearningSafetyReview
}

// ── Resource type style config ────────────────────────

const TYPE_STYLES: Record<string, {
  icon: ReactNode
  label: string
  accent: string
  bg: string
  border: string
  badge: string
}> = {
  course_brief: {
    icon: <BookOpen className="h-4 w-4" />,
    label: '讲解讲义',
    accent: 'text-sky-600',
    bg: 'bg-sky-50/60',
    border: 'border-sky-200',
    badge: 'bg-sky-100 text-sky-700 border-sky-200',
  },
  mind_map: {
    icon: <Map className="h-4 w-4" />,
    label: '知识脑图',
    accent: 'text-violet-600',
    bg: 'bg-violet-50/60',
    border: 'border-violet-200',
    badge: 'bg-violet-100 text-violet-700 border-violet-200',
  },
  practice_pack: {
    icon: <Brain className="h-4 w-4" />,
    label: '分层练习',
    accent: 'text-emerald-600',
    bg: 'bg-emerald-50/60',
    border: 'border-emerald-200',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  },
  reading_guide: {
    icon: <FileText className="h-4 w-4" />,
    label: '阅读指南',
    accent: 'text-amber-600',
    bg: 'bg-amber-50/60',
    border: 'border-amber-200',
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
  },
  case_lab: {
    icon: <Code2 className="h-4 w-4" />,
    label: '实验任务',
    accent: 'text-rose-600',
    bg: 'bg-rose-50/60',
    border: 'border-rose-200',
    badge: 'bg-rose-100 text-rose-700 border-rose-200',
  },
  review_sheet: {
    icon: <ClipboardList className="h-4 w-4" />,
    label: '复盘清单',
    accent: 'text-teal-600',
    bg: 'bg-teal-50/60',
    border: 'border-teal-200',
    badge: 'bg-teal-100 text-teal-700 border-teal-200',
  },
}

const DEFAULT_STYLE = {
  icon: <BookOpen className="h-4 w-4" />,
  label: '学习资源',
  accent: 'text-slate-600',
  bg: 'bg-slate-50/60',
  border: 'border-slate-200',
  badge: 'bg-slate-100 text-slate-600 border-slate-200',
}

export function ResourceCard({
  type, title, summary, estimatedMinutes,
  contentMarkdown, sourceRefs, safetyReview,
}: ResourceCardProps) {
  const style = TYPE_STYLES[type] ?? DEFAULT_STYLE

  return (
    <div className={`rounded-2xl border ${style.border} ${style.bg} overflow-hidden`}>
      {/* ── Header ── */}
      <div className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${style.bg}`}>
        <div className="flex items-center gap-3 min-w-0">
          <span className={style.accent}>{style.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${style.badge}`}>
                {style.label}
              </span>
              <span className="text-[11px] text-slate-400">{estimatedMinutes} 分钟</span>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900 truncate">{title}</h3>
          </div>
        </div>
      </div>

      {/* ── Summary ── */}
      <div className="px-5 pt-3">
        <p className="text-xs leading-5 text-slate-500">{summary}</p>
      </div>

      {/* ── Source refs tags ── */}
      {sourceRefs && sourceRefs.length > 0 ? (
        <div className="px-5 pt-2 flex flex-wrap gap-1">
          {sourceRefs.map((ref) => (
            <span key={ref} className={`rounded-full px-2 py-0.5 text-[10px] ${
              ref.startsWith('module:') ? 'bg-blue-50 text-blue-600 border border-blue-200' :
              ref.startsWith('source:') ? 'bg-purple-50 text-purple-600 border border-purple-200' :
              'bg-slate-100 text-slate-500 border border-slate-200'
            }`}>{ref}</span>
          ))}
        </div>
      ) : null}

      {/* ── Body ── */}
      <div className="px-5 py-4">
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <MarkdownRenderer content={contentMarkdown} />
        </div>
      </div>

      {/* ── Footer: safety ── */}
      {safetyReview ? (
        <div className={`px-5 pb-4 flex items-center gap-2 text-[11px] ${
          safetyReview.grounding_passed ? 'text-emerald-600' : 'text-rose-600'
        }`}>
          <span className={`inline-block w-2 h-2 rounded-full ${
            safetyReview.grounding_passed ? 'bg-emerald-400' : 'bg-rose-400'
          }`} />
          {safetyReview.grounding_passed ? '内容可溯源' : 'grounding 未通过'}
          {safetyReview.warnings && safetyReview.warnings.length > 0 ? (
            <span className="text-amber-500">({safetyReview.warnings.length} 告警)</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
