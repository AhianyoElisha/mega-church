import 'server-only'

// Constituencies, bacentas, basontas, and who belongs to what.
//
// Different linkages live here and they are NOT symmetrical:
//
//   constituency  a FIELD on the member (`members.constituency_id`), because a
//                 member lives in exactly one place. Assigning is an update to
//                 the member rows, not an insert into a join table.
//   basonta       a JOIN collection (`basonta_members`), because a chorister
//                 may also run the sound desk and sing in a second choir.
//   bacenta       a PLACE under a constituency. Its membership becomes a field
//                 too, for the same reason a constituency's is — but that is
//                 the next change; today it is still the join below.
//
// Collapsing any of them into another's shape is the mistake this file exists
// to prevent, so each write path is written in the shape its data actually has.

import { ID, Query, type Databases, type Models } from 'node-appwrite'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import { diffMembership, normaliseName, validateGroupName } from './tree'
import { memberDocToMember } from '@/lib/attendance/server'
import { fullName, type Member } from '@/lib/members/types'
import type {
  Bacenta,
  BacentaCategory,
  BacentaWithCount,
  Basonta,
  BasontaCategory,
  BasontaWithCount,
  Constituency,
  ConstituencyWithCount,
  MembershipMode,
  MembershipResult,
} from './types'

const PAGE = 100
/** Appwrite rejects an over-long `Query.equal` array; chunk id lists at this. */
const ID_CHUNK = 100

type Doc = Models.Document & Record<string, unknown>

type BulkDatabases = {
  createDocuments: (db: string, col: string, docs: object[]) => Promise<unknown>
  updateDocuments?: (
    db: string,
    col: string,
    data: object,
    queries?: string[],
  ) => Promise<unknown>
}
const bulk = (db: Databases): BulkDatabases => db as unknown as BulkDatabases

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

// --- document mappers -------------------------------------------------------

export function constituencyDocTo(d: Doc): Constituency {
  return {
    $id: d.$id,
    name: String(d.name ?? ''),
    description: str(d.description),
    head_user_id: str(d.head_user_id),
    head_name: str(d.head_name),
    sort_order: typeof d.sort_order === 'number' ? d.sort_order : 100,
    created_by: str(d.created_by),
    $createdAt: d.$createdAt,
  }
}

export function categoryDocTo(d: Doc): BacentaCategory {
  return {
    $id: d.$id,
    name: String(d.name ?? ''),
    description: str(d.description),
    sort_order: typeof d.sort_order === 'number' ? d.sort_order : 100,
    created_by: str(d.created_by),
    $createdAt: d.$createdAt,
  }
}

export function bacentaDocTo(d: Doc): Bacenta {
  return {
    $id: d.$id,
    name: String(d.name ?? ''),
    // `?? null` and not `|| null`: both collapse the empty string, and empty
    // string is how Appwrite hands back an unset optional. Standalone.
    category_id: str(d.category_id),
    description: str(d.description),
    head_user_id: str(d.head_user_id),
    head_name: str(d.head_name),
    sort_order: typeof d.sort_order === 'number' ? d.sort_order : 100,
    created_by: str(d.created_by),
    $createdAt: d.$createdAt,
  }
}

// --- generic paging ---------------------------------------------------------

async function listAll(
  databases: Databases,
  collection: string,
  queries: string[] = [],
): Promise<Doc[]> {
  const out: Doc[] = []
  let cursor: string | null = null
  for (;;) {
    const q = [...queries, Query.limit(PAGE)]
    if (cursor) q.push(Query.cursorAfter(cursor))
    const res = await databases.listDocuments(DATABASE_ID, collection, q)
    out.push(...(res.documents as Doc[]))
    if (res.documents.length < PAGE) break
    cursor = res.documents[res.documents.length - 1].$id
  }
  return out
}

// --- constituencies ---------------------------------------------------------

export async function listConstituencies(databases: Databases): Promise<Constituency[]> {
  const docs = await listAll(databases, COLLECTIONS.constituencies, [Query.orderAsc('sort_order')])
  return docs.map(constituencyDocTo)
}

export async function getConstituency(
  databases: Databases,
  id: string,
): Promise<Constituency | null> {
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.constituencies, id)
    return constituencyDocTo(doc as Doc)
  } catch {
    return null
  }
}

/**
 * How many members each constituency holds, in one pass over the registry.
 *
 * `Query.select` keeps the payload to two fields — the count of a 3,000-member
 * church is otherwise three thousand full member documents crossing the wire to
 * produce four integers.
 */
