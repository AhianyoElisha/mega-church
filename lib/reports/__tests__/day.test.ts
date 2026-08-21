import { describe, expect, it } from 'vitest'
import {
  NO_CONSTITUENCY,
  STATUS_LABEL,
  isDayScope,
  rowsForConstituency,
  rowsForScope,
  safeSheetName,
  type DayReport,
  type DayRow,
  type DayStatus,
} from '@/lib/reports/day'
import type { Member } from '@/lib/members/types'

function member(id: string, last: string, constituencyId: string | null = null): Member {
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
    constituency_id: constituencyId,
    sms_template_id: null,
    status: 'active',
    created_by: null,
    $createdAt: '2026-01-01T00:00:00.000Z',
    $updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function row(
  id: string,
  last: string,
  status: DayStatus,
  constituencyId: string | null = null,
): DayRow {
  return {
    member: member(id, last, constituencyId),
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
  constituencies: [],
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

// --- constituency slicing ---------------------------------------------------

/**
 * Two constituencies plus a member who has neither, which is the ordinary
 * state of a congregation registered before constituencies existed (PRD §1.7).
 */
const grouped: DayReport = {
  date: '2026-08-09',
  held: { first: true, second: true },
  rows: [
    row('1', 'Ahodwoattended', 'first', 'ahodwo'),
    row('2', 'Ahodwomissing', 'absent', 'ahodwo'),
    row('3', 'Bantamaboth', 'both', 'bantama'),
    row('4', 'Nogroupmissing', 'absent', null),
  ],
  totals: { first: 2, second: 1, both: 1, absent: 2, active: 4 },
  constituencies: [
    { id: 'ahodwo', name: 'Ahodwo' },
    { id: 'bantama', name: 'Bantama' },
    { id: NO_CONSTITUENCY, name: 'No constituency' },
  ],
}

describe('rowsForConstituency', () => {
  it('gives a head only their own people', () => {
    expect(names(rowsForConstituency(grouped, 'ahodwo', 'all'))).toEqual([
      'Ahodwoattended',
      'Ahodwomissing',
    ])
    expect(names(rowsForConstituency(grouped, 'bantama', 'all'))).toEqual(['Bantamaboth'])
  })

  it('narrows to a scope INSIDE the constituency, not across it', () => {
    // The bug this guards: filtering by scope first and constituency second on
    // one screen, and the other way round on another, then wondering why the
    // absent count differs. There is one definition and this is it.
    expect(names(rowsForConstituency(grouped, 'ahodwo', 'absent'))).toEqual(['Ahodwomissing'])
    expect(names(rowsForConstituency(grouped, 'ahodwo', 'first'))).toEqual(['Ahodwoattended'])
    expect(rowsForConstituency(grouped, 'bantama', 'absent')).toEqual([])
  })

  it('keeps a both-services member in both service lists within their group', () => {
    expect(names(rowsForConstituency(grouped, 'bantama', 'first'))).toEqual(['Bantamaboth'])
    expect(names(rowsForConstituency(grouped, 'bantama', 'second'))).toEqual(['Bantamaboth'])
  })

  it('treats "no constituency" as a real bucket, not an empty filter', () => {
    // A member with no constituency must land SOMEWHERE in the admin workbook.
    // If this returned everybody (a falsy filter) or nobody, the people most
    // in need of being assigned are exactly the ones who vanish from the
    // report that would prompt somebody to assign them.
    expect(names(rowsForConstituency(grouped, NO_CONSTITUENCY, 'all'))).toEqual([
      'Nogroupmissing',
    ])
    expect(names(rowsForConstituency(grouped, NO_CONSTITUENCY, 'absent'))).toEqual([
      'Nogroupmissing',
    ])
  })

  it('returns nothing for a constituency nobody is in', () => {
    expect(rowsForConstituency(grouped, 'nobody-here', 'all')).toEqual([])
  })
})

describe('safeSheetName', () => {
  it('keeps a short name as it is', () => {
    expect(safeSheetName('First Service — Ahodwo', new Set())).toBe('First Service — Ahodwo')
  })

  it('truncates to the 31 characters Excel allows', () => {
    const name = safeSheetName('First Service — Ahodwo Extension North', new Set())
    expect(name.length).toBeLessThanOrEqual(31)
  })

  it('de-duplicates two long names that truncate to the same string', () => {
    // The real failure: "Ahodwo Extension North" and "Ahodwo Extension South"
    // both cut to the same 31 characters, and ExcelJS THROWS on a duplicate
    // sheet name — so the workbook a church with long group names asks for is
    // precisely the one that fails to build.
    const used = new Set<string>()
    const a = safeSheetName('First Service — Ahodwo Extension North', used)
    const b = safeSheetName('First Service — Ahodwo Extension South', used)
    expect(a).not.toBe(b)
    expect(b.length).toBeLessThanOrEqual(31)
  })

  it('strips the characters the xlsx format forbids in a sheet name', () => {
    const name = safeSheetName('Absent — St/John[1]:*?', new Set())
    expect(name).not.toMatch(/[[\]:*?/\\]/)
  })

  it('never returns an empty name', () => {
    expect(safeSheetName('[]:*?', new Set())).toBe('Sheet')
  })
})
