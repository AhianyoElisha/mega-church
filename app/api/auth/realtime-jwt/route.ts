import { NextResponse } from 'next/server'
import { createSessionClient, requireRole } from '@/lib/appwrite/server'

/**
 * POST /api/auth/realtime-jwt — mint a short-lived Appwrite JWT for the
 * caller's own session.
 *
 * The browser's session cookie is scoped to the app domain and cannot
 * authenticate a websocket to Appwrite. This exchanges it for a JWT bound to
 * the SAME user, so the Realtime subscription carries exactly that user's
 * permissions — no wider.
 */
export async function POST() {
  const auth = await requireRole(['admin', 'usher', 'shepherd'])
  if ('error' in auth) return auth.error

  const client = await createSessionClient()
  if (!client) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }

  const jwt = await client.account.createJWT()
  return NextResponse.json(
    { jwt: jwt.jwt },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
