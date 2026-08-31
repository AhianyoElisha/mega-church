// Pure shaping and validation for the bacenta hierarchy. No Appwrite, no
// React — everything here is a function of its arguments, so it is unit-tested
// rather than clicked through.

import type {
  Bacenta,
  BacentaCategory,
  BacentaTree,
  BacentaWithCount,
  Basonta,
  BasontaCategory,
  BasontaTree,
  BasontaWithCount,
  Constituency,
} from './types'

/**
 * Arrange bacentas under the constituencies they belong to.
 *
 * Two buckets, and the second is the point: a bacenta with no constituency is
 * shown as UNFILED rather than dropped. Dropping it would make a place full of
 * real people vanish from every screen while its rows sat in the database —
 * the kind of bug only discovered when somebody asks where Anloga went.
 *
 * Constituencies with no bacentas are kept. An empty one is a constituency
 * somebody is about to add places to, and hiding it makes the create button
 * look broken.
 *
 * This REPLACED a version that grouped by category. `buildBasontaTree` below
 * still does that, because the serving groups kept their families — the two
 * functions look similar and are no longer the same shape, which is why the
 * delegation that used to join them is gone.
 */
export function buildBacentaTree(
  constituencies: Constituency[],
  bacentas: BacentaWithCount[],
): BacentaTree {
  const known = new Map(constituencies.map((c) => [c.$id, c]))
  const byConstituency = new Map<string, BacentaWithCount[]>()
  const unfiled: BacentaWithCount[] = []

  for (const b of bacentas) {
    // A constituency_id pointing at something deleted lands in `unfiled` with
    // the genuinely unfiled ones. Both need the same human decision — pick a
    // constituency — so they do not need separate buckets.
    if (b.constituency_id !== null && known.has(b.constituency_id)) {
      const list = byConstituency.get(b.constituency_id)
      if (list) list.push(b)
      else byConstituency.set(b.constituency_id, [b])
    } else {
      unfiled.push(b)
    }
  }

  return {
    constituencies: sortByOrderThenName(constituencies).map((constituency) => ({
      constituency,
      bacentas: sortByOrderThenName(byConstituency.get(constituency.$id) ?? []),
    })),
    unfiled: sortByOrderThenName(unfiled),
  }
}

/**
 * Arrange basontas under their categories.
 *
 * Three buckets, and the third is the point: a basonta whose `category_id`
 * matches no surviving category is an ORPHAN and is surfaced, not silently
 * dropped — a group full of real people must never disappear from every screen
 * while its rows sit in the database.
 *
 * Categories with no basontas are kept. An empty "Choir" is one somebody just
 * created and is about to fill.
 */
export function buildBasontaTree(
  categories: BasontaCategory[],
  basontas: BasontaWithCount[],
): BasontaTree {
  const known = new Map(categories.map((c) => [c.$id, c]))
  const byCategory = new Map<string, BasontaWithCount[]>()
  const standalone: BasontaWithCount[] = []
  const orphans: BasontaWithCount[] = []

  for (const b of basontas) {
    if (b.category_id == null) {
      standalone.push(b)
    } else if (known.has(b.category_id)) {
      const list = byCategory.get(b.category_id)
      if (list) list.push(b)
      else byCategory.set(b.category_id, [b])
    } else {
      orphans.push(b)
    }
  }

  return {
    categories: sortByOrderThenName(categories).map((category) => ({
      category,
      basontas: sortByOrderThenName(byCategory.get(category.$id) ?? []),
    })),
    standalone: sortByOrderThenName(standalone),
    orphans: sortByOrderThenName(orphans),
  }
}

/**
 * `sort_order` first, name as the tiebreak. Everything is created with the same
 * `sort_order` today, so in practice this is alphabetical — but the field
 * exists for when the church wants Biazo listed above Fresh Oil, and a stable
 * secondary key stops the list reshuffling between renders.
 */
export function sortByOrderThenName<T extends { sort_order: number; name: string }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'en'),
  )
}

/** How a bacenta reads in a sentence: "Anloga · Alos", or just "Anloga". */
export function bacentaDisplayName(
  bacenta: Pick<Bacenta, 'name'> & { constituency_name?: string | null },
): string {
  return bacenta.constituency_name ? `${bacenta.name} · ${bacenta.constituency_name}` : bacenta.name
}

