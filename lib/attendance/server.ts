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

import {
  COLLECTIONS,
  DATABASE_ID,
  SERVICE_IDS,
  isAdultServiceSlot,
  isMemberType,
} from '@/lib/appwrite/config'
import { getBiometricService } from '@/lib/services/biometricService'
import { rosterMemberIds, warmCandidateCache } from '@/lib/biometrics/server'
import { isMemberTitle } from '@/lib/members/titles'
import { fullName, type Member } from '@/lib/members/types'
import {
  isCompanion,
  type ActiveSession,
  type Meeting,
  type MeetingOccurrence,
} from '@/lib/meetings/types'
import { aggregateLive } from './liveStats'
import {
  attendanceTarget,
  canActivate,
  canResume,
  companionOf,
  companionOnlyMessage,
  pausedOccurrences,
  resolveOpenOccurrence,
  resumeBlockedMessage,
  todayInAccra,
} from './occurrenceResolver'
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
    // `|| null` for the same reason as `constituency_id` below — an unset
    // optional string arrives as `''`, which would render as a blank number
    // rather than as "not assigned yet".
    member_no: (d.member_no as string | null) || null,
    // Narrowed, not cast: a code that is not in the list — hand-edited in the
    // console, or left behind by a title since removed — reads as "no title"
    // rather than being rendered raw into a message the church pays for.
    title: isMemberTitle(d.title) ? d.title : null,
    first_name: String(d.first_name ?? ''),
    last_name: String(d.last_name ?? ''),
    other_names: (d.other_names as string | null) ?? null,
    photo_file_id: (d.photo_file_id as string | null) ?? null,
    birth_month: (d.birth_month as number | null) ?? null,
    birth_day: (d.birth_day as number | null) ?? null,
    address: (d.address as string | null) ?? null,
    // `|| null`: a child registered without a number has '' here, and '' is
    // not a number anybody can ring.
    call_number: (d.call_number as string | null) || null,
    whatsapp_number: (d.whatsapp_number as string | null) ?? null,
    home_service: d.home_service === 'first' ? 'first' : 'second',
    // Narrowed, not cast, and absent reads as `adult`: every row written before
    // the field existed is an adult, and the wrong reading in the other
    // direction would stop texting somebody or redirect them to Save Church.
    member_type: isMemberType(d.member_type) ? d.member_type : 'adult',
    programme: (d.programme as string | null) || null,
    level: typeof d.level === 'number' ? d.level : null,
    level_year: typeof d.level_year === 'number' ? d.level_year : null,
    guardian_name: (d.guardian_name as string | null) || null,
    // `|| null`, not `?? null`: an unset optional string comes back from
    // Appwrite as `''`, and `''` would compare unequal to every real
    // constituency id while still being truthy in a `if (m.constituency_id)`.
    constituency_id: (d.constituency_id as string | null) || null,
    // `|| null` for the same reason as `constituency_id` above: Appwrite hands
    // back `''` for an unset optional string, and `''` is truthy enough to send
    // a lookup after a bacenta that cannot exist.
    bacenta_id: (d.bacenta_id as string | null) || null,
    care_of_member_id: (d.care_of_member_id as string | null) || null,
    status: (d.status as Member['status']) ?? 'active',
    // `=== true` and not a cast: a row written before the backfill has no such
    // field, and `undefined` must read as "not a partner". The other direction
    // texts somebody, at the church's expense, about a commitment they never
    // made.
    benmp_partner: d.benmp_partner === true,
    created_by: (d.created_by as string | null) ?? null,
    // `|| null` for the same reason as `constituency_id` above: Appwrite hands
    // back `''` for an unset optional string, and `''` is truthy enough to
    // send `resolveBirthdayTemplate` looking up a template that cannot exist.
    sms_template_id: (d.sms_template_id as string | null) || null,
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
    // `|| null` and not `?? null`: Appwrite hands back an unset optional string
    // as '', and an empty string here would render as a paused-at time of
    // nothing rather than as "never paused".
    paused_at: (d.paused_at as string | null) || null,
    closed_at: (d.closed_at as string | null) ?? null,
    opened_by: (d.opened_by as string | null) ?? null,
    closed_by: (d.closed_by as string | null) ?? null,
    present_count: Number(d.present_count ?? 0),
    // `|| null`: an unset optional string is '' from Appwrite, and '' would
    // make every ordinary occurrence look like a companion of nothing.
    parent_occurrence_id: (d.parent_occurrence_id as string | null) || null,
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
/**
 * What is running right now: the one open session, and anything paused.
 *
 * The two travel together because they come from ONE query and answer one
 * question. Every caller that wants to know whether the scanner is armed also
 * needs to tell "nothing is running" apart from "First Service is paused" —
 * splitting them would be a second poll for half an answer.
 */
