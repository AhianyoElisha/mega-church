/**
 * Write `benmp_partner: false` onto every member that has no value yet.
 *
 *   npm run backfill:benmp            # dry run
 *   npm run backfill:benmp -- --apply
 *
 * Nobody is made a partner by this. It writes the answer the church already
 * has — "not a partner" — onto rows that predate the field.
 *
 * Why bother, when the code reads `benmp_partner === true` and therefore treats
 * a missing value as false anyway:
 *
 *   1. Appwrite cannot query for "attribute is absent", so the `by_benmp` index
 *      is only usable once every row actually has a value. The monthly reminder
 *      list is a server-side query, and it must not have to page the whole
 *      congregation to find twelve partners.
 *   2. "No value" and "answered no" look identical afterwards but are not the
 *      same thing, and only one of them is safe to trust when the job that
 *      spends money on texts starts reading this field.
 *
 * IDEMPOTENT: a row that already has `true` or `false` is left alone, so this
 * can never un-tick a partner somebody has since recorded.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { Query } from 'node-appwrite'
import { createAdminClient } from '../lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID } from '../lib/appwrite/config'

const APPLY = process.argv.includes('--apply')
const PAGE = 100

const { databases } = createAdminClient()

async function main() {
  console.log(APPLY ? '── APPLYING ──' : '── DRY RUN (pass --apply to write) ──')

  const all: { $id: string; full_name?: unknown; benmp_partner?: unknown }[] = []
  let cursor: string | null = null
  for (;;) {
    const q = [Query.limit(PAGE)]
    if (cursor) q.push(Query.cursorAfter(cursor))
    const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.members, q)
    all.push(...(res.documents as unknown as typeof all))
    if (res.documents.length < PAGE) break
    cursor = res.documents[res.documents.length - 1].$id
  }

  const partners = all.filter((m) => m.benmp_partner === true)
  const answered = all.filter((m) => typeof m.benmp_partner === 'boolean')
  const todo = all.filter((m) => typeof m.benmp_partner !== 'boolean')

  console.log(`\n${all.length} member(s)`)
  console.log(`  ${answered.length} already answered (${partners.length} partner(s))`)
  console.log(`  ${todo.length} with no value — to be set false`)

  if (partners.length > 0) {
    console.log('\npartners, left exactly as they are:')
    for (const p of partners) console.log(`  · ${String(p.full_name ?? p.$id)}`)
  }

  if (!APPLY) {
    console.log(`\n${todo.length} would be set to false. Re-run with --apply to write.`)
    return
  }

  let done = 0
  for (const m of todo) {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.members, m.$id, {
      benmp_partner: false,
    })
    done += 1
    if (done % 25 === 0) console.log(`  … ${done}/${todo.length}`)
  }
  console.log(`\n✓ set ${done} to false. Re-run to confirm it reports 0 with no value.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
