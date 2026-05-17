import { describe, expect, it } from 'vitest'

import { deriveTimeLinkageLabelMeta, deriveTimeLinkageMeta, getSystemTodayKey, resolveTimeLinkageStatus } from './timeLinkage'

describe('timeLinkage', () => {
  it('derives ratio for a normal date window', () => {
    const meta = deriveTimeLinkageMeta(
      {
        period_start: '2026-04-01',
        period_end: '2026-04-11',
        calc_config: '{}'
      },
      55,
      '2026-04-06'
    )

    expect(meta).not.toBeNull()
    expect(meta?.timePercent).toBe(50)
    expect(meta?.status).toBe('ahead')
    expect(meta?.labelText).toBe('2026/04/01 - 2026/04/11')
  })

  it('clamps to 0% before start and 100% after end', () => {
    const before = deriveTimeLinkageMeta(
      {
        period_start: '2026-04-01',
        period_end: '2026-04-11',
        calc_config: '{}'
      },
      10,
      '2026-03-28'
    )
    const after = deriveTimeLinkageMeta(
      {
        period_start: '2026-04-01',
        period_end: '2026-04-11',
        calc_config: '{}'
      },
      10,
      '2026-05-01'
    )

    expect(before?.timePercent).toBe(0)
    expect(after?.timePercent).toBe(100)
  })

  it('returns 100% when start and end are the same day', () => {
    const meta = deriveTimeLinkageMeta(
      {
        period_start: '2026-04-10',
        period_end: '2026-04-10',
        calc_config: '{}'
      },
      20,
      '2026-04-10'
    )

    expect(meta?.timePercent).toBe(100)
  })

  it('returns null for reverse windows', () => {
    const meta = deriveTimeLinkageMeta(
      {
        period_start: '2026-04-11',
        period_end: '2026-04-01',
        calc_config: '{}'
      },
      20,
      '2026-04-05'
    )

    expect(meta).toBeNull()
  })

  it('falls back to calc_config period range', () => {
    const meta = deriveTimeLinkageMeta(
      {
        period_start: null,
        period_end: null,
        calc_config: '{"schedule_config":{"period_start":"2026-04-01","period_end":"2026-04-21"}}'
      },
      30,
      '2026-04-11'
    )

    expect(meta?.startDate).toBe('2026-04-01')
    expect(meta?.endDate).toBe('2026-04-21')
    expect(meta?.timePercent).toBe(50)
  })

  it('returns label meta when only one boundary date is set', () => {
    const startOnly = deriveTimeLinkageLabelMeta({
      period_start: '2026-04-01',
      period_end: null,
      calc_config: '{}'
    })
    const endOnly = deriveTimeLinkageLabelMeta({
      period_start: null,
      period_end: '2026-04-21',
      calc_config: '{}'
    })

    expect(startOnly?.labelText).toBe('2026/04/01 - —')
    expect(endOnly?.labelText).toBe('— - 2026/04/21')
    expect(
      deriveTimeLinkageMeta(
        {
          period_start: '2026-04-01',
          period_end: null,
          calc_config: '{}'
        },
        20,
        '2026-04-10'
      )
    ).toBeNull()
  })

  it('maps status by ahead/behind/neutral rules', () => {
    expect(resolveTimeLinkageStatus(70, 60)).toBe('ahead')
    expect(resolveTimeLinkageStatus(40, 60)).toBe('behind')
    expect(resolveTimeLinkageStatus(48, 60)).toBe('neutral')
    expect(resolveTimeLinkageStatus(null, 60)).toBe('neutral')
  })

  it('returns local date key by default', () => {
    const key = getSystemTodayKey(new Date('2026-04-20T23:30:00+08:00'))
    expect(key).toBe('2026-04-20')
  })
})
