import { NextResponse, type NextRequest } from 'next/server'
import { Query } from 'node-appwrite'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  COLLECTIONS,
  DATABASE_ID,
  SMS_AUDIENCES,
  SMS_CATEGORIES,
  type SmsAudience,
  type SmsCategory,
} from '@/lib/appwrite/config'
import { memberDocToMember } from '@/lib/attendance/server'
import { todayInAccra } from '@/lib/attendance/occurrenceResolver'
import { buildDayReport } from '@/lib/reports/day'
import { createSmsService } from '@/lib/sms/mnotify'
import { getTemplate, sendToMembers, type SendTarget } from '@/lib/sms/server'
import { canSendSmsCategory } from '@/lib/sms/permissions'
import { isSmsAudience, narrowAudience } from '@/lib/sms/audience'
import { servicesAttendedText, type ServicesAttended } from '@/lib/sms/render'
import { contributionsForPeriod } from '@/lib/benmp/server'
import { currentPeriod, periodLabel } from '@/lib/benmp/period'
import { outstandingPartners } from '@/lib/benmp/unpaid'
import { leaderScope } from '@/lib/groups/server'
import type { Member } from '@/lib/members/types'
import type { SendSmsResponse } from '@/lib/sms/types'

/** Appwrite caps the list `Query.equal` accepts; a tithe send can name
 *  hundreds of members, so they are fetched a page at a time. */
const ID_CHUNK = 100

function isCategory(v: unknown): v is SmsCategory {
  return typeof v === 'string' && (SMS_CATEGORIES as readonly string[]).includes(v)
}

/**
 * POST /api/sms/send — the manual path: pick a template, pick members, send.
 *
 * This is what the tithe screen posts to. It is deliberately NOT tithe-specific:
 * "select some members and send them this message" is the same operation
 * whatever the category, and a second near-identical route for general messages
 * would be a second place for the dedupe and logging rules to drift apart.
 *
 * Sends here are NOT deduplicated against one another — an admin may
 * legitimately thank the same member for tithe twice in one day. The birthday
 * run is the automatic path, and it is the one that must never repeat; see
 * `/api/notifications/birthday-sms`.
 */
