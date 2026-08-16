import { NextResponse } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { listSubscriptionsForUser, vapidPublicKey } from '@/lib/notifications/server'
import type { PushStatusResponse } from '@/lib/notifications/types'

/**
 * GET /api/push — what this account needs to turn notifications on.
 *
 * The public VAPID key is public by definition (the browser sends it to the
 * push service), so serving it is not a leak — but it is served from here
 * rather than baked into the bundle so the page can tell the difference
 * between "not configured on the server" and "you have not opted in yet".
 * Those look identical from the client otherwise, and only one of them is
 * something the user can fix.
 *
 * Every signed-in role may subscribe. The birthday team is who this was built
 * for, but an admin who wants the same alert on their phone should not need a
 * second account to get it.
 */
export async function GET() {
  const auth = await requireRole(['admin', 'celebrations', 'usher', 'leader'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  const devices = await listSubscriptionsForUser(databases, auth.user.id)

  return NextResponse.json<PushStatusResponse>(
    { ok: true, vapid_public_key: vapidPublicKey(), devices },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
