// Pure rules about which occurrence is live and whether a new one may open.
//
// SEMP resolved its active session from the WALL CLOCK — an exam slot has a
// timetabled start and end, so the kiosk could derive it. A church service
// starts when it starts. So here the source of truth is an explicit admin
// action, and this module is about the INVARIANT rather than about time:
//
//   at most one occurrence is `open`, globally, at any moment (PRD §2.2).
//
// Kept pure and separate from the Appwrite writes so the invariant can be
// tested without a database.

import { CHURCH_TIMEZONE, SERVICE_IDS, isAdultServiceSlot } from '@/lib/appwrite/config'
import { isCompanion, type Meeting, type MeetingOccurrence } from '@/lib/meetings/types'
import type { Member } from '@/lib/members/types'

/** YYYY-MM-DD for a Date in Accra. */
export function todayInAccra(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHURCH_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export type ResolveResult =
  | { kind: 'open'; occurrence: MeetingOccurrence }
  | { kind: 'none' }
  /**
   * Defensive. The unique-ish invariant is enforced at write time, but two
   * admins racing on a slow link could in principle both win. If it ever
   * happens the caller must refuse to record attendance rather than pick one
   * arbitrarily — an attendance row against a guessed session is worse than a
   * clear error.
   */
  | { kind: 'multiple'; occurrences: MeetingOccurrence[] }

/**
 * The occurrences that can hold the scanner: `open`, and NOT a companion.
 *
 * A Save Church companion is `open` for the whole of its parent service, so a
 * status filter alone would see two open rows every Sunday and refuse to mark
 * anyone. The single-open rule is about who holds the scanner, and a companion
 * never does — it is written to only through the redirect in
 * `resolveAndRecord`, never scanned against directly.
 */
export function scannerHolders(occurrences: MeetingOccurrence[]): MeetingOccurrence[] {
  return occurrences.filter((o) => o.status === 'open' && !isCompanion(o))
}

/**
 * A PAUSED occurrence is not open, and that single fact is the whole pause
 * feature. It is not filtered out here as a special case — it simply is not
 * `open`, so the kiosk sees no session and stops scanning, and `canActivate`
 * below sees nothing in the way and lets another activity start. Both
 * behaviours the church asked for fall out of the one status value.
 */
export function resolveOpenOccurrence(occurrences: MeetingOccurrence[]): ResolveResult {
  const open = scannerHolders(occurrences)
  if (open.length === 0) return { kind: 'none' }
  if (open.length === 1) return { kind: 'open', occurrence: open[0] }
  return { kind: 'multiple', occurrences: open }
}

/**
 * The paused sessions, for the Services page and the kiosk's idle screen.
 *
 * Companions are excluded for the same reason as above: pause leaves them
 * alone (they have no liveness of their own), so one can only be `paused` by a
 * hand edit — and listing it would offer a Resume button for a session that
 * cannot be resumed on its own.
 */
export function pausedOccurrences(occurrences: MeetingOccurrence[]): MeetingOccurrence[] {
  return occurrences.filter((o) => o.status === 'paused' && !isCompanion(o))
}

/** The open companion of `parentId`, if it is in the list. */
export function companionOf(
  parentId: string,
  occurrences: MeetingOccurrence[],
): MeetingOccurrence | null {
  return (
    occurrences.find((o) => o.parent_occurrence_id === parentId && o.status === 'open') ?? null
  )
}

export type ActivationCheck =
  | { ok: true }
  | { ok: false; reason: 'already_open'; blocking: MeetingOccurrence }
  | { ok: false; reason: 'archived' }
  /** Save Church. It opens WITH an adult service, never by itself. */
  | { ok: false; reason: 'companion_only' }

export type ResumeCheck =
  | { ok: true }
  | { ok: false; reason: 'not_paused' }
  | { ok: false; reason: 'already_open'; blocking: MeetingOccurrence }

/**
 * May `meeting` be activated right now, given everything currently open?
 *
 * The rule the church actually asked for — "First Service must be ended before
 * Second Service can be activated" — falls out of the general one rather than
 * being special-cased on the two services. That matters: a special case would
 * have let a committee meeting run during First Service, which is the same
 * ambiguity for a kiosk to resolve and the same bug wearing a different hat.
 *
 * Note what is deliberately NOT enforced: Second Service does not require that
 * First Service already ran today. A Sunday with only one service is normal,
 * and a rule that blocked it would be discovered at 9am on that Sunday.
 *
 * Nor does a PAUSED session block anything. Pausing exists so that a second
 * activity can take attendance in the middle of a service; a pause that still
 * held the slot would relieve the scanner and achieve nothing else.
 *
 * Save Church is refused outright. It has no session of its own: it is a
 * COMPANION opened by First or Second Service's activation, and activating it
 * alone would put a children's service on the scanner with no adult service
 * for children to be redirected FROM.
 */
export function canActivate(
  meeting: Pick<Meeting, '$id' | 'archived'>,
  openOccurrences: MeetingOccurrence[],
): ActivationCheck {
  if (meeting.$id === SERVICE_IDS.save) return { ok: false, reason: 'companion_only' }
  if (meeting.archived) return { ok: false, reason: 'archived' }
  const open = scannerHolders(openOccurrences)
  if (open.length > 0) return { ok: false, reason: 'already_open', blocking: open[0] }
  return { ok: true }
}

/**
 * The sentence shown to an admin whose activation was refused. Naming the
 * blocking session is the whole value — "end First Service first" is
 * actionable, "something is already running" sends them hunting.
 */
export function activationBlockedMessage(blockingMeetingName: string, wanted: string): string {
  return (
    `${blockingMeetingName} is still open. End it before activating ${wanted} — ` +
    'only one session can run at a time.'
  )
}

/** The sentence shown when somebody tries to activate Save Church by itself. */
export function companionOnlyMessage(meetingName: string): string {
  return `${meetingName} opens with First or Second Service and cannot be activated on its own.`
}

/**
 * May this paused occurrence be resumed right now?
 *
 * The mirror of `canActivate`, and it has to exist separately rather than being
 * folded into it: activating CREATES an occurrence, resuming returns an
 * existing one to `open`, and only the second can fail because the thing being
 * resumed is not actually paused.
 *
 * The single-active invariant is the same one. Pausing First Service to run a
 * committee meeting is the point of the feature — but resuming First Service
 * while that committee meeting is still open would put two sessions on the
 * scanner at once, which is exactly what PRD §2.2 forbids. So a resume is
 * refused, naming the meeting in the way, and the admin ends that one first.
 */
export function canResume(
  occurrence: Pick<MeetingOccurrence, 'status'>,
  openOccurrences: MeetingOccurrence[],
): ResumeCheck {
  if (occurrence.status !== 'paused') return { ok: false, reason: 'not_paused' }
  const open = scannerHolders(openOccurrences)
  if (open.length > 0) return { ok: false, reason: 'already_open', blocking: open[0] }
  return { ok: true }
}

/** The sentence shown when a resume is refused because something else is open. */
export function resumeBlockedMessage(blockingMeetingName: string, wanted: string): string {
  return (
    `${blockingMeetingName} is open. End it before resuming ${wanted} — ` +
    'only one session can run at a time.'
  )
}

// === Where a mark lands ====================================================

export type AttendanceTarget = 'parent' | 'companion'

/**
 * Which occurrence a member's mark is written to.
 *
 * `companion` — Save Church — exactly when a CHILD touches the scanner during
 * an ADULT SERVICE. Every other combination is the open session itself:
 *
 *   - an adult or student at a service: the service, as today.
 *   - a child at a restricted meeting (or any non-service): the meeting, where
 *     the roster decides as it always has. A children's committee is a real
 *     thing, and redirecting its members to Save Church would make it
 *     impossible to take.
 *
 * Pure, and decided from the member's TYPE rather than from `home_service`,
 * which never gates attendance (PRD §2.1). `member_type === 'child'` is the
 * one field whose whole job is to change what the kiosk does.
 */
export function attendanceTarget(
  session: { meeting: Pick<Meeting, 'kind' | 'service_slot'> },
  member: Pick<Member, 'member_type'>,
): AttendanceTarget {
  if (member.member_type !== 'child') return 'parent'
  if (session.meeting.kind !== 'service') return 'parent'
  return isAdultServiceSlot(session.meeting.service_slot) ? 'companion' : 'parent'
}
