import { NextResponse, type NextRequest } from 'next/server'
import {
  createAdminClient,
  createSessionClientFromSecret,
  sessionCookieName,
  toAuthUser,
} from '@/lib/appwrite/server'
import type { LoginRequest, LoginResponse } from '@/lib/auth/types'

// One message for both "no such account" and "wrong password", so the endpoint
// cannot be used to enumerate who has an account here.
const INVALID_CREDENTIALS = 'Invalid email or password'

export async function POST(request: NextRequest) {
  let body: LoginRequest
  try {
    body = (await request.json()) as LoginRequest
  } catch {
    return NextResponse.json<LoginResponse>(
      { ok: false, error: 'Invalid request body' },
      { status: 400 },
    )
  }

  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password) {
    return NextResponse.json<LoginResponse>(
      { ok: false, error: 'Email and password are required' },
      { status: 400 },
    )
  }

  const { account } = createAdminClient()
  let session
  try {
    session = await account.createEmailPasswordSession(email, password)
  } catch {
    return NextResponse.json<LoginResponse>(
      { ok: false, error: INVALID_CREDENTIALS },
      { status: 401 },
    )
  }

  const sessionClient = createSessionClientFromSecret(session.secret)
  let user
  try {
    user = await sessionClient.account.get()
  } catch {
    return NextResponse.json<LoginResponse>(
      { ok: false, error: INVALID_CREDENTIALS },
      { status: 401 },
    )
  }

  const authUser = toAuthUser({
    $id: user.$id,
    email: user.email,
    name: user.name ?? '',
    labels: user.labels ?? [],
    prefs: (user.prefs ?? {}) as Record<string, unknown>,
  })
  if (!authUser) {
    // Real credentials, but no role. Say so plainly — this is an
    // administrative gap, and pretending the password was wrong would send
    // someone chasing the wrong problem.
    return NextResponse.json<LoginResponse>(
      {
        ok: false,
        error:
          'This account has no role assigned. An administrator must give it one of ' +
          'admin, usher or kiosk.',
      },
      { status: 403 },
    )
  }

  const response = NextResponse.json<LoginResponse>({ ok: true, user: authUser })
  response.cookies.set(sessionCookieName(), session.secret, {
    httpOnly: true,
    // `secure` breaks plain-http localhost dev, where the cookie is simply
    // never stored and every login appears to silently fail.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(session.expire),
  })
  return response
}
