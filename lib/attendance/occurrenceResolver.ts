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

import { CHURCH_TIMEZONE } from '@/lib/appwrite/config'
import type { Meeting, MeetingOccurrence } from '@/lib/meetings/types'

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

export function resolveOpenOccurrence(occurrences: MeetingOccurrence[]): ResolveResult {
  const open = occurrences.filter((o) => o.status === 'open')
  if (open.length === 0) return { kind: 'none' }
  if (open.length === 1) return { kind: 'open', occurrence: open[0] }
  return { kind: 'multiple', occurrences: open }
}

export type ActivationCheck =
  | { ok: true }
  | { ok: false; reason: 'already_open'; blocking: MeetingOccurrence }
  | { ok: false; reason: 'archived' }

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
 */
export function canActivate(
  meeting: Pick<Meeting, 'archived'>,
  openOccurrences: MeetingOccurrence[],
): ActivationCheck {
  if (meeting.archived) return { ok: false, reason: 'archived' }
  const open = openOccurrences.filter((o) => o.status === 'open')
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
