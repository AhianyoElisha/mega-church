import { NextResponse, type NextRequest } from 'next/server'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import { occurrenceDocToOccurrence } from '@/lib/attendance/server'
import { listMeetings } from '@/lib/meetings/server'
import type { AttendanceRecord, MemberHistoryResponse } from '@/lib/attendance/types'

type Ctx = { params: Promise<{ id: string }> }

const LOOKBACK = 60

/**
 * GET /api/attendance/member/[id] — one member's recent attendance.
 *
 * Returns the last N occurrences with a `record` of null where they were
 * absent, rather than only the sessions they attended. The gaps are the useful
 * part: "came to the last four" and "came four times this year" look identical
 * in a list of present-only rows.
 */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(['admin', 'usher', 'shepherd'])
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()

  const [occRes, recRes, meetings] = await Promise.all([
    databases.listDocuments(DATABASE_ID, COLLECTIONS.meeting_occurrences, [
      Query.orderDesc('opened_at'),
      Query.limit(LOOKBACK),
    ]),
    databases.listDocuments(DATABASE_ID, COLLECTIONS.attendance_records, [
      Query.equal('member_id', id),
      Query.orderDesc('marked_at'),
      Query.limit(LOOKBACK * 2),
    ]),
    listMeetings(databases),
  ])

  const names = new Map(meetings.map((m) => [m.$id, m.name]))
  const byOccurrence = new Map<string, AttendanceRecord>()
  for (const d of recRes.documents) {
    const row = d as Models.Document & Record<string, unknown>
    byOccurrence.set(String(row.occurrence_id), {
      $id: row.$id,
      $createdAt: row.$createdAt,
      occurrence_id: String(row.occurrence_id ?? ''),
      meeting_id: String(row.meeting_id ?? ''),
      member_id: String(row.member_id ?? ''),
      marked_at: String(row.marked_at ?? ''),
      method: (row.method as AttendanceRecord['method']) ?? 'biometric',
      marked_by: (row.marked_by as string | null) ?? null,
      station: (row.station as string | null) ?? null,
      note: (row.note as string | null) ?? null,
    })
  }

  const history = occRes.documents
    .map((d) => occurrenceDocToOccurrence(d as Models.Document & Record<string, unknown>))
    .map((occurrence) => ({
      occurrence,
      meeting_name: names.get(occurrence.meeting_id) ?? 'Deleted meeting',
      record: byOccurrence.get(occurrence.$id) ?? null,
    }))

  return NextResponse.json<MemberHistoryResponse>(
    { ok: true, history },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
