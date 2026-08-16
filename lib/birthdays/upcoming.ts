// Whose birthday is coming up, and in how many days.
//
// Pure: every function here is a function of the arguments it is handed,
// including "today". Nothing reads the clock except `todayInAccra`, which the
// callers pass in. That is what makes the wrap-around and leap-year cases
// testable rather than reproducible only in late December.
//
// The church stores a birth MONTH and DAY and deliberately no year (PRD §1.1),
// so all of this is calendar arithmetic on a (month, day) pair — there is no
// age to compute and no birth date to compare against.

import { BIRTHDAY_LEAD_DAYS } from '@/lib/appwrite/config'

/** A member reduced to what a birthday list needs. */
export type Celebrant = {
  $id: string
  full_name: string
  photo_file_id: string | null
  call_number: string
  whatsapp_number: string | null
  birth_month: number
  birth_day: number
  /** 0 = today, 1 = tomorrow. Never negative — the next occurrence, always. */
  days_away: number
  /** YYYY-MM-DD of the celebration itself. */
  date: string
}

type MemberLike = {
  $id: string
  first_name: string
  other_names?: string | null
  last_name: string
  photo_file_id: string | null
  call_number: string
  whatsapp_number: string | null
  birth_month: number | null
  birth_day: number | null
  status: 'active' | 'inactive'
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Split a YYYY-MM-DD into numbers. No Date object — no timezone to get wrong. */
export function parseISODate(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { year: y, month: m, day: d }
}

export function toISODate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Proleptic Gregorian, which is what every date in this app is. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Days since an arbitrary fixed epoch. Only differences are ever used. */
function dayNumber(year: number, month: number, day: number): number {
  // Howard Hinnant's civil-from-days, inverted. Chosen over `Date.UTC` because
  // it involves no Date object at all: a `new Date(...)` here would be correct
  // today and quietly wrong the first time someone reached for `.getDate()`
  // on it in a non-UTC process.
  const y = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** Civil date from a day number — the inverse of `dayNumber`. */
function civilFromDays(z: number): { year: number; month: number; day: number } {
  const days = z + 719468
  const era = Math.floor(days / 146097)
  const doe = days - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp + (mp < 10 ? 3 : -9)
  return { year: y + (month <= 2 ? 1 : 0), month, day }
}

/**
 * `n` days after a YYYY-MM-DD, still as YYYY-MM-DD.
 *
 * Used to label a list ("the birthdays below are for 15 March") when the list
 * itself is empty and there is no celebrant to read a date off. Month lengths
 * and leap years fall out of the day-number arithmetic rather than being
 * special-cased.
 */
export function addDaysISO(iso: string, n: number): string {
  const { year, month, day } = parseISODate(iso)
  const c = civilFromDays(dayNumber(year, month, day) + n)
  return toISODate(c.year, c.month, c.day)
}

/**
 * When does this (month, day) next fall, on or after `todayISO`?
 *
 * Two cases the naive "same year" version gets wrong:
 *
 *   the December wrap — on 30 December, a 1 January birthday is TOMORROW, not
 *   364 days ago;
 *
 *   29 February — a real birthday that only exists every fourth year. It is
 *   observed on 28 February in a common year, which is what the celebrants
 *   themselves do and, more to the point, means the team is never told to
 *   prepare a flyer for a day that will not arrive.
 */
export function nextOccurrence(
  month: number,
  day: number,
  todayISO: string,
): { date: string; days_away: number } {
  const today = parseISODate(todayISO)
  const todayNum = dayNumber(today.year, today.month, today.day)

  for (const year of [today.year, today.year + 1]) {
    const observedDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day
    const num = dayNumber(year, month, observedDay)
    if (num >= todayNum) {
      return { date: toISODate(year, month, observedDay), days_away: num - todayNum }
    }
  }
  // Unreachable: next year's occurrence is always on or after today. Kept so
  // the function is total rather than returning undefined on a path the type
  // system cannot see is impossible.
  const observedDay = month === 2 && day === 29 && !isLeapYear(today.year + 1) ? 28 : day
  const num = dayNumber(today.year + 1, month, observedDay)
  return { date: toISODate(today.year + 1, month, observedDay), days_away: num - todayNum }
}

export function fullNameOf(m: Pick<MemberLike, 'first_name' | 'other_names' | 'last_name'>): string {
  return [m.first_name, m.other_names, m.last_name]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Everyone with a birthday in the window `[0, horizonDays]` from today,
 * soonest first.
 *
 * Inactive members are excluded: the church does not send a shoutout to
 * somebody who has left, and having to remember to filter it at each of the
 * three call sites is how one of them ends up not filtering it.
 */
export function upcomingCelebrants(
  members: MemberLike[],
  todayISO: string,
  horizonDays: number,
): Celebrant[] {
  const out: Celebrant[] = []
  for (const m of members) {
    if (m.status !== 'active') continue
    if (!m.birth_month || !m.birth_day) continue
    const { date, days_away } = nextOccurrence(m.birth_month, m.birth_day, todayISO)
    if (days_away > horizonDays) continue
    out.push({
      $id: m.$id,
      full_name: fullNameOf(m),
      photo_file_id: m.photo_file_id,
      call_number: m.call_number,
      whatsapp_number: m.whatsapp_number,
      birth_month: m.birth_month,
      birth_day: m.birth_day,
      days_away,
      date,
    })
  }
  return out.sort(
    (a, b) => a.days_away - b.days_away || a.full_name.localeCompare(b.full_name, 'en'),
  )
}

/**
 * The people this morning's notification is about: those celebrating exactly
 * `BIRTHDAY_LEAD_DAYS` from now.
 *
 * The church used to be shown birthdays ON the day. That is too late for
 * anyone making a flyer, which is the entire reason this lead time exists —
 * so this is an exact-day filter, not "within the next N days". A window would
 * re-announce the same person every morning until their birthday arrived, and
 * a team that gets the same notification four times stops reading them.
 */
export function celebrantsForNotification(
  members: MemberLike[],
  todayISO: string,
  leadDays: number = BIRTHDAY_LEAD_DAYS,
): Celebrant[] {
  return upcomingCelebrants(members, todayISO, leadDays).filter(
    (c) => c.days_away === leadDays,
  )
}

/** "Tomorrow", "In 3 days", "Today". */
export function daysAwayLabel(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

/** "14 March" — month and day only, because there is no year to show. */
export function monthDayLabel(month: number, day: number): string {
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  return `${day} ${MONTHS[month - 1] ?? ''}`.trim()
}

/**
 * The notification body. Names people rather than counting them — "Ama Serwaa
 * and Kofi Mensah have birthdays tomorrow" tells the team what to make;
 * "2 birthdays tomorrow" makes them open the app to find out.
 */
export function birthdayNotificationText(celebrants: Celebrant[]): {
  title: string
  body: string
} {
  const names = celebrants.map((c) => c.full_name)
  const title =
    celebrants.length === 1 ? '1 birthday tomorrow' : `${celebrants.length} birthdays tomorrow`

  let body: string
  if (names.length === 0) body = 'Nobody is celebrating tomorrow.'
  else if (names.length <= 3) body = `${listSentence(names)} — time to prepare the shoutout.`
  else body = `${listSentence(names.slice(0, 3))} and ${names.length - 3} more.`

  return { title, body }
}

function listSentence(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
