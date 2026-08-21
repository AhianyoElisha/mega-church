import 'server-only'

// Who attended which service on a given day.
//
// Split out from the export route because the shape of this question is the
// report — the spreadsheet is just one rendering of it. Keeping it here means
// the same answer can be reused (a screen, a CSV, an SMS list) without the
// definition of "absent" drifting between them.

import { Query, type Databases, type Models } from 'node-appwrite'
import { COLLECTIONS, DATABASE_ID, SERVICE_IDS } from '@/lib/appwrite/config'
import { listConstituencies } from '@/lib/groups/server'
import { listMembers } from '@/lib/members/server'
import { fullName, type Member } from '@/lib/members/types'

export type DayScope = 'first' | 'second' | 'absent' | 'all'

export const DAY_SCOPES: DayScope[] = ['first', 'second', 'absent', 'all']

export function isDayScope(v: string): v is DayScope {
  return (DAY_SCOPES as string[]).includes(v)
}

/** Where a member was on the day. `both` is not a mistake — a member may
 *  legitimately attend First and Second Service (PRD §2.1), and hiding that
 *  would make the two service lists silently disagree with the headcount. */
export type DayStatus = 'first' | 'second' | 'both' | 'absent'

export const STATUS_LABEL: Record<DayStatus, string> = {
  first: 'First Service',
  second: 'Second Service',
  both: 'Both services',
  absent: 'Absent',
}

export type DayRow = {
  member: Member
  status: DayStatus
  /** ISO timestamps, null when they were not at that service. */
  first_marked_at: string | null
  second_marked_at: string | null
  first_method: string | null
  second_method: string | null
}

/** The bucket a member with no constituency falls into.
 *
 *  Not an error and not a placeholder to be cleaned up: members registered
 *  before constituencies existed genuinely have none (PRD §1.7), and the bulk
 *  assigner is how that backlog clears. It appears in the admin's workbook so
 *  those people are visible; it is never offered to a head, because nobody
 *  heads it. */
export const NO_CONSTITUENCY = '__none__'

export type DayReport = {
  date: string
  /** True when no service occurrence exists for the date at all. Without this
   *  a day nobody opened a service on looks identical to a day everybody
   *  missed — and the absent list would name the entire congregation. */
  held: { first: boolean; second: boolean }
  rows: DayRow[]
  totals: { first: number; second: number; both: number; absent: number; active: number }
  /**
   * Every constituency, plus the `NO_CONSTITUENCY` bucket when anybody is in
   * it. Resolved once here rather than per sheet, so a workbook with fifteen
   * tabs still costs one read.
   */
  constituencies: { id: string; name: string }[]
}

async function listAll<T extends Models.Document>(
  databases: Databases,
  collection: string,
  queries: string[],
): Promise<T[]> {
  const out: T[] = []
  let cursor: string | null = null
  for (;;) {
    const q = [...queries, Query.limit(100)]
    if (cursor) q.push(Query.cursorAfter(cursor))
    const res = await databases.listDocuments<T>(DATABASE_ID, collection, q)
    out.push(...res.documents)
    if (res.documents.length < 100) break
    cursor = res.documents[res.documents.length - 1].$id
  }
  return out
}

/** member_id -> earliest mark, across every occurrence of one meeting that day. */
async function presenceFor(
  databases: Databases,
  meetingId: string,
  date: string,
): Promise<{ held: boolean; marks: Map<string, { at: string; method: string }> }> {
  const occurrences = await listAll<Models.Document & Record<string, unknown>>(
    databases,
    COLLECTIONS.meeting_occurrences,
    [Query.equal('occurrence_date', date), Query.equal('meeting_id', meetingId)],
  )
  const marks = new Map<string, { at: string; method: string }>()
  if (occurrences.length === 0) return { held: false, marks }

  for (const occ of occurrences) {
    const records = await listAll<Models.Document & Record<string, unknown>>(
      databases,
      COLLECTIONS.attendance_records,
      [Query.equal('occurrence_id', occ.$id)],
    )
    for (const r of records) {
      const memberId = String(r.member_id ?? '')
      const at = String(r.marked_at ?? '')
      const existing = marks.get(memberId)
      // A service re-opened after being closed would give one member two
      // marks; keep the earliest, which is when they actually arrived.
      if (!existing || at < existing.at) {
        marks.set(memberId, { at, method: String(r.method ?? 'biometric') })
      }
    }
  }
  return { held: true, marks }
}

