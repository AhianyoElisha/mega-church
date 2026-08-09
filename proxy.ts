// Next 16 renamed Middleware to Proxy. Same job, same file position (project
// root, alongside `app/`), exported as `proxy`.
//
// This is the OPTIMISTIC gate: it proves a session cookie resolves to a user
// with a recognised label, and routes each label to its home. It is not the
// authorisation layer — every Route Handler re-checks with `requireRole()`.

import { NextResponse, type NextRequest } from 'next/server'
import { Account, Client } from 'node-appwrite'
import type { UserLabel } from '@/lib/auth/types'
import { getCachedUserLabels } from '@/lib/auth/session-cache'

const PUBLIC_PATHS = ['/login', '/api/auth']
const RECOGNISED_LABELS: readonly UserLabel[] = ['admin', 'usher', 'kiosk']

const LABEL_HOMES: Record<UserLabel, string> = {
  admin: '/',
  usher: '/monitor',
  kiosk: '/kiosk',
}

/** Paths each non-admin label is allowed to reach. Admin reaches everything. */
const LABEL_ALLOWED_PREFIXES: Record<Exclude<UserLabel, 'admin'>, string[]> = {
  // An usher works the live monitor and does manual check-ins, and needs to be
  // able to look a member up to confirm who they are.
  usher: ['/monitor', '/members', '/setup'],
  // A kiosk is a locked appliance — but /setup is the diagnostic for a kiosk
  // that is not working, and the person who needs it is standing at that
  // machine, signed in as that account. Locking them out of the page that
  // explains the fault helps nobody.
  kiosk: ['/kiosk', '/setup'],
}

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

function pickLabel(labels: string[]): UserLabel | null {
  return RECOGNISED_LABELS.find((l) => labels.includes(l)) ?? null
}

/**
 * `fetch()` follows 3xx transparently, so redirecting an `/api/*` call to the
 * HTML login page hands JSON callers a `200 text/html` and they die on
 * `res.json()`. API requests get a real 401; page navigations redirect.
 */
function denyAccess(request: NextRequest, cookieName: string, clearCookie: boolean): NextResponse {
  const response = request.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    : (() => {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
      })()
  if (clearCookie) response.cookies.delete(cookieName)
  return response
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (isPublic(pathname)) return NextResponse.next()

  const projectId = process.env.APPWRITE_PROJECT_ID ?? process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID
  const endpoint = process.env.APPWRITE_ENDPOINT ?? process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT
  const cookieName = `a_session_${projectId}`

  const session = request.cookies.get(cookieName)?.value
  if (!session) return denyAccess(request, cookieName, false)

  if (!endpoint || !projectId) {
    // Misconfiguration — fail closed.
    return denyAccess(request, cookieName, true)
  }

  let labels: string[]
  try {
    labels = await getCachedUserLabels(session, async () => {
      const client = new Client().setEndpoint(endpoint).setProject(projectId).setSession(session)
      return new Account(client).get()
    })
  } catch {
    return denyAccess(request, cookieName, true)
  }

  const label = pickLabel(labels)
  if (!label) return denyAccess(request, cookieName, true)

  // API routes carry their own per-handler role checks. Redirecting an
  // authenticated usher's API call to a page URL would surface HTML to a
  // fetch() caller. Authentication is proven above; let the route decide role.
  if (pathname.startsWith('/api/')) return NextResponse.next()

  if (label !== 'admin') {
    const allowed = LABEL_ALLOWED_PREFIXES[label]
    if (!allowed.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
      const url = request.nextUrl.clone()
      url.pathname = LABEL_HOMES[label]
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.next()
}

export const config = {
  /**
   * Everything listed here is static, carries no user data, and must be
   * reachable WITHOUT a session. Gating any of it does not fail loudly — it
   * turns a 200 into a 307 to /login, and the asset just silently does not
   * appear.
   *
   *   nbis          the WebAssembly matcher a tablet kiosk fetches at runtime,
   *                 via a dynamic import that sends no credentials. Gate it and
   *                 the tablet quietly loses fingerprint capture.
   *   logo / icon   the brand mark. The login page is by definition
   *                 unauthenticated, so a gated logo is broken exactly where
   *                 it is most visible. Same for the favicon and the iOS
   *                 home-screen icon, which browsers fetch out-of-band.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|logo@2x.png|assets|fonts|nbis).*)',
  ],
}
