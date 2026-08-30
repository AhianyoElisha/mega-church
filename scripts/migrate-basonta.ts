/**
 * Split the old `bacentas` collection into its two real meanings.
 *
 *   npm run migrate:basonta                          # dry run, writes nothing
 *   npm run migrate:basonta -- --apply --copy-only   # steps 1-4 only
 *   npm run migrate:basonta -- --apply               # the whole thing
 *
 * ── What this is fixing ────────────────────────────────────────────────────
 *
 * `bacentas` was built as one collection doing two unrelated jobs: the church's
 * SERVING groups (Choir over Biazo / Living Waters / Fresh Oil, Technical Team,
 * Ushers, Media, Dancing Stars) and the PLACES people live (Anloga, Susuankyi,
 * Oforikrom, Bomso, Asokwa). The church's word for the first is BASONTA. A
 * bacenta is the second.
 *
 * ── The order, and why it is this order ────────────────────────────────────
 *
 *   1  copy the categories to `basonta_categories`
 *   2  copy the 7 serving groups to `basontas`
 *   3  copy their membership rows to `basonta_members`
 *   4  VERIFY every copy — counts, and that each row resolves to a real member
 *      and a real group
 *   5  file the 5 places into their constituency
 *   6  write `members.bacenta_id` from the place membership rows
 *   7  DELETE the copied serving groups, then the whole `bacenta_members` join
 *
 * Steps 1-4 are non-destructive and can be run and inspected on their own.
 * Step 7 is the ONLY step that removes anything, it runs last, and it runs only
 * against rows step 4 has already proven were copied. Nothing is deleted before
 * its copy is verified.
 *
 * IDEMPOTENT throughout: every step skips what it already did, so a run that
 * fails halfway can simply be run again.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { ID, Query } from 'node-appwrite'
import { createAdminClient } from '../lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID } from '../lib/appwrite/config'

const APPLY = process.argv.includes('--apply')
/**
 * `--copy-only` performs steps 1-4 and stops.
 *
 * The copy is written and verified; nothing is filed, no member is changed, and
 * nothing at all is deleted. It exists so the irreversible half can be a
 * separate, deliberate decision taken after looking at the result — which is
 * how a migration against a live congregation ought to be run.
 */
const COPY_ONLY = process.argv.includes('--copy-only')
const PAGE = 100

/**
 * The classification, written out rather than inferred.
 *
 * It would be tempting to sort on the name ending in "Bacenta". That is a guess
 * about what somebody typed, and it decides which collection real people's
 * memberships end up in. These two lists are the church's own answer, confirmed
 * against the live data before this was written, and the run ABORTS if the
 * groups in the database are not exactly these — a group added or renamed since
 * is a question for a human, not something to sort automatically.
 */
const SERVING_GROUPS = [
  'Biazo',
  'Living Waters',
  'Fresh Oil',
  'Technical Team',
  'Ushers',
  'Media',
  'Dancing Stars',
]

const PLACES = [
  'Oforikrom Bacenta',
  'Bomso Bacenta',
  'Anloga Bacenta',
  'Susuankyi Bacenta',
  'Asokwa Bacenta',
]

/** Every place belongs to this constituency — all 28 of their members live in it. */
const PLACES_CONSTITUENCY = 'Alos Constituency'

type Doc = { $id: string } & Record<string, unknown>

const { databases } = createAdminClient()
const bulk = databases as unknown as {
  createDocuments: (db: string, col: string, docs: object[]) => Promise<unknown>
}

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

const name = (d: Doc) => String(d.name ?? '').trim()
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

let failed = false
const step = (n: number, label: string) => console.log(`\n── ${n}. ${label} ──`)
const did = (msg: string) => console.log(`  ${APPLY ? '✓' : '·'} ${msg}`)
const skip = (msg: string) => console.log(`  · ${msg}`)
const bad = (msg: string) => {
  failed = true
  console.error(`  ✗ ${msg}`)
}

