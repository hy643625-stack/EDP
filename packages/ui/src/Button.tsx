import { type ButtonHTMLAttributes, type ReactNode } from 'react'

import { cn } from './cn'

export type ButtonVariant = 'primary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const variantClass: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--edp-brand)] text-[var(--edp-on-brand)] shadow-sm hover:bg-[var(--edp-brand-strong)] disabled:bg-[var(--edp-brand-soft)] disabled:text-[var(--edp-on-brand)]',
  ghost:
    'border border-slate-200 bg-white text-slate-700 hover:border-[var(--edp-brand-border)] hover:bg-[var(--edp-brand-subtle)] hover:text-slate-900 disabled:text-slate-400',
  danger:
    'border border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100 disabled:text-rose-400'
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-xs sm:text-sm',
  md: 'h-10 px-4 text-sm'
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex touch-manipulation items-center justify-center gap-1.5 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variantClass[variant],
        sizeClass[size],
        className
      )}
      {...props}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  )
}
