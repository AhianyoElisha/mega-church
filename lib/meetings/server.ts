import 'server-only'

// Meeting definitions and their authorised rosters.

import { ID, Query, type Databases, type Models } from 'node-appwrite'
import { COLLECTIONS, DATABASE_ID, SERVICE_IDS } from '@/lib/appwrite/config'
import { invalidateCandidateCache, rosterMemberIds } from '@/lib/biometrics/server'
import { meetingDocToMeeting } from '@/lib/attendance/server'
import type { Meeting } from './types'

const PAGE = 100

type BulkDatabases = {
  createDocuments: (db: string, col: string, docs: object[]) => Promise<unknown>
}
const bulk = (db: Databases): BulkDatabases => db as unknown as BulkDatabases

/** The two seeded services. Protected from rename-away and deletion. */
export const PROTECTED_MEETING_IDS: readonly string[] = [SERVICE_IDS.first, SERVICE_IDS.second]

export function isProtected(id: string): boolean {
  return PROTECTED_MEETING_IDS.includes(id)
}

export async function listMeetings(databases: Databases): Promise<Meeting[]> {
  const out: Meeting[] = []
  let cursor: string | null = null
  for (;;) {
    const q = [Query.orderAsc('sort_order'), Query.limit(PAGE)]
    if (cursor) q.push(Query.cursorAfter(cursor))
    const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.meetings, q)
    out.push(
      ...res.documents.map((d) =>
        meetingDocToMeeting(d as Models.Document & Record<string, unknown>),
      ),
    )
    if (res.documents.length < PAGE) break
    cursor = res.documents[res.documents.length - 1].$id
  }
  return out
}

export async function getMeeting(databases: Databases, id: string): Promise<Meeting | null> {
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.meetings, id)
    return meetingDocToMeeting(doc as Models.Document & Record<string, unknown>)
  } catch {
    return null
  }
}

export async function createMeeting(
  databases: Databases,
  input: { name: string; description?: string | null },
  createdBy: string,
): Promise<Meeting> {
  const doc = await databases.createDocument(DATABASE_ID, COLLECTIONS.meetings, ID.unique(), {
    name: input.name,
    description: input.description ?? null,
    kind: 'meeting',
    service_slot: null,
    // Every admin-created meeting is restricted. A meeting that anyone may
    // attend is what the services are for; creating one here by accident would
    // silently open a committee's attendance to the whole congregation.
    restricted: true,
    archived: false,
    // After the two services, in creation order.
    sort_order: 100,
    created_by: createdBy,
  })
  return meetingDocToMeeting(doc as Models.Document & Record<string, unknown>)
}

/**
 * Set a meeting's authorised roster to exactly `memberIds`.
 *
 * Written as a DIFF rather than delete-all-then-insert. Two reasons, and the
 * second is the one that matters: a full rewrite loses `added_by` and the
 * created timestamps for people who were already on the list, and — if it
 * fails halfway — it can leave a meeting with an empty roster, which is the
 * one state that locks everybody out of their own meeting.
 */
export async function setRoster(
  databases: Databases,
  meetingId: string,
  memberIds: string[],
  addedBy: string,
): Promise<{ added: number; removed: number; total: number }> {
  const wanted = new Set(memberIds)

  const existing = await databases.listDocuments(DATABASE_ID, COLLECTIONS.meeting_members, [
    Query.equal('meeting_id', meetingId),
    Query.limit(5000),
  ])
  const current = new Map<string, string>() // member_id -> doc $id
  for (const d of existing.documents) {
    const memberId = (d as Models.Document & { member_id?: string }).member_id
    if (memberId) current.set(memberId, d.$id)
  }

  const toAdd = [...wanted].filter((m) => !current.has(m))
  const toRemove = [...current.entries()].filter(([m]) => !wanted.has(m))

  if (toAdd.length > 0) {
    // Bulk API — a 400-member roster is one round-trip, not 400.
    await bulk(databases).createDocuments(
      DATABASE_ID,
      COLLECTIONS.meeting_members,
      toAdd.map((member_id) => ({
        $id: ID.unique(),
        meeting_id: meetingId,
        member_id,
        added_by: addedBy,
      })),
    )
  }
  if (toRemove.length > 0) {
    await Promise.all(
      toRemove.map(([, docId]) =>
        databases.deleteDocument(DATABASE_ID, COLLECTIONS.meeting_members, docId),
      ),
    )
  }

  // The gallery for this meeting just changed shape.
  invalidateCandidateCache()
  return { added: toAdd.length, removed: toRemove.length, total: wanted.size }
}