export async function constituencyCounts(databases: Databases): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const docs = await listAll(databases, COLLECTIONS.members, [
    Query.select(['$id', 'constituency_id']),
  ])
  for (const d of docs) {
    const cid = str(d.constituency_id)
    if (cid) counts.set(cid, (counts.get(cid) ?? 0) + 1)
  }
  return counts
}

export async function listConstituenciesWithCounts(
  databases: Databases,
): Promise<ConstituencyWithCount[]> {
  const [rows, counts] = await Promise.all([
    listConstituencies(databases),
    constituencyCounts(databases),
  ])
  return rows.map((c) => ({ ...c, member_count: counts.get(c.$id) ?? 0 }))
}

export async function createConstituency(
  databases: Databases,
  input: { name: string; description?: string | null; head_user_id?: string | null; head_name?: string | null },
  createdBy: string,
): Promise<Constituency> {
  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.constituencies,
    ID.unique(),
    {
      name: input.name,
      description: input.description ?? null,
      head_user_id: input.head_user_id ?? null,
      head_name: input.head_name ?? null,
      sort_order: 100,
      created_by: createdBy,
    },
  )
  return constituencyDocTo(doc as Doc)
}

export async function updateConstituency(
  databases: Databases,
  id: string,
  fields: Record<string, unknown>,
): Promise<Constituency> {
  const doc = await databases.updateDocument(DATABASE_ID, COLLECTIONS.constituencies, id, fields)
  return constituencyDocTo(doc as Doc)
}

/**
 * Delete a constituency, first clearing it off every member who lives in it.
 *
 * The members are NOT deleted — obviously — but leaving `constituency_id`
 * pointing at a row that no longer exists gives every one of them a home that
 * renders as blank in some places and as a raw id in others. Clearing first
 * means the worst case is "no constituency yet", which the UI already handles.
 */
export async function deleteConstituencyCascade(
  databases: Databases,
  id: string,
): Promise<{ cleared: number }> {
  const cleared = await assignConstituency(databases, id, { mode: 'clear-all' })
  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.constituencies, id)
  return { cleared }
}

/**
 * Bulk-assign members to a constituency — the whole point of the group-select
 * screen: tick eighty people who were registered before constituencies existed
 * and file them in one action.
 *
 * Written through the bulk `updateDocuments` API where the SDK has it, falling
 * back to a bounded parallel loop where it does not. Either way it is chunked:
 * a `Query.equal('$id', [...])` with 800 ids in it is rejected by the server,
 * and the failure mode is the whole assignment silently doing nothing.
 */
export async function assignConstituency(
  databases: Databases,
  constituencyId: string,
  opts:
    | { mode: 'assign'; memberIds: string[]; onlyUnassigned?: boolean }
    | { mode: 'unassign'; memberIds: string[] }
    | { mode: 'clear-all' },
): Promise<number> {
  let ids: string[]
  let value: string | null

  if (opts.mode === 'clear-all') {
    const docs = await listAll(databases, COLLECTIONS.members, [
      Query.select(['$id']),
      Query.equal('constituency_id', constituencyId),
    ])
    ids = docs.map((d) => d.$id)
    value = null
  } else {
    ids = [...new Set(opts.memberIds)]
    value = opts.mode === 'assign' ? constituencyId : null
  }
  if (ids.length === 0) return 0

  /**
   * The rule that makes this route safe for a group HEAD to call.
   *
   * A constituency is a field on the member, so "assign" is really "overwrite
   * where this person lives". An admin may do that — moving somebody between
   * constituencies is a real correction. A head must not: their own list would
   * otherwise be a lever for pulling members out of a neighbouring
   * constituency, and the neighbouring head would watch their roster shrink
   * with nothing on screen to explain it.
   *
   * The filter lives HERE, next to the write, rather than in the route. A
   * future second caller that forgets it would reintroduce exactly that, and
   * the failure is silent — the assignment succeeds, it is simply the wrong
   * person's.
   */
  if (opts.mode === 'assign' && opts.onlyUnassigned) {
    const docs = await listAll(databases, COLLECTIONS.members, [
      Query.select(['$id', 'constituency_id']),
      Query.equal('$id', ids.slice(0, ID_CHUNK)),
    ])
    const free = new Set(
      docs
        .filter((d) => !((d as Doc).constituency_id as string | null))
        .map((d) => d.$id),
    )
    ids = ids.filter((memberId) => free.has(memberId))
    if (ids.length === 0) return 0
  }

  const db = bulk(databases)
  let touched = 0
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK)
    if (typeof db.updateDocuments === 'function') {
      await db.updateDocuments(DATABASE_ID, COLLECTIONS.members, { constituency_id: value }, [
        Query.equal('$id', chunk),
      ])
    } else {
      await Promise.all(
        chunk.map((memberId) =>
          databases.updateDocument(DATABASE_ID, COLLECTIONS.members, memberId, {
            constituency_id: value,
          }),
        ),
      )
    }
    touched += chunk.length
  }
  return touched
}

