// Attendance orchestrator. The ONLY file in lib/attendance/ that imports
// node-appwrite; every route under app/api/attendance and app/api/occurrences
// calls into here.
//
// Entry points:
//   resolveActiveSession()  → the one open occurrence + its meeting + roster size
//   activateOccurrence()    → open one, enforcing the single-active invariant
//   closeOccurrence()       → close it and freeze the tally
//   processScan()           → biometric → identify → authorise → record
//   processManual()         → usher-driven, with a dry-run mode
//   loadLiveStats()         → aggregate for the monitor
//   loadOccurrenceRecords() → paged record log joined to member summaries

import 'server-only'

import { ID, Query, type Databases, type Models } from 'node-appwrite'

import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import { getBiometricService } from '@/lib/services/biometricService'
import { rosterMemberIds } from '@/lib/biometrics/server'
import { fullName, type Member } from '@/lib/members/types'
import type {
  ActiveSession,
  Meeting,
  MeetingOccurrence,
} from '@/lib/meetings/types'
import { aggregateLive } from './liveStats'
import { canActivate, resolveOpenOccurrence, todayInAccra } from './occurrenceResolver'
import type {
  AttendanceRecord,
  AttendanceRecordPayload,
  LiveStats,
  ManualRequest,
  MemberSummary,
  ScanRequest,
  ScanResult,
} from './types'

const PAGE_SIZE = 100
/** 20,000 rows. A church that exceeds this in one occurrence has other news. */
const MAX_PAGES = 200

async function listAll<T extends Models.Document>(
  databases: Databases,
  collectionId: string,
  queries: string[],
): Promise<T[]> {
  const out: T[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const q: string[] = [...queries, Query.limit(PAGE_SIZE)]
    if (cursor) q.push(Query.cursorAfter(cursor))
    const res = await databases.listDocuments<T>(DATABASE_ID, collectionId, q)
    out.push(...res.documents)
    if (res.documents.length < PAGE_SIZE) break
    cursor = res.documents[res.documents.length - 1].$id
  }
  return out
}

// === Mappers ===============================================================

type MemberDoc = Models.Document & Record<string, unknown>

export function memberDocToMember(d: MemberDoc): Member {
  return {
    $id: d.$id,
    first_name: String(d.first_name ?? ''),
    last_name: String(d.last_name ?? ''),
    other_names: (d.other_names as string | null) ?? null,
    photo_file_id: (d.photo_file_id as string | null) ?? null,
    birth_month: (d.birth_month as number | null) ?? null,
    birth_day: (d.birth_day as number | null) ?? null,
    address: (d.address as string | null) ?? null,
    call_number: String(d.call_number ?? ''),
    whatsapp_number: (d.whatsapp_number as string | null) ?? null,
    home_service: (d.home_service as Member['home_service']) ?? 'second',
    status: (d.status as Member['status']) ?? 'active',
    created_by: (d.created_by as string | null) ?? null,
    $createdAt: d.$createdAt,
    $updatedAt: d.$updatedAt,
  }
}

export function toMemberSummary(m: Member): MemberSummary {
  return {
    $id: m.$id,
    full_name: fullName(m),
    photo_file_id: m.photo_file_id,
    home_service: m.home_service,
  }
}

export function meetingDocToMeeting(d: Models.Document & Record<string, unknown>): Meeting {
  return {
    $id: d.$id,
    name: String(d.name ?? ''),
    description: (d.description as string | null) ?? null,
    kind: (d.kind as Meeting['kind']) ?? 'meeting',
    service_slot: (d.service_slot as Meeting['service_slot']) ?? null,
    restricted: Boolean(d.restricted),
    archived: Boolean(d.archived),
    sort_order: Number(d.sort_order ?? 100),
    created_by: (d.created_by as string | null) ?? null,
    $createdAt: d.$createdAt,
  }
}

export function occurrenceDocToOccurrence(
  d: Models.Document & Record<string, unknown>,
): MeetingOccurrence {
  return {
    $id: d.$id,
    meeting_id: String(d.meeting_id ?? ''),
    occurrence_date: String(d.occurrence_date ?? ''),
    status: (d.status as MeetingOccurrence['status']) ?? 'closed',
    opened_at: String(d.opened_at ?? ''),
    closed_at: (d.closed_at as string | null) ?? null,
    opened_by: (d.opened_by as string | null) ?? null,
    closed_by: (d.closed_by as string | null) ?? null,
    present_count: Number(d.present_count ?? 0),
  }
}

