import 'server-only'

// Member registry reads/writes. Validation lives here rather than in the route
// so the same rules apply to a script or a future import path.

import { ID, Query, type Databases, type Models } from 'node-appwrite'
import { CHURCH_TIMEZONE, COLLECTIONS, DATABASE_ID, type ServiceSlot } from '@/lib/appwrite/config'
import { fullName, type Member, type MemberInput, type MemberStatus } from './types'
import { memberDocToMember } from '@/lib/attendance/server'
import { nextMemberNo } from './numbering'
import { looksLikeMemberNo } from './search'
import { releaseCharges } from '@/lib/groups/server'
import { isMemberTitle } from './titles'

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
  /*
   * Title. Refused rather than coerced when it is not one of ours — the same
   * posture as `benmp_partner`. An unrecognised code stored here would either
   * render as nothing (silently demoting a Reverend in a message the church
   * paid to send) or render raw. Neither is something to learn about from the
   * congregation.
   *
   * `null` and `''` are real, ordinary values and clear the title.
   */
  if (body.title !== undefined) {
    // Compared as `unknown`: the form sends '' for "no title" and the declared
    // input type does not admit it, so a narrow comparison would not compile
    // while the value still arrives at runtime.
    const rawTitle = body.title as unknown
    if (rawTitle === null || rawTitle === '') {
      out.title = null
    } else if (!isMemberTitle(rawTitle)) {
      return {
        ok: false,
        error: `"${String(rawTitle)}" is not a title the system knows. Choose one from the list.`,
      }
    } else {
      out.title = rawTitle
    }
  } else if (need) {
    out.title = null
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
  // vs `null` distinction `basonta_ids` relies on, and for the same reason: a
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

  // Where they live, one level down from the constituency. Same `undefined` vs
  // `null` rule: omitting leaves it alone, `null` takes them out of a bacenta.
  if (body.bacenta_id !== undefined) {
    if (body.bacenta_id === null || body.bacenta_id === '') {
      out.bacenta_id = null
    } else if (typeof body.bacenta_id !== 'string' || body.bacenta_id.length > 64) {
      return { ok: false, error: 'That bacenta is not valid.' }
    } else {
      out.bacenta_id = body.bacenta_id
    }
  } else if (need) {
    out.bacenta_id = null
  }

  // Who looks after them. Only the SHAPE is checked here — that the carer is
  // active, in the same bacenta, and does not close a loop is
  // `careAssignmentProblem`, which needs the other members and therefore a
  // database handle the route has and this does not.
  if (body.care_of_member_id !== undefined) {
    if (body.care_of_member_id === null || body.care_of_member_id === '') {
      out.care_of_member_id = null
    } else if (
      typeof body.care_of_member_id !== 'string' ||
      body.care_of_member_id.length > 64
    ) {
      return { ok: false, error: 'That member is not valid.' }
    } else {
      out.care_of_member_id = body.care_of_member_id
    }
  } else if (need) {
    out.care_of_member_id = null
  }

  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'inactive') {
      return { ok: false, error: 'status must be "active" or "inactive".' }
    }
    out.status = body.status as MemberStatus
  } else if (need) {
    out.status = 'active'
  }

  // BENMP Partner. Written explicitly on every create — never allowed to
  // acquire a default in the schema, because a defaulted boolean is one nobody
  // answered, and this one decides who the church pays to text each month.
  //
  // Anything that is not a boolean is REFUSED rather than coerced: `"false"`
  // arriving as a string from a hand-built request is truthy, and silently
  // coercing it would enrol somebody who was being taken off the list.
  if (body.benmp_partner !== undefined) {
    if (typeof body.benmp_partner !== 'boolean') {
      return { ok: false, error: 'benmp_partner must be true or false.' }
    }
    out.benmp_partner = body.benmp_partner
  } else if (need) {
    out.benmp_partner = false
  }

  return { ok: true, value: out }
}

/**
 * Pull `basonta_ids` out of a request body.
 *
 * Kept apart from `validateMemberInput` because it is NOT a member column —
 * bacenta membership is many-to-many and lands in `bacenta_members` after the
 * member row is written. Returning `undefined` for an absent key is
 * load-bearing: a PATCH that never mentions bacentas must leave them alone,
 * while an explicit `[]` clears them.
 */
export function readBasontaIds(body: unknown): string[] | undefined {
  const raw = (body as { basonta_ids?: unknown } | null)?.basonta_ids
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

/**
 * Every `member_no` already issued for `year`.
 *
 * `Query.select` keeps this to one small column, and the set is bounded by the
 * congregation's registrations in a single year. It is read fresh on every
 * allocation rather than cached: a cached maximum is precisely what would hand
 * two people the same number.
 */
async function issuedMemberNos(databases: Databases, year: number): Promise<string[]> {
  const out: string[] = []
  let cursor: string | null = null
  for (;;) {
    const q = [Query.select(['$id', 'member_no']), Query.limit(PAGE)]
    if (cursor) q.push(Query.cursorAfter(cursor))
    const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.members, q)
    for (const d of res.documents) {
      const value = (d as Models.Document & { member_no?: unknown }).member_no
      if (typeof value === 'string' && value.startsWith(String(year))) out.push(value)
    }
    if (res.documents.length < PAGE) break
    cursor = res.documents[res.documents.length - 1].$id
  }
  return out
}

/** Appwrite's code for "a unique index refused this". */
function isDuplicate(err: unknown): boolean {
  const e = err as { code?: number; type?: string } | null
  return e?.code === 409 || e?.type === 'document_already_exists'
}

/**
 * How many times to re-read and retry after losing a race. Five is far beyond
 * what a church registration desk can produce — the point is that the loop
 * TERMINATES, so a persistent 409 from some other cause surfaces as itself
 * rather than spinning.
 */