export type SessionSnapshot = { session: ActiveSession | null; paused: ActiveSession[] }

let activeCache: { at: number; value: SessionSnapshot } | null = null

export function invalidateActiveSession(): void {
  activeCache = null
}

async function loadMeeting(databases: Databases, meetingId: string): Promise<Meeting> {
  const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.meetings, meetingId)
  return meetingDocToMeeting(doc as Models.Document & Record<string, unknown>)
}

/** The open Save Church companion of `parentId`, straight from the database. */
async function findCompanionOccurrence(
  databases: Databases,
  parentId: string,
): Promise<MeetingOccurrence | null> {
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.meeting_occurrences, [
    Query.equal('parent_occurrence_id', parentId),
    Query.equal('status', 'open'),
    Query.limit(1),
  ])
  if (res.documents.length === 0) return null
  return occurrenceDocToOccurrence(res.documents[0] as Models.Document & Record<string, unknown>)
}

/**
 * A companion occurrence with its meeting, or null when the companion's
 * meeting row is gone — a companion pointing at a deleted Save Church is not
 * worth failing the whole session over, and the redirect will say so itself.
 */
async function hydrateCompanion(
  databases: Databases,
  occurrence: MeetingOccurrence | null,
): Promise<ActiveSession['companion']> {
  if (!occurrence) return null
  try {
    return { occurrence, meeting: await loadMeeting(databases, occurrence.meeting_id) }
  } catch {
    return null
  }
}

/**
 * An occurrence plus its meeting, roster size and companion.
 *
 * `siblings` is the list the caller already fetched (every open and paused
 * row), so the companion is found without a second round trip on the poll
 * every screen makes. Without it the companion is looked up directly.
 */
export async function hydrateSession(
  databases: Databases,
  occurrence: MeetingOccurrence,
  siblings?: MeetingOccurrence[],
): Promise<ActiveSession> {
  const meeting = await loadMeeting(databases, occurrence.meeting_id)
  const roster_size = meeting.restricted
    ? (await rosterMemberIds(databases, meeting.$id)).length
    : 0
  const companionOccurrence = siblings
    ? companionOf(occurrence.$id, siblings)
    : await findCompanionOccurrence(databases, occurrence.$id)
  const companion = await hydrateCompanion(databases, companionOccurrence)
  return { occurrence, meeting, roster_size, companion }
}

export async function resolveSessions(
  databases: Databases,
  opts: { fresh?: boolean } = {},
): Promise<SessionSnapshot> {
  if (!opts.fresh && activeCache && Date.now() - activeCache.at < ACTIVE_TTL_MS) {
    return activeCache.value
  }

  // Both statuses in ONE query. The kiosk polls this endpoint on a fast
  // cadence, and a second round trip per poll to find paused sessions would be
  // paid on every tick to answer "usually none".
  const docs = await listAll<Models.Document & Record<string, unknown>>(
    databases,
    COLLECTIONS.meeting_occurrences,
    [Query.equal('status', ['open', 'paused'])],
  )
  const occurrences = docs.map(occurrenceDocToOccurrence)
  const resolved = resolveOpenOccurrence(occurrences)

  if (resolved.kind === 'multiple') {
    // Refuse rather than guess. See occurrenceResolver.ts.
    throw new Error(
      `${resolved.occurrences.length} sessions are open at once ` +
        `(${resolved.occurrences.map((o) => o.$id).join(', ')}). ` +
        'Close all but one before recording attendance.',
    )
  }

  const paused: ActiveSession[] = []
  for (const o of pausedOccurrences(occurrences)) {
    try {
      paused.push(await hydrateSession(databases, o, occurrences))
    } catch {
      // Its meeting was deleted out from under it. A paused session nobody can
      // name is not worth failing the whole endpoint over — the kiosk and the
      // header both depend on this call answering.
    }
  }

  const session =
    resolved.kind === 'open'
      ? await hydrateSession(databases, resolved.occurrence, occurrences)
      : null
  const value: SessionSnapshot = { session, paused }
  activeCache = { at: Date.now(), value }
  return value
}

