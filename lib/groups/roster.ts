import 'server-only'

// The roster a group head sees: their members, with how often each has turned
// up. Appwrite has no joins, so this fetches each side and merges in memory
// (CLAUDE.md) — but only for the members actually in the group, not the whole
// registry.

import { Query, type Databases, type Models } from 'node-appwrite'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import { fullName } from '@/lib/members/types'
import { memberDocToMember } from '@/lib/attendance/server'
import type { GroupMember } from './types'

/** Appwrite rejects an over-long `Query.equal` array. */
const ID_CHUNK = 100
const PAGE = 100

type Doc = Models.Document & Record<string, unknown>

/**
 * How many times each of `memberIds` has been marked present, and when last.
 *
 * Queried by member id in chunks rather than by reading the whole
 * `attendance_records` collection: a church a year into using this has tens of
 * thousands of rows, and a bacenta of twelve people does not need to pull them
 * all across the wire to count twelve.
 */
export async function attendanceSummary(
  databases: Databases,
  memberIds: string[],
): Promise<Map<string, { count: number; last: string | null }>> {
  const out = new Map<string, { count: number; last: string | null }>()
  if (memberIds.length === 0) return out

  for (let i = 0; i < memberIds.length; i += ID_CHUNK) {
    const chunk = memberIds.slice(i, i + ID_CHUNK)
    let cursor: string | null = null
    for (;;) {
      const q = [
        Query.select(['$id', 'member_id', 'marked_at']),
        Query.equal('member_id', chunk),
        Query.limit(PAGE),
      ]
      if (cursor) q.push(Query.cursorAfter(cursor))
      const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.attendance_records, q)
      for (const d of res.documents as Doc[]) {
        const id = typeof d.member_id === 'string' ? d.member_id : null
        if (!id) continue
        const markedAt = typeof d.marked_at === 'string' ? d.marked_at : null
        const prev = out.get(id)
        if (!prev) out.set(id, { count: 1, last: markedAt })
        else {
          prev.count++
          // ISO-8601 UTC strings compare lexicographically in time order, so
          // no Date parsing is needed to find the most recent.
          if (markedAt && (!prev.last || markedAt > prev.last)) prev.last = markedAt
        }
      }
      if (res.documents.length < PAGE) break
      cursor = res.documents[res.documents.length - 1].$id
    }
  }
  return out
}

/** Fetch member documents by id, chunked, in the order the ids came in. */
export async function membersByIds(databases: Databases, memberIds: string[]) {
  if (memberIds.length === 0) return []
  const docs: Doc[] = []
  for (let i = 0; i < memberIds.length; i += ID_CHUNK) {
    const chunk = memberIds.slice(i, i + ID_CHUNK)
    let cursor: string | null = null
    for (;;) {
      const q = [Query.equal('$id', chunk), Query.limit(PAGE)]
      if (cursor) q.push(Query.cursorAfter(cursor))
      const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.members, q)
      docs.push(...(res.documents as Doc[]))
      if (res.documents.length < PAGE) break
      cursor = res.documents[res.documents.length - 1].$id
    }
  }
  return docs.map(memberDocToMember)
}

/**
 * Turn members into roster rows, sorted by name.
 *
 * `last_seen` is the date part only. A head asking "when did I last see
 * Kwabena?" wants "8 March", not a timestamp to the millisecond, and trimming
 * it here means no page has to remember to.
 */
export function toGroupMembers(
  members: Awaited<ReturnType<typeof membersByIds>>,
  attendance: Map<string, { count: number; last: string | null }>,
): GroupMember[] {
  return members
    .map((m): GroupMember => {
      const a = attendance.get(m.$id)
      return {
        $id: m.$id,
        full_name: fullName(m),
        photo_file_id: m.photo_file_id,
        call_number: m.call_number,
        whatsapp_number: m.whatsapp_number,
        birth_month: m.birth_month,
        birth_day: m.birth_day,
        status: m.status,
        home_service: m.home_service,
        attendance_count: a?.count ?? 0,
        last_seen: a?.last ? a.last.slice(0, 10) : null,
      }
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'en'))
}

/** The whole roster for a set of member ids, in one call. */
export async function buildGroupRoster(
  databases: Databases,
  memberIds: string[],
): Promise<GroupMember[]> {
  const [members, attendance] = await Promise.all([
    membersByIds(databases, memberIds),
    attendanceSummary(databases, memberIds),
  ])
  return toGroupMembers(members, attendance)
}
