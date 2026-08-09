import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSessionClient, sessionCookieName } from '@/lib/appwrite/server'
import { evictSession } from '@/lib/auth/session-cache'
import type { LogoutResponse } from '@/lib/auth/types'

export async function POST() {
  // Capture the cookie BEFORE deleting it, so the 30s session cache can be
  // evicted too — otherwise a signed-out cookie keeps authenticating page
  // navigation until the TTL expires.
  const name = sessionCookieName()
  const cookieStore = await cookies()
  const session = cookieStore.get(name)?.value ?? null

  const s = await createSessionClient()
  if (s) {
    try {
      await s.account.deleteSession('current')
    } catch {
      // The session may already be invalid server-side; the cookie still goes.
    }
  }
  if (session) evictSession(session)

  const response = NextResponse.json<LogoutResponse>({ ok: true })
  response.cookies.delete(name)
  return response
}