// --- bacenta categories -----------------------------------------------------

export async function listCategories(databases: Databases): Promise<BacentaCategory[]> {
  const docs = await listAll(databases, COLLECTIONS.bacenta_categories, [
    Query.orderAsc('sort_order'),
  ])
  return docs.map(categoryDocTo)
}

export async function createCategory(
  databases: Databases,
  input: { name: string; description?: string | null },
  createdBy: string,
): Promise<BacentaCategory> {
  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.bacenta_categories,
    ID.unique(),
    {
      name: input.name,
      description: input.description ?? null,
      sort_order: 100,
      created_by: createdBy,
    },
  )
  return categoryDocTo(doc as Doc)
}

export async function updateCategory(
  databases: Databases,
  id: string,
  fields: Record<string, unknown>,
): Promise<BacentaCategory> {
  const doc = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.bacenta_categories,
    id,
    fields,
  )
  return categoryDocTo(doc as Doc)
}

/**
 * Refuse to delete a category that still holds bacentas.
 *
 * Deleting it would orphan every bacenta under it — `buildBacentaTree` would
 * still SHOW them (that is what its `orphans` bucket is for), but "Biazo,
 * category missing" is a worse state than being told to empty the category
 * first. The admin's real intent is almost always to move the bacentas
 * somewhere, and only they know where.
 */
export async function deleteCategory(
  databases: Databases,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const held = await databases.listDocuments(DATABASE_ID, COLLECTIONS.bacentas, [
    Query.equal('category_id', id),
    Query.limit(1),
  ])
  if (held.total > 0) {
    return {
      ok: false,
      error:
        'This category still has bacentas in it. Move or delete them first — ' +
        'deleting the category would leave them with no family.',
    }
  }
  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.bacenta_categories, id)
  return { ok: true }
}

// --- bacentas ---------------------------------------------------------------

export async function listBacentas(databases: Databases): Promise<Bacenta[]> {
  const docs = await listAll(databases, COLLECTIONS.bacentas, [Query.orderAsc('sort_order')])
  return docs.map(bacentaDocTo)
}

export async function getBacenta(databases: Databases, id: string): Promise<Bacenta | null> {
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.bacentas, id)
    return bacentaDocTo(doc as Doc)
  } catch {
    return null
  }
}

/** Members per bacenta, in one pass over the join collection. */
export async function bacentaCounts(databases: Databases): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const docs = await listAll(databases, COLLECTIONS.bacenta_members, [
    Query.select(['$id', 'bacenta_id']),
  ])
  for (const d of docs) {
    const bid = str(d.bacenta_id)
    if (bid) counts.set(bid, (counts.get(bid) ?? 0) + 1)
  }
  return counts
}

export async function listBacentasWithCounts(databases: Databases): Promise<BacentaWithCount[]> {
  const [rows, categories, counts] = await Promise.all([
    listBacentas(databases),
    listCategories(databases),
    bacentaCounts(databases),
  ])
  const catNames = new Map(categories.map((c) => [c.$id, c.name]))
  return rows.map((b) => ({
    ...b,
    member_count: counts.get(b.$id) ?? 0,
    category_name: b.category_id ? (catNames.get(b.category_id) ?? null) : null,
  }))
}

/**
 * Names must be unique WITHIN a category, not across the whole church.
 *
 * "Youth" under Choir and "Youth" under Ushers are two real, different groups.
 * A global unique index would refuse the second one, so uniqueness is checked
 * here where the category is known — and standalone bacentas (`category_id`
 * null) are checked against each other as their own bucket.
 */
export async function bacentaNameTaken(
  databases: Databases,
  name: string,
  categoryId: string | null,
  exceptId?: string,
): Promise<boolean> {
  const siblings = await listAll(databases, COLLECTIONS.bacentas, [
    Query.select(['$id', 'name', 'category_id']),
  ])
  const key = normaliseName(name)
  return siblings.some(
    (d) =>
      d.$id !== exceptId &&
      str(d.category_id) === categoryId &&
      normaliseName(String(d.name ?? '')) === key,
  )
}