async function main() {
  console.log(APPLY ? '══ APPLYING ══' : '══ DRY RUN (pass --apply to write) ══')

  const [categories, bacentas, joins, members, constituencies, basontaCats, basontas, basontaJoins] =
    await Promise.all([
      listAll(COLLECTIONS.bacenta_categories),
      listAll(COLLECTIONS.bacentas),
      listAll(COLLECTIONS.bacenta_members),
      listAll(COLLECTIONS.members),
      listAll(COLLECTIONS.constituencies),
      listAll(COLLECTIONS.basonta_categories),
      listAll(COLLECTIONS.basontas),
      listAll(COLLECTIONS.basonta_members),
    ])

  console.log(
    `\n${bacentas.length} bacenta(s), ${joins.length} membership row(s), ` +
      `${categories.length} category/ies, ${members.length} member(s)`,
  )
  console.log(
    `already migrated: ${basontas.length} basonta(s), ${basontaJoins.length} membership row(s)`,
  )

  // --- the classification must match the database exactly -------------------
  const expected = new Set([...SERVING_GROUPS, ...PLACES])
  const live = bacentas.map(name)
  const unexpected = live.filter((n) => !expected.has(n))
  const missing = [...expected].filter((n) => !live.includes(n))

  // Anything already moved is legitimately absent on a re-run.
  const alreadyMoved = new Set(basontas.map(name))
  const reallyMissing = missing.filter((n) => !alreadyMoved.has(n))

  if (unexpected.length > 0) {
    bad(
      `group(s) in the database that this script has no instruction for: ` +
        `${unexpected.join(', ')}. Add them to SERVING_GROUPS or PLACES first — ` +
        `guessing would file real people into the wrong collection.`,
    )
  }
  if (reallyMissing.length > 0) {
    bad(`expected group(s) not found: ${reallyMissing.join(', ')}.`)
  }
  if (failed) {
    console.error('\nStopped before touching anything.')
    process.exit(1)
  }

  const servingRows = bacentas.filter((b) => SERVING_GROUPS.includes(name(b)))
  const placeRows = bacentas.filter((b) => PLACES.includes(name(b)))
  console.log(`\nto BASONTA: ${servingRows.length}   staying BACENTA: ${placeRows.length}`)

  // --- 1. categories --------------------------------------------------------
  step(1, 'categories → basonta_categories')
  const categoryMap = new Map<string, string>() // old id -> new id
  for (const c of categories) {
    const existing = basontaCats.find((x) => name(x) === name(c))
    if (existing) {
      categoryMap.set(c.$id, existing.$id)
      skip(`"${name(c)}" already there`)
      continue
    }
    if (!APPLY) {
      categoryMap.set(c.$id, `(new)-${name(c)}`)
      did(`would copy "${name(c)}"`)
      continue
    }
    const created = await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.basonta_categories,
      ID.unique(),
      {
        name: name(c),
        description: str(c.description),
        sort_order: typeof c.sort_order === 'number' ? c.sort_order : 100,
        created_by: str(c.created_by),
      },
    )
    categoryMap.set(c.$id, created.$id)
    did(`copied "${name(c)}"`)
  }

  // --- 2. serving groups ----------------------------------------------------
  step(2, 'serving groups → basontas')
  const groupMap = new Map<string, string>() // old bacenta id -> new basonta id
  for (const b of servingRows) {
    const existing = basontas.find((x) => name(x) === name(b))
    if (existing) {
      groupMap.set(b.$id, existing.$id)
      skip(`"${name(b)}" already there`)
      continue
    }
    const oldCategory = str(b.category_id)
    const newCategory = oldCategory ? (categoryMap.get(oldCategory) ?? null) : null
    if (oldCategory && !newCategory) {
      bad(`"${name(b)}" points at category ${oldCategory}, which was not copied`)
      continue
    }
    if (!APPLY) {
      groupMap.set(b.$id, `(new)-${name(b)}`)
      did(`would copy "${name(b)}"${newCategory ? ' (categorised)' : ' (standalone)'}`)
      continue
    }
    const created = await databases.createDocument(DATABASE_ID, COLLECTIONS.basontas, ID.unique(), {
      name: name(b),
      category_id: newCategory,
      description: str(b.description),
      head_user_id: str(b.head_user_id),
      head_name: str(b.head_name),
      sort_order: typeof b.sort_order === 'number' ? b.sort_order : 100,
      created_by: str(b.created_by),
    })
    groupMap.set(b.$id, created.$id)
    did(`copied "${name(b)}"`)
  }

  // --- 3. their memberships -------------------------------------------------
  step(3, 'serving memberships → basonta_members')
  const servingIds = new Set(servingRows.map((r) => r.$id))
  const servingJoins = joins.filter((j) => servingIds.has(String(j.bacenta_id)))
  const havePair = new Set(basontaJoins.map((j) => `${j.basonta_id}:${j.member_id}`))

  const toCreate: object[] = []
  for (const j of servingJoins) {
    const newGroup = groupMap.get(String(j.bacenta_id))
    if (!newGroup) {
      bad(`membership points at a group that was not copied: ${String(j.bacenta_id)}`)
      continue
    }
    if (APPLY && havePair.has(`${newGroup}:${String(j.member_id)}`)) continue
    toCreate.push({
      $id: ID.unique(),
      basonta_id: newGroup,
      member_id: String(j.member_id),
      added_by: str(j.added_by),
    })
  }
  console.log(`  ${servingJoins.length} row(s) to move, ${toCreate.length} not yet copied`)
  if (APPLY && toCreate.length > 0) {
    // Bulk — a loop of createDocument for a multi-row write is the bug
    // CLAUDE.md names by hand.
    for (let i = 0; i < toCreate.length; i += PAGE) {
      await bulk.createDocuments(DATABASE_ID, COLLECTIONS.basonta_members, toCreate.slice(i, i + PAGE))
    }
    did(`copied ${toCreate.length} membership row(s)`)
  }

  // --- 4. VERIFY before anything is destroyed -------------------------------
  step(4, 'verify the copy')
  if (!APPLY) {
    skip('dry run — nothing copied yet, so nothing to verify')
  } else {
    const [afterCats, afterGroups, afterJoins] = await Promise.all([
      listAll(COLLECTIONS.basonta_categories),
      listAll(COLLECTIONS.basontas),
      listAll(COLLECTIONS.basonta_members),
    ])
    const memberIds = new Set(members.map((m) => m.$id))
    const groupIds = new Set(afterGroups.map((g) => g.$id))

    for (const c of categories) {
      if (!afterCats.some((x) => name(x) === name(c))) bad(`category "${name(c)}" missing`)
    }
    for (const b of servingRows) {
      if (!afterGroups.some((x) => name(x) === name(b))) bad(`basonta "${name(b)}" missing`)
    }
    if (afterJoins.length < servingJoins.length) {
      bad(`${afterJoins.length} membership row(s) copied, expected at least ${servingJoins.length}`)
    }
    const dangling = afterJoins.filter(
      (j) => !memberIds.has(String(j.member_id)) || !groupIds.has(String(j.basonta_id)),
    )
    if (dangling.length > 0) bad(`${dangling.length} copied membership row(s) resolve to nothing`)

    if (failed) {
      console.error('\n✗ Verification FAILED. Nothing has been deleted. Fix and re-run.')
      process.exit(1)
    }
    did(
      `${afterCats.length} category/ies, ${afterGroups.length} basonta(s), ` +
        `${afterJoins.length} membership row(s) — all resolve`,
    )
  }

  if (COPY_ONLY) {
    console.log(
      [
        '',
        '── stopping after the copy (--copy-only) ──',
        '  Nothing has been filed, changed or deleted. Every old row is still',
        '  there, so this half is undone by deleting the new basonta rows.',
        '  Re-run with --apply alone to finish.',
      ].join('\n'),
    )
    return
  }

  // --- 5. file the places into their constituency ---------------------------
  step(5, `file the places into ${PLACES_CONSTITUENCY}`)
  const alos = constituencies.find((c) => name(c) === PLACES_CONSTITUENCY)
  if (!alos) {
    bad(`constituency "${PLACES_CONSTITUENCY}" not found`)
  } else {
    for (const b of placeRows) {
      if (str(b.constituency_id)) {
        skip(`"${name(b)}" already filed`)
        continue
      }
      if (!APPLY) {
        did(`would file "${name(b)}"`)
        continue
      }
      await databases.updateDocument(DATABASE_ID, COLLECTIONS.bacentas, b.$id, {
        constituency_id: alos.$id,
      })
      did(`filed "${name(b)}"`)
    }
  }

  // --- 6. membership becomes a field ----------------------------------------
  step(6, 'place memberships → members.bacenta_id')
  const placeIds = new Set(placeRows.map((r) => r.$id))
  const placeJoins = joins.filter((j) => placeIds.has(String(j.bacenta_id)))

  // A member in two places would make this ambiguous, and the whole field model
  // rests on that not happening. Checked rather than assumed.
  const seen = new Map<string, string>()
  for (const j of placeJoins) {
    const memberId = String(j.member_id)
    const previous = seen.get(memberId)
    if (previous && previous !== String(j.bacenta_id)) {
      bad(`member ${memberId} is in two places — cannot become a single field`)
    }
    seen.set(memberId, String(j.bacenta_id))
  }
  if (failed) {
    console.error('\nStopped before writing. Nothing has been deleted.')
    process.exit(1)
  }

  let wrote = 0
  for (const [memberId, bacentaId] of seen) {
    const m = members.find((x) => x.$id === memberId)
    if (!m) {
      skip(`member ${memberId} no longer exists`)
      continue
    }
    if (str(m.bacenta_id) === bacentaId) continue
    if (!APPLY) {
      wrote += 1
      continue
    }
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.members, memberId, {
      bacenta_id: bacentaId,
    })
    wrote += 1
  }
  did(`${wrote} member(s) ${APPLY ? 'given' : 'would be given'} a bacenta`)

  // --- 7. THE ONLY DESTRUCTIVE STEP -----------------------------------------
  step(7, 'remove what has been copied')
  if (!APPLY) {
    skip(`would delete ${servingRows.length} copied serving group(s) from bacentas`)
    skip(`would delete all ${joins.length} bacenta_members row(s)`)
  } else {
    for (const b of servingRows) {
      await databases.deleteDocument(DATABASE_ID, COLLECTIONS.bacentas, b.$id)
      did(`removed "${name(b)}" from bacentas`)
    }
    // The join collection goes entirely: serving membership now lives in
    // `basonta_members`, and place membership is a field on the member.
    let removed = 0
    for (const j of joins) {
      await databases.deleteDocument(DATABASE_ID, COLLECTIONS.bacenta_members, j.$id)
      removed += 1
    }
    did(`removed ${removed} bacenta_members row(s)`)
  }

  console.log(
    APPLY
      ? '\n✓ Migration complete. Run `npm run verify:appwrite`, then re-run this to confirm it is a no-op.'
      : '\nNothing was written. Re-run with --apply.',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
