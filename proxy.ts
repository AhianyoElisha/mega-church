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
  usher: ['/monitor', '/members'],
  // A kiosk is a locked appliance. One page.
  kiosk: ['/kiosk'],
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
  // `nbis` is the WebAssembly matcher the tablet kiosk fetches at runtime. It
  // is static, carries no user data, and is loaded by a dynamic import that
  // does not send credentials — routing it through auth turns a 200 into a 307
  // to /login and the tablet silently loses fingerprint capture.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets|fonts|nbis).*)'],
}
