import 'server-only'

// Templates, and the act of sending.
//
// The ordering in `sendToMembers` is the part to read carefully: every message
// is CLAIMED in the database before the provider is called, so a retried cron
// collides on the unique index instead of texting somebody twice. Same
// principle as `notification_runs` (CLAUDE.md) — the guarantee is the INSERT,
// not the check in front of it.

import { ID, Query, type Databases, type Models } from 'node-appwrite'
import { COLLECTIONS, DATABASE_ID, type SmsCategory } from '@/lib/appwrite/config'
import { fullName, type Member } from '@/lib/members/types'
import { render, toProviderNumber } from './render'
import type { SmsService } from './mnotify'
import type {
  SmsMessage,
  SmsSendOutcome,
  SmsTemplate,
  SmsTemplateInput,
} from './types'

type Doc = Models.Document & Record<string, unknown>

const PAGE = 100

export function templateDocTo(d: Doc): SmsTemplate {
  return {
    $id: d.$id,
    name: String(d.name ?? ''),
    category: String(d.category ?? 'general') as SmsCategory,
    body: String(d.body ?? ''),
    is_default: Boolean(d.is_default),
    sort_order: Number(d.sort_order ?? 0),
    created_by: (d.created_by as string | null) || null,
    $createdAt: d.$createdAt,
    $updatedAt: d.$updatedAt,
  }
}

export function messageDocTo(d: Doc): SmsMessage {
  return {
    $id: d.$id,
    member_id: String(d.member_id ?? ''),
    phone: String(d.phone ?? ''),
    body: String(d.body ?? ''),
    category: String(d.category ?? 'general') as SmsCategory,
    template_id: (d.template_id as string | null) || null,
    status: (d.status as SmsMessage['status']) ?? 'failed',
    provider_message: (d.provider_message as string | null) || null,
    sent_at: String(d.sent_at ?? ''),
    run_date: String(d.run_date ?? ''),
    sent_by: (d.sent_by as string | null) || null,
    $createdAt: d.$createdAt,
  }
}

// --- templates --------------------------------------------------------------

export async function listTemplates(
  databases: Databases,
  category?: SmsCategory,
): Promise<SmsTemplate[]> {
  const q = [Query.limit(PAGE), Query.orderAsc('sort_order')]
  if (category) q.unshift(Query.equal('category', category))
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.sms_templates, q)
  return res.documents.map((d) => templateDocTo(d as Doc))
}

export async function getTemplate(
  databases: Databases,
  id: string,
): Promise<SmsTemplate | null> {
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.sms_templates, id)
    return templateDocTo(doc as Doc)
  } catch {
    return null
  }
}

/** Case- and whitespace-insensitive, and scoped to the CATEGORY: a "Standard"
 *  birthday message and a "Standard" tithe message are two different things
 *  the church genuinely wants. Same shape and same reasoning as
 *  `bacentaNameTaken` — deliberately not an index, because an index compares
 *  bytes and a human comparing names does not. */
export async function templateNameTaken(
  databases: Databases,
  category: SmsCategory,
  name: string,
  exceptId?: string,
): Promise<SmsTemplate | null> {
  const key = name.trim().replace(/\s+/g, ' ').toLowerCase()
  const existing = await listTemplates(databases, category)
  // Returns the CLASHING template rather than a boolean so the refusal can
  // name what already exists. Echoing back what the admin just typed tells
  // them nothing they did not know; naming the other template tells them
  // whether they meant to edit it.
  return (
    existing.find(
      (t) => t.$id !== exceptId && t.name.trim().replace(/\s+/g, ' ').toLowerCase() === key,
    ) ?? null
  )
}

/**
 * Make `keepId` the only default in its category.
 *
 * Two defaults is not a tidiness problem — it is a coin toss over which
 * message the congregation receives, resolved differently depending on which
 * row Appwrite happens to return first.
 */
async function clearOtherDefaults(
  databases: Databases,
  category: SmsCategory,
  keepId: string | null,
): Promise<void> {
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.sms_templates, [
    Query.equal('category', category),
    Query.equal('is_default', true),
    Query.limit(PAGE),
  ])
  await Promise.all(
    res.documents
      .filter((d) => d.$id !== keepId)
      .map((d) =>
        databases.updateDocument(DATABASE_ID, COLLECTIONS.sms_templates, d.$id, {
          is_default: false,
        }),
      ),
  )
}

export async function createTemplate(
  databases: Databases,
  input: SmsTemplateInput,
  createdBy: string,
): Promise<SmsTemplate> {
  const existing = await listTemplates(databases, input.category)
  // The first template in a category is the default whether or not the admin
  // ticked the box. A category whose only template is not the default is a
  // category the automatic birthday run cannot send from, and the reason would
  // be invisible on screen.
  const isDefault = input.is_default === true || existing.length === 0

  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.sms_templates,
    ID.unique(),
    {
      name: input.name.trim().replace(/\s+/g, ' '),
      category: input.category,
      body: input.body,
      is_default: isDefault,
      sort_order: existing.length,
      created_by: createdBy,
    },
  )
  if (isDefault) await clearOtherDefaults(databases, input.category, doc.$id)
  return templateDocTo(doc as Doc)
}

