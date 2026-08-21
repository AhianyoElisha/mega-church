import 'server-only'

// Who is allowed to trigger a scheduled run.
//
// Extracted because both birthday jobs need it and a timing-safe comparison
// copy-pasted into two files is a comparison that gets fixed in one of them.

import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/appwrite/server'

export type CronAuth =
  | { ok: true; who: string }
  | { ok: false; status: 401 | 403; error: string }

/**
 * The secrets a scheduler may present, in order of preference.
 *
 * `CRON_SECRET` is here because **Vercel Cron sends it and nothing else**: the
 * platform reads that exact variable and attaches
 * `Authorization: Bearer <CRON_SECRET>` to every scheduled invocation. Checking
 * only `NOTIFICATIONS_CRON_SECRET` would mean a correctly configured Vercel
 * cron gets a 401 every morning — the job runs, the log fills with failures,
 * and nobody's birthday text goes out.
 *
 * Both are accepted so the church can keep one secret in one variable if they
 * prefer, or point an external scheduler at a different one from Vercel's.
 */
function schedulerSecrets(): string[] {
  return [process.env.NOTIFICATIONS_CRON_SECRET, process.env.CRON_SECRET]
    .map((v) => v?.trim())
    .filter((v): v is string => !!v)
}

/**
 * Accept a scheduler's bearer token, or a signed-in admin.
 *
 * Two ways in, and they are different on purpose:
 *
 *   a scheduler  no session, because a cron has no cookie jar. This is why
 *                `/api/notifications/*` is exempt from the proxy's session
 *                gate — the exemption is not "unauthenticated", it is
 *                "authenticated by this function instead" (CLAUDE.md).
 *   an admin     pressing a button in the app, for the morning the scheduler
 *                did not fire.
 *
 * A caller presenting a Bearer token is judged ONLY on that token. Falling
 * through to the session check would let a wrong token quietly succeed for
 * whoever happened to be signed in, which turns a broken scheduler into one
 * that appears to work from a browser and fails at 6am.
 */
export async function authoriseCronRun(request: NextRequest): Promise<CronAuth> {
  const header = request.headers.get('authorization') ?? ''

  if (header.startsWith('Bearer ')) {
    const offered = header.slice('Bearer '.length)
    const secrets = schedulerSecrets()
    if (secrets.length === 0) {
      return {
        ok: false,
        status: 403,
        error:
          'No scheduler secret is configured, so token authentication is refused. ' +
          'Set NOTIFICATIONS_CRON_SECRET (or CRON_SECRET, which is what Vercel Cron sends).',
      }
    }
    if (secrets.some((s) => safeEqual(offered, s))) return { ok: true, who: 'scheduler' }
    return { ok: false, status: 401, error: 'Invalid scheduler token.' }
  }

  const auth = await requireRole('admin')
  if ('error' in auth) {
    // The role helper's own response carries the right status; mirror it rather
    // than inventing one, so an usher pressing the button gets 403 and an
    // anonymous caller gets 401, exactly as everywhere else.
    return { ok: false, status: auth.error.status === 403 ? 403 : 401, error: 'Unauthorized' }
  }
  return { ok: true, who: auth.user.email }
}

/** Shape the refusal as JSON in whatever response type the route uses. */
export function cronRefusal<T>(auth: Extract<CronAuth, { ok: false }>): NextResponse<T> {
  return NextResponse.json({ ok: false, error: auth.error } as T, { status: auth.status })
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  // `timingSafeEqual` THROWS on a length mismatch rather than returning false,
  // so the length is checked first. That does leak the secret's length, which
  // is an acceptable trade against a randomly generated token — knowing it is
  // 44 characters helps nobody guess it, whereas a byte-at-a-time timing
  // oracle on the CONTENT would.
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
