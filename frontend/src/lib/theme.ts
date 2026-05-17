import type { CSSProperties } from 'react'

import { DEFAULT_TASK_COLOR } from '@/features/overview/taskColorPresets'

type RGB = { r: number; g: number; b: number }

export function normalizeThemeHex(input: string | null | undefined, fallback = DEFAULT_TASK_COLOR): string {
  const candidate = (input || '').trim()
  const hex = candidate.startsWith('#') ? candidate.slice(1) : candidate
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback
  return `#${hex.toLowerCase()}`
}

function hexToRgb(hex: string): RGB {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16)
  }
}

function rgbToHex({ r, g, b }: RGB): string {
  return `#${[r, g, b]
    .map((value) => {
      const clamped = Math.max(0, Math.min(255, Math.round(value)))
      return clamped.toString(16).padStart(2, '0')
    })
    .join('')}`
}

export function mixThemeHex(colorA: string, colorB: string, ratio: number): string {
  const weight = Math.max(0, Math.min(1, ratio))
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)
  return rgbToHex({
    r: a.r * (1 - weight) + b.r * weight,
    g: a.g * (1 - weight) + b.g * weight,
    b: a.b * (1 - weight) + b.b * weight
  })
}

export function rgbaFromThemeHex(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  const resolvedAlpha = Math.max(0, Math.min(1, alpha))
  return `rgba(${r}, ${g}, ${b}, ${resolvedAlpha})`
}

export function buildTaskThemeStyle(taskColor: string | null | undefined): CSSProperties {
  const base = normalizeThemeHex(taskColor)
  const strong = mixThemeHex(base, '#0f172a', 0.24)
  const soft = mixThemeHex(base, '#ffffff', 0.38)
  const subtle = mixThemeHex(base, '#ffffff', 0.9)
  const border = mixThemeHex(base, '#e2e8f0', 0.45)
  const aura2 = mixThemeHex(base, '#3b82f6', 0.72)
  return {
    '--edp-brand': base,
    '--edp-brand-strong': strong,
    '--edp-brand-soft': soft,
    '--edp-brand-subtle': subtle,
    '--edp-brand-border': border,
    '--edp-brand-ring': rgbaFromThemeHex(base, 0.26),
    '--edp-on-brand': '#ffffff',
    '--edp-bg-aura-1': rgbaFromThemeHex(base, 0.12),
    '--edp-bg-aura-2': rgbaFromThemeHex(aura2, 0.1)
  } as CSSProperties
}