export async function updateTemplate(
  databases: Databases,
  id: string,
  fields: Partial<SmsTemplateInput>,
): Promise<SmsTemplate> {
  const patch: Record<string, unknown> = {}
  if (fields.name !== undefined) patch.name = fields.name.trim().replace(/\s+/g, ' ')
  if (fields.body !== undefined) patch.body = fields.body
  if (fields.is_default !== undefined) patch.is_default = fields.is_default

  const doc = await databases.updateDocument(DATABASE_ID, COLLECTIONS.sms_templates, id, patch)
  const template = templateDocTo(doc as Doc)
  if (fields.is_default === true) {
    await clearOtherDefaults(databases, template.category, id)
  }
  return template
}

/**
 * Delete a template, and make sure the category still has a default.
 *
 * Deleting the default silently would leave the automatic birthday run with
 * nothing to send and no error until the next birthday — so the next template
 * in order is promoted. Members pointing at the deleted template fall back to
 * the category default by the same resolution order, so no member is left
 * unreachable.
 */
export async function deleteTemplate(databases: Databases, id: string): Promise<void> {
  const template = await getTemplate(databases, id)
  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.sms_templates, id)
  if (!template?.is_default) return

  const remaining = await listTemplates(databases, template.category)
  const next = remaining.find((t) => t.$id !== id)
  if (next) {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.sms_templates, next.$id, {
      is_default: true,
    })
  }
}

export async function defaultTemplate(
  databases: Databases,
  category: SmsCategory,
): Promise<SmsTemplate | null> {
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.sms_templates, [
    Query.equal('category', category),
    Query.equal('is_default', true),
    Query.limit(1),
  ])
  if (res.documents.length > 0) return templateDocTo(res.documents[0] as Doc)
  // No default flagged — fall back to the first template rather than refusing.
  // A category with templates in it can always send something; a category with
  // none genuinely cannot, and that is the case the caller must handle.
  const any = await listTemplates(databases, category)
  return any[0] ?? null
}

/**
 * Which birthday message THIS member gets.
 *
 * Order: the member's own override, then the category default. A member whose
 * override points at a template somebody has since deleted falls through to
 * the default rather than being skipped — the church would rather send the
 * standard wording than nothing at all on somebody's birthday.
 */
export async function resolveBirthdayTemplate(
  databases: Databases,
  member: { sms_template_id?: string | null },
): Promise<SmsTemplate | null> {
  if (member.sms_template_id) {
    const own = await getTemplate(databases, member.sms_template_id)
    if (own && own.category === 'birthday') return own
  }
  return defaultTemplate(databases, 'birthday')
}

// --- sending ----------------------------------------------------------------

export type SendTarget = {
  member: Member & { sms_template_id?: string | null }
  template: SmsTemplate
}

export type SendReport = {
  sent: number
  failed: number
  skipped: number
  no_phone: string[]
  provider_message: string | null
  /**
   * What the provider said was left after the last batch it accepted.
   *
   * This arrives free on the send response, so recording it costs nothing and
   * gives the church a balance reading at the one moment they are certainly
   * looking: just after spending. Null when mNotify omitted it, when the send
   * never reached them, or when nothing was sent — deliberately not 0, which
   * is a real balance and the worst possible thing to report by accident.
   *
   * When a send fans out into several batches (one per distinct message text)
   * the LAST figure wins, because that is the most recent truth.
   */
  credit_left: number | null
}

/** `birthday:<member>:<date>` collides on a retry and writes nothing.
 *  `manual:<random>` never collides, because thanking the same member for
 *  tithe twice in one day is a legitimate thing an admin may do. */
export function dedupeKey(
  category: SmsCategory,
  memberId: string,
  runDate: string,
  automatic: boolean,
): string {
  return automatic
    ? `${category}:${memberId}:${runDate}`
    : `manual:${ID.unique()}:${memberId}`
}

/**
 * Render, claim, send, record.
 *
 * The order is the design:
 *
 *   1. render everything first, so a broken template fails before anything is
 *      claimed or charged;
 *   2. CLAIM each message by inserting its row — a 409 here is the dedupe
 *      index refusing a duplicate, and is reported as `skipped`, not an error;
 *   3. group by identical text, because mNotify's quick endpoint takes many
 *      recipients and ONE message. A tithe thank-you with no placeholders is
 *      then one API call for two hundred members instead of two hundred;
 *   4. update each claimed row with what the provider actually said.
 *
 * A claim whose send never happened is left as `failed` with the reason on it,
 * not deleted: "we tried to text you and it did not work" is a fact the church
 * needs to be able to look up, and a deleted row would also free the dedupe key
 * for a retry that texts a member who may well have received the first one.
 */
