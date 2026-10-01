import { describe, expect, it } from 'vitest'
import {
  academicYear,
  applyRollover,
  graduate,
  isDueForUpdate,
  isValidLevel,
  levelOptions,
  promote,
  repeat,
} from '../students'
import { ACADEMIC_YEAR_START_MONTH, LEVEL_MAX, LEVEL_MIN } from '@/lib/appwrite/config'

const student = (level: number | null, level_year: number | null) => ({
  member_type: 'student' as const,
  level,
  level_year,
})

describe('academicYear', () => {
  it('turns over in the start month, not at New Year', () => {
    // The month before the boundary still belongs to the previous academic
    // year; the boundary month opens the new one.
    expect(ACADEMIC_YEAR_START_MONTH).toBe(8)
    expect(academicYear('2026-07-31')).toBe(2025)
    expect(academicYear('2026-08-01')).toBe(2026)
  })

  it('January belongs to the academic year that started the previous August', () => {
    expect(academicYear('2027-01-15')).toBe(2026)
    expect(academicYear('2026-12-31')).toBe(2026)
  })
})

describe('isDueForUpdate', () => {
  it('is due when the level was confirmed in an earlier academic year', () => {
    expect(isDueForUpdate(student(200, 2025), '2026-09-01')).toBe(true)
  })

  it('is not due when confirmed this academic year', () => {
    expect(isDueForUpdate(student(200, 2026), '2026-09-01')).toBe(false)
    // Still the same academic year in the following spring.
    expect(isDueForUpdate(student(200, 2026), '2027-03-01')).toBe(false)
  })

  it('treats an absent level_year as due — "never asked" is the case the roll exists for', () => {
    expect(isDueForUpdate(student(200, null), '2026-09-01')).toBe(true)
    expect(isDueForUpdate(student(null, null), '2026-09-01')).toBe(true)
  })

  it('never applies to a non-student', () => {
    expect(isDueForUpdate({ member_type: 'adult', level_year: null }, '2026-09-01')).toBe(false)
    expect(isDueForUpdate({ member_type: 'child', level_year: 2020 }, '2026-09-01')).toBe(false)
  })
})

describe('promote', () => {
  it('adds one level and stamps this academic year', () => {
    expect(promote(student(200, 2025), '2026-09-01')).toEqual({
      ok: true,
      patch: { level: 300, level_year: 2026 },
    })
  })

  it('refuses at the top level and points at Graduate', () => {
    const out = promote(student(LEVEL_MAX, 2025), '2026-09-01')
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('expected a refusal')
    expect(out.error).toMatch(/graduate/i)
  })

  it('refuses a student with no level rather than inventing one', () => {
    const out = promote(student(null, null), '2026-09-01')
    expect(out.ok).toBe(false)
  })

  it('refuses a non-student', () => {
    expect(promote({ member_type: 'adult', level: 200, level_year: 2025 }, '2026-09-01').ok).toBe(
      false,
    )
  })
})

describe('repeat', () => {
  it('leaves the level alone and stamps the year — which is what clears "due"', () => {
    const out = repeat(student(200, 2025), '2026-09-01')
    expect(out).toEqual({ ok: true, patch: { level_year: 2026 } })
    if (!out.ok) throw new Error('expected ok')
    expect(isDueForUpdate({ ...student(200, 2025), ...out.patch }, '2026-09-01')).toBe(false)
  })

  it('works for a student with no level yet', () => {
    expect(repeat(student(null, null), '2026-09-01')).toEqual({
      ok: true,
      patch: { level_year: 2026 },
    })
  })
})

describe('graduate', () => {
  it('makes them an adult and clears all three student fields together', () => {
    expect(graduate(student(400, 2025), '2026-09-01')).toEqual({
      ok: true,
      patch: { member_type: 'adult', programme: null, level: null, level_year: null },
    })
  })

  it('refuses a non-student', () => {
    expect(graduate({ member_type: 'child', level: null, level_year: null }, '2026-09-01').ok).toBe(
      false,
    )
  })
})

describe('applyRollover', () => {
  it('dispatches by name', () => {
    expect(applyRollover('promote', student(100, 2025), '2026-09-01')).toEqual(
      promote(student(100, 2025), '2026-09-01'),
    )
    expect(applyRollover('repeat', student(100, 2025), '2026-09-01')).toEqual(
      repeat(student(100, 2025), '2026-09-01'),
    )
    expect(applyRollover('graduate', student(100, 2025), '2026-09-01')).toEqual(
      graduate(student(100, 2025), '2026-09-01'),
    )
  })
})

describe('levelOptions / isValidLevel', () => {
  it('lists every level from the lowest to the highest in steps', () => {
    const opts = levelOptions()
    expect(opts[0]).toBe(LEVEL_MIN)
    expect(opts[opts.length - 1]).toBe(LEVEL_MAX)
    expect(opts).toEqual([100, 200, 300, 400, 500, 600, 700, 800])
  })

  it('accepts only whole steps inside the range', () => {
    expect(isValidLevel(300)).toBe(true)
    expect(isValidLevel(250)).toBe(false)
    expect(isValidLevel(0)).toBe(false)
    expect(isValidLevel(900)).toBe(false)
    expect(isValidLevel('300')).toBe(false)
  })
})
