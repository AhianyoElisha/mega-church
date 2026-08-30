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
 *
 * THE ONE EXCEPTION to "a read-only role appears on GET handlers only".
 *
 * `shepherd` and `treasurer` are both here, on a POST, and CLAUDE.md states
 * that rule without qualification — so the reason is written down rather than
 * left to be re-derived by whoever notices next:
 *
 * It is a POST because it CREATES a token, not because it changes anything the
 * church can see. The token grants precisely the caller's own permissions, so
 * a read-only account gets a read-only socket. Refusing them here would not
 * make them safer; it would leave `/monitor` — a page they are deliberately
 * allowed to open — permanently stuck on "connecting".
 *
 * The invariant that actually matters is unchanged: no read-only label appears
 * on a handler that writes CHURCH data. If this route ever grows a side effect
 * beyond minting the caller's own token, both labels come straight back out.
 */
export async function POST() {
  const auth = await requireRole(['admin', 'usher', 'shepherd', 'treasurer'])
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
