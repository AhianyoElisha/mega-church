import type { NextRequest } from 'next/server'
import { NOTIFICATION_KINDS } from '@/lib/appwrite/config'
import { runServiceSms, type ServiceRecipient } from '@/lib/notifications/serviceSms'
import { buildDayReport } from '@/lib/reports/day'
import { servicesAttendedText, type ServicesAttended } from '@/lib/sms/render'

/**
 * POST /api/notifications/attendance-thanks — Sunday 14:00: thank everyone
 * who was marked present at First or Second Service TODAY.
 *
 * Scheduled in `vercel.json` as `0 14 * * 0`. "The Sunday just gone" is
 * today's date in Accra at 14:00 — both services have closed and nobody has
 * yet been marked at anything else — so the run date and the attendance date
 * are the same string, and `buildDayReport(databases, runDate)` is the whole
 * lookup.
 *
 * ⚠ Vercel's Hobby plan allows TWO cron jobs; this project declares five.
 * The church must be on Pro, or point an external scheduler at this path with
 * `Authorization: Bearer <NOTIFICATIONS_CRON_SECRET>`. Not verifiable from
 * the code.
 *
 * Each recipient carries its OWN `services_attended`, rendered from its row's
 * status: "First Service", "Second Service" or "both First and Second
 * Service". One template, three wordings; the attendance rows decide. A row
 * with any other status — `absent`, and the `save` status Track B is adding
 * for children at Save Church — is not an adult attendee and is not thanked.
 * The runner drops children again by `member_type` regardless, so a child
 * who somehow reached an adult service's rows is still never texted.
 */
export async function POST(request: NextRequest) {
  return runServiceSms(request, {
    kind: NOTIFICATION_KINDS.attendance_thanks,
    category: 'attendance_thanks',
    recipients: async (databases, runDate) => {
      const report = await buildDayReport(databases, runDate)
      const out: ServiceRecipient[] = []
      for (const row of report.rows) {
        const s = row.status as string
        if (s !== 'first' && s !== 'second' && s !== 'both') continue
        out.push({
          member: row.member,
          extras: { services_attended: servicesAttendedText(s as ServicesAttended) },
        })
      }
      return out
    },
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
