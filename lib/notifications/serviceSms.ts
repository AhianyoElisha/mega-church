import 'server-only'

// The three scheduled service texts, as ONE job with three recipient rules.
//
//   sunday-reminder    Saturday 18:00   every active adult or student
//   midweek-reminder   Wednesday 08:00  every active adult or student
//   attendance-thanks  Sunday 14:00     everyone marked at First or Second
//
// They share this runner rather than three copies of `birthday-sms`, because
// the parts that must not drift — who may trigger it, how the run is recorded,
// that the send is `automatic` so the dedupe index makes it idempotent, that a
// child is never a recipient — are exactly the parts a copy-paste would let
// drift. Each route contributes its recipient rule and its own comments.

import { NextResponse, type NextRequest } from 'next/server'
import type { Databases } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/server'
import type { NotificationKind, SmsCategory } from '@/lib/appwrite/config'
import { todayInAccra } from '@/lib/attendance/occurrenceResolver'
import type { Member } from '@/lib/members/types'
import { createSmsService } from '@/lib/sms/mnotify'
import { defaultTemplate, sendToMembers, type SendTarget } from '@/lib/sms/server'
import { authoriseCronRun, cronRefusal } from './cron'
import { recordRun } from './server'
import type { ServiceSmsResponse } from './types'

/** One recipient, and anything only this member's render may use. */
export type ServiceRecipient = {
  member: Member
  extras?: Record<string, string>
}

export type ServiceSmsJob = {
  kind: NotificationKind
  category: SmsCategory
  /**
   * Who gets it on `runDate`. May include children — the runner drops them
   * and reports the count, so a rule cannot forget to. It never has to think
   * about phones, claims or templates either.
   */
  recipients(databases: Databases, runDate: string): Promise<ServiceRecipient[]>
}

/**
 * Run one scheduled service text. Modelled on `birthday-sms`; read that route's
 * comments for why a run is RECORDED and not claimed, and why GET delegates.
 *
 * Idempotency is per MEMBER on `sms_messages.dedupe_key`
 * (`<category>:<member_id>:<run_date>`), which is what `automatic: true`
 * selects. A retried cron, an overlapping schedule, or an admin pressing the
 * button after the scheduler already fired all collide there and write
 * nothing — and a run that died at member forty can be called again for the
 * remaining twenty. That is why `recordRun` is a record and not a claim: a
 * per-day claim would either text everyone twice or the last twenty never.
 */
export async function runServiceSms(
  request: NextRequest,
  job: ServiceSmsJob,
): Promise<NextResponse<ServiceSmsResponse>> {
  const authorised = await authoriseCronRun(request)
  if (!authorised.ok) return cronRefusal<ServiceSmsResponse>(authorised)

  const { databases } = createAdminClient()
  const runDate = todayInAccra()

  /**
   * Every `ok` exit leaves a row, INCLUDING the quiet ones. A Wednesday on
   * which the run found nobody is indistinguishable from a scheduler that
   * never fired unless something is written — and "nobody" on a service
   * reminder means the registry is empty or every member is a child, which is
   * worth seeing in the log.
   *
   * `notification_runs.celebrant_count` is the column's name because the first
   * job that had one was the birthday push; here it carries the recipient
   * count. Renaming a column is a migration, not a comment.
   */
  const answer = async (body: Extract<ServiceSmsResponse, { ok: true }>) => {
    await recordRun(databases, runDate, job.kind, authorised.who, {
      status: body.status,
      celebrant_count: body.recipient_count,
      sent: body.sent,
      failed: body.failed,
      skipped: body.skipped,
    })
    return NextResponse.json<ServiceSmsResponse>(body)
  }

  const quiet = (
    status: Exclude<ServiceSmsResponse, { ok: false }>['status'],
    counts: { recipient_count: number; excluded_children: number },
  ) =>
    answer({
      ok: true,
      status,
      kind: job.kind,
      run_date: runDate,
      ...counts,
      sent: 0,
      failed: 0,
      skipped: 0,
      no_phone: [],
      // Nothing was sent, so nothing was learned. Not 0 — that is a balance.
      credit_left: null,
    })

  const sms = createSmsService()
  const config = sms.status()
  if (!config.configured) {
    // Reported, not thrown, and NOT a claim. Nothing was sent, so a later call
    // once the sender ID is approved must still be free to send.
    return quiet('not_configured', { recipient_count: 0, excluded_children: 0 })
  }

  const everyone = await job.recipients(databases, runDate)

  /*
   * Children are dropped HERE, before targets exist, and again inside
   * `sendToMembers`. The second is the guarantee; this one is so the count
   * reaches the response with its meaning attached rather than as a silent
   * shortfall. A child marked at Save Church is in the attendance rows and
   * would otherwise be thanked for "Second Service" on a parent's phone.
   */
  const recipients = everyone.filter((r) => r.member.member_type !== 'child')
  const excludedChildren = everyone.length - recipients.length

  if (recipients.length === 0) {
    return quiet('nobody', { recipient_count: 0, excluded_children: excludedChildren })
  }

  const template = await defaultTemplate(databases, job.category)
  if (!template) {
    // There ARE recipients and nothing to send them. Said out loud rather than
    // reported as success with zero sent, which would look exactly like a
    // quiet day and hide the missing template until somebody noticed the
    // church had stopped texting anyone.
    return quiet('no_template', {
      recipient_count: recipients.length,
      excluded_children: excludedChildren,
    })
  }

  const targets: SendTarget[] = recipients.map(({ member, extras }) => ({
    member,
    template,
    extras,
  }))

  try {
    const report = await sendToMembers(databases, sms, targets, {
      category: job.category,
      sentBy: authorised.who,
      runDate,
      automatic: true,
    })
    return answer({
      ok: true,
      status: 'sent',
      kind: job.kind,
      run_date: runDate,
      recipient_count: recipients.length,
      // The chokepoint's own count. Zero here, because the filter above ran
      // first — if it is ever non-zero, a recipient rule has started returning
      // something this runner did not filter, and that is worth seeing.
      excluded_children: excludedChildren + report.excluded_children,
      sent: report.sent,
      failed: report.failed,
      skipped: report.skipped,
      no_phone: report.no_phone,
      credit_left: report.credit_left,
    })
  } catch (err) {
    return NextResponse.json<ServiceSmsResponse>(
      { ok: false, error: err instanceof Error ? err.message : 'The run failed.' },
      { status: 500 },
    )
  }
}