export async function POST(request: NextRequest) {
  /*
   * `leader` is here for exactly ONE category.
   *
   * The gate that matters is `canSendSmsCategory` below, which grants a leader
   * `benmp` and nothing else, plus the constituency narrowing further down. A
   * leader reaching this handler is not a leader who may send: it is a leader
   * who may be REFUSED BY NAME, which is the point.
   */
  const auth = await requireRole(['admin', 'treasurer', 'leader'])
  if ('error' in auth) return auth.error

  let body: {
    member_ids?: unknown
    template_id?: unknown
    category?: unknown
    audience?: unknown
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return bad('Send a JSON body.')
  }

  if (!Array.isArray(body.member_ids) || body.member_ids.some((v) => typeof v !== 'string')) {
    return bad('member_ids must be an array of member ids.')
  }
  const memberIds = [...new Set(body.member_ids as string[])]
  if (memberIds.length === 0) return bad('Pick at least one member.')
  if (typeof body.template_id !== 'string') return bad('Pick a message template.')
  if (!isCategory(body.category)) {
    return bad(`category must be one of: ${SMS_CATEGORIES.join(', ')}.`)
  }
  /*
   * `audience` defaults to `all` when ABSENT and is refused by name when
   * WRONG. The two are different: an older client that never sends the field
   * means "everyone I picked", but a client sending `audience: 'student'`
   * (singular) meant something narrower and must not be widened to the whole
   * congregation because of a typo.
   */
  let audience: SmsAudience = 'all'
  if (body.audience !== undefined) {
    if (!isSmsAudience(body.audience)) {
      return bad(`audience must be one of: ${SMS_AUDIENCES.join(', ')}.`)
    }
    audience = body.audience
  }

  /**
   * The category gate, checked BEFORE anything is looked up or sent.
   *
   * A treasurer may send `tithe` and nothing else, and a refusal NAMES the
   * category rather than quietly sending a tithe message instead. Silently
   * downgrading would return 200 and leave them believing a hundred birthday
   * messages went out — the same failure a head's refused fields are refused
   * by name to avoid.
   *
   * This runs on the CATEGORY the caller asked for. The template's own category
   * is checked further down and must agree, so neither a mismatched template
   * nor a mislabelled request gets a treasurer past this.
   */
  const allowed = canSendSmsCategory(auth.user.label, body.category)
  if (!allowed.ok) {
    return NextResponse.json<SendSmsResponse>(
      { ok: false, error: allowed.error },
      { status: allowed.status },
    )
  }

  const { databases } = createAdminClient()

  const template = await getTemplate(databases, body.template_id)
  if (!template) return bad('That template no longer exists. Pick another.')
  if (template.category !== body.category) {
    // Not pedantry: the log is filtered by category, and a tithe message
    // recorded as a birthday would put a `birthday:<member>:<today>` dedupe key
    // on a send that has nothing to do with anybody's birthday — silently
    // suppressing the real birthday message later that morning.
    return bad(
      `"${template.name}" is a ${template.category} template, not a ${body.category} one.`,
    )
  }

  const sms = createSmsService()
  const config = sms.status()
  if (!config.configured) {
    // 503, not 400: nothing about the request is wrong, the server cannot send.
    // The screen shows `reason` verbatim so an admin can tell whether to call
    // the provider or fix an environment variable.
    return NextResponse.json<SendSmsResponse>(
      { ok: false, error: config.reason ?? 'SMS is not set up.' },
      { status: 503 },
    )
  }

  const members: Member[] = []
  for (let i = 0; i < memberIds.length; i += ID_CHUNK) {
    const slice = memberIds.slice(i, i + ID_CHUNK)
    const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.members, [
      Query.equal('$id', slice),
      Query.limit(ID_CHUNK),
    ])
    members.push(...res.documents.map((d) => memberDocToMember(d as never)))
  }

  // An inactive member is skipped, not refused. An admin ticking a hundred
  // names should not have the whole send fail because one of those people left
  // the church last month.
  let eligible = members.filter((m) => m.status === 'active')
  let excluded = 0
  const reasons: string[] = []

  /*
   * The audience, and the children.
   *
   * `narrowAudience` drops a Save Church child from EVERY audience, `all`
   * included, and says so. `sendToMembers` would drop them again silently —
   * that is the guarantee — but a count with no reason is a count the sender
   * reads as a bug, so the reason is attached here where it can reach the
   * screen. The `/sms` picker applies the same function so nobody is offered
   * a name the server is about to discard.
   */
  const narrowed = narrowAudience(eligible, audience)
  eligible = narrowed.kept
  excluded += narrowed.excluded
  if (narrowed.reason) reasons.push(narrowed.reason)

  /*
   * A BENMP reminder resolves its OWN recipients, and does not trust the ids it
   * was handed.
   *
   * The whole feature is "stop dunning people who have already paid", and a
   * list of ids is a snapshot of what one browser tab believed some minutes
   * ago. Between opening the page and pressing send, a treasurer at another
   * desk may have recorded half of them.
   *
   * SKIPPED, not refused. Refusing the batch means the other seventeen partners
   * do not get their reminder because one person paid while the tab was open;
   * skipping fails in the direction where nobody is dunned who should not be.
   * The count comes back in the response so the sender learns rather than
   * silently sending to fewer people than they picked.
   */
  if (body.category === 'benmp') {
    const period = currentPeriod()
    const paidRows = await contributionsForPeriod(databases, period)
    const before = eligible.length
    eligible = outstandingPartners(eligible, paidRows, period)
    const paidOrNotPartner = before - eligible.length
    excluded += paidOrNotPartner
    if (paidOrNotPartner > 0) {
      reasons.push(
        `${paidOrNotPartner} already paid for ${periodLabel(period)}, or are not BENMP partners`,
      )
    }

    /*
     * A head reminds their OWN constituency's partners.
     *
     * `canSendSmsCategory` decides WHAT a leader may send; it cannot express
     * WHO, so without this a category grant alone would let any head remind the
     * entire congregation. Resolved from `leaderScope()` per request and never
     * from anything the client sent.
     */
    if (auth.user.label === 'leader') {
      const scope = await leaderScope(databases, auth.user.id)
      const mine = new Set(scope.constituencies.map((c) => c.$id))
      const beforeScope = eligible.length
      eligible = eligible.filter(
        (m) => m.constituency_id !== null && mine.has(m.constituency_id),
      )
      const outOfScope = beforeScope - eligible.length
      if (outOfScope > 0) {
        excluded += outOfScope
        reasons.push(`${outOfScope} are not in a constituency you head`)
      }
    }
  }

  /*
   * A thank-you sent BY HAND — an admin re-running the Sunday 14:00 job that
   * did not fire — still gets its wording from the attendance rows, never from
   * the request. `{{services_attended}}` is a fact about who was in the
   * building, and the only source for it is the day report; a member the
   * report does not show at First or Second Service is dropped with a reason,
   * because there is no true sentence to send them.
   *
   * Track B is adding a `save` status for children marked at Save Church.
   * Anything other than first/second/both is treated as "not an adult
   * attendee" — the children are already gone by this point, and an unknown
   * status must fail towards not texting.
   */
  const extrasByMember = new Map<string, Record<string, string>>()
  if (body.category === 'attendance_thanks') {
    const report = await buildDayReport(databases, todayInAccra())
    const status = new Map(report.rows.map((r) => [r.member.$id, r.status as string]))
    const before = eligible.length
    eligible = eligible.filter((m) => {
      const s = status.get(m.$id)
      if (s !== 'first' && s !== 'second' && s !== 'both') return false
      extrasByMember.set(m.$id, {
        services_attended: servicesAttendedText(s as ServicesAttended),
      })
      return true
    })
    const notPresent = before - eligible.length
    if (notPresent > 0) {
      excluded += notPresent
      reasons.push(`${notPresent} ${notPresent === 1 ? 'was' : 'were'} not marked present today`)
    }
  }

  const targets: SendTarget[] = eligible.map((member) => ({
    member,
    template,
    extras: extrasByMember.get(member.$id),
  }))

  if (targets.length === 0) {
    return bad(
      body.category === 'benmp'
        ? `Nobody to remind — everyone you picked has already paid for ${periodLabel(currentPeriod())}, or is not a BENMP partner you can reach.`
        : body.category === 'attendance_thanks'
          ? 'Nobody to thank — none of the members you picked was marked present at First or Second Service today.'
          : reasons.length > 0
            ? `Nobody to send to — ${reasons.join('; ')}.`
            : 'None of those members are active.',
    )
  }

  try {
    const report = await sendToMembers(databases, sms, targets, {
      category: body.category,
      sentBy: auth.user.email,
      runDate: todayInAccra(),
      automatic: false,
    })
    return NextResponse.json<SendSmsResponse>({
      ok: true,
      sent: report.sent,
      failed: report.failed,
      skipped: report.skipped,
      excluded,
      excluded_reason: excluded > 0 ? reasons.join('; ') : undefined,
      no_phone: report.no_phone,
      provider_message: report.provider_message,
      credit_left: report.credit_left,
    })
  } catch (err) {
    // `sendToMembers` throws only when a template cannot render, which is an
    // admin-fixable mistake and worth naming precisely.
    return bad(err instanceof Error ? err.message : 'The send failed.')
  }
}

function bad(error: string, status = 400) {
  return NextResponse.json<SendSmsResponse>({ ok: false, error }, { status })
}
