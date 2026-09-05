import { NextResponse, type NextRequest } from 'next/server'
import { Query } from 'node-appwrite'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID, SMS_CATEGORIES, type SmsCategory } from '@/lib/appwrite/config'
import { memberDocToMember } from '@/lib/attendance/server'
import { todayInAccra } from '@/lib/attendance/occurrenceResolver'
import { createSmsService } from '@/lib/sms/mnotify'
import { getTemplate, sendToMembers, type SendTarget } from '@/lib/sms/server'
import { canSendSmsCategory } from '@/lib/sms/permissions'
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

  let body: { member_ids?: unknown; template_id?: unknown; category?: unknown }
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
  let excludedReason = ''

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
    excluded = before - eligible.length
    excludedReason = `already paid for ${periodLabel(period)}, or are not BENMP partners`

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
        excludedReason = `already paid for ${periodLabel(period)}, are not BENMP partners, or are not in a constituency you head`
      }
    }
  }

  const targets: SendTarget[] = eligible.map((member) => ({ member, template }))

  if (targets.length === 0) {
    return bad(
      body.category === 'benmp'
        ? `Nobody to remind — everyone you picked has already paid for ${periodLabel(currentPeriod())}, or is not a BENMP partner you can reach.`
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
      excluded_reason: excluded > 0 ? excludedReason : undefined,
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
