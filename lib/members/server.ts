import 'server-only'

// Member registry reads/writes. Validation lives here rather than in the route
// so the same rules apply to a script or a future import path.

import { ID, Query, type Databases, type Models } from 'node-appwrite'
import { COLLECTIONS, DATABASE_ID, type ServiceSlot } from '@/lib/appwrite/config'
import { fullName, type Member, type MemberInput, type MemberStatus } from './types'
import { memberDocToMember } from '@/lib/attendance/server'

const PAGE = 100

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Ghanaian numbers arrive as `024 123 4567`, `+233 24 123 4567`, `233241234567`
 * and every spacing in between. Normalise to `+233…` so a lookup by number
 * works regardless of how it was typed, and so the same person entered twice by
 * two different admins is detectably the same person.
 *
 * Anything already carrying a `+` is left alone apart from spacing — the church
 * has members abroad and this must not mangle a UK or US number.
 */
export function normalisePhone(raw: string): string {
  const trimmed = raw.replace(/[\s()\-.]/g, '')
  if (trimmed.startsWith('+')) return trimmed
  if (trimmed.startsWith('00')) return `+${trimmed.slice(2)}`
  if (trimmed.startsWith('0')) return `+233${trimmed.slice(1)}`
  if (trimmed.startsWith('233')) return `+${trimmed}`
  return trimmed
}

/** Loose on purpose: 7-15 digits after an optional `+`. Tight enough to catch a
 *  typo, loose enough not to reject a legitimate foreign number. */
function isPlausiblePhone(v: string): boolean {
  return /^\+?\d{7,15}$/.test(v)
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export function validateMemberInput(
  body: Partial<MemberInput>,
  opts: { partial?: boolean } = {},
): ValidationResult<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  const need = !opts.partial

  const first = typeof body.first_name === 'string' ? body.first_name.trim() : undefined
  const last = typeof body.last_name === 'string' ? body.last_name.trim() : undefined

  if (need || first !== undefined) {
    if (!first) return { ok: false, error: 'First name is required.' }
    if (first.length > 64) return { ok: false, error: 'First name is too long (max 64).' }
    out.first_name = first
  }
  if (need || last !== undefined) {
    if (!last) return { ok: false, error: 'Last name is required.' }
    if (last.length > 64) return { ok: false, error: 'Last name is too long (max 64).' }
    out.last_name = last
  }
  if (body.other_names !== undefined) {
    const other = typeof body.other_names === 'string' ? body.other_names.trim() : ''
    if (other.length > 96) return { ok: false, error: 'Other names are too long (max 96).' }
    out.other_names = other || null
  }

  // Call number is the one contact field the church insists on (PRD §1.1).
  if (need || body.call_number !== undefined) {
    const call = typeof body.call_number === 'string' ? normalisePhone(body.call_number) : ''
    if (!call) return { ok: false, error: 'A call number is required.' }
    if (!isPlausiblePhone(call)) {
      return { ok: false, error: `"${body.call_number}" does not look like a phone number.` }
    }
    out.call_number = call
  }

  // WhatsApp is optional and independent — many members use one number for
  // both, some do not, and inferring one from the other loses that.
  if (body.whatsapp_number !== undefined) {
    const raw = typeof body.whatsapp_number === 'string' ? body.whatsapp_number.trim() : ''
    if (raw === '') {
      out.whatsapp_number = null
    } else {
      const wa = normalisePhone(raw)
      if (!isPlausiblePhone(wa)) {
        return { ok: false, error: `"${raw}" does not look like a phone number.` }
      }
      out.whatsapp_number = wa
    }
  }

  // Birthday: month and day, never a year.
  const monthGiven = body.birth_month !== undefined && body.birth_month !== null
  const dayGiven = body.birth_day !== undefined && body.birth_day !== null
  if (monthGiven || dayGiven) {
    if (!monthGiven || !dayGiven) {
      return { ok: false, error: 'Give both the birth month and the day, or neither.' }
    }
    const m = Number(body.birth_month)
    const d = Number(body.birth_day)
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      return { ok: false, error: 'Birth month must be between 1 and 12.' }
    }
    // 29 February is a real birthday and must be accepted — there is no year
    // here to make it invalid.
    if (!Number.isInteger(d) || d < 1 || d > DAYS_IN_MONTH[m - 1]) {
      return { ok: false, error: `Birth day must be between 1 and ${DAYS_IN_MONTH[m - 1]}.` }
    }
    out.birth_month = m
    out.birth_day = d
  } else if (body.birth_month === null || body.birth_day === null) {
    out.birth_month = null
    out.birth_day = null
  }

  if (body.address !== undefined) {
    const addr = typeof body.address === 'string' ? body.address.trim() : ''
    if (addr.length > 256) return { ok: false, error: 'Address is too long (max 256).' }
    out.address = addr || null
  }

  if (body.home_service !== undefined) {
    if (body.home_service !== 'first' && body.home_service !== 'second') {
      return { ok: false, error: 'home_service must be "first" or "second".' }
    }
    out.home_service = body.home_service as ServiceSlot
  } else if (need) {
    out.home_service = 'second'
  }

  // Where the member lives. Optional even on create: the four constituencies
  // were introduced after the congregation was already registered, and
  // refusing a registration for want of one would block the front desk. That
  // the id NAMES a real constituency is checked in the route, which has a
  // database handle; this only checks the shape.
  if (body.constituency_id !== undefined) {
    if (body.constituency_id === null || body.constituency_id === '') {
      out.constituency_id = null
    } else if (typeof body.constituency_id !== 'string' || body.constituency_id.length > 64) {
      return { ok: false, error: 'That constituency is not valid.' }
    } else {
      out.constituency_id = body.constituency_id
    }
  } else if (need) {
    out.constituency_id = null
  }

  // The per-member birthday-message override. `null` clears it back to the
  // category default; omitting the key leaves it alone — the same `undefined`
  // vs `null` distinction `bacenta_ids` relies on, and for the same reason: a
  // PATCH correcting a phone number must not silently reset which birthday
  // message somebody gets.
  if (body.sms_template_id !== undefined) {
    if (body.sms_template_id === null || body.sms_template_id === '') {
      out.sms_template_id = null
    } else if (
      typeof body.sms_template_id !== 'string' ||
      body.sms_template_id.length > 64
    ) {
      return { ok: false, error: 'That birthday message is not valid.' }
    } else {
      out.sms_template_id = body.sms_template_id
    }
  } else if (need) {
    out.sms_template_id = null
  }

  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'inactive') {
      return { ok: false, error: 'status must be "active" or "inactive".' }
    }
    out.status = body.status as MemberStatus
  } else if (need) {
    out.status = 'active'
  }

  return { ok: true, value: out }
}