function recordDocToRecord(d: Models.Document & Record<string, unknown>): AttendanceRecord {
  return {
    $id: d.$id,
    $createdAt: d.$createdAt,
    occurrence_id: String(d.occurrence_id ?? ''),
    meeting_id: String(d.meeting_id ?? ''),
    member_id: String(d.member_id ?? ''),
    marked_at: String(d.marked_at ?? ''),
    method: (d.method as AttendanceRecord['method']) ?? 'biometric',
    marked_by: (d.marked_by as string | null) ?? null,
    station: (d.station as string | null) ?? null,
    note: (d.note as string | null) ?? null,
  }
}

// === Session resolution ====================================================

/**
 * The one open occurrence, hydrated with its meeting and roster size.
 *
 * Cached briefly. Every scan needs it BEFORE it can scope the gallery, and on
 * a busy Sunday morning that is several requests a second all asking the same
 * question whose answer changes twice a day. Staleness is bounded and benign:
 * the worst case is a scan landing against a session that closed seconds ago,
 * which the close path then reconciles.
 */
const ACTIVE_TTL_MS = 10_000
let activeCache: { at: number; value: ActiveSession | null } | null = null

export function invalidateActiveSession(): void {
  activeCache = null
}

export async function resolveActiveSession(
  databases: Databases,
  opts: { fresh?: boolean } = {},
): Promise<ActiveSession | null> {
  if (!opts.fresh && activeCache && Date.now() - activeCache.at < ACTIVE_TTL_MS) {
    return activeCache.value
  }

  const docs = await listAll<Models.Document & Record<string, unknown>>(
    databases,
    COLLECTIONS.meeting_occurrences,
    [Query.equal('status', 'open')],
  )
  const resolved = resolveOpenOccurrence(docs.map(occurrenceDocToOccurrence))

  if (resolved.kind === 'multiple') {
    // Refuse rather than guess. See occurrenceResolver.ts.
    throw new Error(
      `${resolved.occurrences.length} sessions are open at once ` +
        `(${resolved.occurrences.map((o) => o.$id).join(', ')}). ` +
        'Close all but one before recording attendance.',
    )
  }
  if (resolved.kind === 'none') {
    activeCache = { at: Date.now(), value: null }
    return null
  }

  const occurrence = resolved.occurrence
  const meetingDoc = await databases.getDocument(
    DATABASE_ID,
    COLLECTIONS.meetings,
    occurrence.meeting_id,
  )
  const meeting = meetingDocToMeeting(meetingDoc as Models.Document & Record<string, unknown>)
  const roster_size = meeting.restricted
    ? (await rosterMemberIds(databases, meeting.$id)).length
    : 0

  const value: ActiveSession = { occurrence, meeting, roster_size }
  activeCache = { at: Date.now(), value }
  return value
}

// === Activate / close ======================================================

export type ActivateOutcome =
  | { ok: true; session: ActiveSession }
  | { ok: false; error: string; conflict?: ActiveSession }

/**
 * Open an occurrence for `meetingId`.
 *
 * The single-active-session invariant (PRD §2.2) is enforced HERE, on the
 * server, and this is the only place it is enforced. The Services page also
 * greys out the button, but that is a courtesy — a second browser tab, a stale
 * page, or a curl would otherwise walk straight past it.
 */
export async function activateOccurrence(
  databases: Databases,
  meetingId: string,
  openedBy: string,
): Promise<ActivateOutcome> {
  let meeting: Meeting
  try {
    meeting = meetingDocToMeeting(
      (await databases.getDocument(
        DATABASE_ID,
        COLLECTIONS.meetings,
        meetingId,
      )) as Models.Document & Record<string, unknown>,
    )
  } catch {
    return { ok: false, error: 'That meeting no longer exists.' }
  }

  // Read fresh, not through the cache — this is the check the invariant rests
  // on, and a 10-second-old answer is exactly long enough to let two
  // activations through.
  const existing = await resolveActiveSession(databases, { fresh: true })
  const check = canActivate(meeting, existing ? [existing.occurrence] : [])

  if (!check.ok) {
    if (check.reason === 'archived') {
      return { ok: false, error: `${meeting.name} is archived. Restore it before activating.` }
    }
    return {
      ok: false,
      error:
        `${existing!.meeting.name} is still open. End it before activating ${meeting.name} — ` +
        'only one session can run at a time.',
      conflict: existing!,
    }
  }

  const now = new Date()
  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.meeting_occurrences,
    ID.unique(),
    {
      meeting_id: meetingId,
      occurrence_date: todayInAccra(now),
      status: 'open',
      opened_at: now.toISOString(),
      closed_at: null,
      opened_by: openedBy,
      closed_by: null,
      present_count: 0,
    },
  )

  invalidateActiveSession()
  const occurrence = occurrenceDocToOccurrence(doc as Models.Document & Record<string, unknown>)
  const roster_size = meeting.restricted
    ? (await rosterMemberIds(databases, meeting.$id)).length
    : 0
  return { ok: true, session: { occurrence, meeting, roster_size } }
}