const ALLOCATION_ATTEMPTS = 5

export async function createMember(
  databases: Databases,
  fields: Record<string, unknown>,
  createdBy: string,
): Promise<Member> {
  /**
   * The member number is CLAIMED BY THE INSERT, not by a check.
   *
   * Read the highest issued, add one, and write it. If two registrations
   * compute the same number in the same moment, the unique index refuses the
   * second and we recompute — the database decides, which is the only thing
   * that can. A check-then-write would pass both times under exactly the
   * concurrency this exists to survive, and the two members would collide.
   *
   * Same rule as `notification_runs` and `sms_messages.dedupe_key`: the read in
   * front is a fast path, and the index is the guarantee.
   *
   * The number is settled HERE, when creation is triggered, and never reserved
   * by the form — a number handed out when a form opens is a number lost every
   * time somebody changes their mind and closes it.
   */
  const year = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: CHURCH_TIMEZONE, year: 'numeric' }).format(
      new Date(),
    ),
  )

  let lastError: unknown = null
  for (let attempt = 0; attempt < ALLOCATION_ATTEMPTS; attempt += 1) {
    const memberNo = nextMemberNo(await issuedMemberNos(databases, year), year)
    try {
      return await createMemberWithNumber(databases, fields, createdBy, memberNo)
    } catch (err) {
      if (!isDuplicate(err)) throw err
      lastError = err
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Could not allocate a member number. Try again.')
}

async function createMemberWithNumber(
  databases: Databases,
  fields: Record<string, unknown>,
  createdBy: string,
  memberNo: string,
): Promise<Member> {
  const doc = await databases.createDocument(DATABASE_ID, COLLECTIONS.members, ID.unique(), {
    ...withFullName(fields),
    member_no: memberNo,
    title: fields.title ?? null,
    other_names: fields.other_names ?? null,
    photo_file_id: null,
    birth_month: fields.birth_month ?? null,
    birth_day: fields.birth_day ?? null,
    address: fields.address ?? null,
    whatsapp_number: fields.whatsapp_number ?? null,
    constituency_id: fields.constituency_id ?? null,
    bacenta_id: fields.bacenta_id ?? null,
    care_of_member_id: fields.care_of_member_id ?? null,
    sms_template_id: fields.sms_template_id ?? null,
    // `?? false` and not `|| false`: both give false here, but `??` says the
    // intent — a create that omitted the key means "not a partner", and
    // `validateMemberInput` has already supplied it anyway.
    benmp_partner: fields.benmp_partner ?? false,
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
  filters: {
    search?: string
    status?: string
    constituencyId?: string
    homeService?: string
  } = {},
): Promise<Member[]> {
  const base: string[] = []
  if (filters.status === 'active' || filters.status === 'inactive') {
    base.push(Query.equal('status', filters.status))
  }
  // Which service the member usually attends. Validated HERE rather than at the
  // route, exactly as `status` above is: an unrecognised value is dropped and
  // the caller gets the whole registry, because a filter nobody can spell
  // should not be able to empty the page. It never gates attendance — a
  // member may be marked at either service regardless (PRD §2.1) — this is
  // only the registry asking to see one service at a time.
  if (filters.homeService === 'first' || filters.homeService === 'second') {
    base.push(Query.equal('home_service', filters.homeService))
  }
  // Pushed to the server rather than filtered in memory: a constituency head's
  // whole view is this one query, and shipping the entire registry to filter
  // four hundred people out of it is the difference between a page that opens
  // and one that times out.
  if (filters.constituencyId) {
    base.push(Query.equal('constituency_id', filters.constituencyId))
  }
  /**
   * Name OR member number, decided by `looksLikeMemberNo` — the same rule the
   * browser uses, so a search box and the server cannot disagree about what
   * was asked for.
   *
   * The number is a PREFIX match, so `2026` lists everyone registered this year
   * and `202600` narrows to the first nine. `full_name` is a fulltext search
   * against the `search_name` index; `member_no` cannot use one (a fulltext
   * index tokenises words, and `2026042` is one token that would only ever
   * match in full), so it uses the ordinary index behind `member_no_unique`.
   */
  const term = filters.search?.trim() ?? ''
  if (term.length >= 2) {
    base.push(
      looksLikeMemberNo(term)
        ? Query.startsWith('member_no', term)
        : Query.search('full_name', term),
    )
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
  basontas: number
  /** How many members were looked after by this one, and are now released. */
  released: number
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
  // Basonta membership is a join collection and Appwrite has no cascade, so a
  // skipped purge here leaves the choir's roster counting a person who no
  // longer exists.
  //
  // Neither `constituency_id` nor `bacenta_id` needs an equivalent: both are
  // fields ON the member document and go when the document does.
  const basontas = await purge(COLLECTIONS.basonta_members, 'member_id')
  // `care_of_member_id` DOES need one, and the difference is the whole reason
  // it is easy to miss: it is a field on SOMEBODY ELSE'S document. Skip this
  // and everyone the deleted member looked after is left pointing at a person
  // who is not there — invisible on screen, and wrong in the records.
  const released = await releaseCharges(databases, [id])
  // Attendance history is deleted last and deliberately: it is the only one of
  // the three whose loss changes a past count, so if an earlier step fails the
  // history is still intact.
  const records = await purge(COLLECTIONS.attendance_records, 'member_id')
  // The SMS log. Left behind, these rows keep a deleted member's phone number
  // and the text of everything ever sent to them — which is the kind of thing
  // a church deleting somebody at their own request means to be rid of.
  const messages = await purge(COLLECTIONS.sms_messages, 'member_id')

  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.members, id)
  return { templates, roster, records, basontas, released, messages }
}