/** How a basonta reads in a sentence: "Biazo · Choir", or "Technical Team". */
export function basontaDisplayName(
  basonta: Pick<Basonta, 'name'> & { category_name?: string | null },
): string {
  return basonta.category_name ? `${basonta.name} · ${basonta.category_name}` : basonta.name
}

export const GROUP_NAME_MAX = 96

export type NameCheck = { ok: true; value: string } | { ok: false; error: string }

/**
 * Validate a constituency, category or bacenta name.
 *
 * `taken` is compared case-insensitively and with collapsed whitespace, because
 * "Living  Waters" and "living waters" are the same choir to everyone except a
 * string comparison, and two rows that render identically in a dropdown are
 * unusable.
 */
export function validateGroupName(
  raw: unknown,
  opts: { taken?: string[]; noun?: string } = {},
): NameCheck {
  const noun = opts.noun ?? 'group'
  const value = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
  if (!value) return { ok: false, error: `Give the ${noun} a name.` }
  if (value.length > GROUP_NAME_MAX) {
    return { ok: false, error: `That name is too long (max ${GROUP_NAME_MAX} characters).` }
  }
  const key = normaliseName(value)
  if ((opts.taken ?? []).some((t) => normaliseName(t) === key)) {
    return { ok: false, error: `A ${noun} called "${value}" already exists.` }
  }
  return { ok: true, value }
}

