/**
 * Give every existing member a `member_no`.
 *
 *   npm run backfill:member-numbers            # dry run — prints, writes nothing
 *   npm run backfill:member-numbers -- --apply # writes
 *
 * IDEMPOTENT. A member who already has a number is left alone, so this can be
 * re-run after a partial failure without renumbering anybody. Renumbering is
 * the one thing it must never do: the number is what a paper record, a written
 * receipt or a phone call refers to, and changing it invalidates all of them
 * silently.
 *
 * The order is the church's decision, not this script's — see `backfillOrder`
 * in `lib/members/numbering.ts`, which is pure and unit-tested precisely so the
 * order can be asserted rather than eyeballed in a dry run:
 *
 *   2026001  Kwame Ofosuhene Peasah          the pastor
 *   2026002  Bernice Serwaa Ofosuhene Peasah his wife
 *   2026003+ the remaining constituency heads, in constituency order
 *   2026006+ everybody else, oldest registration first
 *
 * 2026005 is RESERVED for Hayford Budu, who heads Anadeia and has no member row
 * yet. It is skipped rather than given away — see RESERVED_MEMBER_NUMBERS.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { Query } from 'node-appwrite'
import { createAdminClient } from '../lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID } from '../lib/appwrite/config'
import {
  RESERVED_MEMBER_NUMBERS,
  backfillOrder,
  nextMemberNo,
  parseMemberNo,
} from '../lib/members/numbering'

const APPLY = process.argv.includes('--apply')
const PAGE = 100

/** The two people the church named explicitly, matched on their full name. */
const PASTOR = 'Kwame Ofosuhene Peasah'
const PASTORS_WIFE = 'Bernice Serwaa Ofosuhene Peasah'

type Doc = { $id: string; $createdAt: string } & Record<string, unknown>

const { databases } = createAdminClient()

async function listAll(collection: string): Promise<Doc[]> {
  const out: Doc[] = []
  let cursor: string | null = null
  for (;;) {
    const q = [Query.limit(PAGE)]
    if (cursor) q.push(Query.cursorAfter(cursor))
    const res = await databases.listDocuments(DATABASE_ID, collection, q)
    out.push(...(res.documents as unknown as Doc[]))
    if (res.documents.length < PAGE) break
    cursor = res.documents[res.documents.length - 1].$id
  }
  return out
}

/** Exactly one member with this full name, or null — never a guess. */
function findByName(members: Doc[], name: string): Doc | null {
  const hits = members.filter((m) => String(m.full_name ?? '').trim() === name)
  if (hits.length === 1) return hits[0]
  if (hits.length === 0) console.warn(`  ! no member named "${name}"`)
  else console.warn(`  ! ${hits.length} members named "${name}" — refusing to guess`)
  return null
}

