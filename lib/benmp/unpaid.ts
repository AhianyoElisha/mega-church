// Who still owes this month.
//
// Pure — no Appwrite, no `server-only`, so the rule that decides who the church
// pays to text can be exercised in a unit test rather than only against a live
// project. This is the same reason `celebrantsForNotification` is pure.

import type { Period } from './period'

/** The subset of a member this module needs. Structural, so both the server's
 *  `Member` and a trimmed client shape satisfy it. */
export type PartnerCandidate = {
  $id: string
  benmp_partner: boolean
  status: 'active' | 'inactive'
}

/** One recorded payment. Presence IS the payment; there is no `paid` flag. */
export type ContributionRow = {
  member_id: string
  period: string
}

/**
 * Is this member a BENMP partner?
 *
 * `=== true`, never cast — the rule `benmp_partner` has carried since it was
 * added. A row written before the field existed has no value at all, and "not a
 * partner" is the only safe reading of that: the other direction texts somebody,
 * at the church's expense, about a commitment they never made.
 *
 * That is not hypothetical here. Most of the congregation predates the checkbox,
 * so the field is absent on the majority of rows in the live project right now.
 */
export function isPartner(m: { benmp_partner?: unknown }): boolean {
  return m.benmp_partner === true
}

/**
 * The partners who have NOT paid for `period`.
 *
 * Three exclusions, and each one is somebody who must not receive a dunning
 * message:
 *
 *   not a partner   never signed up to the campaign
 *   inactive        has left, or is hidden from the church's systems
 *   already paid    the entire point of the feature
 *
 * Returns ids in the order the members were given, so a caller that sorted them
 * for display gets them back in that order rather than in whatever order the
 * payment rows happened to arrive.
 */
export function outstandingPartners<T extends PartnerCandidate>(
  members: readonly T[],
  contributions: readonly ContributionRow[],
  period: Period,
): T[] {
  const paid = paidMemberIds(contributions, period)
  return members.filter((m) => isPartner(m) && m.status === 'active' && !paid.has(m.$id))
}

/** The partners who HAVE paid for `period`. The complement, for a summary line. */
export function paidPartners<T extends PartnerCandidate>(
  members: readonly T[],
  contributions: readonly ContributionRow[],
  period: Period,
): T[] {
  const paid = paidMemberIds(contributions, period)
  return members.filter((m) => isPartner(m) && m.status === 'active' && paid.has(m.$id))
}

/** Member ids with a row for exactly this period. */
export function paidMemberIds(
  contributions: readonly ContributionRow[],
  period: Period,
): Set<string> {
  const out = new Set<string>()
  for (const c of contributions) {
    if (c.period === period) out.add(c.member_id)
  }
  return out
}

/**
 * `member_id` → the set of periods they have paid, for rendering a year's grid
 * in one pass instead of scanning the rows once per cell.
 *
 * A 50-partner year is 600 cells; the naive version is 600 array scans on every
 * keystroke in the search box.
 */
export function paidByMember(contributions: readonly ContributionRow[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const c of contributions) {
    const set = out.get(c.member_id)
    if (set) set.add(c.period)
    else out.set(c.member_id, new Set([c.period]))
  }
  return out
}

export type PartnerSummary = {
  partners: number
  paid: number
  outstanding: number
}

/** The one-line state of a month, for the top of the grid. */
export function summarise<T extends PartnerCandidate>(
  members: readonly T[],
  contributions: readonly ContributionRow[],
  period: Period,
): PartnerSummary {
  const active = members.filter((m) => isPartner(m) && m.status === 'active')
  const paid = paidMemberIds(contributions, period)
  const paidCount = active.filter((m) => paid.has(m.$id)).length
  return {
    partners: active.length,
    paid: paidCount,
    outstanding: active.length - paidCount,
  }
}
