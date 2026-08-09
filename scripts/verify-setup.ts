/**
 * Read the live Appwrite project back through the APPLICATION's own code
 * paths and check the things that would quietly break attendance.
 *
 *   npx tsx scripts/verify-setup.ts
 *
 * Deliberately not a re-read of the setup script's own output: that only
 * proves the script thinks it succeeded. This proves the app can use what the
 * script made.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { Query } from 'node-appwrite'
import { createAdminClient } from '../lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID, SERVICE_IDS } from '../lib/appwrite/config'
import { listMeetings } from '../lib/meetings/server'
import { resolveActiveSession } from '../lib/attendance/server'
import { loadAllCandidateTemplates } from '../lib/biometrics/server'

let failures = 0
const ok = (m: string) => console.log(`  ✓ ${m}`)
const bad = (m: string) => {
  console.log(`  ✗ ${m}`)
  failures++
}

async function main() {
  const { databases } = createAdminClient()
  console.log(`Verifying ${DATABASE_ID} at ${process.env.APPWRITE_ENDPOINT}\n`)

  // --- collections reachable ----------------------------------------------
  console.log('collections')
  for (const id of Object.values(COLLECTIONS)) {
    try {
      const c = await databases.getCollection(DATABASE_ID, id)
      const pending = c.attributes.filter(
        (a: { status?: string }) => a.status && a.status !== 'available',
      )
      if (pending.length > 0) bad(`${id}: ${pending.length} attribute(s) still processing`)
      else ok(`${id} (${c.attributes.length} attributes, ${c.indexes.length} indexes)`)
    } catch (e) {
      bad(`${id} unreachable: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // --- the two services ----------------------------------------------------
  console.log('\nseeded services')
  const meetings = await listMeetings(databases)
  for (const wanted of [SERVICE_IDS.first, SERVICE_IDS.second]) {
    const m = meetings.find((x) => x.$id === wanted)
    if (!m) {
      bad(`${wanted} missing`)
      continue
    }
    // The single most consequential field in the schema. `restricted: true` on
    // a service would gate it behind a roster nobody has filled in, and every
    // member would be refused at the door on Sunday morning (PRD §2.1).
    if (m.restricted) bad(`${m.name} is restricted — it must be open to every active member`)
    else if (m.kind !== 'service') bad(`${m.name} has kind="${m.kind}", expected "service"`)
    else ok(`${m.name} — open to all, kind=service, slot=${m.service_slot}`)
  }

  // --- the invariant -------------------------------------------------------
  console.log('\nsession state')
  try {
    const session = await resolveActiveSession(databases, { fresh: true })
    ok(session ? `one session open: ${session.meeting.name}` : 'no session open (expected on a fresh project)')
  } catch (e) {
    // Thrown when more than one occurrence is `open` — the invariant is broken.
    bad(e instanceof Error ? e.message : String(e))
  }

  // --- unique indexes actually enforce -------------------------------------
  // These are what make "one mark per member per occurrence" and "one roster
  // row per pair" true under a race, rather than merely likely.
  console.log('\nunique indexes')
  for (const [coll, name] of [
    [COLLECTIONS.attendance_records, 'occurrence_member_unique'],
    [COLLECTIONS.meeting_members, 'pair_unique'],
  ] as const) {
    const c = await databases.getCollection(DATABASE_ID, coll)
    const idx = c.indexes.find((i: { key: string }) => i.key === name)
    if (!idx) bad(`${coll}.${name} missing`)
    else if ((idx as { type: string }).type !== 'unique') bad(`${coll}.${name} is not unique`)
    else ok(`${coll}.${name}`)
  }

  // --- storage -------------------------------------------------------------
  console.log('\nbuckets')
  const { storage } = createAdminClient()
  for (const id of ['member-photos', 'kiosk-downloads']) {
    try {
      const b = await storage.getBucket(id)
      ok(`${id} (max ${(b.maximumFileSize / 1024 / 1024).toFixed(0)} MB)`)
    } catch {
      bad(`${id} unreachable`)
    }
  }

  // --- the biometric gallery ----------------------------------------------
  console.log('\nbiometrics')
  const candidates = await loadAllCandidateTemplates(databases)
  ok(`gallery loads: ${candidates.length} enrolled member(s)`)
  const members = await databases.listDocuments(DATABASE_ID, COLLECTIONS.members, [
    Query.limit(1),
  ])
  ok(`${members.total} member(s) registered`)

  console.log(
    failures === 0
      ? '\n─── all checks passed ───'
      : `\n─── ${failures} check(s) FAILED ───`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
