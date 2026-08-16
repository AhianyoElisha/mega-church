import { describe, expect, it } from 'vitest'
import { STATUS_LABEL, isDayScope, rowsForScope, type DayReport, type DayRow, type DayStatus } from '@/lib/reports/day'
import type { Member } from '@/lib/members/types'

function member(id: string, last: string): Member {
  return {
    $id: id,
    first_name: 'Test',
    last_name: last,
    other_names: null,
    photo_file_id: null,
    birth_month: null,
    birth_day: null,
    address: null,
    call_number: `+23324000000${id}`,
    whatsapp_number: null,
    home_service: 'second',
    constituency_id: null,
    status: 'active',
    created_by: null,
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function row(id: string, last: string, status: DayStatus): DayRow {
  return {
    member: member(id, last),
    status,
    first_marked_at: status === 'first' || status === 'both' ? '2026-08-09T07:40:00.000Z' : null,
    second_marked_at: status === 'second' || status === 'both' ? '2026-08-09T10:20:00.000Z' : null,
    first_method: status === 'first' || status === 'both' ? 'biometric' : null,
    second_method: status === 'second' || status === 'both' ? 'manual' : null,
  }
}

const report: DayReport = {
  date: '2026-08-09',
  held: { first: true, second: true },
  rows: [
    row('1', 'Firstonly', 'first'),
    row('2', 'Bothservices', 'both'),
    row('3', 'Secondonly', 'second'),
    row('4', 'Missing', 'absent'),
  ],
  totals: { first: 2, second: 2, both: 1, absent: 1, active: 4 },
}

const names = (rows: DayRow[]) => rows.map((r) => r.member.last_name)

describe('rowsForScope', () => {
  it('puts a member who attended BOTH services in both service lists', () => {
    // The case that would otherwise make the two sheets silently disagree with
    // the headcount: attending both services is allowed (PRD §2.1), so such a
    // member belongs on the First list AND the Second list.
    expect(names(rowsForScope(report, 'first'))).toEqual(['Firstonly', 'Bothservices'])
    expect(names(rowsForScope(report, 'second'))).toEqual(['Bothservices', 'Secondonly'])
  })

  it('never lists a both-services member as absent', () => {
    expect(names(rowsForScope(report, 'absent'))).toEqual(['Missing'])
  })

  it('absent means neither service, not "missed one of them"', () => {
    const absent = rowsForScope(report, 'absent')
    for (const r of absent) {
      expect(r.first_marked_at).toBeNull()
      expect(r.second_marked_at).toBeNull()
    }
  })

  it('the all scope is every active member, exactly once', () => {
    const all = rowsForScope(report, 'all')
    expect(all).toHaveLength(report.totals.active)
    expect(new Set(all.map((r) => r.member.$id)).size).toBe(report.totals.active)
  })

  it('every member carries a call number', () => {
    // These lists exist to be phoned down; a row without a number is useless.
    for (const r of rowsForScope(report, 'all')) {
      expect(r.member.call_number).toMatch(/^\+?\d+$/)
    }
  })

  it('service lists and the absent list together cover everyone', () => {
    const covered = new Set([
      ...rowsForScope(report, 'first').map((r) => r.member.$id),
      ...rowsForScope(report, 'second').map((r) => r.member.$id),
      ...rowsForScope(report, 'absent').map((r) => r.member.$id),
    ])
    expect(covered.size).toBe(report.totals.active)
  })
})

describe('status labels', () => {
  it('names all four states in words', () => {
    expect(STATUS_LABEL.first).toBe('First Service')
    expect(STATUS_LABEL.second).toBe('Second Service')
    expect(STATUS_LABEL.both).toBe('Both services')
    expect(STATUS_LABEL.absent).toBe('Absent')
  })
})

describe('isDayScope', () => {
  it('accepts the four scopes and rejects anything else', () => {
    for (const s of ['first', 'second', 'absent', 'all']) expect(isDayScope(s)).toBe(true)
    for (const s of ['', 'FIRST', 'third', 'all-members']) expect(isDayScope(s)).toBe(false)
  })
})
