import { describe, it, expect } from 'vitest'
import {
  resolvePeriodStart,
  resolvePeriodEnd,
  eachBusinessDate,
  eachDate,
  isWeekend,
  toTorontoDate,
} from '@/lib/utils/dates'

describe('resolvePeriodStart', () => {
  it('daily returns the same Toronto-local date', () => {
    expect(resolvePeriodStart('daily', new Date('2026-04-30T12:00:00Z'))).toBe('2026-04-30')
  })

  it('weekly returns Monday of the ISO week', () => {
    // 2026-04-30 is a Thursday; ISO Monday = 2026-04-27
    expect(resolvePeriodStart('weekly', new Date('2026-04-30T12:00:00Z'))).toBe('2026-04-27')
  })

  it('monthly returns the 1st of the month', () => {
    expect(resolvePeriodStart('monthly', new Date('2026-04-30T12:00:00Z'))).toBe('2026-04-01')
  })
})

describe('resolvePeriodEnd', () => {
  it('weekly returns Friday when includeWeekends=false', () => {
    expect(resolvePeriodEnd('weekly', '2026-04-27', false)).toBe('2026-05-01')
  })
  it('weekly returns Sunday when includeWeekends=true', () => {
    expect(resolvePeriodEnd('weekly', '2026-04-27', true)).toBe('2026-05-03')
  })
  it('monthly returns the last day of the month', () => {
    expect(resolvePeriodEnd('monthly', '2026-04-01', true)).toBe('2026-04-30')
    expect(resolvePeriodEnd('monthly', '2026-02-01', true)).toBe('2026-02-28')
  })
})

describe('eachDate', () => {
  it('yields all dates in [start, end] inclusive', () => {
    expect(eachDate('2026-04-28', '2026-04-30')).toEqual([
      '2026-04-28', '2026-04-29', '2026-04-30',
    ])
  })
})

describe('eachBusinessDate', () => {
  it('skips Sat and Sun', () => {
    expect(eachBusinessDate({ start: '2026-04-30', end: '2026-05-04' }))
      .toEqual(['2026-04-30', '2026-05-01', '2026-05-04'])
  })
})

describe('isWeekend', () => {
  it('detects Saturday and Sunday', () => {
    expect(isWeekend('2026-05-02')).toBe(true)
    expect(isWeekend('2026-05-03')).toBe(true)
    expect(isWeekend('2026-05-04')).toBe(false)
  })
})

describe('toTorontoDate', () => {
  it('converts a UTC ISO timestamp to a Toronto-local YYYY-MM-DD', () => {
    expect(toTorontoDate('2026-03-08T07:00:00Z')).toBe('2026-03-08')
    expect(toTorontoDate('2026-01-01T04:00:00Z')).toBe('2025-12-31')
  })
})
