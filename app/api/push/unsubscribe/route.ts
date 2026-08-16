import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { removeSubscription } from '@/lib/notifications/server'
import type { UnsubscribeResponse } from '@/lib/notifications/types'

/** POST /api/push/unsubscribe — stop notifications on this device. Scoped to
 *  the caller's own rows, so one account cannot silence another's phone. */
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'celebrations', 'usher', 'leader'])
  if ('error' in auth) return auth.error

  let body: { endpoint?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json<UnsubscribeResponse>(
      { ok: false, error: 'Invalid request body.' },
      { status: 400 },
    )
  }

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
  if (!endpoint) {
    return NextResponse.json<UnsubscribeResponse>(
      { ok: false, error: 'No device given.' },
      { status: 400 },
    )
  }

  const { databases } = createAdminClient()
  const removed = await removeSubscription(databases, endpoint, auth.user.id)
  return NextResponse.json<UnsubscribeResponse>({ ok: true, removed })
}