export async function createBacenta(
  databases: Databases,
  input: {
    name: string
    category_id?: string | null
    description?: string | null
    head_user_id?: string | null
    head_name?: string | null
  },
  createdBy: string,
): Promise<Bacenta> {
  const doc = await databases.createDocument(DATABASE_ID, COLLECTIONS.bacentas, ID.unique(), {
    name: input.name,
    category_id: input.category_id ?? null,
    description: input.description ?? null,
    head_user_id: input.head_user_id ?? null,
    head_name: input.head_name ?? null,
    sort_order: 100,
    created_by: createdBy,
  })
  return bacentaDocTo(doc as Doc)
}

export async function updateBacenta(
  databases: Databases,
  id: string,
  fields: Record<string, unknown>,
): Promise<Bacenta> {
  const doc = await databases.updateDocument(DATABASE_ID, COLLECTIONS.bacentas, id, fields)
  return bacentaDocTo(doc as Doc)
}

/** Delete a bacenta and the join rows that put people in it. */
export async function deleteBacentaCascade(
  databases: Databases,
  id: string,
): Promise<{ removed: number }> {
  let removed = 0
  for (;;) {
    const page = await databases.listDocuments(DATABASE_ID, COLLECTIONS.bacenta_members, [
      Query.equal('bacenta_id', id),
      Query.limit(PAGE),
    ])
    if (page.documents.length === 0) break
    await Promise.all(
      page.documents.map((d) =>
        databases.deleteDocument(DATABASE_ID, COLLECTIONS.bacenta_members, d.$id),
      ),
    )
    removed += page.documents.length
    if (page.documents.length < PAGE) break
  }
  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.bacentas, id)
  return { removed }
}

// --- bacenta membership (many-to-many) --------------------------------------

export async function bacentaMemberIds(databases: Databases, bacentaId: string): Promise<string[]> {
  const docs = await listAll(databases, COLLECTIONS.bacenta_members, [
    Query.select(['$id', 'member_id']),
    Query.equal('bacenta_id', bacentaId),
  ])
  return docs.map((d) => String(d.member_id ?? '')).filter(Boolean)
}

/** Which bacentas one member is in — the member detail page and edit form. */
export async function bacentaIdsForMember(
  databases: Databases,
  memberId: string,
): Promise<string[]> {
  const docs = await listAll(databases, COLLECTIONS.bacenta_members, [
    Query.select(['$id', 'bacenta_id']),
    Query.equal('member_id', memberId),
  ])
  return docs.map((d) => String(d.bacenta_id ?? '')).filter(Boolean)
}

/**
 * Apply a membership change to a bacenta, expressed as a diff.
 *
 * `set` is the destructive mode and is only sent by the "replace the whole
 * list" control. The group-select assigner sends `add`, because topping up an
 * existing bacenta is the common case and a `set` from a filtered view would
 * quietly remove everyone who happened not to be on screen.
 */
export async function applyBacentaMembership(
  databases: Databases,
  bacentaId: string,
  memberIds: string[],
  mode: MembershipMode,
  addedBy: string,
): Promise<MembershipResult> {
  const existing = await databases.listDocuments(DATABASE_ID, COLLECTIONS.bacenta_members, [
    Query.equal('bacenta_id', bacentaId),
    Query.limit(5000),
  ])
  const current = new Map<string, string>() // member_id -> doc $id
  for (const d of existing.documents) {
    const memberId = (d as Doc).member_id
    if (typeof memberId === 'string' && memberId) current.set(memberId, d.$id)
  }

  const { toAdd, toRemove } = diffMembership(
    [...current.keys()],
    [...new Set(memberIds)],
    mode,
  )

  if (toAdd.length > 0) {
    // Bulk API — a 200-strong choir is one round trip, not 200 (CLAUDE.md).
    await bulk(databases).createDocuments(
      DATABASE_ID,
      COLLECTIONS.bacenta_members,
      toAdd.map((member_id) => ({
        $id: ID.unique(),
        bacenta_id: bacentaId,
        member_id,
        added_by: addedBy,
      })),
    )
  }
  if (toRemove.length > 0) {
    await Promise.all(
      toRemove
        .map((memberId) => current.get(memberId))
        .filter((docId): docId is string => !!docId)
        .map((docId) =>
          databases.deleteDocument(DATABASE_ID, COLLECTIONS.bacenta_members, docId),
        ),
    )
  }

  return {
    added: toAdd.length,
    removed: toRemove.length,
    total: current.size + toAdd.length - toRemove.length,
  }
}

/**
 * Set one member's bacentas to exactly `bacentaIds` — the registration form and
 * the edit form, where the tick-boxes ARE the complete answer for that person.
 *
 * The mirror image of `applyBacentaMembership`: same join collection, pivoted
 * on the member instead of the group.
 */
