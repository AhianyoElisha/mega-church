import { NextResponse, type NextRequest } from 'next/server'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import { listMeetings } from '@/lib/meetings/server'
import { occurrenceDocToOccurrence } from '@/lib/attendance/server'

// GET /api/occurrences[?meeting_id=…] — session history, most recent first.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'usher'])
  if ('error' in auth) return auth.error

  const meetingId = request.nextUrl.searchParams.get('meeting_id')
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 100) || 100, 500)

  const { databases } = createAdminClient()
  const queries = [Query.orderDesc('opened_at'), Query.limit(limit)]
  if (meetingId) queries.push(Query.equal('meeting_id', meetingId))

  const [res, meetings] = await Promise.all([
    databases.listDocuments(DATABASE_ID, COLLECTIONS.meeting_occurrences, queries),
    listMeetings(databases),
  ])

  // No joins in Appwrite; the meetings list is small enough to map in memory.
  const names = new Map(meetings.map((m) => [m.$id, m.name]))

  return NextResponse.json(
    {
      ok: true,
      occurrences: res.documents
        .map((d) => occurrenceDocToOccurrence(d as Models.Document & Record<string, unknown>))
        .map((o) => ({
          $id: o.$id,
          meeting_id: o.meeting_id,
          meeting_name: names.get(o.meeting_id) ?? 'Deleted meeting',
          occurrence_date: o.occurrence_date,
          status: o.status,
          opened_at: o.opened_at,
          closed_at: o.closed_at,
          present_count: o.present_count,
        })),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
