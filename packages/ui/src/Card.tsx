import { type HTMLAttributes } from 'react'

import { cn } from './cn'

export type CardTone = 'elevated' | 'subtle'

const toneClass: Record<CardTone, string> = {
  elevated: 'card-surface',
  subtle: 'rounded-2xl border border-slate-200/80 bg-slate-50/80'
}

type CardProps = HTMLAttributes<HTMLElement> & {
  tone?: CardTone
}

export function Card({ className, tone = 'elevated', ...props }: CardProps) {
  return <section className={cn('overflow-hidden', toneClass[tone], className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-sm font-semibold text-slate-900', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-4 sm:px-5 sm:py-5', className)} {...props} />
}
