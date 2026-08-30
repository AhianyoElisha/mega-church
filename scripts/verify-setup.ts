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
import {
  listBacentas,
  listBasontaCategories,
  listBasontas,
  listCategories,
  listConstituencies,
} from '../lib/groups/server'

let failures = 0
const ok = (m: string) => console.log(`  ✓ ${m}`)
const bad = (m: string) => {
  console.log(`  ✗ ${m}`)
  failures++
}
/** Reported but NOT a failure. An optional feature that is switched off is a
 *  state the app explains on screen, not a broken deployment. */
const warn = (m: string) => console.log(`  ! ${m}`)

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
    // One row per (bacenta, member) — two admins ticking the same person at
    // the same moment must not double-count a bacenta's roster.
    [COLLECTIONS.bacenta_members, 'pair_unique'],
    // Same guarantee for the serving groups.
    [COLLECTIONS.basonta_members, 'pair_unique'],
    // Two groups with the same name are indistinguishable in every dropdown
    // in the app, which makes both of them unusable.
    // THE guarantee that two members never hold the same number. Allocation
    // reads the highest and adds one; this is what decides the race when two
    // registrations compute the same answer at the same moment.
    [COLLECTIONS.members, 'member_no_unique'],
    [COLLECTIONS.constituencies, 'name_unique'],
    [COLLECTIONS.bacenta_categories, 'name_unique'],
    [COLLECTIONS.basonta_categories, 'name_unique'],
    // One device, one row. A phone that re-subscribes after a browser update
    // must not end up being notified twice.
    [COLLECTIONS.push_subscriptions, 'endpoint_unique'],
    // THE guarantee that a retried or overlapping cron cannot notify the
    // birthday team twice in a day. The check in the route is only the fast
    // path; this is what makes it true.
    [COLLECTIONS.notification_runs, 'day_kind_unique'],
    // THE guarantee that a retried birthday-SMS run cannot text a member twice
    // on their birthday. Every send is CLAIMED by inserting a row keyed
    // `birthday:<member>:<date>`; a second attempt collides here and writes
    // nothing. Without this index the run is not idempotent at all, and the
    // failure is invisible until somebody's phone buzzes twice.
    [COLLECTIONS.sms_messages, 'dedupe_unique'],
  ] as const) {
    const c = await databases.getCollection(DATABASE_ID, coll)
    const idx = c.indexes.find((i: { key: string }) => i.key === name)
    if (!idx) bad(`${coll}.${name} missing`)
    else if ((idx as { type: string }).type !== 'unique') bad(`${coll}.${name} is not unique`)
    else ok(`${coll}.${name}`)
  }

  // --- SMS -----------------------------------------------------------------
  console.log('\nsms')
  {
    const key = process.env.MNOTIFY_API_KEY?.trim()
    const sender = process.env.MNOTIFY_SENDER_ID?.trim()
    if (!key || !sender) {
      // Not a failure. SMS is optional in the same way push is: without it the
      // screens say so rather than offering a button that silently does
      // nothing.
      warn('mNotify not configured — SMS is off and the app says so')
    } else if (sender.length > 11) {
      bad(`MNOTIFY_SENDER_ID "${sender}" is ${sender.length} characters; the limit is 11`)
    } else {
      ok(`mNotify configured, sender "${sender}"`)
    }

    // Exactly one default per category. Two defaults is not untidiness — it is
    // a coin toss over which message the congregation receives, decided by
    // whichever row Appwrite happens to return first.
    const templates = await databases.listDocuments(DATABASE_ID, COLLECTIONS.sms_templates, [
      Query.limit(100),
    ])
    const byCategory = new Map<string, number>()
    for (const t of templates.documents as (typeof templates.documents[number] & {
      category?: string
      is_default?: boolean
    })[]) {
      if (t.is_default) {
        byCategory.set(String(t.category), (byCategory.get(String(t.category)) ?? 0) + 1)
      }
    }
    let clash = false
    for (const [category, count] of byCategory) {
      if (count > 1) {
        bad(`${category} has ${count} default templates; exactly one is allowed`)
        clash = true
      }
    }
    if (!clash) {
      ok(`${templates.total} template(s), at most one default per category`)
    }

    // A birthday default is what the automatic run reaches for. Without one it
    // returns `no_template` every morning — correct, reported, and completely
    // silent unless somebody goes looking.
    const birthdayDefault = (templates.documents as { category?: string; is_default?: boolean }[])
      .some((t) => t.category === 'birthday' && t.is_default)
    if (birthdayDefault) ok('a standard birthday message is set')
    else warn('no standard birthday message — the automatic run has nothing to send')
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

  // --- groups ---------------------------------------------------------------
  // The things a passing "collection exists" check would not catch: a bacenta
  // pointing at a constituency that is gone, a basonta pointing at a missing
  // category, or a member filed into a bacenta that no longer exists. The tree
  // builders surface all of these rather than dropping them, but a project in
  // that state has real groups showing a warning banner, and the fix is a human
  // decision about where they belong.
  console.log('\ngroups')
  const [categories, bacentas, constituencies, basontaCategories, basontas] = await Promise.all([
    listCategories(databases),
    listBacentas(databases),
    listConstituencies(databases),
    listBasontaCategories(databases),
    listBasontas(databases),
  ])
  ok(`${constituencies.length} constituency/ies, ${categories.length} category/ies, ${bacentas.length} bacenta(s)`)
  ok(`${basontaCategories.length} basonta category/ies, ${basontas.length} basonta(s)`)

  const constituencyIds = new Set(constituencies.map((c) => c.$id))
  const misfiled = bacentas.filter(
    (b) => b.constituency_id && !constituencyIds.has(b.constituency_id),
  )
  if (misfiled.length > 0) {
    bad(
      `${misfiled.length} bacenta(s) point at a missing constituency: ` +
        misfiled.map((b) => b.name).join(', '),
    )
  } else {
    ok('every bacenta is in a constituency that exists, or in none')
  }

  const unfiled = bacentas.filter((b) => b.constituency_id === null)
  if (unfiled.length > 0) {
    // Not a failure: this is the state between the schema change and the
    // migration, and the page shows them under "Not filed yet".
    ok(
      `${unfiled.length} bacenta(s) not yet in a constituency: ` +
        unfiled.map((b) => b.name).join(', '),
    )
  } else {
    ok('every bacenta is filed into a constituency')
  }

  // The same orphan check for basontas. Written out rather than folded into a
  // loop with the bacenta one: the two collections are about to stop having
  // the same shape, and a shared loop would have to be unpicked exactly then.
  const basontaCategoryIds = new Set(basontaCategories.map((c) => c.$id))
  const basontaOrphans = basontas.filter(
    (b) => b.category_id && !basontaCategoryIds.has(b.category_id),
  )
  if (basontaOrphans.length > 0) {
    bad(
      `${basontaOrphans.length} basonta(s) point at a missing category: ` +
        basontaOrphans.map((b) => b.name).join(', '),
    )
  } else {
    ok('every basonta is standalone or in a category that exists')
  }

  // --- notifications --------------------------------------------------------
  console.log('\nnotifications')
  if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    ok('VAPID keys present — push can be sent')
  } else {
    // Not a failure. The app runs fine without push; the birthdays page says
    // so, and nobody gets a button that does nothing.
    console.log('  · VAPID keys not set — push notifications are off (see .env.local.example)')
  }
  if (!process.env.NOTIFICATIONS_CRON_SECRET) {
    console.log(
      '  · NOTIFICATIONS_CRON_SECRET not set — only a signed-in admin can trigger a run',
    )
  } else {
    ok('cron secret present — a scheduler can trigger the daily run')
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
