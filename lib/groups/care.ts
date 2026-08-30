// Who looks after whom inside a bacenta.
//
// Pure and unit-tested, and separate from `server.ts` because the whole point
// is that it can be checked without a database — the cycle walk in particular
// is the kind of thing that is easy to write, easy to get subtly wrong, and
// impossible to notice once it is wrong.
//
// ── What this models ───────────────────────────────────────────────────────
//
// A bacenta is a PLACE, and inside it members are assigned to other members to
// be checked on and looked after. The carer needs NO ACCOUNT: this is a record
// of pastoral responsibility, not a login. That is the whole reason it is a
// field on the member rather than a role or a permission — nothing about it
// grants anybody the ability to see or do anything.
//
// Chains are fine and expected (A under B, B under C). Only CYCLES are refused,
// because a cycle is not a structure anybody can be at the top of: every walk
// up it runs forever, and "who is ultimately responsible for A" has no answer.

/** Just enough of a member for the checks below. */
export type CareCandidate = {
  $id: string
  full_name: string
  status: 'active' | 'inactive'
  /** The place they belong to. Null when they have not been filed into one. */
  bacenta_id: string | null
  /** Who looks after THEM. Null is the ordinary case. */
  care_of_member_id: string | null
}

/**
 * `null` when `carerId` may be recorded as looking after `memberId`, otherwise
 * the reason it may not.
 *
 * A reason rather than a boolean, matching `vapidSubjectProblem`: the string is
 * shown to whoever has to fix it, and "that assignment is not allowed" without
 * saying which rule was broken is a message that sends somebody reading source
 * code.
 */
export function careAssignmentProblem(
  memberId: string,
  carerId: string | null,
  members: ReadonlyMap<string, CareCandidate>,
): string | null {
  // Nobody looking after them is a NORMAL state, not an error — the same
  // posture as a leader who heads no groups. Most of a bacenta is unassigned on
  // the day it is created.
  if (carerId === null) return null

  const member = members.get(memberId)
  if (!member) return 'That member no longer exists. Reload and try again.'

  if (carerId === memberId) {
    return `${member.full_name} cannot be assigned to look after themselves.`
  }

  const carer = members.get(carerId)
  if (!carer) return 'That person no longer exists. Reload and pick somebody else.'

  if (carer.status !== 'active') {
    return (
      `${carer.full_name} is marked inactive, so they cannot be given anybody to look ` +
      'after. Make them active first, or pick somebody else.'
    )
  }

  if (member.bacenta_id === null) {
    return (
      `${member.full_name} is not in a bacenta yet. Put them in one first — being looked ` +
      'after is something that happens inside a bacenta.'
    )
  }

  if (carer.bacenta_id !== member.bacenta_id) {
    return (
      `${carer.full_name} is not in the same bacenta as ${member.full_name}. ` +
      'Somebody is looked after by a member of their own bacenta.'
    )
  }

  // Walk UP from the proposed carer. If the chain reaches the member being
  // assigned, this edge would close a loop.
  //
  // The `seen` set is not belt-and-braces: the stored data may ALREADY contain
  // a cycle (written before this check existed, or by a direct database edit),
  // and without it this walk would hang the request rather than refusing it.
  const seen = new Set<string>([memberId])
  const chain: string[] = []
  let cursor: string | null = carerId
  while (cursor !== null) {
    const node = members.get(cursor)
    if (!node) break
    chain.push(node.full_name)

    if (node.care_of_member_id === memberId) {
      return (
        `That would make a loop: ${member.full_name} would be looked after by ` +
        `${chain.join(', who is looked after by ')}, who is looked after by ` +
        `${member.full_name}.`
      )
    }
    if (node.care_of_member_id !== null && seen.has(node.care_of_member_id)) break
    if (cursor) seen.add(cursor)
    cursor = node.care_of_member_id
  }

  return null
}

/**
 * Everyone `memberId` is responsible for, directly.
 *
 * Used when a member is deleted or moved out of their bacenta: their charges
 * have to be released, or they point at somebody who is not there. Appwrite has
 * no cascade, so this is the list the caller must clear.
 */
export function membersInCareOf(
  memberId: string,
  members: Iterable<CareCandidate>,
): CareCandidate[] {
  return [...members].filter((m) => m.care_of_member_id === memberId)
}

/**
 * The people in `bacentaId` who may be offered as a carer for `memberId`.
 *
 * Excludes the member themselves, anybody inactive, and anybody whose own chain
 * already runs through the member — so the dropdown cannot offer a choice that
 * `careAssignmentProblem` will then refuse. Same pairing as
 * `sendableCategories` and `canSendSmsCategory`: what is offered and what is
 * accepted come from one place.
 */
export function eligibleCarers(
  memberId: string,
  bacentaId: string | null,
  members: Iterable<CareCandidate>,
): CareCandidate[] {
  if (bacentaId === null) return []
  const byId = new Map([...members].map((m) => [m.$id, m]))
  return [...byId.values()]
    .filter((m) => m.bacenta_id === bacentaId)
    .filter((m) => careAssignmentProblem(memberId, m.$id, byId) === null)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'en'))
}
