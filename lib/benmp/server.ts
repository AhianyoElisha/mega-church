// Reading and writing BENMP contributions.
//
// The only file in lib/benmp/ that touches Appwrite. `period.ts` and
// `unpaid.ts` stay pure so the rule deciding who the church pays to text can be
// exercised in a unit test.

import 'server-only'

import { ID, Query, type Databases, type Models } from 'node-appwrite'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import type { ContributionRow } from './unpaid'
import { isPeriod, type Period } from './period'

const PAGE = 100

type Doc = Models.Document & Record<string, unknown>

function toRow(d: Doc): ContributionRow & { $id: string; recorded_by: string | null } {
  return {
    $id: d.$id,
    member_id: String(d.member_id ?? ''),
    period: String(d.period ?? ''),
    recorded_by: (d.recorded_by as string | null) || null,
  }
}

async function listAll(databases: Databases, queries: string[]): Promise<Doc[]> {
  const out: Doc[] = []
  let cursor: string | undefined
  for (;;) {
    const q = [...queries, Query.limit(PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : [])]
    const page = await databases.listDocuments(DATABASE_ID, COLLECTIONS.benmp_contributions, q)
    out.push(...(page.documents as Doc[]))
    if (page.documents.length < PAGE) break
    cursor = page.documents[page.documents.length - 1].$id
  }
  return out
}

/**
 * Every contribution in a calendar year.
 *
 * A RANGE over the `period` string rather than twelve equality queries, which
 * works only because the periods are zero-padded `YYYY-MM` — `2026-01` through
 * `2026-12` is a contiguous lexical span and nothing else falls inside it.
 */
export async function contributionsForYear(
  databases: Databases,
  year: number,
): Promise<ContributionRow[]> {
  const docs = await listAll(databases, [
    Query.greaterThanEqual('period', `${year}-01`),
    Query.lessThanEqual('period', `${year}-12`),
  ])
  return docs.map(toRow)
}

/** Every contribution for one month — what the reminder asks about. */
export async function contributionsForPeriod(
  databases: Databases,
  period: Period,
): Promise<ContributionRow[]> {
  const docs = await listAll(databases, [Query.equal('period', period)])
  return docs.map(toRow)
}

export type RecordOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; error: string; status: 400 | 409 }

/**
 * Record that a member paid for a month.
 *
 * CLAIMED BY THE INSERT, not by the check in front of it — the same rule as
 * `notification_runs` and `sms_messages`. The unique index on
 * `(member_id, period)` is what actually stops two treasurers recording the
 * same month from two phones; the lookup below only exists so the second one
 * gets "already recorded" instead of a raw Appwrite conflict.
 *
 * Recording an ALREADY-recorded month is `changed: false` and not an error. The
 * gesture is a tick box, the tick box is idempotent, and a double-click on a
 * slow connection should not produce a red banner about something that is in
 * exactly the state the person wanted.
 */
export async function recordContribution(
  databases: Databases,
  memberId: string,
  period: string,
  recordedBy: string,
): Promise<RecordOutcome> {
  if (!isPeriod(period)) {
    return { ok: false, status: 400, error: `"${period}" is not a month.` }
  }
  try {
    await databases.createDocument(DATABASE_ID, COLLECTIONS.benmp_contributions, ID.unique(), {
      member_id: memberId,
      period,
      recorded_by: recordedBy,
    })
    return { ok: true, changed: true }
  } catch (err) {
    // The unique index refused it: somebody else recorded this month first,
    // which is the outcome the caller wanted anyway.
    if (isConflict(err)) return { ok: true, changed: false }
    throw err
  }
}

/**
 * Undo a recorded month.
 *
 * Deletes the row rather than writing a `paid: false`, because absence is how
 * this collection spells "not paid" and a second way to spell it is a second
 * thing that can disagree with the first.
 *
 * Undoing something already undone is `changed: false`, not a 404 — two
 * treasurers clearing the same mistaken tick should both see it gone.
 */
export async function unrecordContribution(
  databases: Databases,
  memberId: string,
  period: string,
): Promise<RecordOutcome> {
  if (!isPeriod(period)) {
    return { ok: false, status: 400, error: `"${period}" is not a month.` }
  }
  const existing = await databases.listDocuments(DATABASE_ID, COLLECTIONS.benmp_contributions, [
    Query.equal('member_id', memberId),
    Query.equal('period', period),
    Query.limit(PAGE),
  ])
  if (existing.documents.length === 0) return { ok: true, changed: false }
  // A loop, not a single delete: the unique index makes duplicates impossible
  // going forward, but a row written before it existed would otherwise be
  // undeletable through this door and would keep somebody off the reminder
  // list forever.
  for (const d of existing.documents) {
    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.benmp_contributions, d.$id)
  }
  return { ok: true, changed: true }
}

/**
 * Remove every contribution belonging to a member.
 *
 * Appwrite has no cascade, so this is called from `deleteMemberCascade`. A
 * contribution left behind points at a member who no longer exists, and the
 * only thing that would ever notice is a year total that cannot be explained.
 */
export async function purgeContributions(
  databases: Databases,
  memberId: string,
): Promise<number> {
  const docs = await listAll(databases, [Query.equal('member_id', memberId)])
  for (const d of docs) {
    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.benmp_contributions, d.$id)
  }
  return docs.length
}

function isConflict(err: unknown): boolean {
  const e = err as { code?: number; type?: string }
  return e?.code === 409 || e?.type === 'document_already_exists'
}