export async function closeOccurrence(
  databases: Databases,
  occurrenceId: string,
  closedBy: string,
): Promise<
  | { ok: true; occurrence: MeetingOccurrence; present_count: number }
  | { ok: false; error: string }
> {
  let occurrence: MeetingOccurrence
  try {
    occurrence = occurrenceDocToOccurrence(
      (await databases.getDocument(
        DATABASE_ID,
        COLLECTIONS.meeting_occurrences,
        occurrenceId,
      )) as Models.Document & Record<string, unknown>,
    )
  } catch {
    return { ok: false, error: 'That session no longer exists.' }
  }
  if (occurrence.status !== 'open') {
    return { ok: false, error: 'That session is already closed.' }
  }

  // Freeze the tally at close so history does not have to re-count thousands
  // of rows every time someone opens a report.
  const records = await listAll(databases, COLLECTIONS.attendance_records, [
    Query.equal('occurrence_id', occurrenceId),
    Query.select(['$id']),
  ])

  const updated = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.meeting_occurrences,
    occurrenceId,
    {
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: closedBy,
      present_count: records.length,
    },
  )
  invalidateActiveSession()

  return {
    ok: true,
    occurrence: occurrenceDocToOccurrence(updated as Models.Document & Record<string, unknown>),
    present_count: records.length,
  }
}

// === Marking attendance ====================================================

async function findMember(databases: Databases, memberId: string): Promise<Member | null> {
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.members, memberId)
    return memberDocToMember(doc as MemberDoc)
  } catch {
    return null
  }
}

async function existingRecord(
  databases: Databases,
  occurrenceId: string,
  memberId: string,
): Promise<AttendanceRecord | null> {
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.attendance_records, [
    Query.equal('occurrence_id', occurrenceId),
    Query.equal('member_id', memberId),
    Query.limit(1),
  ])
  if (res.documents.length === 0) return null
  return recordDocToRecord(res.documents[0] as Models.Document & Record<string, unknown>)
}

async function isOnRoster(
  databases: Databases,
  meetingId: string,
  memberId: string,
): Promise<boolean> {
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.meeting_members, [
    Query.equal('meeting_id', meetingId),
    Query.equal('member_id', memberId),
    Query.limit(1),
  ])
  return res.documents.length > 0
}

async function countRecords(databases: Databases, occurrenceId: string): Promise<number> {
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.attendance_records, [
    Query.equal('occurrence_id', occurrenceId),
    Query.limit(1),
  ])
  // `.total` is capped server-side by _APP_DATABASE_COUNT_LIMIT, but the cap is
  // far above any single church gathering, and this number only drives a
  // "you are the Nth here" nicety on the kiosk.
  return res.total
}

/**
 * The shared tail of both scan and manual: given an identified member, decide
 * the outcome and write if it is a new mark.
 */
async function resolveAndRecord(
  databases: Databases,
  session: ActiveSession,
  member: Member,
  opts: { method: 'biometric' | 'manual'; markedBy: string | null; station: string | null; note: string | null; dryRun: boolean },
): Promise<ScanResult> {
  const summary = toMemberSummary(member)

  if (member.status !== 'active') {
    return { kind: 'inactive_member', member: summary }
  }

  // Authorisation. A service is open to every active member regardless of
  // which service they usually attend (PRD §2.1) — `restricted` is false on
  // both service rows and that is checked here, not assumed.
  if (session.meeting.restricted) {
    const authorised = await isOnRoster(databases, session.meeting.$id, member.$id)
    if (!authorised) {
      // Identified but refused. The member's NAME goes back so the kiosk can
      // say who they are and why they cannot mark attendance here.
      return {
        kind: 'not_authorised',
        member: summary,
        meeting_name: session.meeting.name,
      }
    }
  }

  const already = await existingRecord(databases, session.occurrence.$id, member.$id)
  if (already) {
    return { kind: 'already_marked', member: summary, marked_at: already.marked_at }
  }

  const marked_at = new Date().toISOString()
  if (opts.dryRun) {
    return { kind: 'marked', member: summary, marked_at, sequence: 0 }
  }

  const payload: AttendanceRecordPayload = {
    occurrence_id: session.occurrence.$id,
    meeting_id: session.meeting.$id,
    member_id: member.$id,
    marked_at,
    method: opts.method,
    marked_by: opts.markedBy,
    station: opts.station,
    note: opts.note,
  }

  try {
    await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.attendance_records,
      ID.unique(),
      payload,
    )
  } catch (e) {
    // The unique index on (occurrence_id, member_id) is what makes the
    // duplicate guarantee real. Losing that race means somebody else marked
    // them a millisecond ago — which is `already_marked`, not an error.
    if (e && typeof e === 'object' && (e as { code?: number }).code === 409) {
      return { kind: 'already_marked', member: summary, marked_at }
    }
    throw e
  }

  return {
    kind: 'marked',
    member: summary,
    marked_at,
    sequence: await countRecords(databases, session.occurrence.$id),
  }
}

