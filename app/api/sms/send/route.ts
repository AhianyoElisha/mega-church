import { NextResponse, type NextRequest } from 'next/server'
import { Query } from 'node-appwrite'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID, SMS_CATEGORIES, type SmsCategory } from '@/lib/appwrite/config'
import { memberDocToMember } from '@/lib/attendance/server'
import { todayInAccra } from '@/lib/attendance/occurrenceResolver'
import { createSmsService } from '@/lib/sms/mnotify'
import { getTemplate, sendToMembers, type SendTarget } from '@/lib/sms/server'
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
  const auth = await requireRole('admin')
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
  const targets: SendTarget[] = members
    .filter((m) => m.status === 'active')
    .map((member) => ({ member, template }))

  if (targets.length === 0) return bad('None of those members are active.')

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
      no_phone: report.no_phone,
      provider_message: report.provider_message,
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
