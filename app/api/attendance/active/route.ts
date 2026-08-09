import { NextResponse } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { resolveActiveSession } from '@/lib/attendance/server'
import type { ActiveSessionResponse } from '@/lib/meetings/types'

/**
 * GET /api/attendance/active — the one open session, or null.
 *
 * Open to every role: the kiosk polls it to know whether to arm the scanner,
 * ushers watch it, and admins see it in the header. Nothing here is sensitive
 * beyond the meeting's name.
 */
export async function GET() {
  const auth = await requireRole(['admin', 'usher', 'kiosk'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  try {
    const session = await resolveActiveSession(databases)
    return NextResponse.json<ActiveSessionResponse>(
      { ok: true, session },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (e) {
    // The "two sessions open at once" guard. Surfacing the message is the
    // point — it tells an admin exactly what to fix.
    return NextResponse.json<ActiveSessionResponse>(
      { ok: false, error: e instanceof Error ? e.message : 'Could not resolve the session.' },
      { status: 409 },
    )
  }
}