/** Just the open one. The shape almost every caller wants. */
export async function resolveActiveSession(
  databases: Databases,
  opts: { fresh?: boolean } = {},
): Promise<ActiveSession | null> {
  return (await resolveSessions(databases, opts)).session
}

// === Activate / close ======================================================

export type ActivateOutcome =
  | { ok: true; session: ActiveSession }
  | {
      ok: false
      error: string
      conflict?: ActiveSession
      /** Set when the refusal is a rule about the MEETING rather than about
       *  what is open, so the route can pick a status without parsing text. */
      reason?: 'companion_only'
    }

/**
 * The fields every new occurrence row is written with. Spelled out once so the
 * parent and its companion cannot drift — `present_count: 0` and the three
 * nulls are what `closeOccurrence` and the mappers rely on.
 */
function newOccurrenceFields(
  meetingId: string,
  now: Date,
  openedBy: string,
  parentOccurrenceId: string | null,
) {
  return {
    meeting_id: meetingId,
    occurrence_date: todayInAccra(now),
    status: 'open' as const,
    opened_at: now.toISOString(),
    paused_at: null,
    closed_at: null,
    opened_by: openedBy,
    closed_by: null,
    present_count: 0,
    parent_occurrence_id: parentOccurrenceId,
  }
}

/**
 * Open the Save Church companion of `parent`.
 *
 * Throws if the Save Church meeting row does not exist. That is a project the
 * setup script has not been run on, and the message says so — a companion for
 * a meeting that is not there would be a row nobody could ever name.
 */
async function createCompanion(
  databases: Databases,
  parent: MeetingOccurrence,
  openedBy: string,
): Promise<NonNullable<ActiveSession['companion']>> {
  let meeting: Meeting
  try {
    meeting = await loadMeeting(databases, SERVICE_IDS.save)
  } catch {
    throw new Error(
      'Save Church is not set up on this project — run `npm run setup:appwrite` to seed it.',
    )
  }
  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.meeting_occurrences,
    ID.unique(),
    newOccurrenceFields(meeting.$id, new Date(), openedBy, parent.$id),
  )
  return {
    occurrence: occurrenceDocToOccurrence(doc as Models.Document & Record<string, unknown>),
    meeting,
  }
}

/**
 * Today's open Save Church companion for `session`, found or created.
 *
 * Exists for the service that was ALREADY open when this shipped: its
 * activation predates companions, so the first child to scan would otherwise
 * have nowhere to go. Called only on the redirect path, so a session with no
 * children present never grows a companion it does not need after the fact —
 * activation is what creates one in the ordinary case.
 */
export async function ensureCompanion(
  databases: Databases,
  session: ActiveSession,
): Promise<NonNullable<ActiveSession['companion']>> {
  const existing = await hydrateCompanion(
    databases,
    await findCompanionOccurrence(databases, session.occurrence.$id),
  )
  if (existing) return existing
  const created = await createCompanion(
    databases,
    session.occurrence,
    session.occurrence.opened_by ?? 'system',
  )
  // The cached snapshot says `companion: null`; the next poll must not.
  invalidateActiveSession()
  return created
}

/**
 * Open an occurrence for `meetingId`.
 *
 * The single-active-session invariant (PRD §2.2) is enforced HERE, on the
 * server, and this is the only place it is enforced. The Services page also
 * greys out the button, but that is a courtesy — a second browser tab, a stale
 * page, or a curl would otherwise walk straight past it.
 *
 * Activating First or Second Service ALSO opens a Save Church companion for
 * it, in the same call. Children who scan during the service are redirected
 * there by `resolveAndRecord`; nobody has to remember to open it.
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
    if (check.reason === 'companion_only') {
      return { ok: false, error: companionOnlyMessage(meeting.name), reason: 'companion_only' }
    }
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

  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.meeting_occurrences,
    ID.unique(),
    newOccurrenceFields(meetingId, new Date(), openedBy, null),
  )
  const occurrence = occurrenceDocToOccurrence(doc as Models.Document & Record<string, unknown>)

  // The children's service runs alongside both adult services and nowhere
  // else. A restricted meeting, or Save Church itself, gets no companion.
  let companion: ActiveSession['companion'] = null
  if (meeting.kind === 'service' && isAdultServiceSlot(meeting.service_slot)) {
    try {
      companion = await createCompanion(databases, occurrence, openedBy)
    } catch (e) {
      // The adult service is open and must stay open — a missing Save Church
      // row is a setup fault, not a reason to turn the congregation away. The
      // redirect path retries through `ensureCompanion` and refuses by name.
      console.warn(`[attendance] no companion for ${meeting.name}: ${(e as Error).message}`)
    }
  }

  invalidateActiveSession()
  // Start loading the gallery NOW, so the first member of the service does not
  // stand at the scanner paying for it. Fire-and-forget: activation must not
  // wait on, or fail because of, a slow fetch.
  warmCandidateCache(databases, {
    meeting_id: meeting.$id,
    restricted: meeting.restricted,
  })
  const roster_size = meeting.restricted
    ? (await rosterMemberIds(databases, meeting.$id)).length
    : 0
  return { ok: true, session: { occurrence, meeting, roster_size, companion } }
}

/** The refusal for closing, pausing or resuming a companion BY ITS OWN ID. */
function companionActedOnAlone(): { ok: false; error: string } {
  return {
    ok: false,
    error:
      'Save Church runs with its parent service. End, pause or resume that service instead — ' +
      'Save Church follows it.',
  }
}

