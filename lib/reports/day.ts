import 'server-only'

// Who attended which service on a given day.
//
// Split out from the export route because the shape of this question is the
// report — the spreadsheet is just one rendering of it. Keeping it here means
// the same answer can be reused (a screen, a CSV, an SMS list) without the
// definition of "absent" drifting between them.

import { Query, type Databases, type Models } from 'node-appwrite'
import { COLLECTIONS, DATABASE_ID, SERVICE_IDS } from '@/lib/appwrite/config'
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

export type DayReport = {
  date: string
  /** True when no service occurrence exists for the date at all. Without this
   *  a day nobody opened a service on looks identical to a day everybody
   *  missed — and the absent list would name the entire congregation. */
  held: { first: boolean; second: boolean }
  rows: DayRow[]
  totals: { first: number; second: number; both: number; absent: number; active: number }
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
  const [members, first, second] = await Promise.all([
    listMembers(databases, { status: 'active' }),
    presenceFor(databases, SERVICE_IDS.first, date),
    presenceFor(databases, SERVICE_IDS.second, date),
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

  return {
    date,
    held: { first: first.held, second: second.held },
    rows,
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