export async function sendToMembers(
  databases: Databases,
  sms: SmsService,
  targets: SendTarget[],
  opts: { category: SmsCategory; sentBy: string; runDate: string; automatic: boolean },
): Promise<SendReport> {
  const report: SendReport = {
    sent: 0,
    failed: 0,
    skipped: 0,
    no_phone: [],
    provider_message: null,
    credit_left: null,
  }
  if (targets.length === 0) return report

  type Claimed = { docId: string; phone: string; text: string; memberId: string }
  const claimed: Claimed[] = []

  for (const { member, template } of targets) {
    const rendered = render(template.body, member)
    if (!rendered.ok) {
      // A template the system cannot render is an admin-fixable mistake, and
      // failing the whole batch on it is right: sending half a congregation a
      // message and refusing the rest is harder to reason about than sending
      // none.
      throw new Error(`${template.name}: ${rendered.error}`)
    }

    const phone = toProviderNumber(member.whatsapp_number || member.call_number)
    if (!phone) {
      report.no_phone.push(fullName(member))
      continue
    }

    const now = new Date().toISOString()
    try {
      const doc = await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.sms_messages,
        ID.unique(),
        {
          member_id: member.$id,
          phone,
          body: rendered.text,
          category: opts.category,
          template_id: template.$id,
          // Pessimistic until the provider says otherwise. A crash between the
          // claim and the send leaves an honest "failed", never a "sent" for a
          // message that never left.
          status: 'failed',
          provider_message: 'Claimed, not yet handed to mNotify.',
          sent_at: now,
          run_date: opts.runDate,
          sent_by: opts.sentBy,
          dedupe_key: dedupeKey(opts.category, member.$id, opts.runDate, opts.automatic),
        },
      )
      claimed.push({ docId: doc.$id, phone, text: rendered.text, memberId: member.$id })
    } catch (err) {
      if ((err as { code?: number }).code === 409) {
        // The unique index doing exactly its job — this member has already
        // been texted for this category today.
        report.skipped++
        continue
      }
      throw err
    }
  }

  if (claimed.length === 0) return report

  // Identical text goes in one call. mNotify bills per message, not per call,
  // so this is about rate limits and latency rather than cost.
  const byText = new Map<string, Claimed[]>()
  for (const c of claimed) {
    byText.set(c.text, [...(byText.get(c.text) ?? []), c])
  }

  const messages: string[] = []
  for (const [text, group] of byText) {
    const outcome: SmsSendOutcome = await sms.send(
      group.map((g) => g.phone),
      text,
    )
    messages.push(outcome.provider_message)

    if (outcome.kind === 'sent') {
      // Kept only when the provider actually gave a figure, so a batch that
      // omits it cannot erase one an earlier batch reported.
      if (outcome.credit_left !== null) report.credit_left = outcome.credit_left
      const rejected = new Set(outcome.rejected)
      for (const c of group) {
        const ok = !rejected.has(c.phone)
        if (ok) report.sent++
        else report.failed++
        await databases
          .updateDocument(DATABASE_ID, COLLECTIONS.sms_messages, c.docId, {
            status: ok ? 'sent' : 'failed',
            provider_message: (ok
              ? outcome.provider_message
              : `mNotify rejected this number. ${outcome.provider_message}`
            ).slice(0, 512),
          })
          .catch(() => {
            // Bookkeeping. The message did go out; failing to stamp the row
            // must not turn a delivered SMS into a reported failure.
          })
      }
    } else {
      report.failed += group.length
      for (const c of group) {
        await databases
          .updateDocument(DATABASE_ID, COLLECTIONS.sms_messages, c.docId, {
            status: 'failed',
            provider_message: outcome.provider_message.slice(0, 512),
          })
          .catch(() => {})
      }
    }
  }

  report.provider_message = [...new Set(messages)].join(' · ').slice(0, 512)
  return report
}

// --- the log ----------------------------------------------------------------

export async function listSmsLog(
  databases: Databases,
  opts: { category?: SmsCategory; memberId?: string; limit?: number } = {},
): Promise<{ messages: SmsMessage[]; total: number }> {
  const q = [Query.limit(Math.min(opts.limit ?? 50, PAGE)), Query.orderDesc('$createdAt')]
  if (opts.category) q.unshift(Query.equal('category', opts.category))
  if (opts.memberId) q.unshift(Query.equal('member_id', opts.memberId))
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.sms_messages, q)
  return { messages: res.documents.map((d) => messageDocTo(d as Doc)), total: res.total }
}

/** Every `sms_messages` row for a member, so deleting one cascades properly.
 *  Cascades are manual here (CLAUDE.md) and this is the SMS half of it. */
export async function purgeMemberMessages(
  databases: Databases,
  memberId: string,
): Promise<number> {
  let removed = 0
  for (;;) {
    const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.sms_messages, [
      Query.equal('member_id', memberId),
      Query.limit(PAGE),
    ])
    if (res.documents.length === 0) break
    await Promise.all(
      res.documents.map((d) =>
        databases.deleteDocument(DATABASE_ID, COLLECTIONS.sms_messages, d.$id),
      ),
    )
    removed += res.documents.length
    if (res.documents.length < PAGE) break
  }
  return removed
}