export function normaliseName(v: string): string {
  return v.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Which of `memberIds` are not yet in `current`, and which of `current` should
 * go — the diff every membership write is expressed as.
 *
 * A diff rather than delete-all-then-insert for the same reason the meeting
 * roster uses one (`lib/meetings/server.ts::setRoster`): a rewrite loses
 * `added_by` and the joined-on timestamps for people who never moved, and a
 * rewrite that fails halfway leaves the group empty — the one state that makes
 * a head's screen look like their bacenta was disbanded.
 */
export function diffMembership(
  current: readonly string[],
  memberIds: readonly string[],
  mode: 'add' | 'remove' | 'set',
): { toAdd: string[]; toRemove: string[] } {
  const have = new Set(current)
  const asked = new Set(memberIds)

  if (mode === 'add') {
    return { toAdd: [...asked].filter((id) => !have.has(id)), toRemove: [] }
  }
  if (mode === 'remove') {
    return { toAdd: [], toRemove: [...asked].filter((id) => have.has(id)) }
  }
  return {
    toAdd: [...asked].filter((id) => !have.has(id)),
    toRemove: [...have].filter((id) => !asked.has(id)),
  }
}

/**
 * Does this user head anything at all?
 *
 * A `leader` account with no groups is not an error — it is an account created
 * before the appointment was recorded. The UI says so; it does not 403, which
 * would look like a broken login.
 */
export function headsAnything(
  userId: string,
  constituencies: Pick<Constituency, 'head_user_id'>[],
  bacentas: Pick<Bacenta, 'head_user_id'>[],
  basontas: Pick<Basonta, 'head_user_id'>[] = [],
): boolean {
  return (
    constituencies.some((c) => c.head_user_id === userId) ||
    bacentas.some((b) => b.head_user_id === userId) ||
    basontas.some((b) => b.head_user_id === userId)
  )
}

/**
 * Narrow a registration submitted by a group HEAD down to what they may write.
 *
 * A head registering a member is the one place where somebody who is otherwise
 * read-only creates a row, so the boundary is stated once, here, as a function
 * of its arguments — the route has a database handle and a session and is the
 * wrong place to be reasoning about this.
 *
 * Three refusals, and each is a specific failure that would otherwise be silent:
 *
 *   no constituency held  a bacenta-only head has no basis for deciding where
 *                         anybody LIVES, and a member registered with no
 *                         constituency lands in the unassigned pool where a
 *                         second head may claim them.
 *   constituency omitted  REFUSED, never defaulted to "their first one" — the
 *                         same rule as `/api/reports/export` (CLAUDE.md). A
 *                         head of two constituencies who forgot to choose must
 *                         be asked, not guessed at; the guess is invisible
 *                         afterwards because the member simply appears in the
 *                         wrong roster.
 *   a foreign group       filing somebody into a neighbour's constituency, or
 *                         into a choir they do not run, is exactly the write
 *                         `onlyUnassigned` exists to prevent on the bulk
 *                         assigner. Same boundary, different door.
 *
 * An admin never comes through here: they may file anyone anywhere.
 */
export type HeadRegistrationScope =
  | { ok: true; constituency_id: string; basonta_ids: string[] }
  | { ok: false; error: string; status: 400 | 403 }

export function headRegistrationScope(
  input: { constituency_id?: unknown; basonta_ids?: readonly string[] },
  heads: { constituencies: readonly string[]; basontas: readonly string[] },
): HeadRegistrationScope {
  if (heads.constituencies.length === 0) {
    return {
      ok: false,
      status: 403,
      error:
        'You do not head a constituency, so there is nowhere to register this member. ' +
        'Ask an administrator to register them.',
    }
  }

  const constituencyId =
    typeof input.constituency_id === 'string' && input.constituency_id.length > 0
      ? input.constituency_id
      : null
  if (!constituencyId) {
    return {
      ok: false,
      status: 400,
      error: 'Choose which of your constituencies this member lives in.',
    }
  }
  if (!heads.constituencies.includes(constituencyId)) {
    return { ok: false, status: 403, error: 'You do not head that constituency.' }
  }

  const basontaIds = [...new Set(input.basonta_ids ?? [])]
  const foreign = basontaIds.filter((id) => !heads.basontas.includes(id))
  if (foreign.length > 0) {
    return {
      ok: false,
      status: 403,
      error:
        'You can only put a new member into a basonta you head. ' +
        'Ask the head of that basonta, or an administrator, to add them.',
    }
  }

  return { ok: true, constituency_id: constituencyId, basonta_ids: basontaIds }
}

/**
 * Narrow an EDIT submitted by a group head down to what they may change.
 *
 * The sibling of `headRegistrationScope`, and the differences are the point.
 * Registering happens before the member exists, so the head supplies
 * everything; editing happens to a member who already has answers, some of
 * them put there by an admin or by another head. So this function is mostly
 * about what it must NOT let a head overwrite.
 *
 * Scope is wider here than on registration, deliberately. A head may edit
 * anyone in a constituency, a BACENTA, or a BASONTA they head — "their own
 * members" in the plain sense, and the same set their group pages already show
 * them in full. (Registering stays constituency-only, because neither a place
 * head nor a choir head has a basis for saying where somebody LIVES.)
 *
 * ## What a CONSTITUENCY head may now change, and what stays refused
 *
 * `status`, `sms_template_id` and `bacenta_id` were refused to every head.
 * They are now allowed to the head of the member's OWN CONSTITUENCY, and still
 * refused to a bacenta or basonta head editing the same person.
 *
 * The split is the point, and it is the same asymmetry `headRegistrationScope`
 * already draws. A constituency head runs the place a member LIVES and is
 * answerable for that record; a choir head knows they sing on Sundays. Opening
 * these three to every head would let a basonta head mark somebody inactive —
 * removing them from the matcher's gallery CHURCH-WIDE — on the strength of
 * running one serving group, which nobody asked for and which would be
 * invisible afterwards.
 *
 * So the refusals now depend on WHICH group the head runs:
 *
 *   status             constituency head only. Flipping somebody `inactive`
 *                      removes them from the matcher's gallery church-wide.
 *   sms_template_id    constituency head only. Picks which text the church
 *                      pays to send, in the church's own voice.
 *   bacenta_id         constituency head only, and the DESTINATION must be a
 *                      bacenta inside a constituency they head — otherwise a
 *                      head could post somebody into a neighbour's place.
 *                      Resent unchanged it is a no-op and dropped, because the
 *                      shared form always sends the field.
 *   constituency_id    still refused to everyone. MOVING a member out of a
 *                      constituency is the write `onlyUnassigned` blocks on the
 *                      bulk assigner, arriving through a different door — and
 *                      the head of the constituency they are LEAVING is exactly
 *                      the person with an interest in the answer. Resending the
 *                      value it already has is not a move and is accepted.
 *
 * `assignableBacentas` is what makes the `bacenta_id` check possible without
 * this function touching Appwrite: the route passes the bacentas that sit in
 * constituencies this head runs. It is OPTIONAL and defaults to none, so a
 * caller that forgets it refuses every move rather than permitting every move —
 * the direction this has to fail in.
 *
 * `care_of_member_id` is deliberately NOT refused, and that is written down
 * because an absent entry in this list is invisible. Recording who looks after
 * whom inside a bacenta is the head's own pastoral work — it is the single most
 * likely thing they are on this screen to do, it grants the named carer nothing
 * at all, and the server still checks it with `careAssignmentProblem`.
 */
export type HeadEditScope =
  | { ok: true; fields: Record<string, unknown>; basonta_ids: string[] | undefined }
  | { ok: false; error: string; status: 400 | 403 }

export function headEditScope(
  input: { fields: Record<string, unknown>; basonta_ids: string[] | undefined },
  member: {
    constituency_id: string | null
    bacenta_id: string | null
    basonta_ids: readonly string[]
  },
  heads: {
    constituencies: readonly string[]
    bacentas: readonly string[]
    basontas: readonly string[]
    /**
     * Bacentas sitting INSIDE a constituency this head runs — the places they
     * may move somebody to. Not the bacentas they head: a constituency head
     * moves members between all the places in their constituency, whether or
     * not they personally run each one.
     *
     * Optional, defaulting to none, so a caller that forgets it refuses every
     * move rather than allowing every move.
     */
    assignableBacentas?: readonly string[]
  },
): HeadEditScope {
  const inScope =
    (member.constituency_id !== null && heads.constituencies.includes(member.constituency_id)) ||
    (member.bacenta_id !== null && heads.bacentas.includes(member.bacenta_id)) ||
    member.basonta_ids.some((id) => heads.basontas.includes(id))
  if (!inScope) {
    return { ok: false, status: 403, error: 'That member is not in a group you head.' }
  }

  const fields = { ...input.fields }

  /**
   * Does this head run the constituency the member LIVES in?
   *
   * Not "is this member in scope at all" — that is `inScope` above and is
   * satisfied by heading any one of their three kinds of group. This is the
   * narrower question the three newly-permitted fields turn on.
   */
  const runsTheirConstituency =
    member.constituency_id !== null && heads.constituencies.includes(member.constituency_id)

  if ('status' in fields && !runsTheirConstituency) {
    return {
      ok: false,
      status: 403,
      error:
        'Only an administrator, or the head of this member’s own constituency, can make ' +
        'a member active or inactive. An inactive member stops being recognised by the scanner.',
    }
  }
  /*
   * A title is a claim of OFFICE, not a detail like a phone number.
   *
   * So it sits with `status` rather than with `benmp_partner`, which it
   * otherwise resembles — both record something the member stated. The
   * difference is who is harmed by a wrong one: a mistaken `benmp_partner`
   * texts somebody about a campaign, and a mistaken title addresses a whole
   * congregation's message to "Bishop" somebody who is not one. The head of
   * the constituency they live in is the person who actually knows.
   */
  if ('title' in fields && !runsTheirConstituency) {
    return {
      ok: false,
      status: 403,
      error:
        'Only an administrator, or the head of this member’s own constituency, can change ' +
        'how a member is addressed.',
    }
  }
  if ('sms_template_id' in fields && !runsTheirConstituency) {
    return {
      ok: false,
      status: 403,
      error:
        'Only an administrator, or the head of this member’s own constituency, can change ' +
        'which birthday message a member is sent.',
    }
  }
  /*
   * `benmp_partner` is deliberately NOT refused, and the decision is written
   * down because an absent refusal is invisible — the next person to read this
   * list cannot tell "considered and allowed" from "never thought about".
   *
   * It reads like `sms_template_id`, which IS refused, in that both end in the
   * church spending money on a text. The difference is what the field records.
   * `sms_template_id` chooses the church's WORDING and is the church's to pick.
   * `benmp_partner` records a FACT about the member — they signed up to the
   * campaign — and the head at the desk is the person the member told. Routing
   * that through an administrator is how a phone number stays wrong, which is
   * the exact reasoning that let heads correct details in the first place
   * (PRD §5.2).
   *
   * Revisit if the monthly reminder is ever automated AND a head turns out to
   * be enrolling people who did not sign up. The failure would be visible in
   * `sms_messages`, which is a log with a `sent_by` on every row.
   */
  if ('constituency_id' in fields) {
    if (fields.constituency_id !== member.constituency_id) {
      return {
        ok: false,
        status: 403,
        error:
          'Moving a member to a different constituency is an administrator’s job. ' +
          'Everything else on this form you can change yourself.',
      }
    }
    // A no-op the form sent because it always sends it. Dropped rather than
    // written, so an edit of a phone number is a one-field update.
    delete fields.constituency_id
  }
  if ('bacenta_id' in fields) {
    if (fields.bacenta_id === member.bacenta_id) {
      // A no-op the form sent because it always sends it. Dropped rather than
      // written, so an edit of a phone number is a one-field update.
      delete fields.bacenta_id
    } else if (!runsTheirConstituency) {
      return {
        ok: false,
        status: 403,
        error:
          'Moving a member to a different bacenta is for an administrator or the head of ' +
          'their constituency. You can still record who looks after them inside their own bacenta.',
      }
    } else {
      /*
       * A constituency head may move somebody between the places in their OWN
       * constituency, and `null` unfiles them without moving them out of it.
       *
       * The destination is checked against the places this head actually runs,
       * because assigning a bacenta MOVES — an unchecked id here would let a
       * head post one of their members into a neighbouring constituency's
       * bacenta, which is the `constituency_id` refusal above arriving through
       * a different door.
       */
      const destination = fields.bacenta_id
      if (
        destination !== null &&
        !(heads.assignableBacentas ?? []).includes(destination as string)
      ) {
        return {
          ok: false,
          status: 403,
          error:
            'That bacenta is not in a constituency you head. You can only move a member ' +
            'between the places in your own constituency.',
        }
      }
    }
  }

  return {
    ok: true,
    fields,
    basonta_ids:
      input.basonta_ids === undefined
        ? undefined
        : headBasontaMerge(input.basonta_ids, member.basonta_ids, heads.basontas),
  }
}

/**
 * May this head DELETE this member outright?
 *
 * Deleting is deliberately narrower than editing, and narrower than the rest of
 * this file: a CONSTITUENCY head only, and only for a member filed into a
 * constituency they run. A bacenta or basonta head may correct the same
 * member's phone number and may not delete them.
 *
 * The reason is what a delete costs. `deleteMemberCascade` purges the member's
 * biometric templates, roster rows, basonta memberships, SMS log entries and
 * **attendance records**, and releases everybody left in their care. The
 * attendance rows are the church's own account of who was in the building, they
 * are not recoverable, and nothing anywhere reports that they used to exist. A
 * head of one serving group has no basis for spending that, and the blast
 * radius does not shrink just because the person deleting knows the member.
 *
 * A member with NO constituency is refused to every head rather than being
 * open to all of them: nobody heads "unassigned", and treating an empty field
 * as everybody's is how a record with no owner gets deleted by whoever finds it
 * first. An administrator deletes those.
 *
 * Pure and unit-tested, for the same reason `headRegistrationScope` is: this is
 * the check standing between a head and an irreversible write, and a check that
 * can only be exercised through a live route is a check nobody runs.
 */
export type HeadDeleteScope = { ok: true } | { ok: false; error: string; status: 403 }

export function headDeleteScope(
  member: { constituency_id: string | null },
  heads: { constituencies: readonly string[] },
): HeadDeleteScope {
  if (member.constituency_id === null) {
    return {
      ok: false,
      status: 403,
      error:
        'This member is not filed into any constituency, so no head owns their record. ' +
        'An administrator removes an unassigned member.',
    }
  }
  if (!heads.constituencies.includes(member.constituency_id)) {
    return {
      ok: false,
      status: 403,
      error: 'That member is not in a constituency you head.',
    }
  }
  return { ok: true }
}

export function headBasontaMerge(
  submitted: readonly string[],
  existing: readonly string[],
  headed: readonly string[],
): string[] {
  const untouchable = existing.filter((id) => !headed.includes(id))
  const chosen = submitted.filter((id) => headed.includes(id))
  return [...new Set([...untouchable, ...chosen])]
}
