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

/**
 * Paths that skip the session gate.
 *
 * `/api/notifications` is here because a SCHEDULER calls it, and a cron job has
 * no cookie jar. It is not unauthenticated: the route itself requires either a
 * constant-time-compared `Authorization: Bearer <NOTIFICATIONS_CRON_SECRET>` or
 * a signed-in admin, and refuses everything else. Gating it here instead meant
 * the proxy answered 401 before the route ever saw the token — which is
 * exactly how it behaved until the groups smoke test caught it.
 */
const PUBLIC_PATHS = ['/login', '/api/auth', '/api/notifications']
const RECOGNISED_LABELS: readonly UserLabel[] = [
  'admin',
  'usher',
  'kiosk',
  'leader',
  'celebrations',
  'shepherd',
]

const LABEL_HOMES: Record<UserLabel, string> = {
  admin: '/',
  usher: '/monitor',
  kiosk: '/kiosk',
  // A head lands on their own groups. Which groups those are is resolved from
  // the database per request — the route is the same for every leader.
  leader: '/my-groups',
  celebrations: '/birthdays',
  // A shepherd is here to look at the congregation, so they land where the
  // congregation is rather than on an admin dashboard of controls they cannot
  // press.
  shepherd: '/members',
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
  // A constituency or bacenta head. The two group prefixes are here because a
  // head opens the SAME detail page an admin does — one page, not a parallel
  // read-only copy that drifts.
  //
  // This list is only where they may NAVIGATE. What they may SEE is decided
  // per request by `lib/groups/server.ts::canReadGroup`, because a path prefix
  // cannot express "only the bacentas this person heads". The list pages at
  // `/constituencies` and `/bacentas` are admin data; their APIs refuse a
  // leader with a 403, and the pages themselves bounce one to /my-groups
  // rather than rendering an error.
  leader: ['/my-groups', '/constituencies', '/bacentas'],
  // The birthday team. Deliberately narrow: they prepare flyers and shoutouts,
  // so they need the celebrant list and nothing else in the registry.
  celebrations: ['/birthdays'],
  // A shepherd reads the whole church. This is the WIDEST non-admin list in
  // here, and that is the point of the role — but it is only where they may
  // NAVIGATE. What stops them changing anything is not this list: `shepherd`
  // appears on GET handlers only, so every mutating route refuses it without
  // naming it. The pages themselves also render read-only, because a button
  // that 403s is worse than no button.
  //
  // `/services` and `/meetings` are here so a shepherd can see what is running
  // and who is authorised for what — but EVERY control on those two pages is
  // gated on the admin label, and `/meetings/new` bounces a non-admin back to
  // the list. A prefix cannot express "this path but not that child", so that
  // one redirect lives in the page.
  //
  // Still absent, and for a reason a gate cannot fix:
  //
  //   /sms      a send console that spends the church's money
  //   /kiosk    an appliance that writes attendance
  shepherd: [
    '/members',
    '/constituencies',
    '/bacentas',
    '/my-groups',
    '/birthdays',
    '/meetings',
    '/services',
    '/monitor',
    '/reports',
  ],
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
   *
   *   sw.js         the service worker. Fetched by the browser itself, not by
   *                 page code, and WITHOUT credentials — so a gated
   *                 registration gets a 307 to /login, the browser refuses to
   *                 register a worker whose script is an HTML page, and push
   *                 notifications simply never arrive. Nothing errors.
   *   manifest      likewise fetched out of band. A manifest that 401s makes
   *                 the app uninstallable, and on iOS an uninstallable app is
   *                 one that can never receive a push at all.
   *   icon-*        referenced BY the manifest. A manifest whose icons cannot
   *                 be fetched is an invalid manifest, with the same result.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icon-192.png|icon-512.png|icon-maskable-512.png|logo.png|logo@2x.png|manifest.webmanifest|sw.js|assets|fonts|nbis).*)',
  ],
}