/**
 * Pull `bacenta_ids` out of a request body.
 *
 * Kept apart from `validateMemberInput` because it is NOT a member column —
 * bacenta membership is many-to-many and lands in `bacenta_members` after the
 * member row is written. Returning `undefined` for an absent key is
 * load-bearing: a PATCH that never mentions bacentas must leave them alone,
 * while an explicit `[]` clears them.
 */
export function readBacentaIds(body: unknown): string[] | undefined {
  const raw = (body as { bacenta_ids?: unknown } | null)?.bacenta_ids
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0))]
}

/** Recompute the denormalised search field whenever a name part changes. */
function withFullName(
  fields: Record<string, unknown>,
  existing?: Member,
): Record<string, unknown> {
  const touchesName =
    'first_name' in fields || 'last_name' in fields || 'other_names' in fields
  if (!touchesName) return fields
  return {
    ...fields,
    full_name: fullName({
      first_name: (fields.first_name as string) ?? existing?.first_name ?? '',
      other_names: (fields.other_names as string | null) ?? existing?.other_names ?? null,
      last_name: (fields.last_name as string) ?? existing?.last_name ?? '',
    }),
  }
}

export async function createMember(
  databases: Databases,
  fields: Record<string, unknown>,
  createdBy: string,
): Promise<Member> {
  const doc = await databases.createDocument(DATABASE_ID, COLLECTIONS.members, ID.unique(), {
    ...withFullName(fields),
    other_names: fields.other_names ?? null,
    photo_file_id: null,
    birth_month: fields.birth_month ?? null,
    birth_day: fields.birth_day ?? null,
    address: fields.address ?? null,
    whatsapp_number: fields.whatsapp_number ?? null,
    constituency_id: fields.constituency_id ?? null,
    sms_template_id: fields.sms_template_id ?? null,
    created_by: createdBy,
  })
  return memberDocToMember(doc as Models.Document & Record<string, unknown>)
}