export async function setMemberBacentas(
  databases: Databases,
  memberId: string,
  bacentaIds: string[],
  addedBy: string,
): Promise<{ added: number; removed: number }> {
  const existing = await databases.listDocuments(DATABASE_ID, COLLECTIONS.bacenta_members, [
    Query.equal('member_id', memberId),
    Query.limit(500),
  ])
  const current = new Map<string, string>() // bacenta_id -> doc $id
  for (const d of existing.documents) {
    const bacentaId = (d as Doc).bacenta_id
    if (typeof bacentaId === 'string' && bacentaId) current.set(bacentaId, d.$id)
  }

  const wanted = new Set(bacentaIds)
  const toAdd = [...wanted].filter((id) => !current.has(id))
  const toRemove = [...current.entries()].filter(([id]) => !wanted.has(id))

  if (toAdd.length > 0) {
    await bulk(databases).createDocuments(
      DATABASE_ID,
      COLLECTIONS.bacenta_members,
      toAdd.map((bacenta_id) => ({
        $id: ID.unique(),
        bacenta_id,
        member_id: memberId,
        added_by: addedBy,
      })),
    )
  }
  if (toRemove.length > 0) {
    await Promise.all(
      toRemove.map(([, docId]) =>
        databases.deleteDocument(DATABASE_ID, COLLECTIONS.bacenta_members, docId),
      ),
    )
  }
  return { added: toAdd.length, removed: toRemove.length }
}

/** Remove every bacenta row for a member — part of the member delete cascade. */
export async function purgeMemberBacentas(
  databases: Databases,
  memberId: string,
): Promise<number> {
  const docs = await listAll(databases, COLLECTIONS.bacenta_members, [
    Query.select(['$id']),
    Query.equal('member_id', memberId),
  ])
  await Promise.all(
    docs.map((d) => databases.deleteDocument(DATABASE_ID, COLLECTIONS.bacenta_members, d.$id)),
  )
  return docs.length
}

/** bacenta_id -> member_id[], for joining a whole page of members at once. */
export async function bacentaMembershipIndex(
  databases: Databases,
): Promise<{ byBacenta: Map<string, string[]>; byMember: Map<string, string[]> }> {
  const docs = await listAll(databases, COLLECTIONS.bacenta_members, [
    Query.select(['$id', 'bacenta_id', 'member_id']),
  ])
  const byBacenta = new Map<string, string[]>()
  const byMember = new Map<string, string[]>()
  for (const d of docs) {
    const b = str(d.bacenta_id)
    const m = str(d.member_id)
    if (!b || !m) continue
    byBacenta.set(b, [...(byBacenta.get(b) ?? []), m])
    byMember.set(m, [...(byMember.get(m) ?? []), b])
  }
  return { byBacenta, byMember }
}

// --- basonta categories -----------------------------------------------------
//
// Everything from here to the leader scoping is the bacenta code above, moved
// one collection over. It is a deliberate copy and not a shared generic: the
// two shapes part company as soon as a bacenta gains `constituency_id`, and a
// generic written now would have to be un-written then, in a hurry, against
// live data.

export function basontaCategoryDocTo(d: Doc): BasontaCategory {
  return {
    $id: d.$id,
    name: String(d.name ?? ''),
    description: str(d.description),
    sort_order: typeof d.sort_order === 'number' ? d.sort_order : 100,
    created_by: str(d.created_by),
    $createdAt: d.$createdAt,
  }
}

export function basontaDocTo(d: Doc): Basonta {
  return {
    $id: d.$id,
    name: String(d.name ?? ''),
    category_id: str(d.category_id),
    description: str(d.description),
    head_user_id: str(d.head_user_id),
    head_name: str(d.head_name),
    sort_order: typeof d.sort_order === 'number' ? d.sort_order : 100,
    created_by: str(d.created_by),
    $createdAt: d.$createdAt,
  }
}

export async function listBasontaCategories(databases: Databases): Promise<BasontaCategory[]> {
  const docs = await listAll(databases, COLLECTIONS.basonta_categories, [
    Query.orderAsc('sort_order'),
  ])
  return docs.map(basontaCategoryDocTo)
}

export async function createBasontaCategory(
  databases: Databases,
  input: { name: string; description?: string | null },
  createdBy: string,
): Promise<BasontaCategory> {
  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.basonta_categories,
    ID.unique(),
    {
      name: input.name,
      description: input.description ?? null,
      sort_order: 100,
      created_by: createdBy,
    },
  )
  return basontaCategoryDocTo(doc as Doc)
}

export async function updateBasontaCategory(
  databases: Databases,
  id: string,
  fields: Record<string, unknown>,
): Promise<BasontaCategory> {
  const doc = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.basonta_categories,
    id,
    fields,
  )
  return basontaCategoryDocTo(doc as Doc)
}

