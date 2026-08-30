// Human-readable member numbers: `2026001`, `2026002`, …
//
// Pure — no Appwrite, no React. Everything here is a function of its arguments
// so the rules below are unit-tested rather than discovered in production with
// two members holding the same number.
//
// ── The shape ──────────────────────────────────────────────────────────────
//
// The YEAR the member was registered, then a sequence that restarts each
// January. `2026001` is the first person registered in 2026; the first of 2027
// is `2027001`. That makes the number say something the Appwrite `$id` cannot:
// when somebody joined, and roughly in what order.
//
// It is NOT the primary key — Appwrite's `$id` still is. This is the reference
// humans use out loud and on paper, because
// `6a819fac00089c09d5f2` is not a thing anyone can read down a phone.

/** Sequence digits below 1000. Above that the number simply gets longer. */
const SEQ_PAD = 3

/**
 * Numbers held back from allocation, and who each is for.
 *
 * A reservation exists because the church's numbering has an ORDER that means
 * something — the pastor, his wife, then the constituency heads — and one of
 * those heads has no member row yet. Handing his slot to the next person to
 * walk in would put him at the end of the congregation when he is finally
 * registered, and the order would be silently wrong forever after.
 *
 * Enforced rather than documented. `nextMemberNo` will never issue one of
 * these, so it cannot be lost by someone re-running a backfill or by an
 * ordinary registration on a busy Sunday. A comment in a script would not
 * survive either.
 *
 * To CONSUME a reservation: register the member, set their `member_no` to the
 * reserved value, and delete the line from this map in the same change. The
 * unique index on `member_no` is what stops it being handed out twice in the
 * window between those two steps.
 */
export const RESERVED_MEMBER_NUMBERS: Readonly<Record<string, string>> = {
  '2026005':
    'Hayford Budu — head of Anadeia Constituency. Has no member row yet, so his ' +
    'place in the head sequence is held rather than given away.',
}

export type ParsedMemberNo = { year: number; seq: number }

/** `2026001` → `{ year: 2026, seq: 1 }`. Null for anything that is not one. */
export function parseMemberNo(raw: unknown): ParsedMemberNo | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  // At least four year digits plus one sequence digit, digits only.
  if (!/^\d{5,}$/.test(value)) return null
  const year = Number(value.slice(0, 4))
  const seq = Number(value.slice(4))
  if (!Number.isFinite(year) || !Number.isFinite(seq)) return null
  // `20260000` is not a member number; the sequence starts at 1.
  if (seq < 1) return null
  return { year, seq }
}

/** `(2026, 1)` → `"2026001"`. Past 999 the sequence just gets a fourth digit. */
export function formatMemberNo(year: number, seq: number): string {
  return `${year}${String(seq).padStart(SEQ_PAD, '0')}`
}

/**
 * The next number to issue for `year`, given everything already taken.
 *
 * **Max + 1, never the lowest free gap.** A gap is somebody who was deleted, or
 * a reservation — and reissuing either is precisely what must not happen. This
 * also means the allocator never has to reason about holes, which is what makes
 * it safe to run concurrently.
 *
 * A reservation is SKIPPED when the sequence reaches it, and deliberately does
 * NOT count towards the maximum. Counting it would raise the floor from the
 * very first allocation: with `2026005` held and nothing issued, the maximum
 * would be 5 and the church's first member would be handed `2026006`. The
 * reservation has to be invisible until the count actually arrives at it.
 *
 * ⚠️ The maximum is computed by PARSING each number and comparing the sequence
 * NUMERICALLY, never by sorting the strings. Below 1000 the two agree; at
 * `20261000` they stop agreeing, and a lexical maximum would then hand out a
 * number that is already taken — a duplicate the unique index would refuse, on
 * the day the church grows past 999 registrations in a year and nobody is
 * expecting a failure.
 */
export function nextMemberNo(
  taken: readonly (string | null | undefined)[],
  year: number,
  reserved: readonly string[] = Object.keys(RESERVED_MEMBER_NUMBERS),
): string {
  let highest = 0
  for (const candidate of taken) {
    const parsed = parseMemberNo(candidate)
    if (parsed && parsed.year === year && parsed.seq > highest) highest = parsed.seq
  }

  const held = new Set(reserved)
  let seq = highest + 1
  while (held.has(formatMemberNo(year, seq))) seq += 1
  return formatMemberNo(year, seq)
}

/**
 * The order the backfill assigns numbers in.
 *
 * Stated as a pure function of the member list so the order can be asserted in
 * a test rather than eyeballed in a dry-run — the two named people at the top
 * are a decision the church made, and a refactor that quietly reorders them
 * would be invisible.
 *
 *   1. the pastor, then his wife — named explicitly by `$id`
 *   2. the remaining constituency heads, in constituency order
 *   3. everybody else, oldest registration first
 *
 * Step 3 is `$createdAt` rather than alphabetical because "any order" was
 * permitted and registration order is the one that carries information.
 */
export function backfillOrder<T extends { $id: string; full_name?: string; $createdAt: string }>(
  members: readonly T[],
  opts: { firstIds: readonly string[]; headIds: readonly string[] },
): T[] {
  const rank = new Map<string, number>()
  opts.firstIds.forEach((id, i) => rank.set(id, i))
  opts.headIds.forEach((id, i) => {
    // A head who is also one of the named few keeps their earlier place —
    // Bernice heads Tsalack and is already number two.
    if (!rank.has(id)) rank.set(id, opts.firstIds.length + i)
  })

  const REST = Number.MAX_SAFE_INTEGER
  return [...members].sort((a, b) => {
    const ra = rank.get(a.$id) ?? REST
    const rb = rank.get(b.$id) ?? REST
    if (ra !== rb) return ra - rb
    return a.$createdAt.localeCompare(b.$createdAt)
  })
}