export async function getRoster(databases: Databases, meetingId: string): Promise<string[]> {
  return rosterMemberIds(databases, meetingId)
}

/** Roster sizes for every meeting, in one pass, for the meetings list. */
export async function rosterSizes(databases: Databases): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  let cursor: string | null = null
  for (;;) {
    const q = [Query.select(['$id', 'meeting_id']), Query.limit(PAGE)]
    if (cursor) q.push(Query.cursorAfter(cursor))
    const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.meeting_members, q)
    for (const d of res.documents) {
      const mid = (d as Models.Document & { meeting_id?: string }).meeting_id
      if (mid) sizes.set(mid, (sizes.get(mid) ?? 0) + 1)
    }
    if (res.documents.length < PAGE) break
    cursor = res.documents[res.documents.length - 1].$id
  }
  return sizes
}

/** Most recent occurrence date per meeting, for the "last held" column. */
export async function lastHeldByMeeting(databases: Databases): Promise<Map<string, string>> {
  const last = new Map<string, string>()
  let cursor: string | null = null
  for (;;) {
    const q = [
      Query.select(['$id', 'meeting_id', 'occurrence_date']),
      Query.orderDesc('occurrence_date'),
      Query.limit(PAGE),
    ]
    if (cursor) q.push(Query.cursorAfter(cursor))
    const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.meeting_occurrences, q)
    for (const d of res.documents) {
      const row = d as Models.Document & { meeting_id?: string; occurrence_date?: string }
      if (row.meeting_id && row.occurrence_date && !last.has(row.meeting_id)) {
        last.set(row.meeting_id, row.occurrence_date)
      }
    }
    if (res.documents.length < PAGE) break
    cursor = res.documents[res.documents.length - 1].$id
  }
  return last
}

/**
 * Delete a meeting, its roster and its occurrence history.
 *
 * Refuses on the two services — they are referenced by id throughout the code
 * and deleting one would break activation with a 404 rather than a message.
 */
export async function deleteMeetingCascade(
  databases: Databases,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isProtected(id)) {
    return {
      ok: false,
      error: 'The two services cannot be deleted. Archive is not available for them either.',
    }
  }

  const open = await databases.listDocuments(DATABASE_ID, COLLECTIONS.meeting_occurrences, [
    Query.equal('meeting_id', id),
    Query.equal('status', 'open'),
    Query.limit(1),
  ])
  if (open.total > 0) {
    return { ok: false, error: 'End this meeting before deleting it.' }
  }

  const purge = async (collection: string, field: string) => {
    for (;;) {
      const page = await databases.listDocuments(DATABASE_ID, collection, [
        Query.equal(field, id),
        Query.limit(PAGE),
      ])
      if (page.documents.length === 0) break
      await Promise.all(
        page.documents.map((d) => databases.deleteDocument(DATABASE_ID, collection, d.$id)),
      )
      if (page.documents.length < PAGE) break
    }
  }

  await purge(COLLECTIONS.attendance_records, 'meeting_id')
  await purge(COLLECTIONS.meeting_occurrences, 'meeting_id')
  await purge(COLLECTIONS.meeting_members, 'meeting_id')
  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.meetings, id)
  invalidateCandidateCache()
  return { ok: true }
}
