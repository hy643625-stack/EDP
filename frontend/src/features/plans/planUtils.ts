import type { PlanSnapshot, PlanStep } from '@/api/types'

export function localDateKey(value = new Date()): string {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function defaultTargetDate(start: string): string {
  const value = new Date(`${start}T12:00:00`)
  value.setFullYear(value.getFullYear() + 1)
  return localDateKey(value)
}

export function formatMinutes(value: number): string {
  const safe = Math.max(0, Math.round(value))
  const hours = Math.floor(safe / 60)
  const minutes = safe % 60
  if (hours === 0) return `${minutes} 分钟`
  if (minutes === 0) return `${hours} 小时`
  return `${hours} 小时 ${minutes} 分钟`
}

export function formatSeconds(value: number): string {
  if (value > 0 && value < 60) return '<1 分钟'
  return formatMinutes(Math.round(Math.max(0, value) / 60))
}

export function formatRate(value: number): string {
  if (value > 0 && value < 1) return `${value.toFixed(1)}%`
  return `${Math.round(value)}%`
}

export function collectSteps(snapshot: PlanSnapshot): PlanStep[] {
  return snapshot.phases.flatMap((phase) =>
    phase.milestones.flatMap((milestone) => milestone.weekly_goals.flatMap((goal) => goal.steps))
  )
}

export function updateSnapshotStep(
  snapshot: PlanSnapshot,
  stepId: string,
  updates: Partial<PlanStep>
): PlanSnapshot {
  const next = structuredClone(snapshot)
  for (const phase of next.phases) {
    for (const milestone of phase.milestones) {
      for (const weeklyGoal of milestone.weekly_goals) {
        const step = weeklyGoal.steps.find((item) => item.step_id === stepId)
        if (step) Object.assign(step, updates)
      }
    }
  }
  return next
}