export async function buildDayReport(
  databases: Databases,
  date: string,
): Promise<DayReport> {
  const [members, first, second, allConstituencies] = await Promise.all([
    listMembers(databases, { status: 'active' }),
    presenceFor(databases, SERVICE_IDS.first, date),
    presenceFor(databases, SERVICE_IDS.second, date),
    listConstituencies(databases),
  ])

  const rows: DayRow[] = members.map((member) => {
    const f = first.marks.get(member.$id) ?? null
    const s = second.marks.get(member.$id) ?? null
    const status: DayStatus = f && s ? 'both' : f ? 'first' : s ? 'second' : 'absent'
    return {
      member,
      status,
      first_marked_at: f?.at ?? null,
      second_marked_at: s?.at ?? null,
      first_method: f?.method ?? null,
      second_method: s?.method ?? null,
    }
  })

  // Grouped in reading order, alphabetical inside each group: the sheet is
  // worked down a column by someone making phone calls.
  const ORDER: DayStatus[] = ['first', 'both', 'second', 'absent']
  rows.sort((a, b) => {
    const g = ORDER.indexOf(a.status) - ORDER.indexOf(b.status)
    return g !== 0 ? g : fullName(a.member).localeCompare(fullName(b.member))
  })

  // Every constituency is listed even when nobody in it turned up, because an
  // empty sheet for Ahodwo is a finding — a missing sheet for Ahodwo is a bug
  // report from a head who thinks the system lost their people.
  const constituencies = allConstituencies.map((c) => ({ id: c.$id, name: c.name }))
  if (rows.some((r) => !r.member.constituency_id)) {
    constituencies.push({ id: NO_CONSTITUENCY, name: 'No constituency' })
  }

  return {
    date,
    held: { first: first.held, second: second.held },
    rows,
    constituencies,
    totals: {
      first: rows.filter((r) => r.status === 'first' || r.status === 'both').length,
      second: rows.filter((r) => r.status === 'second' || r.status === 'both').length,
      both: rows.filter((r) => r.status === 'both').length,
      absent: rows.filter((r) => r.status === 'absent').length,
      active: rows.length,
    },
  }
}

/** Rows for one scope, in the order the sheet should present them. */
export function rowsForScope(report: DayReport, scope: DayScope): DayRow[] {
  if (scope === 'all') return report.rows
  if (scope === 'absent') return report.rows.filter((r) => r.status === 'absent')
  if (scope === 'first') {
    return report.rows.filter((r) => r.status === 'first' || r.status === 'both')
  }
  return report.rows.filter((r) => r.status === 'second' || r.status === 'both')
}

/**
 * `rowsForScope`, narrowed to one constituency.
 *
 * Kept beside `rowsForScope` rather than filtered at the call site so that
 * "absent, in Ahodwo" has exactly one definition. Two call sites filtering
 * independently is how a head's sheet and the admin's headcount end up
 * disagreeing about the same Sunday, with no way to tell which is right.
 */
export function rowsForConstituency(
  report: DayReport,
  constituencyId: string,
  scope: DayScope,
): DayRow[] {
  const inGroup =
    constituencyId === NO_CONSTITUENCY
      ? (r: DayRow) => !r.member.constituency_id
      : (r: DayRow) => r.member.constituency_id === constituencyId
  return rowsForScope(report, scope).filter(inGroup)
}

/**
 * A worksheet name Excel will actually accept.
 *
 * The format caps names at 31 characters and forbids `[]:*?/\`. Two
 * constituencies called "Ahodwo Extension North" and "Ahodwo Extension South"
 * both truncate to "First Service — Ahodwo Extensi", and ExcelJS throws on the
 * duplicate — so the workbook a church with long group names asks for is the
 * one that fails. `used` carries the names already taken and a numeric suffix
 * breaks the tie.
 */
export function safeSheetName(desired: string, used: Set<string>): string {
  const cleaned = desired.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet'
  let name = cleaned.slice(0, 31)
  let n = 2
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n})`
    name = cleaned.slice(0, 31 - suffix.length) + suffix
    n++
  }
  used.add(name.toLowerCase())
  return name
}
