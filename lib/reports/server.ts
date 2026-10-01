import 'server-only'

// Loads one session's register. The rules are in `./register.ts`; this only
// fetches. Appwrite has no joins, so the member rows are fetched separately
// and joined in memory, chunked by id.

import { Query, type Databases, type Models } from 'node-appwrite'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import {
  meetingDocToMeeting,
  memberDocToMember,
  occurrenceDocToOccurrence,
} from '@/lib/attendance/server'
import type { AttendanceMethod } from '@/lib/attendance/types'
import { listConstituencies } from '@/lib/groups/server'
import { getRoster } from '@/lib/meetings/server'
import { listMembers } from '@/lib/members/server'
import type { Member } from '@/lib/members/types'
import type { Meeting, MeetingOccurrence } from '@/lib/meetings/types'
import { buildRegister, expectedBasis, isExpected, type SessionRegister } from './register'

type Doc = Models.Document & Record<string, unknown>

async function listAll(databases: Databases, collection: string, queries: string[]): Promise<Doc[]> {
  const out: Doc[] = []
  let cursor: string | null = null
  for (;;) {
    const q = [...queries, Query.limit(100)]
    if (cursor) q.push(Query.cursorAfter(cursor))
    const res = await databases.listDocuments(DATABASE_ID, collection, q)
    out.push(...(res.documents as Doc[]))
    if (res.documents.length < 100) break
    cursor = res.documents[res.documents.length - 1].$id
  }
  return out
}

/** Member rows for a set of ids, in chunks of 100 — Appwrite caps `Query.equal`
 *  on `$id` at that many values. Ids with no row are simply absent. */
async function membersById(databases: Databases, ids: string[]): Promise<Member[]> {
  const out: Member[] = []
  const CHUNK = 100
  for (let i = 0; i < ids.length; i += CHUNK) {
    const page = await databases.listDocuments(DATABASE_ID, COLLECTIONS.members, [
      Query.equal('$id', ids.slice(i, i + CHUNK)),
      Query.limit(CHUNK),
    ])
    for (const d of page.documents) out.push(memberDocToMember(d as Doc))
  }
  return out
}

async function occurrenceWithMeeting(
  databases: Databases,
  occurrenceId: string,
): Promise<{ occurrence: MeetingOccurrence; meeting: Meeting } | null> {
  try {
    const occurrence = occurrenceDocToOccurrence(
      (await databases.getDocument(DATABASE_ID, COLLECTIONS.meeting_occurrences, occurrenceId)) as Doc,
    )
    const meeting = meetingDocToMeeting(
      (await databases.getDocument(DATABASE_ID, COLLECTIONS.meetings, occurrence.meeting_id)) as Doc,
    )
    return { occurrence, meeting }
  } catch {
    return null
  }
}

/**
 * The Save Church session that ran alongside `parentId`, open or closed.
 * (`findCompanionOccurrence` in the attendance orchestrator wants only an OPEN
 * one, because it is deciding where a scan lands; a register is history.)
 */
async function companionOf(
  databases: Databases,
  parentId: string,
): Promise<{ occurrence: MeetingOccurrence; meeting: Meeting; present: number } | null> {
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.meeting_occurrences, [
    Query.equal('parent_occurrence_id', parentId),
    Query.orderDesc('$createdAt'),
    Query.limit(1),
  ])
  if (res.documents.length === 0) return null
  const occurrence = occurrenceDocToOccurrence(res.documents[0] as Doc)
  try {
    const meeting = meetingDocToMeeting(
      (await databases.getDocument(DATABASE_ID, COLLECTIONS.meetings, occurrence.meeting_id)) as Doc,
    )
    const marks = await databases.listDocuments(DATABASE_ID, COLLECTIONS.attendance_records, [
      Query.equal('occurrence_id', occurrence.$id),
      Query.limit(1),
    ])
    return { occurrence, meeting, present: marks.total }
  } catch {
    return null
  }
}

/** Null when there is no such session. */
export async function loadRegister(
  databases: Databases,
  occurrenceId: string,
): Promise<SessionRegister | null> {
  const head = await occurrenceWithMeeting(databases, occurrenceId)
  if (!head) return null
  const { occurrence, meeting } = head
  const basis = expectedBasis(meeting)

  const [recordDocs, expected, companion, parent, allConstituencies] = await Promise.all([
    listAll(databases, COLLECTIONS.attendance_records, [Query.equal('occurrence_id', occurrence.$id)]),
    basis === 'roster'
      ? getRoster(databases, meeting.$id).then((ids) => membersById(databases, ids))
      : listMembers(databases, { status: 'active' }).then((members) =>
          members.filter((m) => isExpected(basis, m)),
        ),
    // A Save Church session has a parent, never a companion, and vice versa.
    occurrence.parent_occurrence_id ? null : companionOf(databases, occurrence.$id),
    occurrence.parent_occurrence_id
      ? occurrenceWithMeeting(databases, occurrence.parent_occurrence_id)
      : null,
    listConstituencies(databases),
  ])

  const records = recordDocs.map((d) => ({
    member_id: String(d.member_id ?? ''),
    marked_at: String(d.marked_at ?? ''),
    method: (d.method === 'manual' ? 'manual' : 'biometric') as AttendanceMethod,
  }))

  // Marks for people not on the expected list: look their rows up so the
  // register can name them. Whoever is still missing after that was deleted.
  const expectedIds = new Set(expected.map((m) => m.$id))
  const strayIds = [...new Set(records.map((r) => r.member_id))].filter(
    (id) => id && !expectedIds.has(id),
  )
  const extra = strayIds.length > 0 ? await membersById(databases, strayIds) : []

  return {
    occurrence,
    meeting,
    basis,
    rows: buildRegister(expected, records, extra),
    companion,
    parent,
    constituencies: allConstituencies.map((c) => ({ id: c.$id, name: c.name })),
  }
}
