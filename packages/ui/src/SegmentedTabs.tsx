import { type ComponentType } from 'react'

import { cn } from './cn'

export type SegmentedTabItem<T extends string> = {
  key: T
  label: string
  icon?: ComponentType<{ className?: string }>
}

export type SegmentedTabsProps<T extends string> = {
  tabs: Array<SegmentedTabItem<T>>
  value: T
  onChange: (next: T) => void
  className?: string
  compact?: boolean
}

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  compact = false
}: SegmentedTabsProps<T>) {
  return (
    <div className={cn('mobile-scroll-x rounded-2xl border border-slate-200/80 bg-white/90 px-2', className)}>
      <ul className="flex min-w-max items-center gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = tab.key === value
          return (
            <li key={tab.key}>
              <button
                type="button"
                onClick={() => onChange(tab.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 border-b-2 font-medium transition-colors',
                  compact ? 'px-2.5 py-2 text-xs sm:text-sm' : 'px-3 py-2.5 text-sm',
                  active
                    ? 'border-[var(--edp-brand)] text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                )}
              >
                {Icon ? <Icon className={cn(compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} /> : null}
                {tab.label}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
