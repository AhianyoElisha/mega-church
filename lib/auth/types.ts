export type UserLabel = 'admin' | 'usher' | 'kiosk'

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
