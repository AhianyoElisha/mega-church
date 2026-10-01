import { NextResponse, type NextRequest } from 'next/server'
import { type Models } from 'node-appwrite'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import {
  hydrateSession,
  loadLiveStats,
  occurrenceDocToOccurrence,
  resolveActiveSession,
} from '@/lib/attendance/server'
import type { LiveStatsResponse } from '@/lib/attendance/types'
import type { ActiveSession } from '@/lib/meetings/types'

/**
 * GET /api/attendance/live[?occurrence_id=…]
 *
 * Without a parameter, reports on whatever is open. With one, on a past
 * occurrence — the same aggregate powers both the live monitor and a report,
 * so the two can never disagree about what a number means.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'usher', 'shepherd', 'treasurer'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  const occurrenceId = request.nextUrl.searchParams.get('occurrence_id')

  let session: ActiveSession | null
  if (occurrenceId) {
    try {
      const occDoc = await databases.getDocument(
        DATABASE_ID,
        COLLECTIONS.meeting_occurrences,
        occurrenceId,
      )
      // The same hydration the poll uses, so a past service reports its Save
      // Church count exactly as a live one does.
      session = await hydrateSession(
        databases,
        occurrenceDocToOccurrence(occDoc as Models.Document & Record<string, unknown>),
      )
    } catch {
      return NextResponse.json<LiveStatsResponse>(
        { ok: false, error: 'No such session.' },
        { status: 404 },
      )
    }
  } else {
    try {
      session = await resolveActiveSession(databases)
    } catch (e) {
      return NextResponse.json<LiveStatsResponse>(
        { ok: false, error: e instanceof Error ? e.message : 'Could not resolve the session.' },
        { status: 409 },
      )
    }
    if (!session) {
      return NextResponse.json<LiveStatsResponse>(
        { ok: false, error: 'No session is open.' },
        { status: 423 },
      )
    }
  }

  const stats = await loadLiveStats(databases, session)
  return NextResponse.json<LiveStatsResponse>(
    { ok: true, stats },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