/** Freeze one occurrence: count its rows and mark it closed. */
async function closeOne(
  databases: Databases,
  occurrenceId: string,
  closedBy: string,
): Promise<{ occurrence: MeetingOccurrence; present_count: number }> {
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
  return {
    occurrence: occurrenceDocToOccurrence(updated as Models.Document & Record<string, unknown>),
    present_count: records.length,
  }
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
  // A PAUSED session may be closed directly. Requiring it to be resumed first
  // would mean re-arming the scanner for a moment purely to satisfy a state
  // machine, and a service that was paused and then simply finished is the
  // ordinary way this ends.
  if (occurrence.status === 'closed') {
    return { ok: false, error: 'That session is already closed.' }
  }
  if (isCompanion(occurrence)) return companionActedOnAlone()

  // Companions FIRST, then the parent. Each gets its own frozen tally, computed
  // from its own rows exactly as the parent's is. Every open or paused one is
  // closed, not just today's: a companion left open by a crash between the two
  // writes would otherwise sit there forever, invisible to every liveness
  // check, collecting nothing.
  const companions = await listAll<Models.Document & Record<string, unknown>>(
    databases,
    COLLECTIONS.meeting_occurrences,
    [
      Query.equal('parent_occurrence_id', occurrenceId),
      Query.equal('status', ['open', 'paused']),
      Query.select(['$id']),
    ],
  )
  for (const c of companions) await closeOne(databases, c.$id, closedBy)

  const closed = await closeOne(databases, occurrenceId, closedBy)
  invalidateActiveSession()

  return { ok: true, ...closed }
}

// === Pause / resume ========================================================

export type PauseOutcome =
  | { ok: true; session: ActiveSession }
  | { ok: false; error: string; conflict?: ActiveSession }

async function loadOccurrence(
  databases: Databases,
  occurrenceId: string,
): Promise<MeetingOccurrence | null> {
  try {
    return occurrenceDocToOccurrence(
      (await databases.getDocument(
        DATABASE_ID,
        COLLECTIONS.meeting_occurrences,
        occurrenceId,
      )) as Models.Document & Record<string, unknown>,
    )
  } catch {
    return null
  }
}

/**
 * Pause an open session: it stays running, but lets go of the scanner.
 *
 * The church's case is a service that has not ended while a different activity
 * needs to take attendance. Ending the service would freeze its tally and turn
 * the rest of it into a second occurrence with a second count; making the other
 * activity wait is not an option either.
 *
 * Nothing is frozen here and no tally is written — `present_count` is still
 * computed at close, from the rows, so attendance marked before the pause and
 * after the resume lands in the SAME occurrence and is counted once.
 */
