// Which month a BENMP contribution belongs to.
//
// Pure — no Appwrite, no `server-only`. The grid, the send route and the tests
// all read these, so they cannot disagree about which month it is.

import { todayInAccra } from '@/lib/attendance/occurrenceResolver'

/** `2026-09`. */
export type Period = string

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/**
 * The month as the CONGREGATION reckons it.
 *
 * Derived from `todayInAccra()` and never from a bare `Date`, for the same
 * reason attendance is: a server in another region rolling over at its own
 * midnight would disagree with the church about which month it is. On the last
 * day of a month that is not an edge case, it is a whole month of people either
 * dunned early or missed entirely.
 */
export function currentPeriod(now: Date = new Date()): Period {
  return todayInAccra(now).slice(0, 7)
}

/** `2026-09` → `{ year: 2026, month: 9 }`, or null if it is not a period. */
export function parsePeriod(period: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}

export function isPeriod(v: unknown): v is Period {
  return typeof v === 'string' && parsePeriod(v) !== null
}

/** `2026`, `9` → `2026-09`. The zero pad is what makes periods sort lexically. */
export function toPeriod(year: number, month: number): Period {
  return `${year}-${String(month).padStart(2, '0')}`
}

/** The twelve periods of a year, January first. */
export function periodsInYear(year: number): Period[] {
  return MONTH_NAMES.map((_, i) => toPeriod(year, i + 1))
}

/**
 * "September 2026" — for a heading, a confirm dialog, or an SMS preview.
 *
 * Falls back to the raw string rather than throwing: a period read from a
 * document somebody hand-edited should render as itself, not crash a page.
 */
export function periodLabel(period: string): string {
  const parsed = parsePeriod(period)
  if (!parsed) return period
  return `${MONTH_NAMES[parsed.month - 1]} ${parsed.year}`
}

/**
 * The year a grid should open on.
 *
 * The current one, always. A church looking at this page in September is
 * looking for September, and defaulting to anything else means every visit
 * starts by correcting the page.
 */
export function currentYear(now: Date = new Date()): number {
  return Number(todayInAccra(now).slice(0, 4))
}
