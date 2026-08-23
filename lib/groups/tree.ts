// Pure shaping and validation for the bacenta hierarchy. No Appwrite, no
// React — everything here is a function of its arguments, so it is unit-tested
// rather than clicked through.

import type {
  Bacenta,
  BacentaCategory,
  BacentaTree,
  BacentaWithCount,
  Constituency,
} from './types'

/**
 * Arrange bacentas under their categories.
 *
 * Three buckets, and the third is the point: a bacenta whose `category_id`
 * matches no surviving category is an ORPHAN and is surfaced, not silently
 * dropped. Dropping it would make a group full of real people vanish from
 * every screen while its rows sat in the database — the kind of bug that is
 * only discovered when someone asks why the choir is not listed.
 *
 * Categories with no bacentas are kept. An empty "Choir" is a category someone
 * just created and is about to fill; hiding it makes the create button look
 * broken.
 */
export function buildBacentaTree(
  categories: BacentaCategory[],
  bacentas: BacentaWithCount[],
): BacentaTree {
  const known = new Map(categories.map((c) => [c.$id, c]))
  const byCategory = new Map<string, BacentaWithCount[]>()
  const standalone: BacentaWithCount[] = []
  const orphans: BacentaWithCount[] = []

  for (const b of bacentas) {
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
      bacentas: sortByOrderThenName(byCategory.get(category.$id) ?? []),
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

/** How a bacenta reads in a sentence: "Biazo (Choir)", or just "Technical Team". */
export function bacentaDisplayName(
  bacenta: Pick<Bacenta, 'name'> & { category_name?: string | null },
): string {
  return bacenta.category_name ? `${bacenta.name} · ${bacenta.category_name}` : bacenta.name
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
): boolean {
  return (
    constituencies.some((c) => c.head_user_id === userId) ||
    bacentas.some((b) => b.head_user_id === userId)
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
  | { ok: true; constituency_id: string; bacenta_ids: string[] }
  | { ok: false; error: string; status: 400 | 403 }

export function headRegistrationScope(
  input: { constituency_id?: unknown; bacenta_ids?: readonly string[] },
  heads: { constituencies: readonly string[]; bacentas: readonly string[] },
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

  const bacentaIds = [...new Set(input.bacenta_ids ?? [])]
  const foreign = bacentaIds.filter((id) => !heads.bacentas.includes(id))
  if (foreign.length > 0) {
    return {
      ok: false,
      status: 403,
      error:
        'You can only put a new member into a bacenta you head. ' +
        'Ask the head of that bacenta, or an administrator, to add them.',
    }
  }

  return { ok: true, constituency_id: constituencyId, bacenta_ids: bacentaIds }
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
 * anyone in a constituency OR a bacenta they head — "their own members" in the
 * plain sense, and the same set their group page already shows them in full.
 * (Registering stays constituency-only, because a bacenta head has no basis for
 * saying where somebody LIVES.)
 *
 * Three refusals, each naming the field rather than quietly dropping it. A
 * silent strip is how a head comes away believing they changed something:
 *
 *   status            flipping somebody `inactive` removes them from the
 *                     matcher's gallery church-wide.
 *   sms_template_id   picks which text the church pays to send.
 *   constituency_id   MOVING a member is an admin's job — it is the write
 *                     `onlyUnassigned` blocks on the bulk assigner, arriving
 *                     through a different door. Resending the value it already
 *                     has is not a move and is accepted, because the shared
 *                     form always sends the field.
 */
export type HeadEditScope =
  | { ok: true; fields: Record<string, unknown>; bacenta_ids: string[] | undefined }
  | { ok: false; error: string; status: 400 | 403 }

export function headEditScope(
  input: { fields: Record<string, unknown>; bacenta_ids: string[] | undefined },
  member: { constituency_id: string | null; bacenta_ids: readonly string[] },
  heads: { constituencies: readonly string[]; bacentas: readonly string[] },
): HeadEditScope {
  const inScope =
    (member.constituency_id !== null && heads.constituencies.includes(member.constituency_id)) ||
    member.bacenta_ids.some((id) => heads.bacentas.includes(id))
  if (!inScope) {
    return { ok: false, status: 403, error: 'That member is not in a group you head.' }
  }

  const fields = { ...input.fields }

  if ('status' in fields) {
    return {
      ok: false,
      status: 403,
      error:
        'Only an administrator can make a member active or inactive. ' +
        'An inactive member stops being recognised by the scanner.',
    }
  }
  if ('sms_template_id' in fields) {
    return {
      ok: false,
      status: 403,
      error: 'Only an administrator can change which birthday message a member is sent.',
    }
  }
  if ('constituency_id' in fields) {
    if (fields.constituency_id !== member.constituency_id) {
      return {
        ok: false,
        status: 403,
        error:
          'Moving a member to a different constituency is an administrator\u2019s job. ' +
          'Everything else on this form you can change yourself.',
      }
    }
    // A no-op the form sent because it always sends it. Dropped rather than
    // written, so an edit of a phone number is a one-field update.
    delete fields.constituency_id
  }

  return {
    ok: true,
    fields,
    bacenta_ids:
      input.bacenta_ids === undefined
        ? undefined
        : headBacentaMerge(input.bacenta_ids, member.bacenta_ids, heads.bacentas),
  }
}

/**
 * What a head's bacenta tick-list actually means for a member's FULL list.
 *
 * The form sends the complete answer for the boxes it drew, and a head is only
 * ever shown the bacentas they head. Writing that list verbatim would remove
 * the member from every OTHER bacenta — a constituency head correcting a phone
 * number would silently take somebody out of the choir, which is the exact
 * failure `readBacentaIds` returning `undefined` exists to prevent one level up.
 *
 * So the answer is a merge, not a replacement: memberships outside the head's
 * reach are carried through untouched, and the head's ticks decide only the
 * bacentas they run.
 */
export function headBacentaMerge(
  submitted: readonly string[],
  existing: readonly string[],
  headed: readonly string[],
): string[] {
  const untouchable = existing.filter((id) => !headed.includes(id))
  const chosen = submitted.filter((id) => headed.includes(id))
  return [...new Set([...untouchable, ...chosen])]
}