export async function pauseOccurrence(
  databases: Databases,
  occurrenceId: string,
  pausedBy: string,
): Promise<PauseOutcome> {
  const occurrence = await loadOccurrence(databases, occurrenceId)
  if (!occurrence) return { ok: false, error: 'That session no longer exists.' }

  if (occurrence.status === 'closed') {
    return { ok: false, error: 'That session has already ended.' }
  }
  if (occurrence.status === 'paused') {
    return { ok: false, error: 'That session is already paused.' }
  }
  if (isCompanion(occurrence)) return companionActedOnAlone()

  // The companion is left alone. Pausing takes the PARENT off the scanner, and
  // the redirect only ever runs from an open parent — so a companion with no
  // liveness of its own stops receiving marks without changing status.
  const updated = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.meeting_occurrences,
    occurrenceId,
    { status: 'paused', paused_at: new Date().toISOString() },
  )
  // Without this the kiosk keeps accepting scans for up to the cache TTL after
  // the admin was told the session was paused.
  invalidateActiveSession()

  void pausedBy
  return {
    ok: true,
    session: await hydrateSession(
      databases,
      occurrenceDocToOccurrence(updated as Models.Document & Record<string, unknown>),
    ),
  }
}

/**
 * Return a paused session to `open`.
 *
 * Refused while something else is open — that would put two sessions on the
 * scanner at once, which is the one thing PRD §2.2 forbids. The refusal names
 * the meeting in the way, because "end the committee meeting first" is
 * actionable and "cannot resume" is not.
 */
export async function resumeOccurrence(
  databases: Databases,
  occurrenceId: string,
  resumedBy: string,
): Promise<PauseOutcome> {
  const occurrence = await loadOccurrence(databases, occurrenceId)
  if (!occurrence) return { ok: false, error: 'That session no longer exists.' }
  if (isCompanion(occurrence)) return companionActedOnAlone()

  // Fresh, not cached — this is the check the single-active invariant rests on,
  // and a ten-second-old answer is exactly long enough to let two through.
  const existing = await resolveActiveSession(databases, { fresh: true })
  const check = canResume(occurrence, existing ? [existing.occurrence] : [])

  if (!check.ok) {
    if (check.reason === 'not_paused') {
      return {
        ok: false,
        error:
          occurrence.status === 'open'
            ? 'That session is already running.'
            : 'That session has ended and cannot be resumed. Activate it again instead.',
      }
    }
    const wanted = (await loadMeetingName(databases, occurrence.meeting_id)) ?? 'that session'
    return {
      ok: false,
      error: resumeBlockedMessage(existing!.meeting.name, wanted),
      conflict: existing!,
    }
  }

  const updated = await databases.updateDocument(
    DATABASE_ID,
    COLLECTIONS.meeting_occurrences,
    occurrenceId,
    { status: 'open', paused_at: null },
  )
  invalidateActiveSession()

  void resumedBy
  const session = await hydrateSession(
    databases,
    occurrenceDocToOccurrence(updated as Models.Document & Record<string, unknown>),
  )
  // Same reason as activation: the scanner is about to be live again, and the
  // gallery may have aged out during the pause.
  warmCandidateCache(databases, {
    meeting_id: session.meeting.$id,
    restricted: session.meeting.restricted,
  })
  return { ok: true, session }
}


async function loadMeetingName(databases: Databases, meetingId: string): Promise<string | null> {
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.meetings, meetingId)
    return meetingDocToMeeting(doc as Models.Document & Record<string, unknown>).name
  } catch {
    return null
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
  // every service row and that is checked here, not assumed.
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

  // WHERE the mark lands. A child at an adult service goes to the Save Church
  // companion; everyone else, and every child at a non-service, goes to the
  // open session. From here down every read and write is against `target`,
  // never `session.occurrence` — the two are the same row for almost everyone,
  // and the one place they differ is the whole feature.
  const redirected = attendanceTarget(session, member) === 'companion'
  const target = redirected
    ? (session.companion ?? (await ensureCompanion(databases, session)))
    : { occurrence: session.occurrence, meeting: session.meeting }
  const meeting_name = target.meeting.name

  const already = await existingRecord(databases, target.occurrence.$id, member.$id)
  if (already) {
    // The database says they are marked; teach the ordering hint, which may be
    // a fresh instance that has seen nothing yet.
    noteMarked(target.occurrence.$id, member.$id)
    return {
      kind: 'already_marked',
      member: summary,
      marked_at: already.marked_at,
      meeting_name,
      redirected,
    }
  }

  const marked_at = new Date().toISOString()
  if (opts.dryRun) {
    return { kind: 'marked', member: summary, marked_at, sequence: 0, meeting_name, redirected }
  }

  const payload: AttendanceRecordPayload = {
    occurrence_id: target.occurrence.$id,
    meeting_id: target.meeting.$id,
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
      // They ARE marked, so the ordering hint should know it even though this
      // path did not write the row.
      noteMarked(target.occurrence.$id, member.$id)
      return { kind: 'already_marked', member: summary, marked_at, meeting_name, redirected }
    }
    throw e
  }

  // Ordering hint only — they now go to the back of the gallery for subsequent
  // scans at this occurrence. Never read as truth; see `markedByOccurrence`.
  // Keyed by the TARGET, so a child marked at Save Church is noted under the
  // companion; the parent's hint stays about the parent, and being a hint it
  // is allowed to know nothing about them.
  noteMarked(target.occurrence.$id, member.$id)

  return {
    kind: 'marked',
    member: summary,
    marked_at,
    sequence: await countRecords(databases, target.occurrence.$id),
    meeting_name,
    redirected,
  }
}

