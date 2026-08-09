/**
 * Single source of truth for every Appwrite identifier. No magic strings
 * anywhere else in the codebase (CLAUDE.md).
 */

export const DATABASE_ID = 'church-db'

export const COLLECTIONS = {
  /** Registered members of the church. PRD §1.1. */
  members: 'members',
  /**
   * Fingerprint minutiae templates, NBIS `.xyt` wire form (`xyt:<b64>`).
   * Four fingers × three variations per fully-enrolled member. Never images.
   * PRD §1.2.
   */
  biometric_templates: 'biometric_templates',
  /**
   * Recurring DEFINITIONS — the two services plus every admin-created
   * meeting. Not occurrences. PRD §1.3.
   */
  meetings: 'meetings',
  /**
   * The authorised roster of a restricted meeting: one document per
   * (meeting, member). Persists between occurrences so reopening a meeting
   * needs no re-selection. PRD §1.4.
   */
  meeting_members: 'meeting_members',
  /**
   * One dated run of a meeting, opened and closed by an admin. Named
   * `meeting_occurrences` and never `sessions` — Appwrite reserves "session"
   * for auth, and a collection by that name is a debugging trap.
   * PRD §1.5.
   */
  meeting_occurrences: 'meeting_occurrences',
  /** One row per member marked present at one occurrence. PRD §1.6. */
  attendance_records: 'attendance_records',
} as const

export const BUCKETS = {
  /** Member profile photos, shown on the kiosk result screen (PRD §2.4). */
  member_photos: 'member-photos',
  /**
   * The kiosk provisioning pack — bridge bundle, native binaries, Futronic
   * driver and installer — so a fresh Windows PC is set up by downloading a
   * few MB rather than cloning the repo. Built by
   * `scripts/build-kiosk-pack.ts`, served through `/api/kiosk-pack`.
   */
  kiosk_downloads: 'kiosk-downloads',
} as const

export const USER_LABELS = {
  admin: 'admin',
  usher: 'usher',
  kiosk: 'kiosk',
} as const

export type CollectionId = (typeof COLLECTIONS)[keyof typeof COLLECTIONS]
export type BucketId = (typeof BUCKETS)[keyof typeof BUCKETS]
export type UserLabel = (typeof USER_LABELS)[keyof typeof USER_LABELS]

// --- Domain constants -------------------------------------------------------

/**
 * The two service definitions are seeded with fixed document ids so code can
 * reference them without a lookup, and so they survive a re-run of the setup
 * script. They are not deletable through the UI.
 */
export const SERVICE_IDS = {
  first: 'first-service',
  second: 'second-service',
} as const

export type ServiceSlot = keyof typeof SERVICE_IDS

export const SERVICE_DEFINITIONS = [
  {
    id: SERVICE_IDS.first,
    name: 'First Service',
    alias: 'Sun Chapel',
    description: 'The early service, attended mostly by students.',
    service_slot: 'first' as const,
    sort_order: 1,
  },
  {
    id: SERVICE_IDS.second,
    name: 'Second Service',
    alias: 'Main Service',
    description: 'The main general service.',
    service_slot: 'second' as const,
    sort_order: 2,
  },
]

/** The four fingers enrolled for every member, in capture order. PRD §1.2. */
export const FINGER_LABELS = [
  'right-thumb',
  'left-thumb',
  'right-index',
  'left-index',
] as const
export type FingerLabel = (typeof FINGER_LABELS)[number]

export const FINGER_DISPLAY: Record<FingerLabel, string> = {
  'right-thumb': 'Right thumb',
  'left-thumb': 'Left thumb',
  'right-index': 'Right index',
  'left-index': 'Left index',
}

/** Three presses per finger — the matcher's best chance at a genuine match. */
export const VARIATIONS_PER_FINGER = 3

/** 4 × 3. A member below this is partially enrolled, not unenrolled. */
export const TEMPLATES_PER_MEMBER = FINGER_LABELS.length * VARIATIONS_PER_FINGER

/** The church runs on Accra time; all date arithmetic uses this zone. */
export const CHURCH_TIMEZONE = 'Africa/Accra'
