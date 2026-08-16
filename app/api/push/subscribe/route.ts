import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { saveSubscription } from '@/lib/notifications/server'
import type { SubscribeResponse } from '@/lib/notifications/types'

/**
 * POST /api/push/subscribe — register this device for notifications.
 *
 * The subscription belongs to the SIGNED-IN account, taken from the session
 * and never from the request body. A device identifier posted by a client is
 * not a claim about who owns it, and accepting one would let any authenticated
 * caller attach their phone to somebody else's alerts.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'celebrations', 'usher', 'leader'])
  if ('error' in auth) return auth.error

  let body: { endpoint?: unknown; keys?: unknown; device_label?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return bad('Invalid request body.')
  }

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
  const keys = body.keys as { p256dh?: unknown; auth?: unknown } | undefined
  const p256dh = typeof keys?.p256dh === 'string' ? keys.p256dh : ''
  const authKey = typeof keys?.auth === 'string' ? keys.auth : ''

  // All three or none. A row missing either key is a row every future send
  // fails on, and it fails at encryption time with an error that says nothing
  // about which device is broken.
  if (!endpoint || !p256dh || !authKey) {
    return bad('That subscription is incomplete. Try enabling notifications again.')
  }
  if (!/^https:\/\//.test(endpoint)) {
    return bad('That push endpoint is not a valid HTTPS URL.')
  }

  const { databases } = createAdminClient()
  const device = await saveSubscription(
    databases,
    {
      endpoint,
      keys: { p256dh, auth: authKey },
      device_label: typeof body.device_label === 'string' ? body.device_label : null,
    },
    { id: auth.user.id, label: auth.user.label },
  )

  return NextResponse.json<SubscribeResponse>({ ok: true, device }, { status: 201 })
}

function bad(error: string, status = 400) {
  return NextResponse.json<SubscribeResponse>({ ok: false, error }, { status })
}
