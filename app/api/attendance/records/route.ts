import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { loadOccurrenceRecords, resolveActiveSession } from '@/lib/attendance/server'
import type { AttendanceListResponse } from '@/lib/attendance/types'

// GET /api/attendance/records?occurrence_id=…&cursor=… — the check-in log.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'usher', 'shepherd', 'treasurer'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  let occurrenceId = request.nextUrl.searchParams.get('occurrence_id')

  if (!occurrenceId) {
    const session = await resolveActiveSession(databases).catch(() => null)
    if (!session) {
      return NextResponse.json<AttendanceListResponse>(
        { ok: false, error: 'No session is open.' },
        { status: 423 },
      )
    }
    occurrenceId = session.occurrence.$id
  }

  const cursor = request.nextUrl.searchParams.get('cursor')
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 50) || 50, 200)

  const { records, cursor: next } = await loadOccurrenceRecords(databases, occurrenceId, {
    cursor,
    limit,
  })

  return NextResponse.json<AttendanceListResponse>(
    { ok: true, records, cursor: next },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
