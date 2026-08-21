import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/appwrite/server'
import { authoriseCronRun, cronRefusal } from '@/lib/notifications/cron'
import { listMembers } from '@/lib/members/server'
import { todayInAccra } from '@/lib/attendance/occurrenceResolver'
import { birthdayNotificationText, celebrantsForNotification } from '@/lib/birthdays/upcoming'
import {
  claimRun,
  finishRun,
  listSubscriptionsForLabels,
  releaseRun,
  sendToAll,
} from '@/lib/notifications/server'
import { USER_LABELS } from '@/lib/appwrite/config'
import type { BirthdayRunResponse } from '@/lib/notifications/types'

const KIND = 'birthday'

/**
 * Who is told. The celebrations team is the point of the feature; admins are
 * included because the person who set the church up wants to know the alert
 * actually went out, and finding out by asking someone else is worse.
 */
const NOTIFY_LABELS = [USER_LABELS.celebrations, USER_LABELS.admin]

/**
 * POST /api/notifications/birthday-run — push tomorrow's birthdays to the team.
 *
 * Two ways in, and they are different on purpose:
 *
 *   a scheduler  `Authorization: Bearer <NOTIFICATIONS_CRON_SECRET>`. No
 *                session, because a cron has no cookie jar. Point any
 *                scheduler at it — an Appwrite Function on a cron trigger,
 *                cron-job.org, a Windows scheduled task with curl.
 *   an admin     a signed-in admin pressing "Send now" on /birthdays, for the
 *                morning the scheduler did not fire.
 *
 * Idempotent per day. The unique index on `(run_date, kind)` is the guarantee:
 * the run is CLAIMED by inserting that row before anything is sent, so two
 * overlapping firings cannot both decide they are first. A repeat gets
 * `already_sent` and nobody's phone buzzes twice.
 *
 * "Today" is Accra, not the server's timezone. A run triggered at 06:00 Accra
 * from a machine in UTC must agree with the dashboard about which day it is.
 */
export async function POST(request: NextRequest) {
  const authorised = await authoriseCronRun(request)
  if (!authorised.ok) return cronRefusal<BirthdayRunResponse>(authorised)

  const { databases } = createAdminClient()
  const runDate = todayInAccra()

  const claim = await claimRun(databases, runDate, KIND, authorised.who)
  if (!claim.ok) {
    return NextResponse.json<BirthdayRunResponse>({
      ok: true,
      status: 'already_sent',
      run_date: runDate,
      celebrant_count: 0,
      sent: 0,
      failed: 0,
      pruned: 0,
    })
  }

  try {
    const members = await listMembers(databases)
    const celebrants = celebrantsForNotification(members, runDate)

    if (celebrants.length === 0) {
      // The claim STAYS. Nobody is celebrating tomorrow, and a scheduler that
      // fires hourly should not re-check and re-decide that fifteen more times
      // today. The claim expires naturally when the date rolls over.
      await finishRun(databases, claim.id, { celebrant_count: 0, sent: 0, failed: 0 })
      return NextResponse.json<BirthdayRunResponse>({
        ok: true,
        status: 'nobody_celebrating',
        run_date: runDate,
        celebrant_count: 0,
        sent: 0,
        failed: 0,
        pruned: 0,
      })
    }

    const targets = await listSubscriptionsForLabels(databases, NOTIFY_LABELS)
    if (targets.length === 0) {
      // Released, not kept: there ARE people to celebrate and nobody was told.
      // The moment someone on the team enables notifications, the next run
      // must be free to actually send.
      await releaseRun(databases, claim.id)
      return NextResponse.json<BirthdayRunResponse>({
        ok: true,
        status: 'no_subscribers',
        run_date: runDate,
        celebrant_count: celebrants.length,
        sent: 0,
        failed: 0,
        pruned: 0,
      })
    }

    const { title, body } = birthdayNotificationText(celebrants)
    const result = await sendToAll(databases, targets, {
      title,
      body,
      url: '/birthdays',
      // One tag for the day, so a phone that receives it twice for any reason
      // replaces the notification rather than stacking two identical ones.
      tag: `birthday-${runDate}`,
    })

    if ('error' in result) {
      await releaseRun(databases, claim.id)
      return NextResponse.json<BirthdayRunResponse>(
        { ok: false, error: result.error },
        { status: 503 },
      )
    }

    await finishRun(databases, claim.id, {
      celebrant_count: celebrants.length,
      sent: result.sent,
      failed: result.failed,
    })

    return NextResponse.json<BirthdayRunResponse>({
      ok: true,
      status: 'sent',
      run_date: runDate,
      celebrant_count: celebrants.length,
      sent: result.sent,
      failed: result.failed,
      pruned: result.pruned,
    })
  } catch (err) {
    // The claim must not outlive a run that never sent anything, or tomorrow's
    // celebrants are silently skipped for the day.
    await releaseRun(databases, claim.id)
    return NextResponse.json<BirthdayRunResponse>(
      { ok: false, error: err instanceof Error ? err.message : 'The run failed.' },
      { status: 500 },
    )
  }
}
