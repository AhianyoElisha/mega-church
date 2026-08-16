/**
 * Exactly one per account (CLAUDE.md).
 *
 * `leader` covers BOTH a constituency head and a bacenta head, on purpose. The
 * same person frequently does both jobs, and two labels would mean two logins
 * to see the two halves of their own work. What a leader can actually see is
 * resolved per-request from which groups name them as head — see
 * `lib/groups/server.ts::leaderScope`.
 */
export type UserLabel = 'admin' | 'usher' | 'kiosk' | 'leader' | 'celebrations'

export type AuthUser = {
  id: string
  email: string
  name: string
  label: UserLabel
  /**
   * Optional free-text label for where this kiosk stands ("Main entrance",
   * "Chapel side door"). Recorded on attendance rows for the audit trail.
   * Unlike SEMP's `hall_id` this is NOT a security boundary — with one active
   * session globally (PRD §2.2) there is nothing for a station to be scoped
   * to. It is provenance, not authorisation.
   */
  station: string | null
}

export type LoginRequest = { email: string; password: string }

export type LoginResponse = { ok: true; user: AuthUser } | { ok: false; error: string }

export type MeResponse = { user: AuthUser } | { user: null }

export type LogoutResponse = { ok: true }
