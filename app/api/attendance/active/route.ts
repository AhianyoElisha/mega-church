import { NextResponse } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { resolveSessions } from '@/lib/attendance/server'
import type { ActiveSessionResponse } from '@/lib/meetings/types'

/**
 * GET /api/attendance/active — the one open session, plus anything paused.
 *
 * Open to every role: the kiosk polls it to know whether to arm the scanner,
 * ushers watch it, and admins see it in the header. Nothing here is sensitive
 * beyond the meeting's name.
 *
 * "Every role" means every role. `leader` and `celebrations` were missing from
 * the list while the comment claimed otherwise, and because a denied request is
 * indistinguishable from an empty one, the header pill told those users "No
 * session open" all day — on every page, while a service was running.
 */
export async function GET() {
  const auth = await requireRole(['admin', 'usher', 'kiosk', 'leader', 'celebrations', 'shepherd'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  try {
    const { session, paused } = await resolveSessions(databases)
    return NextResponse.json<ActiveSessionResponse>(
      { ok: true, session, paused },
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
