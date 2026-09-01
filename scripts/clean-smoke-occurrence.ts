/**
 * Remove the phantom service the smoke suite leaves in the attendance history.
 *
 *   npx tsx --conditions=react-server scripts/clean-smoke-occurrence.ts
 *   APPLY=1 npx tsx --conditions=react-server scripts/clean-smoke-occurrence.ts
 *   ... scripts/clean-smoke-occurrence.ts 2026-09-01     # a specific day
 *
 * ## Why the smoke suite cannot clean this up itself
 *
 * `scripts/e2e-smoke.mjs` activates and closes a real FIRST SERVICE, because
 * the single-active-session rule is what it exists to prove and there is no way
 * to prove it without opening one. It deletes its own members and its own test
 * meeting afterwards — but First Service is a real seeded meeting, so the
 * occurrence opened against it is not the suite's to delete by the same logic
 * that deletes everything else it made.
 *
 * What survives is a CLOSED SERVICE DATED TODAY in the congregation's
 * attendance history. Run on a Tuesday it is obviously not a real service. Run
 * on a Sunday it is indistinguishable from one, which is exactly why the suite
 * refuses to start without `E2E_ALLOW_LIVE=1`.
 *
 * ## What makes a phantom identifiable
 *
 * ZERO attendance rows. A real service has marks — that is the entire point of
 * opening one — and the smoke suite's single mark belongs to a member it then
 * deletes, which takes the row with it. So an occurrence against a real service
 * with no attendance rows at all is residue, and one with even a single row is
 * somebody's actual Sunday.
 *
 * That check is the one guard worth keeping if the others are ever trimmed:
 * deleting an occurrence with real marks erases attendance nobody can
 * reconstruct, and nothing afterwards reports that it used to exist.
 *
 * Dry by default. `APPLY=1` deletes.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { Query } from 'node-appwrite'
import { createAdminClient } from '../lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID } from '../lib/appwrite/config'

const day = process.argv[2] ?? new Date().toISOString().slice(0, 10)
const apply = process.env.APPLY === '1'

async function main() {
  const { databases } = createAdminClient()

  const occurrences = await databases.listDocuments(DATABASE_ID, COLLECTIONS.meeting_occurrences, [
    Query.equal('occurrence_date', day),
    Query.limit(100),
  ])

  console.log(`\nOccurrences dated ${day}: ${occurrences.documents.length}\n`)
  if (occurrences.documents.length === 0) {
    console.log('Nothing to look at.')
    return
  }

  const doomed: string[] = []

  for (const raw of occurrences.documents) {
    const o = raw as unknown as Record<string, unknown>
    const id = o.$id as string

    const marks = await databases.listDocuments(DATABASE_ID, COLLECTIONS.attendance_records, [
      Query.equal('occurrence_id', id),
      Query.limit(1),
    ])

    console.log(`${id}`)
    console.log(`  meeting        ${o.meeting_id as string}`)
    console.log(`  status         ${o.status as string}`)
    console.log(`  present_count  ${o.present_count as number}`)
    console.log(`  attendance rows pointing at it: ${marks.total}`)

    /*
     * `closed` and not merely "not open": a PAUSED session is one somebody is
     * still in the middle of and has only let go of the scanner, so deleting it
     * would take a service out from under a congregation that is still in it.
     */
    const checks: [boolean, string][] = [
      [o.status === 'closed', 'closed (never open or paused)'],
      [marks.total === 0, 'no attendance rows — the test for residue'],
    ]
    for (const [pass, label] of checks) console.log(`  ${pass ? 'ok  ' : 'KEEP'} ${label}`)

    if (checks.every(([pass]) => pass)) {
      doomed.push(id)
      console.log('  -> phantom')
    } else {
      console.log('  -> KEPT: this looks like a real service')
    }
    console.log('')
  }

  if (doomed.length === 0) {
    console.log('No phantom occurrences. Nothing to do.')
    return
  }

  if (!apply) {
    console.log(`${doomed.length} phantom occurrence(s) would be removed. Re-run with APPLY=1.`)
    return
  }

  for (const id of doomed) {
    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.meeting_occurrences, id)
    console.log(`deleted ${id}`)
  }

  // Read back, independently of what the deletes reported about themselves.
  const after = await databases.listDocuments(DATABASE_ID, COLLECTIONS.meeting_occurrences, [
    Query.orderDesc('$createdAt'),
    Query.limit(4),
  ])
  console.log('\nnewest occurrences now:')
  for (const raw of after.documents) {
    const o = raw as unknown as Record<string, unknown>
    console.log(
      `  ${o.occurrence_date as string}  ${o.meeting_id as string}  present=${o.present_count as number}`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
