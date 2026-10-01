/**
 * Write `member_type: 'adult'` onto every member that has no value yet.
 *
 *   npm run backfill:member-type            # dry run
 *   npm run backfill:member-type -- --apply
 *
 * Nobody is reclassified by this. It writes the answer the code already gives
 * — `memberDocToMember` reads an absent or unrecognised value as `adult` —
 * onto rows that predate the field.
 *
 * Why bother, when the reader treats a missing value as `adult` anyway:
 *
 *   1. Appwrite cannot query for "attribute is absent", so the `by_member_type`
 *      index is only usable once every row actually has a value. The Category
 *      filter on /members and the audience narrowing on /sms are server-side
 *      queries, and until this has run `type=adult` returns only members
 *      registered AFTER the field existed — which looks exactly like a church
 *      with three adults in it.
 *   2. "No value" and "an adult" look identical to the reader and are not the
 *      same thing. Once the field is on every row, a missing one is a bug to
 *      find rather than a legacy row to tolerate.
 *
 * IDEMPOTENT: a row that already has any recognised value is left alone, so
 * this can never turn a student or a child back into an adult.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { Query } from 'node-appwrite'
import { createAdminClient } from '../lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID, isMemberType } from '../lib/appwrite/config'

const APPLY = process.argv.includes('--apply')
const PAGE = 100

const { databases } = createAdminClient()

async function main() {
  console.log(APPLY ? '── APPLYING ──' : '── DRY RUN (pass --apply to write) ──')

  const all: { $id: string; full_name?: unknown; member_type?: unknown }[] = []
  let cursor: string | null = null
  for (;;) {
    const q = [Query.limit(PAGE)]
    if (cursor) q.push(Query.cursorAfter(cursor))
    const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.members, q)
    all.push(...(res.documents as unknown as typeof all))
    if (res.documents.length < PAGE) break
    cursor = res.documents[res.documents.length - 1].$id
  }

  const answered = all.filter((m) => isMemberType(m.member_type))
  const students = answered.filter((m) => m.member_type === 'student')
  const children = answered.filter((m) => m.member_type === 'child')
  const todo = all.filter((m) => !isMemberType(m.member_type))
  // An unrecognised non-null value is worth naming: it means somebody edited
  // the console by hand, and the reader has been silently calling them an
  // adult. Written to `adult` like the rest, but listed so an admin can check.
  const odd = todo.filter((m) => m.member_type !== undefined && m.member_type !== null)

  console.log(`\n${all.length} member(s)`)
  console.log(
    `  ${answered.length} already answered (${students.length} student(s), ${children.length} child(ren))`,
  )
  console.log(`  ${todo.length} with no value — to be set adult`)

  if (odd.length > 0) {
    console.log('\nunrecognised values, to be overwritten with adult:')
    for (const m of odd) console.log(`  · ${String(m.full_name ?? m.$id)}: ${JSON.stringify(m.member_type)}`)
  }

  if (!APPLY) {
    console.log(`\n${todo.length} would be set to adult. Re-run with --apply to write.`)
    return
  }

  let done = 0
  for (const m of todo) {
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.members, m.$id, {
      member_type: 'adult',
    })
    done += 1
    if (done % 25 === 0) console.log(`  … ${done}/${todo.length}`)
  }
  console.log(`\n✓ set ${done} to adult. Re-run to confirm it reports 0 with no value.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