async function main() {
  console.log(APPLY ? '── APPLYING ──' : '── DRY RUN (pass --apply to write) ──')

  const [members, constituencies] = await Promise.all([
    listAll(COLLECTIONS.members),
    listAll(COLLECTIONS.constituencies),
  ])
  console.log(`\n${members.length} member(s), ${constituencies.length} constituency/ies`)

  // --- who goes first -------------------------------------------------------
  console.log('\nnamed first:')
  const firstIds: string[] = []
  for (const name of [PASTOR, PASTORS_WIFE]) {
    const hit = findByName(members, name)
    if (hit) {
      firstIds.push(hit.$id)
      console.log(`  ✓ ${name}`)
    }
  }

  // Constituency heads, in the order the constituencies themselves are listed,
  // so the numbering is stable across runs rather than depending on which row
  // Appwrite happened to return first.
  console.log('\nconstituency heads:')
  const headIds: string[] = []
  const unmatchedHeads: { constituency: string; headName: string }[] = []
  const ordered = [...constituencies].sort(
    (a, b) => Number(a.sort_order ?? 100) - Number(b.sort_order ?? 100),
  )
  for (const c of ordered) {
    const headName = String(c.head_name ?? '').trim()
    if (!headName) {
      console.log(`  · ${c.name}: no head appointed`)
      continue
    }
    const hit = members.find((m) => String(m.full_name ?? '').trim() === headName)
    if (!hit) {
      // Two different situations reach here and the message must not conflate
      // them, because only one of them is a problem:
      //
      //   Anadeia  Hayford Budu genuinely has no member row. This is why
      //            2026005 is reserved.
      //   Tsalack  head_name is "Bernice S. O. Peasah" but her member row reads
      //            "Bernice Serwaa Ofosuhene Peasah" — the same person under a
      //            shorter spelling. She is already numbered above, so nothing
      //            is lost.
      //
      // Matching is EXACT either way. Fuzzy-matching a head onto a member is
      // guessing at who somebody is, and getting it wrong here would hand a
      // head's number to a different member with a similar name.
      unmatchedHeads.push({ constituency: String(c.name), headName })
      console.log(`  ! ${c.name}: no member is named exactly "${headName}" — not numbered here`)
      continue
    }
    if (firstIds.includes(hit.$id)) {
      console.log(`  · ${c.name}: ${headName} is already named above`)
      continue
    }
    headIds.push(hit.$id)
    console.log(`  ✓ ${c.name}: ${headName}`)
  }

  if (unmatchedHeads.length > 0) {
    console.log(
      '\n  A head not numbered above is either genuinely unregistered (see the\n' +
        '  reservation below) or recorded under a shorter spelling than their own\n' +
        '  member row, in which case they are already numbered as themselves.\n' +
        '  Neither is fixed by guessing: correct head_name on the group page if\n' +
        '  the two are meant to match.',
    )
  }

  console.log('\nreserved, and skipped by the allocator:')
  for (const [no, why] of Object.entries(RESERVED_MEMBER_NUMBERS)) {
    const holder = members.find((m) => m.member_no === no)
    console.log(`  ${no}  ${why}`)
    if (holder) console.error(`  ! ${no} is ALREADY HELD by ${holder.full_name} — investigate`)
  }

  // --- assign ---------------------------------------------------------------
  const year = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Accra', year: 'numeric' }).format(
      new Date(),
    ),
  )

  const already = members.filter((m) => parseMemberNo(m.member_no)).length
  const taken = members.map((m) => (typeof m.member_no === 'string' ? m.member_no : null))
  const todo = backfillOrder(
    members.filter((m) => !parseMemberNo(m.member_no)),
    { firstIds, headIds },
  )

  console.log(
    `\n${already} member(s) already numbered, ${todo.length} to assign, year ${year}\n`,
  )

  let assigned = 0
  for (const m of todo) {
    // Recomputed each time from what is now taken, so a re-run after a partial
    // failure continues rather than restarting.
    const no = nextMemberNo(taken, year)
    taken.push(no)
    const label = `${no}  ${String(m.full_name ?? '(no name)')}`

    if (!APPLY) {
      if (assigned < 12 || assigned >= todo.length - 2) console.log(`  ${label}`)
      else if (assigned === 12) console.log(`  … ${todo.length - 14} more …`)
      assigned += 1
      continue
    }

    try {
      await databases.updateDocument(DATABASE_ID, COLLECTIONS.members, m.$id, { member_no: no })
      assigned += 1
      if (assigned % 25 === 0) console.log(`  … ${assigned}/${todo.length}`)
    } catch (err) {
      // A 409 here means somebody registered while this was running and took
      // the number. Stop rather than skipping: the ordering is the point, and
      // continuing past a collision would quietly shift everyone after it.
      console.error(`\n✗ ${label} failed:`, err instanceof Error ? err.message : err)
      console.error('  Stopped. Re-run — already-numbered members are left alone.')
      process.exit(1)
    }
  }

  console.log(
    APPLY
      ? `\n✓ assigned ${assigned} number(s). Re-run to confirm it reports 0 to assign.`
      : `\n${assigned} would be assigned. Re-run with --apply to write.`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
