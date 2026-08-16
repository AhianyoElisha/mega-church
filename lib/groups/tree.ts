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