export async function updateMember(
  databases: Databases,
  id: string,
  fields: Record<string, unknown>,
): Promise<Member> {
  const existing = memberDocToMember(
    (await databases.getDocument(DATABASE_ID, COLLECTIONS.members, id)) as Models.Document &
      Record<string, unknown>,
  )
  const doc = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.members,
    id,
    withFullName(fields, existing),
  )
  return memberDocToMember(doc as Models.Document & Record<string, unknown>)
}

export async function listMembers(
  databases: Databases,
  filters: { search?: string; status?: string; constituencyId?: string } = {},
): Promise<Member[]> {
  const base: string[] = []
  if (filters.status === 'active' || filters.status === 'inactive') {
    base.push(Query.equal('status', filters.status))
  }
  // Pushed to the server rather than filtered in memory: a constituency head's
  // whole view is this one query, and shipping the entire registry to filter
  // four hundred people out of it is the difference between a page that opens
  // and one that times out.
  if (filters.constituencyId) {
    base.push(Query.equal('constituency_id', filters.constituencyId))
  }
  if (filters.search && filters.search.trim().length >= 2) {
    base.push(Query.search('full_name', filters.search.trim()))
  }

  const out: Member[] = []
  let cursor: string | null = null
  for (;;) {
    const q = [...base, Query.orderAsc('last_name'), Query.limit(PAGE)]
    if (cursor) q.push(Query.cursorAfter(cursor))
    const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.members, q)
    out.push(
      ...res.documents.map((d) => memberDocToMember(d as Models.Document & Record<string, unknown>)),
    )
    if (res.documents.length < PAGE) break
    cursor = res.documents[res.documents.length - 1].$id
  }
  return out
}

/**
 * Delete a member and everything that references them.
 *
 * Appwrite has no foreign keys and no cascade, so this is the cascade. Order
 * matters: templates first, because a member whose row is gone but whose
 * fingerprints remain is a member the matcher can still "identify" into a
 * dangling id.
 */
export async function deleteMemberCascade(
  databases: Databases,
  id: string,
): Promise<{
  templates: number
  roster: number
  records: number
  bacentas: number
  messages: number
}> {
  const dbAny = databases as unknown as {
    deleteDocuments?: (db: string, coll: string, queries?: string[]) => Promise<unknown>
  }

  const purge = async (collection: string, field: string): Promise<number> => {
    if (typeof dbAny.deleteDocuments === 'function') {
      const res = (await dbAny.deleteDocuments(DATABASE_ID, collection, [
        Query.equal(field, id),
      ])) as { total?: number } | undefined
      return typeof res?.total === 'number' ? res.total : 0
    }
    let removed = 0
    for (;;) {
      const page = await databases.listDocuments(DATABASE_ID, collection, [
        Query.equal(field, id),
        Query.limit(PAGE),
      ])
      if (page.documents.length === 0) break
      await Promise.all(
        page.documents.map((d) => databases.deleteDocument(DATABASE_ID, collection, d.$id)),
      )
      removed += page.documents.length
      if (page.documents.length < PAGE) break
    }
    return removed
  }

  const templates = await purge(COLLECTIONS.biometric_templates, 'member_id')
  const roster = await purge(COLLECTIONS.meeting_members, 'member_id')
  // Bacenta membership is a join collection and Appwrite has no cascade, so a
  // skipped purge here leaves the choir's roster counting a person who no
  // longer exists. The constituency needs no equivalent — it is a field ON the
  // member document, and goes when the document does.
  const bacentas = await purge(COLLECTIONS.bacenta_members, 'member_id')
  // Attendance history is deleted last and deliberately: it is the only one of
  // the three whose loss changes a past count, so if an earlier step fails the
  // history is still intact.
  const records = await purge(COLLECTIONS.attendance_records, 'member_id')
  // The SMS log. Left behind, these rows keep a deleted member's phone number
  // and the text of everything ever sent to them — which is the kind of thing
  // a church deleting somebody at their own request means to be rid of.
  const messages = await purge(COLLECTIONS.sms_messages, 'member_id')

  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.members, id)
  return { templates, roster, records, bacentas, messages }
}