/** Refused while it still holds basontas — see `deleteCategory` for the why. */
export async function deleteBasontaCategory(
  databases: Databases,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const held = await databases.listDocuments(DATABASE_ID, COLLECTIONS.basontas, [
    Query.equal('category_id', id),
    Query.limit(1),
  ])
  if (held.total > 0) {
    return {
      ok: false,
      error:
        'This category still has basontas in it. Move or delete them first — ' +
        'deleting the category would leave them with no family.',
    }
  }
  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.basonta_categories, id)
  return { ok: true }
}

// --- basontas ---------------------------------------------------------------

export async function listBasontas(databases: Databases): Promise<Basonta[]> {
  const docs = await listAll(databases, COLLECTIONS.basontas, [Query.orderAsc('sort_order')])
  return docs.map(basontaDocTo)
}

export async function getBasonta(databases: Databases, id: string): Promise<Basonta | null> {
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.basontas, id)
    return basontaDocTo(doc as Doc)
  } catch {
    return null
  }
}

export async function basontaCounts(databases: Databases): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const docs = await listAll(databases, COLLECTIONS.basonta_members, [
    Query.select(['$id', 'basonta_id']),
  ])
  for (const d of docs) {
    const bid = str(d.basonta_id)
    if (bid) counts.set(bid, (counts.get(bid) ?? 0) + 1)
  }
  return counts
}

export async function listBasontasWithCounts(databases: Databases): Promise<BasontaWithCount[]> {
  const [rows, categories, counts] = await Promise.all([
    listBasontas(databases),
    listBasontaCategories(databases),
    basontaCounts(databases),
  ])
  const catNames = new Map(categories.map((c) => [c.$id, c.name]))
  return rows.map((b) => ({
    ...b,
    member_count: counts.get(b.$id) ?? 0,
    category_name: b.category_id ? (catNames.get(b.category_id) ?? null) : null,
  }))
}

/** Unique WITHIN a category, exactly as for bacentas — see `bacentaNameTaken`. */
export async function basontaNameTaken(
  databases: Databases,
  name: string,
  categoryId: string | null,
  exceptId?: string,
): Promise<boolean> {
  const siblings = await listAll(databases, COLLECTIONS.basontas, [
    Query.select(['$id', 'name', 'category_id']),
  ])
  const key = normaliseName(name)
  return siblings.some(
    (d) =>
      d.$id !== exceptId &&
      str(d.category_id) === categoryId &&
      normaliseName(String(d.name ?? '')) === key,
  )
}

export async function createBasonta(
  databases: Databases,
  input: {
    name: string
    category_id?: string | null
    description?: string | null
    head_user_id?: string | null
    head_name?: string | null
  },
  createdBy: string,
): Promise<Basonta> {
  const doc = await databases.createDocument(DATABASE_ID, COLLECTIONS.basontas, ID.unique(), {
    name: input.name,
    category_id: input.category_id ?? null,
    description: input.description ?? null,
    head_user_id: input.head_user_id ?? null,
    head_name: input.head_name ?? null,
    sort_order: 100,
    created_by: createdBy,
  })
  return basontaDocTo(doc as Doc)
}

export async function updateBasonta(
  databases: Databases,
  id: string,
  fields: Record<string, unknown>,
): Promise<Basonta> {
  const doc = await databases.updateDocument(DATABASE_ID, COLLECTIONS.basontas, id, fields)
  return basontaDocTo(doc as Doc)
}

export async function deleteBasontaCascade(
  databases: Databases,
  id: string,
): Promise<{ removed: number }> {
  let removed = 0
  for (;;) {
    const page = await databases.listDocuments(DATABASE_ID, COLLECTIONS.basonta_members, [
      Query.equal('basonta_id', id),
      Query.limit(PAGE),
    ])
    if (page.documents.length === 0) break
    await Promise.all(
      page.documents.map((d) =>
        databases.deleteDocument(DATABASE_ID, COLLECTIONS.basonta_members, d.$id),
      ),
    )
    removed += page.documents.length
    if (page.documents.length < PAGE) break
  }
  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.basontas, id)
  return { removed }
}

// --- basonta membership (many-to-many) --------------------------------------

export async function basontaMemberIds(
  databases: Databases,
  basontaId: string,
): Promise<string[]> {
  const docs = await listAll(databases, COLLECTIONS.basonta_members, [
    Query.select(['$id', 'member_id']),
    Query.equal('basonta_id', basontaId),
  ])
  return docs.map((d) => String(d.member_id ?? '')).filter(Boolean)
}

