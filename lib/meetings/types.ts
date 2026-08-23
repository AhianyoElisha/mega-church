// Meeting definitions, their authorised rosters, and their dated occurrences.
// Pure types — no Appwrite imports.
//
// Vocabulary, because the distinction is load-bearing:
//   meeting     — the recurring DEFINITION ("Youth Committee").
//   occurrence  — one dated run of it, opened and closed by an admin.
//   roster      — the persistent set of members authorised for a meeting.

import type { ServiceSlot } from '@/lib/appwrite/config'

export type MeetingKind = 'service' | 'meeting'

export type Meeting = {
  $id: string
  name: string
  description: string | null
  kind: MeetingKind
  /** Set only when `kind === 'service'`. */
  service_slot: ServiceSlot | null
  /**
   * True ⇒ only members on this meeting's roster may be marked present.
   * Always false for the two services, which are open to every active member
   * regardless of `home_service` (PRD §2.1).
   */
  restricted: boolean
  archived: boolean
  sort_order: number
  created_by: string | null
  $createdAt: string
}

/** A service row is seeded, not created, and cannot be deleted. */
export function isService(m: Pick<Meeting, 'kind'>): boolean {
  return m.kind === 'service'
}

export type MeetingRosterEntry = {
  $id: string
  meeting_id: string
  member_id: string
  added_by: string | null
}

/**
 * `paused` is a session that is still RUNNING but has let go of the scanner.
 *
 * The church's case: a service has not ended, but a different activity has to
 * take attendance in the middle of it. Ending the service to do that would
 * freeze its tally and make the rest of the service a second occurrence; making
 * the other activity wait is not an option either.
 *
 * So `paused` is precisely "not `open`". Everything that asks "is a session
 * live?" filters on `open`, which means a paused session stops the kiosk AND
 * frees the single-active slot for something else — both consequences of the
 * one status value, neither of them a special case anybody has to remember.
 */
export type OccurrenceStatus = 'open' | 'paused' | 'closed'

export type MeetingOccurrence = {
  $id: string
  meeting_id: string
  /** YYYY-MM-DD in Africa/Accra. */
  occurrence_date: string
  status: OccurrenceStatus
  opened_at: string
  /** When it was last paused, or null. Sits beside `status` exactly as
   *  `closed_at` does — `status` is the truth, this is the timestamp. */
  paused_at: string | null
  closed_at: string | null
  opened_by: string | null
  closed_by: string | null
  /** Denormalised tally, written when the occurrence is closed. */
  present_count: number
}

/** An occurrence plus the meeting it belongs to — what the kiosk and monitor
 *  both need, and what `/api/attendance/active` returns. */
export type ActiveSession = {
  occurrence: MeetingOccurrence
  meeting: Meeting
  /** Size of the authorised roster. 0 and `restricted: false` = open to all. */
  roster_size: number
}

export type MeetingInput = {
  name: string
  description?: string | null
  /** Member `$id`s ticked during creation. Persisted as the roster. */
  member_ids?: string[]
}

export type ListMeetingsResponse =
  | { ok: true; meetings: (Meeting & { roster_size: number; last_held: string | null })[] }
  | { ok: false; error: string }

export type MeetingDetailResponse =
  | { ok: true; meeting: Meeting; member_ids: string[] }
  | { ok: false; error: string }

export type ActiveSessionResponse =
  | {
      ok: true
      session: ActiveSession | null
      /**
       * Sessions that are paused, and therefore NOT `session`.
       *
       * Carried on the same response because every consumer that cares whether
       * the scanner is armed also needs to distinguish "nothing is running"
       * from "First Service is paused" — the kiosk says so on its idle screen,
       * and the Services page needs it to offer Resume. Fetching it separately
       * would be a second poll answering half of one question.
       *
       * Usually empty, occasionally one. Never the active session.
       */
      paused: ActiveSession[]
    }
  | { ok: false; error: string }

export type ActivateResponse =
  | { ok: true; session: ActiveSession }
  /**
   * `conflict` carries the session that is already open, so the UI can name it
   * — "End First Service before activating Second Service" is actionable;
   * "something is already running" is not.
   */
  | { ok: false; error: string; conflict?: ActiveSession }

export type CloseOccurrenceResponse =
  | { ok: true; occurrence: MeetingOccurrence; present_count: number }
  | { ok: false; error: string }

/**
 * Pausing and resuming. `conflict` appears on a REFUSED resume for the same
 * reason it appears on a refused activation: resuming would make two sessions
 * open at once, and naming the one in the way is what makes the message
 * actionable.
 */
export type PauseResumeResponse =
  | { ok: true; session: ActiveSession }
  | { ok: false; error: string; conflict?: ActiveSession }
