import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/appwrite/server'
import { authoriseCronRun, cronRefusal } from '@/lib/notifications/cron'
import { listMembers } from '@/lib/members/server'
import { todayInAccra } from '@/lib/attendance/occurrenceResolver'
import { celebrantsForNotification } from '@/lib/birthdays/upcoming'
import { recordRun } from '@/lib/notifications/server'
import { NOTIFICATION_KINDS } from '@/lib/appwrite/config'
import { createSmsService } from '@/lib/sms/mnotify'
import { resolveBirthdayTemplate, sendToMembers, type SendTarget } from '@/lib/sms/server'
import type { BirthdaySmsResponse } from '@/lib/sms/types'

/**
 * POST /api/notifications/birthday-sms — text today's celebrants.
 *
 * ── This is NOT the same job as `/api/notifications/birthday-run` ───────────
 *
 *   birthday-run   tells the celebrations TEAM, by push, the day BEFORE
 *                  (BIRTHDAY_LEAD_DAYS), because they have a flyer to make and
 *                  the morning of is too late.
 *   birthday-sms   texts the CELEBRANT, ON the day, because a birthday message
 *                  that arrives a day early is simply wrong.
 *
 * Both read the same tested calendar arithmetic — `celebrantsForNotification`
 * with a lead of 1 and 0 respectively — so the 29 February observance and the
 * December→January wrap cannot drift apart between them. Point a scheduler at
 * both; they are different times of day and different audiences, and neither
 * substitutes for the other.
 *
 * ── Why this is safe to call repeatedly ─────────────────────────────────────
 *
 * Idempotency is per MEMBER, not per run, and it lives on the unique index over
 * `sms_messages.dedupe_key` — `birthday:<member_id>:<run_date>`. A retried
 * cron, an overlapping schedule, or an admin pressing the button after the
 * scheduler already fired all collide there and write nothing.
 *
 * Per-member rather than per-run on purpose: if the run half-completes because
 * mNotify times out at member forty of sixty, the next call must text the
 * remaining twenty and none of the first forty. A single per-day claim row
 * would either send to everyone twice or to the last twenty never.
 *
 * The path sits under `/api/notifications/`, so it is exempt from the proxy's
 * session gate — a cron has no cookie jar (CLAUDE.md). It is NOT
 * unauthenticated: same constant-time bearer comparison as its neighbour.
 */
export async function POST(request: NextRequest) {
  const authorised = await authoriseCronRun(request)
  if (!authorised.ok) return cronRefusal<BirthdaySmsResponse>(authorised)

  const { databases } = createAdminClient()
  const runDate = todayInAccra()

  /**
   * Answer, and leave a trace that this job ran.
   *
   * Every exit goes through here, which is the point. Before this, three of
   * the four ways out wrote nothing at all: on a day when nobody has a
   * birthday the job returned `nobody_celebrating` having touched no
   * collection, so a firing was indistinguishable from a scheduler that never
   * fired. The only proof the job was alive was somebody happening to have a
   * birthday — which is to say, the evidence was absent on exactly the
   * ordinary days you would want to check.
   *
   * The row is written BEFORE the response is returned but AFTER the work is
   * done, and it never gates anything: see `recordRun`.
   */
  const answer = async (body: Extract<BirthdaySmsResponse, { ok: true }>) => {
    await recordRun(databases, runDate, NOTIFICATION_KINDS.birthday_sms, authorised.who, {
      status: body.status,
      celebrant_count: body.celebrant_count,
      sent: body.sent,
      failed: body.failed,
      skipped: body.skipped,
    })
    return NextResponse.json<BirthdaySmsResponse>(body)
  }

  const sms = createSmsService()
  const config = sms.status()
  if (!config.configured) {
    // Reported, not thrown, and NOT a claim. Nothing was sent, so a later call
    // once the sender ID is approved must still be free to send.
    return answer({
      ok: true,
      status: 'not_configured',
      run_date: runDate,
      celebrant_count: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      // Nothing was sent, so nothing was learned. Not 0 — that is a balance.
      credit_left: null,
    })
  }

  const members = await listMembers(databases)
  // Lead 0 — the celebrant is texted ON their birthday. `celebrantsForNotification`
  // already excludes inactive members and already observes 29 February on the
  // 28th in a common year.
  const celebrants = celebrantsForNotification(members, runDate, 0)

  if (celebrants.length === 0) {
    return answer({
      ok: true,
      status: 'nobody_celebrating',
      run_date: runDate,
      celebrant_count: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      // Nothing was sent, so nothing was learned. Not 0 — that is a balance.
      credit_left: null,
    })
  }

  const byId = new Map(members.map((m) => [m.$id, m]))
  const targets: SendTarget[] = []
  for (const c of celebrants) {
    const member = byId.get(c.$id)
    if (!member) continue
    // Per member, because the whole point is that not everyone is addressed
    // the same way: their own override first, then the birthday default.
    const template = await resolveBirthdayTemplate(databases, member)
    if (!template) continue
    targets.push({ member, template })
  }

  if (targets.length === 0) {
    // There ARE celebrants and there is no template to send them. Said out
    // loud rather than reported as success with zero sent, which would look
    // exactly like a quiet day and hide the missing template until somebody
    // noticed the church had stopped texting anyone.
    return answer({
      ok: true,
      status: 'no_template',
      run_date: runDate,
      celebrant_count: celebrants.length,
      sent: 0,
      failed: 0,
      skipped: 0,
      // Nothing was sent, so nothing was learned. Not 0 — that is a balance.
      credit_left: null,
    })
  }

  try {
    const report = await sendToMembers(databases, sms, targets, {
      category: 'birthday',
      sentBy: authorised.who,
      runDate,
      automatic: true,
    })
    return answer({
      ok: true,
      status: 'sent',
      run_date: runDate,
      celebrant_count: celebrants.length,
      sent: report.sent,
      failed: report.failed,
      // Everyone already texted today. On a second call of the day this is the
      // celebrant count and `sent` is zero — which is exactly what "it did not
      // send twice" looks like from outside.
      skipped: report.skipped,
      credit_left: report.credit_left,
    })
  } catch (err) {
    return NextResponse.json<BirthdaySmsResponse>(
      { ok: false, error: err instanceof Error ? err.message : 'The run failed.' },
      { status: 500 },
    )
  }
}

/**
 * GET — because that is the only verb Vercel Cron speaks.
 *
 * This is not a convenience alias. A Vercel Cron Job invokes its path with a
 * **GET** (user agent `vercel-cron/1.0`); this route exported only POST, so
 * every scheduled firing since the crons were declared answered
 * **405 Method Not Allowed** and the POST handler above never ran. No row was
 * written, no message was sent, and nothing anywhere reported a fault — the
 * job simply looked like a church where nobody had a birthday.
 *
 * The reason it survived verification is worth recording: every manual proof
 * was a `curl -X POST`, which worked perfectly. The scheduler's request and
 * the tested request differed in exactly the one way nobody compared.
 *
 * Route Handlers are not cached by default (Next 16, "Route Handlers →
 * Caching"), and this one reads an Authorization header, so the GET is not at
 * risk of being served from a cache. Do NOT add `dynamic = 'force-static'`
 * here: a cached 200 would make the cron appear to succeed forever while
 * texting no celebrant ever again.
 */
export async function GET(request: NextRequest) {
  return POST(request)
}