export async function basontaIdsForMember(
  databases: Databases,
  memberId: string,
): Promise<string[]> {
  const docs = await listAll(databases, COLLECTIONS.basonta_members, [
    Query.select(['$id', 'basonta_id']),
    Query.equal('member_id', memberId),
  ])
  return docs.map((d) => String(d.basonta_id ?? '')).filter(Boolean)
}

/** A diff, never delete-all-then-insert — see `applyBacentaMembership`. */
export async function applyBasontaMembership(
  databases: Databases,
  basontaId: string,
  memberIds: string[],
  mode: MembershipMode,
  addedBy: string,
): Promise<MembershipResult> {
  const existing = await databases.listDocuments(DATABASE_ID, COLLECTIONS.basonta_members, [
    Query.equal('basonta_id', basontaId),
    Query.limit(5000),
  ])
  const current = new Map<string, string>() // member_id -> doc $id
  for (const d of existing.documents) {
    const memberId = (d as Doc).member_id
    if (typeof memberId === 'string' && memberId) current.set(memberId, d.$id)
  }

  const { toAdd, toRemove } = diffMembership([...current.keys()], [...new Set(memberIds)], mode)

  if (toAdd.length > 0) {
    await bulk(databases).createDocuments(
      DATABASE_ID,
      COLLECTIONS.basonta_members,
      toAdd.map((member_id) => ({
        $id: ID.unique(),
        basonta_id: basontaId,
        member_id,
        added_by: addedBy,
      })),
    )
  }
  if (toRemove.length > 0) {
    await Promise.all(
      toRemove
        .map((memberId) => current.get(memberId))
        .filter((docId): docId is string => !!docId)
        .map((docId) =>
          databases.deleteDocument(DATABASE_ID, COLLECTIONS.basonta_members, docId),
        ),
    )
  }

  return {
    added: toAdd.length,
    removed: toRemove.length,
    total: current.size + toAdd.length - toRemove.length,
  }
}

/** One member's basontas set to exactly `basontaIds` — the member edit form. */
export async function setMemberBasontas(
  databases: Databases,
  memberId: string,
  basontaIds: string[],
  addedBy: string,
): Promise<{ added: number; removed: number }> {
  const existing = await databases.listDocuments(DATABASE_ID, COLLECTIONS.basonta_members, [
    Query.equal('member_id', memberId),
    Query.limit(500),
  ])
  const current = new Map<string, string>() // basonta_id -> doc $id
  for (const d of existing.documents) {
    const basontaId = (d as Doc).basonta_id
    if (typeof basontaId === 'string' && basontaId) current.set(basontaId, d.$id)
  }

  const wanted = new Set(basontaIds)
  const toAdd = [...wanted].filter((id) => !current.has(id))
  const toRemove = [...current.entries()].filter(([id]) => !wanted.has(id))

  if (toAdd.length > 0) {
    await bulk(databases).createDocuments(
      DATABASE_ID,
      COLLECTIONS.basonta_members,
      toAdd.map((basonta_id) => ({
        $id: ID.unique(),
        basonta_id,
        member_id: memberId,
        added_by: addedBy,
      })),
    )
  }
  if (toRemove.length > 0) {
    await Promise.all(
      toRemove.map(([, docId]) =>
        databases.deleteDocument(DATABASE_ID, COLLECTIONS.basonta_members, docId),
      ),
    )
  }
  return { added: toAdd.length, removed: toRemove.length }
}

/** Part of the member delete cascade — cascades are manual here (CLAUDE.md). */
export async function purgeMemberBasontas(
  databases: Databases,
  memberId: string,
): Promise<number> {
  const docs = await listAll(databases, COLLECTIONS.basonta_members, [
    Query.select(['$id']),
    Query.equal('member_id', memberId),
  ])
  await Promise.all(
    docs.map((d) => databases.deleteDocument(DATABASE_ID, COLLECTIONS.basonta_members, d.$id)),
  )
  return docs.length
}

export async function basontaMembershipIndex(
  databases: Databases,
): Promise<{ byBasonta: Map<string, string[]>; byMember: Map<string, string[]> }> {
  const docs = await listAll(databases, COLLECTIONS.basonta_members, [
    Query.select(['$id', 'basonta_id', 'member_id']),
  ])
  const byBasonta = new Map<string, string[]>()
  const byMember = new Map<string, string[]>()
  for (const d of docs) {
    const b = str(d.basonta_id)
    const m = str(d.member_id)
    if (!b || !m) continue
    byBasonta.set(b, [...(byBasonta.get(b) ?? []), m])
    byMember.set(m, [...(byMember.get(m) ?? []), b])
  }
  return { byBasonta, byMember }
}

