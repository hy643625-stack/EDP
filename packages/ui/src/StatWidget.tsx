import { type ComponentType } from 'react'

import { cn } from './cn'

export type StatWidgetData = {
  label: string
  value: string
  unit?: string
  icon?: ComponentType<{ className?: string }>
}

type StatWidgetProps = StatWidgetData & {
  className?: string
}

export function StatWidget({ label, value, unit, icon: Icon, className }: StatWidgetProps) {
  return (
    <article className={cn('rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm sm:p-4', className)}>
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:text-xs">{label}</p>
        {Icon ? <Icon className="h-4 w-4 text-[var(--edp-brand-strong)]" /> : null}
      </div>
      <p className="leading-none tracking-tight text-slate-900">
        <span className="text-3xl font-bold sm:text-4xl">{value}</span>
        {unit ? <span className="ml-1 align-baseline text-base font-semibold text-slate-500 sm:text-lg">{unit}</span> : null}
      </p>
    </article>
  )
}