export async function processScan(
  databases: Databases,
  session: ActiveSession,
  req: ScanRequest,
): Promise<ScanResult> {
  // Scope the gallery to who could plausibly be here. For a restricted meeting
  // that is the roster (with a fall-through to everyone, so an unauthorised
  // person is still identified); for a service it is every active member.
  const biometric = getBiometricService({
    databases,
    scope: { meeting_id: session.meeting.$id, restricted: session.meeting.restricted },
  })

  const match = await biometric.match(req.fingerprint_data)
  if (!match) return { kind: 'no_match' }

  const member = await findMember(databases, match.member_id)
  if (!member) {
    // The matcher named a member who is no longer in the registry — a deleted
    // member whose templates outlived them. That is a stale gallery, not an
    // unknown finger, but from the person's point of view the outcome is the
    // same and there is nothing useful to show them.
    console.warn(`[attendance] matched unknown member_id ${match.member_id}`)
    return { kind: 'no_match' }
  }

  return resolveAndRecord(databases, session, member, {
    method: 'biometric',
    markedBy: null,
    station: req.station ?? null,
    note: null,
    dryRun: false,
  })
}

export async function processManual(
  databases: Databases,
  session: ActiveSession,
  req: ManualRequest,
  markedBy: string,
): Promise<ScanResult> {
  const member = await findMember(databases, req.member_id)
  if (!member) return { kind: 'no_match' }

  return resolveAndRecord(databases, session, member, {
    method: 'manual',
    markedBy,
    station: req.station ?? null,
    note: req.note ?? null,
    dryRun: req.dry_run === true,
  })
}

// === Reads =================================================================

/** How many people this occurrence expects: a roster for a restricted meeting,
 *  the active membership for an open service. */
async function expectedFor(databases: Databases, session: ActiveSession): Promise<number> {
  if (session.meeting.restricted) return session.roster_size
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.members, [
    Query.equal('status', 'active'),
    Query.limit(1),
  ])
  return res.total
}

export async function loadLiveStats(
  databases: Databases,
  session: ActiveSession,
): Promise<LiveStats> {
  const [docs, expected] = await Promise.all([
    listAll<Models.Document & Record<string, unknown>>(
      databases,
      COLLECTIONS.attendance_records,
      [Query.equal('occurrence_id', session.occurrence.$id)],
    ),
    expectedFor(databases, session),
  ])
  return aggregateLive(
    session.occurrence.$id,
    session.meeting.$id,
    expected,
    docs.map(recordDocToRecord),
  )
}

/**
 * Paged record log, each row joined to a member summary.
 *
 * Appwrite has no joins, so the members are fetched in one chunked follow-up
 * query and merged in memory.
 */
export async function loadOccurrenceRecords(
  databases: Databases,
  occurrenceId: string,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<{ records: (AttendanceRecord & { member: MemberSummary })[]; cursor: string | null }> {
  const limit = opts.limit ?? 50
  const queries: string[] = [
    Query.equal('occurrence_id', occurrenceId),
    Query.orderDesc('$createdAt'),
    Query.limit(limit),
  ]
  if (opts.cursor) queries.push(Query.cursorAfter(opts.cursor))

  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.attendance_records, queries)
  const records = res.documents.map((d) =>
    recordDocToRecord(d as Models.Document & Record<string, unknown>),
  )

  const memberIds = [...new Set(records.map((r) => r.member_id))]
  const members = new Map<string, MemberSummary>()
  const CHUNK = 100
  for (let i = 0; i < memberIds.length; i += CHUNK) {
    const page = await databases.listDocuments(DATABASE_ID, COLLECTIONS.members, [
      Query.equal('$id', memberIds.slice(i, i + CHUNK)),
      Query.limit(CHUNK),
    ])
    for (const d of page.documents) {
      const m = memberDocToMember(d as MemberDoc)
      members.set(m.$id, toMemberSummary(m))
    }
  }

  const joined = records.map((r) => ({
    ...r,
    member: members.get(r.member_id) ?? {
      $id: r.member_id,
      // A record whose member was deleted still belongs in the log — dropping
      // it would silently shrink a historical count.
      full_name: 'Deleted member',
      photo_file_id: null,
      home_service: 'second' as const,
    },
  }))

  const nextCursor =
    res.documents.length === limit ? res.documents[res.documents.length - 1].$id : null
  return { records: joined, cursor: nextCursor }
}
