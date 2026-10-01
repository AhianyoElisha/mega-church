import type { NextRequest } from 'next/server'
import { NOTIFICATION_KINDS } from '@/lib/appwrite/config'
import { listMembers } from '@/lib/members/server'
import { runServiceSms } from '@/lib/notifications/serviceSms'

/**
 * POST /api/notifications/sunday-reminder — Saturday 18:00: remind every
 * active adult and student about tomorrow's two services.
 *
 * Scheduled in `vercel.json` as `0 18 * * 6`. Accra is UTC+0 all year, so the
 * cron expression IS the church's clock and no offset is applied anywhere.
 *
 * Vercel allows 100 cron jobs per project on EVERY plan (changelog,
 * 2026-01-20 — the old Hobby limit of two is gone). What Hobby still imposes
 * is a once-per-day minimum interval, which this schedule meets, and ±59 min
 * timing: an invocation lands anywhere inside the scheduled hour. An external
 * scheduler can also call this path with
 * `Authorization: Bearer <NOTIFICATIONS_CRON_SECRET>`. Written here where the next person
 * will look when Saturday's reminder arrives at 18:45 rather than 18:00.
 *
 * Recipients: everyone active who is not a Save Church child. The runner
 * drops children and reports them; the default `sunday_reminder` template is
 * what goes out. The path sits under `/api/notifications/` and is therefore
 * exempt from the proxy's session gate — a cron has no cookie jar — but it is
 * not unauthenticated: `authoriseCronRun` wants the bearer token or an admin.
 */
export async function POST(request: NextRequest) {
  return runServiceSms(request, {
    kind: NOTIFICATION_KINDS.sunday_reminder,
    category: 'sunday_reminder',
    recipients: async (databases) =>
      (await listMembers(databases, { status: 'active' })).map((member) => ({ member })),
  })
}

/**
 * GET — because that is the only verb Vercel Cron speaks.
 *
 * A Vercel Cron Job invokes its path with GET (user agent `vercel-cron/1.0`).
 * The birthday routes shipped POST-only and every scheduled firing answered
 * 405 before the handler ran — no row, no text, no error anywhere. Verify this
 * route the way the cron calls it, not with `curl -X POST`. Do NOT add
 * `dynamic = 'force-static'`: a cached 200 would report success forever while
 * sending nothing.
 */
export async function GET(request: NextRequest) {
  return POST(request)
}
