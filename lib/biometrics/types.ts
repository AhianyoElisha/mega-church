// Biometric enrolment + matcher contracts. Pure types.

import type { FingerLabel } from '@/lib/appwrite/config'

/**
 * What the SERVER can do, reported to any client that asks.
 *
 * A kiosk's own bridge probe proves the scanner is attached to the machine the
 * operator is standing at. It proves nothing about the server handling
 * `/api/attendance/scan`, and in SEMP that gap turned a healthy matcher into an
 * hour of "FINGERPRINT NOT RECOGNISED" (2026-08-08). Hence a second, separate
 * health endpoint that asks the server directly.
 */
export type MatcherHealth = {
  /** `wasm` = this server matches in-process, no bridge needed. */
  implementation: 'local_bridge' | 'wasm' | 'stub'
  /** True when this server can identify a real `xyt:` template at all. */
  configured: boolean
  /** Live probe result; null when there is nothing to probe. */
  reachable: boolean | null
  url: string | null
  /** One sentence, written for a human standing at a kiosk. */
  detail: string
}

export interface BiometricTemplateDoc {
  $id: string
  member_id: string
  finger_label: FingerLabel
  /** 1-3. Which of the three presses of this finger. */
  variation: number
  /** Wire form `xyt:<base64>` — see lib/biometrics/codec.ts. */
  template: string
  minutiae: number
  created_by: string | null
  $createdAt: string
}

/** Sent to the enrolment UI — metadata only, never the payload. */
export interface BiometricTemplateMeta {
  $id: string
  member_id: string
  finger_label: FingerLabel
  variation: number
  minutiae: number
  created_at: string
}

export interface EnrollRequest {
  member_id: string
  finger_label: FingerLabel
  /** 1-3 wire-form templates for this finger, in press order. */
  templates: string[]
  /** When true, existing templates for THIS FINGER are deleted first.
   *  Re-enrolling one finger must not wipe the other three. */
  replace?: boolean
}

export type EnrollResponse =
  | {
      ok: true
      member_id: string
      full_name: string
      finger_label: FingerLabel
      created: number
      deleted: number
      /** Templates now stored for this member across all fingers. */
      total_templates: number
    }
  | { ok: false; error: string }

/** Per-member enrolment state for the registry list and the enrolment page. */
export interface EnrolledMemberSummary {
  member_id: string
  template_count: number
  /** Per-finger counts, so the UI can show which finger still needs presses. */
  by_finger: Record<string, number>
  complete: boolean
}

/** Candidate set shape POSTed to the matcher (bridge `/match`). */
export interface MatcherCandidate {
  member_id: string
  templates: string[]
}
