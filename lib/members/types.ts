// Member registry contracts. Pure types — no Appwrite imports, so this module
// is safe to pull into a browser bundle.

import type { ServiceSlot } from '@/lib/appwrite/config'

export type MemberStatus = 'active' | 'inactive'

export type Member = {
  $id: string
  /**
   * The human-readable member number — `2026001`. See `lib/members/numbering.ts`.
   *
   * Null only for a member registered before the numbering existed and not yet
   * backfilled. It is NOT the primary key: Appwrite's `$id` still is. This is
   * the reference humans use out loud and on paper, because a twenty-character
   * hex id is not something anyone reads down a phone.
   */
  member_no: string | null
  first_name: string
  last_name: string
  other_names: string | null
  photo_file_id: string | null
  /** 1-12. Null when not supplied. NO birth YEAR is ever collected (PRD §1.1). */
  birth_month: number | null
  /** 1-31. */
  birth_day: number | null
  address: string | null
  /** Required. The number you ring. */
  call_number: string
  /**
   * Optional. Very often the same digits as `call_number`, but stored
   * independently because some members keep the two separate — collapsing them
   * into one field loses that and cannot be recovered.
   */
  whatsapp_number: string | null
  /** Descriptive only. NEVER gates attendance (PRD §2.1). */
  home_service: ServiceSlot
  /**
   * Where this member LIVES — exactly one, so it is a field rather than a join
   * (PRD §1.7). Null for anyone registered before the constituencies existed;
   * the bulk assigner on `/constituencies/[id]` is how that backlog clears.
   *
   * Like `home_service`, this NEVER gates attendance. A member is marked
   * present by who they are, not by where they live.
   */
  constituency_id: string | null
  /**
   * The bacenta — the PLACE — this member belongs to. Exactly one, so a field
   * rather than a join, for the same reason `constituency_id` is one.
   *
   * Null is ordinary: most of the congregation has not been filed into a
   * bacenta yet, and like every other group link this NEVER gates attendance.
   */
  bacenta_id: string | null
  /**
   * The member who looks after this one, inside their bacenta.
   *
   * Another MEMBER, not an account — the person named needs no login and gains
   * nothing from being named. Cycles are refused by `careAssignmentProblem`.
   */
  care_of_member_id: string | null
  status: MemberStatus
  created_by: string | null
  /**
   * Which birthday SMS THIS member gets, overriding the category default.
   *
   * Null is the ordinary case and means "use the standard birthday message" —
   * never "send nothing". Not every member is addressed the same way, which is
   * the whole reason this field exists; most are, which is why it is optional
   * rather than asked for at every registration. PRD §1.12.
   */
  sms_template_id: string | null
  $createdAt: string
  $updatedAt: string
}

/** Derived, never stored. */
export function fullName(m: Pick<Member, 'first_name' | 'other_names' | 'last_name'>): string {
  return [m.first_name, m.other_names, m.last_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

/** Two-letter initials for the avatar fallback. */
export function initials(m: Pick<Member, 'first_name' | 'last_name'>): string {
  return `${m.first_name.charAt(0)}${m.last_name.charAt(0)}`.toUpperCase()
}

/** "14 March", or null when no birthday was recorded. */
export function birthdayLabel(m: Pick<Member, 'birth_month' | 'birth_day'>): string | null {
  if (!m.birth_month || !m.birth_day) return null
  // A fixed non-leap year is fine — only month and day are ever rendered.
  const d = new Date(Date.UTC(2001, m.birth_month - 1, m.birth_day))
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(d)
}

export type MemberInput = {
  first_name: string
  last_name: string
  other_names?: string | null
  birth_month?: number | null
  birth_day?: number | null
  address?: string | null
  call_number: string
  whatsapp_number?: string | null
  home_service?: ServiceSlot
  constituency_id?: string | null
  /**
   * The basontas this member serves in. Many-to-many, so it is NOT a column on
   * the member — the route writes it to `basonta_members` after the member row
   * itself is saved. Sending `[]` clears every basonta; omitting the key
   * entirely leaves them untouched, which is what a partial edit needs.
   *
   * The BACENTA below is the opposite shape on purpose: one place, one field.
   */
  basonta_ids?: string[]
  /** The one place they live. `null` clears it; omitting leaves it alone. */
  bacenta_id?: string | null
  /** Who looks after them. `null` clears it; omitting leaves it alone. */
  care_of_member_id?: string | null
  /** `null` clears the override back to the category default; omitting the key
   *  leaves it alone, exactly as `basonta_ids` does. */
  sms_template_id?: string | null
  status?: MemberStatus
}

/** Enrolment progress, joined onto a member for the registry list. */
export type MemberEnrolment = {
  member_id: string
  template_count: number
  /** Which of the four fingers have at least one stored template. */
  fingers_done: string[]
  /** True when all four fingers have all three variations. */
  complete: boolean
}

export type MemberWithEnrolment = Member & {
  enrolment: MemberEnrolment
  /** Basonta `$id`s, joined in-memory from `basonta_members` by the route. */
  basonta_ids: string[]
}

export type ListMembersResponse =
  | { ok: true; members: MemberWithEnrolment[]; total: number }
  | { ok: false; error: string }

export type MemberResponse =
  | {
      ok: true
      member: Member
      basonta_ids?: string[]
      /**
       * The member's constituency by NAME, resolved by the route.
       *
       * Here because a group head cannot look it up: `/api/constituencies` is
       * admin data and answers them 403. Without it their edit form could only
       * show a raw id where the rest of the app shows "Ahodwo".
       */
      constituency_name?: string | null
    }
  | { ok: false; error: string }

export type MemberStatsResponse = {
  ok: true
  stats: {
    total: number
    active: number
    inactive: number
    fully_enrolled: number
    partially_enrolled: number
    not_enrolled: number
  }
}
