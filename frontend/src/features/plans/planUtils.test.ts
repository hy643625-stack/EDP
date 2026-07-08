import { describe, expect, it } from 'vitest'

import type { PlanSnapshot } from '@/api/types'
import { collectSteps, defaultTargetDate, formatMinutes, formatRate, formatSeconds, updateSnapshotStep } from './planUtils'

const snapshot: PlanSnapshot = {
  schema_version: 1,
  generated_at: '2026-07-04T00:00:00Z',
  horizon_end: '2026-07-17',
  phases: [
    {
      phase_id: 'phase-1',
      title: '基础',
      objective: '建立工程基础',
      start_date: '2026-07-04',
      end_date: '2026-09-30',
      estimated_minutes: 180,
      milestones: [
        {
          milestone_id: 'm1',
          title: '后端',
          objective: '完成服务',
          start_date: '2026-07-04',
          end_date: '2026-07-31',
          estimated_minutes: 180,
          weekly_goals: [
            {
              goal_id: 'g1',
              title: '第一周',
              objective: '开始',
              window_start: '2026-07-04',
              window_end: '2026-07-10',
              estimated_minutes: 180,
              expanded: true,
              steps: [
                {
                  step_id: 's1',
                  title: '学习 FastAPI',
                  description: '',
                  scheduled_date: '2026-07-04',
                  due_date: '2026-07-04',
                  estimated_minutes: 180,
                  dependencies: [],
                  evidence_required: false,
                  evidence_prompt: ''
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

describe('plan utilities', () => {
  it('formats estimated and actual time consistently', () => {
    expect(formatMinutes(150)).toBe('2 小时 30 分钟')
    expect(formatSeconds(7_200)).toBe('2 小时')
    expect(formatSeconds(2)).toBe('<1 分钟')
    expect(formatRate(0.3)).toBe('0.3%')
  })

  it('uses a one-year default target date', () => {
    expect(defaultTargetDate('2026-07-04')).toBe('2027-07-04')
  })

  it('edits a preview step without mutating the source snapshot', () => {
    const next = updateSnapshotStep(snapshot, 's1', { title: '先完成 API 路由', estimated_minutes: 90 })
    expect(collectSteps(next)[0].title).toBe('先完成 API 路由')
    expect(collectSteps(next)[0].estimated_minutes).toBe(90)
    expect(collectSteps(snapshot)[0].title).toBe('学习 FastAPI')
  })
})
