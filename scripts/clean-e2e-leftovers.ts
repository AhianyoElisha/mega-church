/**
 * Remove what an aborted e2e run left in the live project.
 *
 *   npx tsx --conditions=react-server scripts/clean-e2e-leftovers.ts <stamp>
 *   APPLY=1 npx tsx --conditions=react-server scripts/clean-e2e-leftovers.ts <stamp>
 *
 * `scripts/e2e-groups.mjs` cleans up after itself in a `finally`. When the
 * finally block ITSELF throws — which is what happened on 2026-09-01, because
 * three assertion sections had been spliced in above the cleanup — the rows
 * survive, in a live congregation, looking like real members.
 *
 * ## Why this exists rather than "just delete the rows"
 *
 * Appwrite has no cascade. A member deleted straight from the database leaves
 * their biometric templates, roster rows, basonta memberships, SMS log rows and
 * attendance records behind, and leaves anybody in their pastoral care pointing
 * at somebody who is gone. So this calls the application's OWN cascade
 * functions — the same ones the route handlers call — rather than
 * re-implementing them here, where they would drift.
 *
 * It needs no session and no admin password: it runs server-side with the API
 * key, which is what makes it usable when the seeded credential is the very
 * thing that is broken.
 *
 * ## Matched on the run STAMP, not on "E2E"
 *
 * The suite names its head-registered member `Registered <stamp>` with no "E2E"
 * anywhere in it — so a name filter misses the row created by the most
 * privileged path in the whole suite. The stamp is in every row it writes.
 *
 * Dry by default. `APPLY=1` deletes.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { Query } from 'node-appwrite'
import { createAdminClient } from '../lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID } from '../lib/appwrite/config'
import { deleteMemberCascade } from '../lib/members/server'
import {
  deleteBacentaCascade,
  deleteBasontaCascade,
  deleteBasontaCategory,
  deleteConstituencyCascade,
} from '../lib/groups/server'

const stamp = process.argv[2] ?? process.env.E2E_STAMP
const apply = process.env.APPLY === '1'

async function main() {
  if (!stamp) {
    console.error('usage: clean-e2e-leftovers.ts <run-stamp>')
    process.exit(1)
  }

  const { databases } = createAdminClient()

  async function findAll(collection: string) {
    const out: Record<string, unknown>[] = []
    let cursor: string | undefined
    for (;;) {
      const q = [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])]
      const page = await databases.listDocuments(DATABASE_ID, collection, q)
      out.push(...(page.documents as unknown as Record<string, unknown>[]))
      if (page.documents.length < 100) break
      cursor = page.documents[page.documents.length - 1].$id
    }
    return out.filter((d) => JSON.stringify(d).includes(stamp!))
  }

  /**
   * Basontas the stamp alone does not catch.
   *
   * A row can be throwaway without carrying the stamp anywhere in it — the
   * duplicate-name test creates one named after another fixture, so its name is
   * whatever that fixture was called and its own document mentions no stamp.
   * What it DOES have is a `category_id` pointing at a stamped category, and a
   * category is only ever created by a run.
   *
   * Without this the category can never be deleted: it refuses while anything
   * still holds it, and the thing holding it is invisible to a stamp match.
   * That is not hypothetical — it is exactly what stranded one on 2026-09-01.
   */
  async function basontasInStampedCategories() {
    const categories = await findAll(COLLECTIONS.basonta_categories)
    if (categories.length === 0) return []
    const ids = new Set(categories.map((c) => c.$id as string))
    const all: Record<string, unknown>[] = []
    let cursor: string | undefined
    for (;;) {
      const q = [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])]
      const page = await databases.listDocuments(DATABASE_ID, COLLECTIONS.basontas, q)
      all.push(...(page.documents as unknown as Record<string, unknown>[]))
      if (page.documents.length < 100) break
      cursor = page.documents[page.documents.length - 1].$id
    }
    return all.filter((b) => typeof b.category_id === 'string' && ids.has(b.category_id))
  }

  /**
   * Order is the suite's own and it is load-bearing: members first, so the
   * groups are empty by the time they go; bacentas before their constituency,
   * because a bacenta filed into a constituency that no longer exists is
   * precisely the unfiled row `verify:appwrite` exists to catch.
   */
  const steps = [
    {
      label: 'members',
      collection: COLLECTIONS.members,
      remove: (id: string) => deleteMemberCascade(databases, id),
    },
    {
      label: 'basontas',
      collection: COLLECTIONS.basontas,
      remove: (id: string) => deleteBasontaCascade(databases, id),
    },
    {
      label: 'basonta categories',
      collection: COLLECTIONS.basonta_categories,
      remove: (id: string) => deleteBasontaCategory(databases, id),
    },
    {
      label: 'bacentas',
      collection: COLLECTIONS.bacentas,
      remove: (id: string) => deleteBacentaCascade(databases, id),
    },
    {
      label: 'constituencies',
      collection: COLLECTIONS.constituencies,
      remove: (id: string) => deleteConstituencyCascade(databases, id),
    },
  ]

  console.log(`\nRows carrying the stamp ${stamp}\n`)

  let total = 0
  for (const step of steps) {
    const found = await findAll(step.collection)
    // Union, de-duplicated by id: a basonta may both carry the stamp and sit in
    // a stamped category, and deleting it twice would report a spurious failure.
    const extra =
      step.collection === COLLECTIONS.basontas ? await basontasInStampedCategories() : []
    const byId = new Map<string, Record<string, unknown>>()
    for (const r of [...found, ...extra]) byId.set(r.$id as string, r)
    const rows = [...byId.values()]
    total += rows.length
    console.log(`${step.label} — ${rows.length}`)
    for (const r of rows) {
      const name = (r.full_name as string) ?? (r.name as string) ?? (r.$id as string)
      // The phone is printed for members because these rows are exactly what a
      // whole-congregation SMS would have tried to text. Knowing the numbers is
      // how you check the send log afterwards.
      const phone = r.call_number ? `  tel ${r.call_number as string}` : ''
      console.log(`  ${r.$id as string}  ${name}${phone}`)
      if (apply) {
        try {
          /*
           * Not every cascade signals failure by throwing.
           * `deleteBasontaCategory` REFUSES a category that still holds
           * basontas and returns `{ ok: false, error }` — so a bare
           * `await` + "removed" reported success for a row still sitting in
           * the database. Honour the return value where there is one.
           */
          const result = (await step.remove(r.$id as string)) as
            | { ok?: boolean; error?: string }
            | undefined
          if (result && result.ok === false) {
            console.log(`    REFUSED: ${result.error ?? 'no reason given'}`)
          } else {
            console.log('    removed')
          }
        } catch (e) {
          console.log(`    FAILED: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  }

  if (!apply) {
    console.log(`\n${total} row(s) would be removed. Re-run with APPLY=1.`)
    return
  }

  // Read back, independently of what the deletes reported about themselves.
  console.log('\nread back:')
  let left = 0
  for (const step of steps) {
    const rows = await findAll(step.collection)
    left += rows.length
    console.log(`  ${step.label.padEnd(20)} ${rows.length} left`)
  }
  console.log(left === 0 ? '\nNothing left carrying that stamp.' : `\n${left} STILL PRESENT.`)
  process.exit(left === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
