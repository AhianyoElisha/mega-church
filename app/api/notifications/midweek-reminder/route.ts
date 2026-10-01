import type { NextRequest } from 'next/server'
import { NOTIFICATION_KINDS } from '@/lib/appwrite/config'
import { listMembers } from '@/lib/members/server'
import { runServiceSms } from '@/lib/notifications/serviceSms'

/**
 * POST /api/notifications/midweek-reminder — Wednesday 08:00: remind every
 * active adult and student about this evening's 6:00pm service.
 *
 * Scheduled in `vercel.json` as `0 8 * * 3`. Accra is UTC+0 all year, so the
 * cron expression IS the church's clock.
 *
 * ⚠ Vercel's Hobby plan allows TWO cron jobs; this project declares five.
 * The church must be on Pro, or point an external scheduler at this path with
 * `Authorization: Bearer <NOTIFICATIONS_CRON_SECRET>`. Not verifiable from the
 * code — recorded here for whoever asks why Wednesday's text never came.
 *
 * There is deliberately no midweek OCCURRENCE: the church has not asked to
 * take midweek attendance through the kiosk, so this is a text with a fixed
 * time and nothing else (plan 6, "Not in scope"). Recipients are everyone
 * active who is not a Save Church child; the runner drops children and
 * reports them.
 */
export async function POST(request: NextRequest) {
  return runServiceSms(request, {
    kind: NOTIFICATION_KINDS.midweek_reminder,
    category: 'midweek_reminder',
    recipients: async (databases) =>
      (await listMembers(databases, { status: 'active' })).map((member) => ({ member })),
  })
}

/**
 * GET — because that is the only verb Vercel Cron speaks. See
 * `sunday-reminder/route.ts` and the birthday routes for the 405 that taught
 * this. Never add `dynamic = 'force-static'` here.
 */
export async function GET(request: NextRequest) {
  return POST(request)
}
