import { describe, expect, it } from 'vitest'
import {
  calculateWeightedCompletionForDate,
  isTaskAttrActiveOnDate,
  parseScheduleConfig,
  stringifyScheduleConfig,
  type AttributeScheduleConfig
} from './schedule'
import type { DailyRecord, TaskAttrRelation } from './types'

const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

function createAttrWithSchedule(overrides: Partial<AttributeScheduleConfig>): TaskAttrRelation {
  const schedule: AttributeScheduleConfig = {
    type: 'daily',
    active_weekdays: [...ALL_WEEKDAYS],
    shared_weekday_groups: [],
    period_start: null,
    period_end: null,
    target_overrides: {},
    ...overrides
  }

  return {
    task_id: 9,
    attr_id: 99,
    attr_name: '测试属性',
    display_order: 1,
    attr_sign: 0,
    attr_record: 1,
    target_value: 100,
    attr_unit: '次',
    calc_type: '10010000',
    calc_config: stringifyScheduleConfig(schedule),
    weight: 1
  }
}

function createRecord(taskId: number, attrId: number, date: string, value: number): DailyRecord {
  return {
    task_id: taskId,
    attr_id: attrId,
    data_value: value,
    record_date: date,
    create_time: `${date}T08:00:00Z`
  }
}

describe('schedule period boundaries', () => {
  it('parses single-side period boundaries correctly', () => {
    const onlyStart = parseScheduleConfig(
      stringifyScheduleConfig({
        type: 'daily',
        active_weekdays: [...ALL_WEEKDAYS],
        shared_weekday_groups: [],
        period_start: '2026-04-01',
        period_end: null,
        target_overrides: {}
      })
    )
    expect(onlyStart.period_start).toBe('2026-04-01')
    expect(onlyStart.period_end).toBeNull()

    const onlyEnd = parseScheduleConfig(
      stringifyScheduleConfig({
        type: 'daily',
        active_weekdays: [...ALL_WEEKDAYS],
        shared_weekday_groups: [],
        period_start: null,
        period_end: '2026-04-30',
        target_overrides: {}
      })
    )
    expect(onlyEnd.period_start).toBeNull()
    expect(onlyEnd.period_end).toBe('2026-04-30')
  })

  it('supports open-ended schedules with only period_start', () => {
    const attr = createAttrWithSchedule({
      period_start: '2026-04-10',
      period_end: null
    })
    expect(isTaskAttrActiveOnDate(attr, '2026-04-09')).toBe(false)
    expect(isTaskAttrActiveOnDate(attr, '2026-04-10')).toBe(true)
    expect(isTaskAttrActiveOnDate(attr, '2026-12-31')).toBe(true)
  })

  it('supports open-ended schedules with only period_end', () => {
    const attr = createAttrWithSchedule({
      period_start: null,
      period_end: '2026-04-20'
    })
    expect(isTaskAttrActiveOnDate(attr, '2026-04-01')).toBe(true)
    expect(isTaskAttrActiveOnDate(attr, '2026-04-20')).toBe(true)
    expect(isTaskAttrActiveOnDate(attr, '2026-04-21')).toBe(false)
  })

  it('returns inactive when period range is invalid (start > end)', () => {
    const attr = createAttrWithSchedule({
      period_start: '2026-04-20',
      period_end: '2026-04-10'
    })
    expect(isTaskAttrActiveOnDate(attr, '2026-04-15')).toBe(false)
    expect(isTaskAttrActiveOnDate(attr, '2026-04-21')).toBe(false)
  })
})

describe('weighted completion', () => {
  it('uses weighted-average across valid attrs with positive weight only', () => {
    const dateKey = '2026-04-20'
    const attrs: TaskAttrRelation[] = [
      { ...createAttrWithSchedule({}), attr_id: 1, weight: 2, target_value: 100 },
      { ...createAttrWithSchedule({}), attr_id: 2, weight: 1, target_value: 100 },
      { ...createAttrWithSchedule({}), attr_id: 3, weight: 0, target_value: 100 }
    ]
    const records: DailyRecord[] = [
      createRecord(9, 1, dateKey, 100),
      createRecord(9, 3, dateKey, 100)
    ]

    const completion = calculateWeightedCompletionForDate(attrs, records, dateKey)
    expect(completion).not.toBeNull()
    expect(completion!).toBeCloseTo((2 / 3) * 100, 5)
  })

  it('returns null when no valid attr has a positive weight', () => {
    const dateKey = '2026-04-20'
    const attrs: TaskAttrRelation[] = [
      { ...createAttrWithSchedule({}), attr_id: 10, weight: 0, target_value: 100 },
      { ...createAttrWithSchedule({}), attr_id: 11, weight: -2, target_value: 80 }
    ]
    const records: DailyRecord[] = [createRecord(9, 10, dateKey, 100)]

    const completion = calculateWeightedCompletionForDate(attrs, records, dateKey)
    expect(completion).toBeNull()
  })
})
