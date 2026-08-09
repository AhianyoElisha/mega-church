// Kiosk + attendance contracts. Ported from SEMP's lib/attendance/types.ts and
// re-pointed at the church domain.
//
// Pure types only. No Appwrite imports — the pure helpers (`liveStats`,
// `occurrenceResolver`) must compile anywhere, and the kiosk imports this file
// straight into the browser bundle.

import type { ActiveSession, MeetingOccurrence } from '@/lib/meetings/types'
import type { Member } from '@/lib/members/types'

// === Persisted document shape (mirrors scripts/setup-appwrite.ts) ===========

export type AttendanceMethod = 'biometric' | 'manual'

export type AttendanceRecord = {
  $id: string
  $createdAt: string
  occurrence_id: string
  /** Denormalised so per-meeting history is one query, not a join. */
  meeting_id: string
  member_id: string
  marked_at: string
  method: AttendanceMethod
  marked_by: string | null
  station: string | null
  note: string | null
}

export type AttendanceRecordPayload = Omit<AttendanceRecord, '$id' | '$createdAt'>

// === Lightweight summary sent to the kiosk =================================

/**
 * Only what the result screen renders. Deliberately NOT the whole member —
 * a kiosk sitting in a public foyer has no business receiving addresses and
 * phone numbers over the wire on every scan.
 */
export type MemberSummary = {
  $id: string
  full_name: string
  photo_file_id: string | null
  home_service: Member['home_service']
}

// === Request payloads ======================================================

export type ScanRequest = {
  /** Opaque template. `xyt:<b64>` from a real scanner; `sim:<member_id>` in
   *  simulator mode. */
  fingerprint_data: string
  /** Free-text provenance ("Main entrance"). Recorded, never trusted. */
  station?: string | null
}

export type ManualRequest = {
  member_id: string
  station?: string | null
  note?: string | null
  /**
   * When true the server resolves the member and evaluates authorisation but
   * writes NOTHING, returning the same ScanResult shape. The kiosk uses this
   * to show a photo + name confirmation card so an usher can check the person
   * in front of them before committing.
   */
  dry_run?: boolean
}

// === Scan result ===========================================================

/**
 * Discriminated union; the kiosk renders one panel per `kind`.
 *
 * The distinction that matters most is `not_authorised` vs `no_match`. An
 * unauthorised member has been IDENTIFIED — we know their name and can say
 * why they were refused. Collapsing them into "fingerprint not recognised"
 * would be wrong and would send people chasing a biometric fault that does
 * not exist (PRD §2.3).
 */
export type ScanResult =
  | {
      kind: 'marked'
      member: MemberSummary
      marked_at: string
      /** Position in this occurrence — "you are the 84th here today". */
      sequence: number
    }
  | {
      // Already present in THIS occurrence. No second row, no second write.
      kind: 'already_marked'
      member: MemberSummary
      marked_at: string
    }
  | {
      // Identified, but not on this restricted meeting's roster.
      kind: 'not_authorised'
      member: MemberSummary
      meeting_name: string
    }
  | {
      // Identified, but flagged inactive in the registry.
      kind: 'inactive_member'
      member: MemberSummary
    }
  | {
      // The matcher RAN and nobody matched. Never used for a broken matcher —
      // that path throws MatcherUnavailableError and becomes a 503.
      kind: 'no_match'
    }

// === Live aggregate ========================================================

export type LiveStats = {
  occurrence_id: string
  meeting_id: string
  /** Roster size for a restricted meeting; active-member count for a service. */
  expected: number
  present: number
  /** `expected - present`, floored at 0. */
  outstanding: number
  by_method: { biometric: number; manual: number }
  /** Marks per 5-minute bucket since the occurrence opened, for the sparkline. */
  timeline: { at: string; count: number }[]
}

// === Route response envelopes ==============================================

export type ScanResponse =
  | { ok: true; result: ScanResult; session: ActiveSession }
  | { ok: false; error: string }

export type LiveStatsResponse = { ok: true; stats: LiveStats } | { ok: false; error: string }

export type AttendanceListResponse =
  | {
      ok: true
      records: (AttendanceRecord & { member: MemberSummary })[]
      cursor: string | null
    }
  | { ok: false; error: string }

export type MemberHistoryResponse =
  | {
      ok: true
      history: {
        occurrence: MeetingOccurrence
        meeting_name: string
        record: AttendanceRecord | null
      }[]
    }
  | { ok: false; error: string }