/**
 * Who has already been marked at an occurrence, for ORDERING only.
 *
 * In memory and deliberately not authoritative. It is seeded by nothing and
 * grows as this process marks people, which means a freshly-started instance
 * knows nobody and simply gets no speed-up — correct, just slower. That is the
 * right failure mode for a hint: on a serverless deployment there is no shared
 * memory to be wrong about, and every consequence of being wrong is measured in
 * milliseconds rather than in a member being turned away.
 *
 * Never consult this to decide anything. `existingRecord` is the source of
 * truth for "already marked", and it asks the database.
 */
const markedByOccurrence = new Map<string, Set<string>>()

function markedSoFar(occurrenceId: string): string[] {
  return [...(markedByOccurrence.get(occurrenceId) ?? [])]
}

function noteMarked(occurrenceId: string, memberId: string): void {
  const set = markedByOccurrence.get(occurrenceId)
  if (set) set.add(memberId)
  else markedByOccurrence.set(occurrenceId, new Set([memberId]))
}

export async function processScan(
  databases: Databases,
  session: ActiveSession,
  req: ScanRequest,
): Promise<ScanResult> {
  // Scope the gallery to who could plausibly be here. For a restricted meeting
  // that is the roster (with a fall-through to everyone, so an unauthorised
  // person is still identified); for a service it is every active member.
  //
  // `already_marked` is an ordering hint, not a filter: whoever has checked in
  // already goes last, because the next person at the sensor is almost never
  // one of them. Mid-service that is half the congregation and it roughly
  // halves the work before the genuine match turns up.
  const biometric = getBiometricService({
    databases,
    scope: {
      meeting_id: session.meeting.$id,
      restricted: session.meeting.restricted,
      already_marked: markedSoFar(session.occurrence.$id),
    },
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

/** `.total` of one members query. Capped server-side, but far above any
 *  congregation this is counting. */
async function countMembers(databases: Databases, queries: string[]): Promise<number> {
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.members, [
    ...queries,
    Query.limit(1),
  ])
  return res.total
}

/**
 * How many people this occurrence expects: a roster for a restricted meeting,
 * the active membership for an open service.
 *
 * An ADULT service expects the active members who are not children — a child
 * who scans there is redirected to Save Church, so counting them would leave
 * "still to come" never reaching zero on a full house. Computed as active
 * minus active-children rather than `notEqual('member_type', 'child')`: most
 * live rows predate the field entirely, and a NOT-EQUAL never matches a row
 * where the attribute is absent, which would have counted nobody.
 */
async function expectedFor(databases: Databases, session: ActiveSession): Promise<number> {
  if (session.meeting.restricted) return session.roster_size
  const active = [Query.equal('status', 'active')]
  if (!isAdultServiceSlot(session.meeting.service_slot)) {
    return countMembers(databases, active)
  }
  const [everyone, children] = await Promise.all([
    countMembers(databases, active),
    countMembers(databases, [...active, Query.equal('member_type', 'child')]),
  ])
  return Math.max(0, everyone - children)
}

export async function loadLiveStats(
  databases: Databases,
  session: ActiveSession,
): Promise<LiveStats> {
  const [docs, expected, companionPresent] = await Promise.all([
    listAll<Models.Document & Record<string, unknown>>(
      databases,
      COLLECTIONS.attendance_records,
      [Query.equal('occurrence_id', session.occurrence.$id)],
    ),
    expectedFor(databases, session),
    session.companion ? countRecords(databases, session.companion.occurrence.$id) : null,
  ])
  return aggregateLive(
    session.occurrence.$id,
    session.meeting.$id,
    expected,
    docs.map(recordDocToRecord),
    companionPresent,
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
