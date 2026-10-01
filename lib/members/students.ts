// The student roll's rules, pure: which academic year it is, who is due for a
// rollover, and the three transitions the /students page applies in bulk.
//
// No `server-only` and no Appwrite. The /students page reads `isDueForUpdate`
// to draw a badge and `levelOptions` to fill a select, and the rollover route
// applies `promote` / `repeat` / `graduate` — so the same function decides
// what the screen SAYS is due and what the server DOES about it, and the two
// cannot disagree.
//
// Nothing here runs on a schedule. A student carries `level_year`, the
// academic year in which their level was last confirmed, and "due" is derived
// by comparing it with today's. That is the whole rollover mechanism: the
// church confirms each student once a year, by hand, and the roll remembers
// who has been confirmed. A cron that bumped everybody's level in August would
// promote the ones who repeated, and nobody would find out until they were
// texted as final-years.

import {
  ACADEMIC_YEAR_START_MONTH,
  LEVEL_MAX,
  LEVEL_MIN,
  LEVEL_STEP,
  type MemberType,
} from '@/lib/appwrite/config'
import type { MemberInput } from './types'

/** The slice of a member these rules need. */
export type StudentFields = {
  member_type: MemberType
  level: number | null
  level_year: number | null
}

/**
 * The academic year that contains `todayISO` (`YYYY-MM-DD`).
 *
 * Named by the calendar year it STARTS in: from August 2026 to July 2027 is
 * academic year 2026. The boundary month is `ACADEMIC_YEAR_START_MONTH` and
 * nothing else — the church may decide it is September, and that is one
 * constant, not a hunt through the code.
 *
 * Takes the ISO string rather than a `Date` so the caller decides the zone.
 * The server passes `todayInAccra()`; a test passes a literal. A bare `Date`
 * here would put a server in another time zone a day out at the boundary,
 * which is not an edge case when the boundary is the day the roll turns over.
 */
export function academicYear(todayISO: string): number {
  const year = Number(todayISO.slice(0, 4))
  const month = Number(todayISO.slice(5, 7))
  return month >= ACADEMIC_YEAR_START_MONTH ? year : year - 1
}

/**
 * Is this student due for a rollover?
 *
 * True for a student whose level was confirmed in an EARLIER academic year
 * than today's — or never confirmed at all. An absent `level_year` reads as
 * due, not as fine: it is the state every student moved in by the bulk assigner
 * starts in, and "we have never asked" is exactly the case the roll exists to
 * surface. A non-student is never due; the question does not apply.
 */
export function isDueForUpdate(
  member: Pick<StudentFields, 'member_type' | 'level_year'>,
  todayISO: string,
): boolean {
  if (member.member_type !== 'student') return false
  if (member.level_year === null) return true
  return member.level_year < academicYear(todayISO)
}

/** The levels the roll accepts, lowest first, for a select. */
export function levelOptions(): number[] {
  const out: number[] = []
  for (let l = LEVEL_MIN; l <= LEVEL_MAX; l += LEVEL_STEP) out.push(l)
  return out
}

/** Is this a level the roll accepts — a multiple of the step, within range? */
export function isValidLevel(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= LEVEL_MIN &&
    v <= LEVEL_MAX &&
    v % LEVEL_STEP === 0
  )
}

/** "Level 300", or "—" for a student whose level is not yet known. */
export function levelLabel(level: number | null): string {
  return level === null ? '—' : `Level ${level}`
}

/**
 * A transition's outcome: the PATCH to apply, or a refusal by name.
 *
 * A refusal is a value and never a throw, because the route applies these to a
 * whole selection and one student at 800 must not abort the other thirty.
 */
export type Transition = { ok: true; patch: Partial<MemberInput> } | { ok: false; error: string }

/**
 * Promote: one level up, confirmed for this academic year.
 *
 * Refused for a student with no level — there is nothing to add to, and
 * inventing `LEVEL_MIN` would record a level nobody stated — and refused at
 * `LEVEL_MAX`, where the next step is `graduate`, a different act with a
 * different result.
 */
export function promote(member: StudentFields, todayISO: string): Transition {
  if (member.member_type !== 'student') {
    return { ok: false, error: 'Not a student, so there is no level to promote.' }
  }
  if (member.level === null) {
    return {
      ok: false,
      error: 'No level is recorded yet. Set the level first, then promote next year.',
    }
  }
  if (member.level >= LEVEL_MAX) {
    return {
      ok: false,
      error: `Already at level ${LEVEL_MAX}, the highest. Use Graduate instead.`,
    }
  }
  return {
    ok: true,
    patch: { level: member.level + LEVEL_STEP, level_year: academicYear(todayISO) },
  }
}

/**
 * Repeat: same level, confirmed for this academic year.
 *
 * The "no change" option the church asked for — and it IS a change, to
 * `level_year`, which is what takes the student off the due list. Without a
 * way to record "still level 200, we checked", a repeater would be nagged
 * every time the page opened until somebody promoted them wrongly to make it
 * stop.
 */
export function repeat(member: StudentFields, todayISO: string): Transition {
  if (member.member_type !== 'student') {
    return { ok: false, error: 'Not a student, so there is no level to confirm.' }
  }
  return { ok: true, patch: { level_year: academicYear(todayISO) } }
}

/**
 * Graduate: no longer a student. Becomes an adult and the three student fields
 * are cleared together — a level with no programme, or a programme with no
 * level, is a half-graduated row the validator would refuse to edit.
 *
 * `todayISO` is accepted for symmetry with the other two and unused: there is
 * no year to stamp on a row that no longer carries one.
 */
export function graduate(member: StudentFields, _todayISO: string): Transition {
  if (member.member_type !== 'student') {
    return { ok: false, error: 'Not a student, so there is nothing to graduate from.' }
  }
  return {
    ok: true,
    patch: { member_type: 'adult', programme: null, level: null, level_year: null },
  }
}

/**
 * One member's outcome in a bulk action. Per member, not per batch, because a
 * treasurer who ticked forty names and reached thirty-eight has to be told
 * WHICH two and WHY — the same rule as `excluded` on an SMS send.
 */
export type BulkMemberOutcome = {
  member_id: string
  name: string
  error: string
}

export type BulkTypeResponse =
  | { ok: true; updated: number; unchanged: number; failed: BulkMemberOutcome[] }
  | { ok: false; error: string }

export type RolloverResponse =
  | { ok: true; action: RolloverAction; updated: number; failed: BulkMemberOutcome[] }
  | { ok: false; error: string }

export const ROLLOVER_ACTIONS = ['promote', 'repeat', 'graduate'] as const
export type RolloverAction = (typeof ROLLOVER_ACTIONS)[number]

export function isRolloverAction(v: unknown): v is RolloverAction {
  return typeof v === 'string' && (ROLLOVER_ACTIONS as readonly string[]).includes(v)
}

/** Dispatch by name, so the route holds no switch of its own to fall out of
 *  step with the three functions above. */
export function applyRollover(
  action: RolloverAction,
  member: StudentFields,
  todayISO: string,
): Transition {
  switch (action) {
    case 'promote':
      return promote(member, todayISO)
    case 'repeat':
      return repeat(member, todayISO)
    case 'graduate':
      return graduate(member, todayISO)
  }
}