/** Reject basonta ids that name nothing, in one query rather than one per id. */
export async function unknownBasontaIds(
  databases: Databases,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return []
  const known = new Set((await listBasontas(databases)).map((b) => b.$id))
  return ids.filter((id) => !known.has(id))
}

// --- leader scoping ---------------------------------------------------------

/**
 * The groups a `leader` account may see: exactly those naming them as head.
 *
 * THIS is the authorisation boundary for the whole leader role. The UI showing
 * a head only their own groups is a convenience; every route that serves group
 * data for a leader resolves the scope here and refuses anything outside it
 * (CLAUDE.md — server-side enforcement is mandatory).
 *
 * One user may appear in both lists. That is the case the design is FOR: a
 * person who heads Ahodwo and also leads the Technical Team signs in once and
 * switches between the two views.
 */
export async function leaderScope(
  databases: Databases,
  userId: string,
): Promise<{ constituencies: Constituency[]; bacentas: Bacenta[]; basontas: Basonta[] }> {
  const [constituencies, bacentas, basontas] = await Promise.all([
    listAll(databases, COLLECTIONS.constituencies, [Query.equal('head_user_id', userId)]),
    listAll(databases, COLLECTIONS.bacentas, [Query.equal('head_user_id', userId)]),
    listAll(databases, COLLECTIONS.basontas, [Query.equal('head_user_id', userId)]),
  ])
  return {
    constituencies: constituencies.map(constituencyDocTo),
    bacentas: bacentas.map(bacentaDocTo),
    basontas: basontas.map(basontaDocTo),
  }
}

/**
 * May this user read this group? Admins may read anything; a leader may read
 * only what they head. Anyone else has already been turned away by
 * `requireRole`, so reaching here with another label is a programming error and
 * is treated as a refusal rather than a crash.
 */
export async function canReadGroup(
  databases: Databases,
  user: { id: string; label: string },
  kind: 'constituency' | 'bacenta' | 'basonta',
  groupId: string,
): Promise<boolean> {
  if (user.label === 'admin') return true
  // A shepherd reads every group. That is the whole role, and it is safe here
  // because this function only ever gates READS — the write paths that consult
  // it (`/api/constituencies/[id]/members`) also require a label that a
  // shepherd does not have.
  if (user.label === 'shepherd') return true
  if (user.label !== 'leader') return false
  const scope = await leaderScope(databases, user.id)
  // Switched on rather than defaulted: an unrecognised `kind` reaching here
  // must REFUSE, not fall through to whichever branch happens to be last.
  // The bug that shape produces is a head reading a group they do not head.
  if (kind === 'constituency') return scope.constituencies.some((c) => c.$id === groupId)
  if (kind === 'bacenta') return scope.bacentas.some((b) => b.$id === groupId)
  if (kind === 'basonta') return scope.basontas.some((b) => b.$id === groupId)
  return false
}

// --- validation -------------------------------------------------------------

/** Reject a `constituency_id` that names no constituency, so a member cannot
 *  be filed into a home that does not exist. */
export async function constituencyExists(databases: Databases, id: string): Promise<boolean> {
  return (await getConstituency(databases, id)) !== null
}

/** Same for a list of bacenta ids, in one query rather than one per id. */
export async function unknownBacentaIds(
  databases: Databases,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return []
  const known = new Set((await listBacentas(databases)).map((b) => b.$id))
  return ids.filter((id) => !known.has(id))
}

export { validateGroupName }

/**
 * Active members who belong to no constituency yet.
 *
 * This is the only view of the wider registry a group head is given, and it is
 * deliberately the narrowest one that makes the feature work: they need to see
 * who is unclaimed in order to claim the ones who live in their area. Members
 * already filed into another constituency never appear, so a head cannot browse
 * a neighbour's roster through this door.
 *
 * Inactive members are excluded for the same reason the bulk assigner excludes
 * them: somebody who has left the church is not somebody to file into a
 * constituency.
 */
export async function listUnassignedMembers(databases: Databases): Promise<Member[]> {
  // Appwrite has no "is null" for an optional string that may be absent OR the
  // empty string, so the filter is applied in memory after a scoped read. The
  // set is bounded by the congregation size and this is not a hot path.
  const docs = await listAll(databases, COLLECTIONS.members, [Query.equal('status', 'active')])
  return docs
    .map((d) => memberDocToMember(d as never))
    .filter((m) => !m.constituency_id)
    .sort((a, b) => fullName(a).localeCompare(fullName(b), 'en'))
}
