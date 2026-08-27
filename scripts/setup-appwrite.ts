/**
 * Idempotent schema setup. This file is the single source of truth for the
 * database — new attributes go here, never into the console by hand, or the
 * next person to provision an environment gets a subtly different one.
 *
 *   npm run setup:appwrite
 *
 * Safe to re-run: everything is create-if-absent, and re-running against a
 * provisioned project should report only "exists".
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import {
  AppwriteException,
  Compression,
  DatabasesIndexType,
  Permission,
  Role,
} from 'node-appwrite'
import { createAdminClient } from '../lib/appwrite/server'
import {
  BUCKETS,
  COLLECTIONS,
  DATABASE_ID,
  FINGER_LABELS,
  SERVICE_DEFINITIONS,
  SMS_CATEGORIES,
} from '../lib/appwrite/config'

const { databases, storage } = createAdminClient()

type Counter = { created: number; exists: number }
const stats = {
  databases: { created: 0, exists: 0 } as Counter,
  collections: { created: 0, exists: 0 } as Counter,
  attributes: { created: 0, exists: 0 } as Counter,
  indexes: { created: 0, exists: 0 } as Counter,
  buckets: { created: 0, exists: 0 } as Counter,
  documents: { created: 0, exists: 0 } as Counter,
}

const isAlreadyExists = (err: unknown) =>
  err instanceof AppwriteException && (err.code === 409 || /already exists/i.test(err.message))

// --- helpers ---------------------------------------------------------------

const DATABASE_NAME = 'The Mega Church'

async function ensureDatabase() {
  try {
    await databases.create(DATABASE_ID, DATABASE_NAME)
    stats.databases.created++
    console.log(`  ✓ database ${DATABASE_ID} created`)
  } catch (err) {
    if (!isAlreadyExists(err)) throw err
    stats.databases.exists++
    // The display name is the one thing `create` cannot fix on a re-run, and
    // the project was first set up under a different one. Idempotent means the
    // live project ends up matching this file, not merely surviving it.
    await databases.update(DATABASE_ID, DATABASE_NAME)
    console.log(`  · database ${DATABASE_ID} exists`)
  }
}

/**
 * Collection-level permissions are `Role.users()` because every write routes
 * through a Route Handler gated by `requireRole()` — the server is the
 * authorisation boundary, not the collection ACL. The one client-SDK reader is
 * the live monitor's Realtime subscription, which needs read on
 * `attendance_records`.
 */
const DEFAULT_PERMS = [
  Permission.read(Role.users()),
  Permission.create(Role.users()),
  Permission.update(Role.users()),
  Permission.delete(Role.users()),
]

async function ensureCollection(id: string, name: string) {
  try {
    await databases.createCollection(DATABASE_ID, id, name, DEFAULT_PERMS, false, true)
    stats.collections.created++
    console.log(`  ✓ collection ${id} created`)
  } catch (err) {
    if (!isAlreadyExists(err)) throw err
    stats.collections.exists++
    console.log(`  · collection ${id} exists`)
  }
}

async function ensureStringAttribute(
  collId: string,
  key: string,
  size: number,
  required: boolean,
  xdefault?: string,
) {
  rejectDefaultOnRequired(collId, key, required, xdefault)
  try {
    await databases.createStringAttribute(DATABASE_ID, collId, key, size, required, xdefault)
    stats.attributes.created++
    console.log(`    ✓ ${collId}.${key} (string ${size}) created`)
    return
  } catch (err) {
    if (!isAlreadyExists(err)) throw err
  }
  // Exists — grow it if the schema now wants more room.
  try {
    const existing = (await databases.getAttribute(DATABASE_ID, collId, key)) as { size?: number }
    if (typeof existing.size === 'number' && existing.size < size) {
      // SDK quirk: the positional update treats `undefined` for xdefault as a
      // missing parameter and rejects. Coerce to null.
      await databases.updateStringAttribute(
        DATABASE_ID,
        collId,
        key,
        required,
        (xdefault ?? null) as unknown as string,
        size,
      )
      stats.attributes.created++
      console.log(`    ↑ ${collId}.${key} resized ${existing.size} → ${size}`)
      return
    }
  } catch {
    // Older SDK/server — fall through.
  }
  stats.attributes.exists++
}

/**
 * Appwrite rejects a default value on a required attribute
 * (`attribute_default_unsupported`) — the two are contradictory: "you must
 * always supply this" and "here is what to use when you don't".
 *
 * Caught here rather than as a 400 halfway through a run, because a partially
 * applied schema is a confusing thing to debug. If you hit this, decide which
 * one you meant: drop the default and let the writers supply the value (that
 * is what every writer in this codebase already does), or make the attribute
 * optional.
 */
function rejectDefaultOnRequired(collId: string, key: string, required: boolean, xdefault: unknown) {
  if (required && xdefault !== undefined) {
    throw new Error(
      `${collId}.${key}: an attribute cannot be both required and have a default. ` +
        'Drop one.',
    )
  }
}

async function ensureIntegerAttribute(
  collId: string,
  key: string,
  required: boolean,
  opts: { min?: number; max?: number; xdefault?: number } = {},
) {
  rejectDefaultOnRequired(collId, key, required, opts.xdefault)
  try {
    await databases.createIntegerAttribute(
      DATABASE_ID,
      collId,
      key,
      required,
      opts.min,
      opts.max,
      opts.xdefault,
    )
    stats.attributes.created++
    console.log(`    ✓ ${collId}.${key} (int) created`)
  } catch (err) {
    if (!isAlreadyExists(err)) throw err
    stats.attributes.exists++
  }
}

async function ensureBooleanAttribute(
  collId: string,
  key: string,
  required: boolean,
  xdefault?: boolean,
) {
  rejectDefaultOnRequired(collId, key, required, xdefault)
  try {
    await databases.createBooleanAttribute(DATABASE_ID, collId, key, required, xdefault)
    stats.attributes.created++
    console.log(`    ✓ ${collId}.${key} (bool) created`)
  } catch (err) {
    if (!isAlreadyExists(err)) throw err
    stats.attributes.exists++
  }
}

async function ensureEnumAttribute(
  collId: string,
  key: string,
  elements: string[],
  required: boolean,
  xdefault?: string,
) {
  rejectDefaultOnRequired(collId, key, required, xdefault)
  try {
    await databases.createEnumAttribute(DATABASE_ID, collId, key, elements, required, xdefault)
    stats.attributes.created++
    console.log(`    ✓ ${collId}.${key} (enum ${elements.join('|')}) created`)
    return
  } catch (err) {
    if (!isAlreadyExists(err)) throw err
  }
  // Exists — widen the value set rather than failing, so adding an enum member
  // later does not require dropping the attribute (and its indexes).
  try {
    const existing = (await databases.getAttribute(DATABASE_ID, collId, key)) as {
      elements?: string[]
    }
    const current = new Set(existing.elements ?? [])
    const missing = elements.filter((v) => !current.has(v))
    if (missing.length > 0) {
      await databases.updateEnumAttribute(
        DATABASE_ID,
        collId,
        key,
        [...(existing.elements ?? []), ...missing],
        required,
        (xdefault ?? null) as unknown as string,
      )
      stats.attributes.created++
      console.log(`    ↑ ${collId}.${key} (enum) widened: +${missing.join(',')}`)
      return
    }
  } catch {
    // Older SDK/server — fall through.
  }
  stats.attributes.exists++
}

async function ensureIndex(
  collId: string,
  key: string,
  type: 'key' | 'unique' | 'fulltext',
  attributes: string[],
) {
  const indexType =
    type === 'unique'
      ? DatabasesIndexType.Unique
      : type === 'fulltext'
        ? DatabasesIndexType.Fulltext
        : DatabasesIndexType.Key
  try {
    await databases.createIndex(DATABASE_ID, collId, key, indexType, attributes)
    stats.indexes.created++
    console.log(`    ✓ index ${collId}.${key} (${type}) created`)
  } catch (err) {
    if (!isAlreadyExists(err)) throw err
    stats.indexes.exists++
  }
}

/**
 * Appwrite creates attributes asynchronously. Creating an index over an
 * attribute that is still `processing` fails, so wait between the two.
 */
async function waitForAttributes(collId: string, timeoutMs = 60_000) {
  const started = Date.now()
  for (;;) {
    const coll = await databases.getCollection(DATABASE_ID, collId)
    const pending = coll.attributes.filter(
      (a: { status?: string }) => a.status && a.status !== 'available',
    )
    if (pending.length === 0) return
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `Timed out waiting for attributes in ${collId}: ` +
          pending.map((a: { key?: string; status?: string }) => `${a.key}=${a.status}`).join(', '),
      )
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}

async function ensureBucket(
  id: string,
  name: string,
  opts: { maxSizeBytes?: number; extensions?: string[] } = {},
) {
  const permissions = [
    Permission.read(Role.users()),
    Permission.create(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users()),
  ]
  const maxSize = opts.maxSizeBytes ?? 5 * 1024 * 1024
  const extensions = opts.extensions ?? ['jpg', 'jpeg', 'png', 'webp']

  try {
    await storage.createBucket(
      id,
      name,
      permissions,
      true, // fileSecurity
      true, // enabled
      maxSize,
      extensions,
      Compression.None,
      false, // encryption
      true, // antivirus
    )
    stats.buckets.created++
    console.log(`  ✓ bucket ${id} created`)
    return
  } catch (err) {
    if (!isAlreadyExists(err)) {
      if (err instanceof AppwriteException && /maximum file size/i.test(err.message)) {
        console.error(
          `  ✗ bucket ${id}: the server rejected a ${maxSize}-byte limit. Raise ` +
            `_APP_STORAGE_LIMIT on the Appwrite container and re-run.`,
        )
        return
      }
      throw err
    }
    stats.buckets.exists++
    console.log(`  · bucket ${id} exists`)
  }
}

async function ensureDocument(collId: string, docId: string, data: Record<string, unknown>) {
  try {
    await databases.createDocument(DATABASE_ID, collId, docId, data)
    stats.documents.created++
    console.log(`    ✓ ${collId}/${docId} seeded`)
  } catch (err) {
    if (!isAlreadyExists(err)) throw err
    stats.documents.exists++
  }
}

// --- schema ----------------------------------------------------------------

async function setupMembers() {
  console.log('\nmembers')
  await ensureCollection(COLLECTIONS.members, 'Members')
  await ensureStringAttribute(COLLECTIONS.members, 'first_name', 64, true)
  await ensureStringAttribute(COLLECTIONS.members, 'last_name', 64, true)
  await ensureStringAttribute(COLLECTIONS.members, 'other_names', 96, false)
  // Denormalised so search can hit ONE fulltext index instead of three, and so
  // list responses do not have to recompute it per row.
  await ensureStringAttribute(COLLECTIONS.members, 'full_name', 224, true)
  await ensureStringAttribute(COLLECTIONS.members, 'photo_file_id', 64, false)
  // Month and day only. There is deliberately no birth_year attribute — PRD
  // §1.1. Adding one later is a decision, not an oversight to be corrected.
  await ensureIntegerAttribute(COLLECTIONS.members, 'birth_month', false, { min: 1, max: 12 })
  await ensureIntegerAttribute(COLLECTIONS.members, 'birth_day', false, { min: 1, max: 31 })
  await ensureStringAttribute(COLLECTIONS.members, 'address', 256, false)
  await ensureStringAttribute(COLLECTIONS.members, 'call_number', 32, true)
  await ensureStringAttribute(COLLECTIONS.members, 'whatsapp_number', 32, false)
  // No defaults on these: `validateMemberInput` fills both in on create, so a
  // schema default would only ever mask a writer that forgot to.
  await ensureEnumAttribute(COLLECTIONS.members, 'home_service', ['first', 'second'], true)
  await ensureEnumAttribute(COLLECTIONS.members, 'status', ['active', 'inactive'], true)
  await ensureStringAttribute(COLLECTIONS.members, 'created_by', 128, false)
  // Where the member LIVES. Optional at the schema level because the four
  // constituencies did not exist when the congregation was first registered,
  // and a required attribute would have made every existing row unwritable.
  // The registration form asks for it; the bulk assigner is how the backlog
  // gets cleared. PRD §1.7.
  await ensureStringAttribute(COLLECTIONS.members, 'constituency_id', 64, false)
  // Which birthday message THIS member gets. Null is the ordinary case and
  // means "use the birthday default" — not "send nothing". Optional because
  // the overwhelming majority of members never need a different wording, and
  // a required attribute would force a choice at every registration. PRD §1.12.
  await ensureStringAttribute(COLLECTIONS.members, 'sms_template_id', 64, false)

  await waitForAttributes(COLLECTIONS.members)
  await ensureIndex(COLLECTIONS.members, 'by_status', 'key', ['status'])
  await ensureIndex(COLLECTIONS.members, 'by_last_name', 'key', ['last_name'])
  await ensureIndex(COLLECTIONS.members, 'search_name', 'fulltext', ['full_name'])
  // Ushers look people up by the number they were called on.
  await ensureIndex(COLLECTIONS.members, 'by_call_number', 'key', ['call_number'])
  // Birthday lists for a given month.
  await ensureIndex(COLLECTIONS.members, 'by_birthday', 'key', ['birth_month', 'birth_day'])
  // "Everyone in Ahodwo" — the constituency head's entire view.
  await ensureIndex(COLLECTIONS.members, 'by_constituency', 'key', ['constituency_id'])
  // "Everyone who comes to First Service" — the registry filter.
  // `home_service` never gates ATTENDANCE (PRD §2.1); it is only where a
  // member usually sits, and whoever is compiling a list to call wants one
  // service at a time.
  await ensureIndex(COLLECTIONS.members, 'by_home_service', 'key', ['home_service'])
}

async function setupConstituencies() {
  console.log('\nconstituencies')
  await ensureCollection(COLLECTIONS.constituencies, 'Constituencies')
  await ensureStringAttribute(COLLECTIONS.constituencies, 'name', 96, true)
  await ensureStringAttribute(COLLECTIONS.constituencies, 'description', 512, false)
  // The Appwrite user $id of the head. Null until someone is appointed — a
  // constituency with no head is a normal, temporary state, not an error.
  await ensureStringAttribute(COLLECTIONS.constituencies, 'head_user_id', 64, false)
  // Denormalised so the list can name the head without an account lookup per
  // row. Refreshed whenever the head is reassigned.
  await ensureStringAttribute(COLLECTIONS.constituencies, 'head_name', 128, false)
  await ensureIntegerAttribute(COLLECTIONS.constituencies, 'sort_order', true)
  await ensureStringAttribute(COLLECTIONS.constituencies, 'created_by', 128, false)

  await waitForAttributes(COLLECTIONS.constituencies)
  // Two constituencies with the same name are indistinguishable in every
  // dropdown in the app, so the database refuses rather than the form.
  await ensureIndex(COLLECTIONS.constituencies, 'name_unique', 'unique', ['name'])
  await ensureIndex(COLLECTIONS.constituencies, 'by_head', 'key', ['head_user_id'])
  await ensureIndex(COLLECTIONS.constituencies, 'by_sort', 'key', ['sort_order'])
}

async function setupBacentaCategories() {
  console.log('\nbacenta_categories')
  await ensureCollection(COLLECTIONS.bacenta_categories, 'Bacenta Categories')
  await ensureStringAttribute(COLLECTIONS.bacenta_categories, 'name', 96, true)
  await ensureStringAttribute(COLLECTIONS.bacenta_categories, 'description', 512, false)
  await ensureIntegerAttribute(COLLECTIONS.bacenta_categories, 'sort_order', true)
  await ensureStringAttribute(COLLECTIONS.bacenta_categories, 'created_by', 128, false)

  await waitForAttributes(COLLECTIONS.bacenta_categories)
  await ensureIndex(COLLECTIONS.bacenta_categories, 'name_unique', 'unique', ['name'])
  await ensureIndex(COLLECTIONS.bacenta_categories, 'by_sort', 'key', ['sort_order'])
}

async function setupBacentas() {
  console.log('\nbacentas')
  await ensureCollection(COLLECTIONS.bacentas, 'Bacentas')
  await ensureStringAttribute(COLLECTIONS.bacentas, 'name', 96, true)
  // NULL is meaningful: it is the standalone bacenta ("Technical Team"), the
  // one that has members directly under it rather than sibling groups. Do not
  // add an `is_standalone` boolean beside this — two fields encoding one fact
  // is two fields that can disagree.
  await ensureStringAttribute(COLLECTIONS.bacentas, 'category_id', 64, false)
  await ensureStringAttribute(COLLECTIONS.bacentas, 'description', 512, false)
  await ensureStringAttribute(COLLECTIONS.bacentas, 'head_user_id', 64, false)
  await ensureStringAttribute(COLLECTIONS.bacentas, 'head_name', 128, false)
  await ensureIntegerAttribute(COLLECTIONS.bacentas, 'sort_order', true)
  await ensureStringAttribute(COLLECTIONS.bacentas, 'created_by', 128, false)

  await waitForAttributes(COLLECTIONS.bacentas)
  // NOT unique: "Youth" under Choir and "Youth" under Ushers are two different
  // groups and both are legitimate. Uniqueness is enforced per category in
  // `lib/groups/server.ts`, where the category is known.
  await ensureIndex(COLLECTIONS.bacentas, 'by_category', 'key', ['category_id'])
  await ensureIndex(COLLECTIONS.bacentas, 'by_head', 'key', ['head_user_id'])
  await ensureIndex(COLLECTIONS.bacentas, 'by_name', 'key', ['name'])
  await ensureIndex(COLLECTIONS.bacentas, 'by_sort', 'key', ['sort_order'])
}

async function setupBacentaMembers() {
  console.log('\nbacenta_members')
  await ensureCollection(COLLECTIONS.bacenta_members, 'Bacenta Members')
  await ensureStringAttribute(COLLECTIONS.bacenta_members, 'bacenta_id', 64, true)
  await ensureStringAttribute(COLLECTIONS.bacenta_members, 'member_id', 64, true)
  await ensureStringAttribute(COLLECTIONS.bacenta_members, 'added_by', 128, false)

  await waitForAttributes(COLLECTIONS.bacenta_members)
  await ensureIndex(COLLECTIONS.bacenta_members, 'by_bacenta', 'key', ['bacenta_id'])
  // The hot query for the member detail page and the registration form:
  // "which bacentas is this person in?"
  await ensureIndex(COLLECTIONS.bacenta_members, 'by_member', 'key', ['member_id'])
  // One row per pair. The assigner writes a diff, but two admins ticking the
  // same person at the same moment is what this index is actually for.
  await ensureIndex(COLLECTIONS.bacenta_members, 'pair_unique', 'unique', [
    'bacenta_id',
    'member_id',
  ])
}

async function setupPushSubscriptions() {
  console.log('\npush_subscriptions')
  await ensureCollection(COLLECTIONS.push_subscriptions, 'Push Subscriptions')
  await ensureStringAttribute(COLLECTIONS.push_subscriptions, 'user_id', 64, true)
  // The role at subscribe time, so a birthday run can target the celebrations
  // team without re-reading every account from the Users API.
  await ensureStringAttribute(COLLECTIONS.push_subscriptions, 'user_label', 32, true)
  // Push endpoints are URLs and routinely run past 300 characters.
  await ensureStringAttribute(COLLECTIONS.push_subscriptions, 'endpoint', 1024, true)
  // MariaDB cannot index 1024 utf8mb4 characters (the 3072-byte key limit),
  // so uniqueness rides on the SHA-256 of the endpoint instead. Same identity,
  // 64 characters. Without this, one phone re-subscribing after a browser
  // update accumulates a duplicate row and gets every notification twice.
  await ensureStringAttribute(COLLECTIONS.push_subscriptions, 'endpoint_hash', 64, true)
  await ensureStringAttribute(COLLECTIONS.push_subscriptions, 'p256dh', 256, true)
  await ensureStringAttribute(COLLECTIONS.push_subscriptions, 'auth_key', 128, true)
  await ensureStringAttribute(COLLECTIONS.push_subscriptions, 'device_label', 128, false)
  await ensureStringAttribute(COLLECTIONS.push_subscriptions, 'last_success_at', 32, false)

  await waitForAttributes(COLLECTIONS.push_subscriptions)
  await ensureIndex(COLLECTIONS.push_subscriptions, 'by_user', 'key', ['user_id'])
  await ensureIndex(COLLECTIONS.push_subscriptions, 'by_label', 'key', ['user_label'])
  await ensureIndex(COLLECTIONS.push_subscriptions, 'endpoint_unique', 'unique', [
    'endpoint_hash',
  ])
}

async function setupNotificationRuns() {
  console.log('\nnotification_runs')
  await ensureCollection(COLLECTIONS.notification_runs, 'Notification Runs')
  /** YYYY-MM-DD in Accra — the day the notification was SENT, not the birthday. */
  await ensureStringAttribute(COLLECTIONS.notification_runs, 'run_date', 10, true)
  await ensureStringAttribute(COLLECTIONS.notification_runs, 'kind', 32, true)
  await ensureIntegerAttribute(COLLECTIONS.notification_runs, 'celebrant_count', true)
  await ensureIntegerAttribute(COLLECTIONS.notification_runs, 'sent', true)
  await ensureIntegerAttribute(COLLECTIONS.notification_runs, 'failed', true)
  await ensureStringAttribute(COLLECTIONS.notification_runs, 'ran_at', 32, true)
  await ensureStringAttribute(COLLECTIONS.notification_runs, 'triggered_by', 128, false)
  /**
   * What the run concluded, in its own words.
   *
   * Without this, two very different mornings are the same row. "Nobody has a
   * birthday tomorrow" and "SMS is not configured, so nothing was even
   * attempted" both land as celebrant_count 0, sent 0 — and the second is a
   * fault somebody must fix, silently wearing the costume of a quiet Tuesday.
   *
   * Optional, because rows written before this attribute existed do not have
   * it and a required attribute would strand them. Never defaulted: a default
   * would put a confident word in the mouth of a run that never reported one.
   */
  await ensureStringAttribute(COLLECTIONS.notification_runs, 'status', 32, false)
  /** Members the per-member dedupe suppressed. Only the SMS job sets it; the
   *  push job has no per-member idempotency to skip anybody with. */
  await ensureIntegerAttribute(COLLECTIONS.notification_runs, 'skipped', false, { xdefault: 0 })

  await waitForAttributes(COLLECTIONS.notification_runs)
  // The whole point of this collection. A cron that fires twice — a retry, an
  // overlapping schedule, someone pressing the manual button after the
  // scheduler already ran — must not notify the team twice. The route checks
  // first for a friendly answer; THIS is what makes it true.
  await ensureIndex(COLLECTIONS.notification_runs, 'day_kind_unique', 'unique', [
    'run_date',
    'kind',
  ])
}

async function setupBiometricTemplates() {
  console.log('\nbiometric_templates')
  await ensureCollection(COLLECTIONS.biometric_templates, 'Biometric Templates')
  await ensureStringAttribute(COLLECTIONS.biometric_templates, 'member_id', 64, true)
  await ensureEnumAttribute(
    COLLECTIONS.biometric_templates,
    'finger_label',
    [...FINGER_LABELS],
    true,
  )
  await ensureIntegerAttribute(COLLECTIONS.biometric_templates, 'variation', true, {
    min: 1,
    max: 3,
  })
  // 16384 is over Appwrite's 16383 VARCHAR ceiling, so this is stored as TEXT
  // (off-row) and cannot hit MariaDB's 64KB row limit the way a large VARCHAR
  // would. A real .xyt is 1-4 KB; the headroom is for a dense capture.
  await ensureStringAttribute(COLLECTIONS.biometric_templates, 'template', 16384, true)
  await ensureIntegerAttribute(COLLECTIONS.biometric_templates, 'minutiae', false, { xdefault: 0 })
  await ensureStringAttribute(COLLECTIONS.biometric_templates, 'created_by', 128, false)

  await waitForAttributes(COLLECTIONS.biometric_templates)
  await ensureIndex(COLLECTIONS.biometric_templates, 'by_member', 'key', ['member_id'])
  await ensureIndex(COLLECTIONS.biometric_templates, 'by_member_finger', 'key', [
    'member_id',
    'finger_label',
  ])
}

async function setupMeetings() {
  console.log('\nmeetings')
  await ensureCollection(COLLECTIONS.meetings, 'Meetings')
  await ensureStringAttribute(COLLECTIONS.meetings, 'name', 96, true)
  await ensureStringAttribute(COLLECTIONS.meetings, 'description', 512, false)
  await ensureEnumAttribute(COLLECTIONS.meetings, 'kind', ['service', 'meeting'], true)
  await ensureEnumAttribute(COLLECTIONS.meetings, 'service_slot', ['first', 'second'], false)
  // `restricted` especially must not have a default. Getting it wrong in
  // either direction is bad — a defaulted `false` silently opens a committee
  // meeting to the whole congregation — so every writer states it outright.
  await ensureBooleanAttribute(COLLECTIONS.meetings, 'restricted', true)
  await ensureBooleanAttribute(COLLECTIONS.meetings, 'archived', true)
  await ensureIntegerAttribute(COLLECTIONS.meetings, 'sort_order', true)
  await ensureStringAttribute(COLLECTIONS.meetings, 'created_by', 128, false)

  await waitForAttributes(COLLECTIONS.meetings)
  await ensureIndex(COLLECTIONS.meetings, 'by_kind', 'key', ['kind'])
  await ensureIndex(COLLECTIONS.meetings, 'by_archived', 'key', ['archived'])

  console.log('  seeding the two services…')
  for (const s of SERVICE_DEFINITIONS) {
    await ensureDocument(COLLECTIONS.meetings, s.id, {
      name: s.name,
      description: s.description,
      kind: 'service',
      service_slot: s.service_slot,
      // A service is open to every active member. This must stay false — see
      // PRD §2.1. Setting it true would gate the services behind a roster and
      // silently lock out anyone who attends the other one.
      restricted: false,
      archived: false,
      sort_order: s.sort_order,
      created_by: null,
    })
  }
}

async function setupMeetingMembers() {
  console.log('\nmeeting_members')
  await ensureCollection(COLLECTIONS.meeting_members, 'Meeting Members (roster)')
  await ensureStringAttribute(COLLECTIONS.meeting_members, 'meeting_id', 64, true)
  await ensureStringAttribute(COLLECTIONS.meeting_members, 'member_id', 64, true)
  await ensureStringAttribute(COLLECTIONS.meeting_members, 'added_by', 128, false)

  await waitForAttributes(COLLECTIONS.meeting_members)
  await ensureIndex(COLLECTIONS.meeting_members, 'by_meeting', 'key', ['meeting_id'])
  await ensureIndex(COLLECTIONS.meeting_members, 'by_member', 'key', ['member_id'])
  // One row per pair. The roster editor diffs and writes only the delta, but a
  // unique index is what actually guarantees it.
  await ensureIndex(COLLECTIONS.meeting_members, 'pair_unique', 'unique', [
    'meeting_id',
    'member_id',
  ])
}

async function setupOccurrences() {
  console.log('\nmeeting_occurrences')
  await ensureCollection(COLLECTIONS.meeting_occurrences, 'Meeting Occurrences')
  await ensureStringAttribute(COLLECTIONS.meeting_occurrences, 'meeting_id', 64, true)
  await ensureStringAttribute(COLLECTIONS.meeting_occurrences, 'occurrence_date', 10, true)
  // `paused` was added after the first deployment. `ensureEnumAttribute`
  // WIDENS an existing enum in place rather than dropping and recreating it,
  // so re-running this against a live project keeps every occurrence row and
  // the `by_status` index over them.
  await ensureEnumAttribute(
    COLLECTIONS.meeting_occurrences,
    'status',
    ['open', 'paused', 'closed'],
    true,
  )
  await ensureStringAttribute(COLLECTIONS.meeting_occurrences, 'opened_at', 32, true)
  await ensureStringAttribute(COLLECTIONS.meeting_occurrences, 'paused_at', 32, false)
  await ensureStringAttribute(COLLECTIONS.meeting_occurrences, 'closed_at', 32, false)
  await ensureStringAttribute(COLLECTIONS.meeting_occurrences, 'opened_by', 128, false)
  await ensureStringAttribute(COLLECTIONS.meeting_occurrences, 'closed_by', 128, false)
  // Written as 0 by activateOccurrence and frozen to the real tally on close.
  await ensureIntegerAttribute(COLLECTIONS.meeting_occurrences, 'present_count', true)

  await waitForAttributes(COLLECTIONS.meeting_occurrences)
  // The hot query: "is anything open?" — asked on every page load and every
  // scan. PRD §2.2 makes the answer at most one row.
  await ensureIndex(COLLECTIONS.meeting_occurrences, 'by_status', 'key', ['status'])
  await ensureIndex(COLLECTIONS.meeting_occurrences, 'by_meeting', 'key', ['meeting_id'])
  await ensureIndex(COLLECTIONS.meeting_occurrences, 'by_date', 'key', ['occurrence_date'])
}

async function setupAttendanceRecords() {
  console.log('\nattendance_records')
  await ensureCollection(COLLECTIONS.attendance_records, 'Attendance Records')
  await ensureStringAttribute(COLLECTIONS.attendance_records, 'occurrence_id', 64, true)
  await ensureStringAttribute(COLLECTIONS.attendance_records, 'meeting_id', 64, true)
  await ensureStringAttribute(COLLECTIONS.attendance_records, 'member_id', 64, true)
  await ensureStringAttribute(COLLECTIONS.attendance_records, 'marked_at', 32, true)
  await ensureEnumAttribute(
    COLLECTIONS.attendance_records,
    'method',
    ['biometric', 'manual'],
    true,
  )
  await ensureStringAttribute(COLLECTIONS.attendance_records, 'marked_by', 128, false)
  await ensureStringAttribute(COLLECTIONS.attendance_records, 'station', 64, false)
  await ensureStringAttribute(COLLECTIONS.attendance_records, 'note', 512, false)

  await waitForAttributes(COLLECTIONS.attendance_records)
  await ensureIndex(COLLECTIONS.attendance_records, 'by_occurrence', 'key', ['occurrence_id'])
  await ensureIndex(COLLECTIONS.attendance_records, 'by_member', 'key', ['member_id'])
  await ensureIndex(COLLECTIONS.attendance_records, 'by_meeting', 'key', ['meeting_id'])
  // One mark per member per occurrence. The scan path checks first and returns
  // `already_marked`, but two kiosks can race — this index is what makes the
  // guarantee real rather than merely likely.
  await ensureIndex(COLLECTIONS.attendance_records, 'occurrence_member_unique', 'unique', [
    'occurrence_id',
    'member_id',
  ])
}

async function setupSmsTemplates() {
  console.log('\nsms_templates')
  await ensureCollection(COLLECTIONS.sms_templates, 'SMS Templates')
  await ensureStringAttribute(COLLECTIONS.sms_templates, 'name', 96, true)
  await ensureEnumAttribute(
    COLLECTIONS.sms_templates,
    'category',
    [...SMS_CATEGORIES],
    true,
  )
  // 1024 rather than 160: a template is written in placeholders, and
  // `{{first_name}}` is 15 characters that render down to about 5. Refusing a
  // long TEMPLATE because a short MESSAGE is cheaper would be measuring the
  // wrong string. The editor shows the rendered part count instead.
  await ensureStringAttribute(COLLECTIONS.sms_templates, 'body', 1024, true)
  // Required and undefaulted, like every other boolean here: `false` arriving
  // by default is how a category quietly ends up with no default at all.
  await ensureBooleanAttribute(COLLECTIONS.sms_templates, 'is_default', true)
  await ensureIntegerAttribute(COLLECTIONS.sms_templates, 'sort_order', true)
  await ensureStringAttribute(COLLECTIONS.sms_templates, 'created_by', 128, false)

  await waitForAttributes(COLLECTIONS.sms_templates)
  await ensureIndex(COLLECTIONS.sms_templates, 'by_category', 'key', ['category'])
  // Finding "the birthday default" is the hottest read in the whole feature —
  // the automatic run does it once per celebrant.
  await ensureIndex(COLLECTIONS.sms_templates, 'by_category_default', 'key', [
    'category',
    'is_default',
  ])
  // Deliberately NOT a unique index on (category, name). Uniqueness here is
  // case- and whitespace-insensitive — "Warm birthday" and "warm  birthday"
  // are the same template to a human — and an index compares bytes. The check
  // lives in `lib/sms/server.ts::templateNameTaken`, same reasoning as
  // `bacentaNameTaken` (CLAUDE.md).
}

async function setupSmsMessages() {
  console.log('\nsms_messages')
  await ensureCollection(COLLECTIONS.sms_messages, 'SMS Messages')
  await ensureStringAttribute(COLLECTIONS.sms_messages, 'member_id', 64, true)
  await ensureStringAttribute(COLLECTIONS.sms_messages, 'phone', 32, true)
  // What was ACTUALLY sent, already rendered. Storing the template id alone
  // would mean an edited template silently rewrites history, and the one
  // question this log exists to answer is "what did we say to them?".
  await ensureStringAttribute(COLLECTIONS.sms_messages, 'body', 1024, true)
  await ensureEnumAttribute(COLLECTIONS.sms_messages, 'category', [...SMS_CATEGORIES], true)
  // Nullable: a template may be deleted long after a message was sent, and
  // that must not take the record of the send with it.
  await ensureStringAttribute(COLLECTIONS.sms_messages, 'template_id', 64, false)
  await ensureEnumAttribute(COLLECTIONS.sms_messages, 'status', ['sent', 'failed'], true)
  // mNotify's own words, kept verbatim. A paraphrase is the thing that makes a
  // support conversation with the provider impossible.
  await ensureStringAttribute(COLLECTIONS.sms_messages, 'provider_message', 512, false)
  await ensureStringAttribute(COLLECTIONS.sms_messages, 'sent_at', 32, true)
  await ensureStringAttribute(COLLECTIONS.sms_messages, 'run_date', 10, true)
  await ensureStringAttribute(COLLECTIONS.sms_messages, 'sent_by', 128, false)
  await ensureStringAttribute(COLLECTIONS.sms_messages, 'dedupe_key', 128, true)

  await waitForAttributes(COLLECTIONS.sms_messages)
  await ensureIndex(COLLECTIONS.sms_messages, 'by_member', 'key', ['member_id'])
  await ensureIndex(COLLECTIONS.sms_messages, 'by_run_date', 'key', ['run_date'])
  await ensureIndex(COLLECTIONS.sms_messages, 'by_category', 'key', ['category'])
  /**
   * The whole reason this collection is not just an audit trail.
   *
   * A birthday send inserts `birthday:<member_id>:<run_date>`, so a scheduler
   * that fires twice — a retry, an overlapping cron, an admin pressing "send
   * now" after it already ran — collides here and writes nothing. The member
   * is texted once on their birthday, and the guarantee is the INDEX, not the
   * check in front of it (CLAUDE.md).
   *
   * A manual send inserts `manual:<random>`, unique by construction, because
   * thanking the same member for tithe twice in one day is legitimate and a
   * guard that refuses it would be a bug wearing a safeguard's clothes.
   *
   * `required: true` and never nullable: MariaDB permits many NULLs in a
   * unique index, so a null key would guard precisely nothing.
   */
  await ensureIndex(COLLECTIONS.sms_messages, 'dedupe_unique', 'unique', ['dedupe_key'])
}

async function setupBuckets() {
  console.log('\nbuckets')
  await ensureBucket(BUCKETS.member_photos, 'Member Photos')
  // The kiosk provisioning pack: bridge bundle, native binaries, WHQL driver,
  // installer. A few MB today. 256 MB leaves room for a pack that bundles its
  // own Node runtime rather than assuming one (node.exe is ~80 MB).
  await ensureBucket(BUCKETS.kiosk_downloads, 'Kiosk Downloads', {
    maxSizeBytes: 268_435_456,
    extensions: ['zip'],
  })
}

// --- main ------------------------------------------------------------------

async function main() {
  const required = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY']
  const missing = required.filter((k) => !process.env[k])
  if (missing.length > 0) {
    console.error(`Missing env: ${missing.join(', ')}. Put them in .env.local.`)
    process.exit(1)
  }
  // This project runs on Appwrite Cloud. (An earlier draft refused to run
  // against Cloud — that rule belongs to the sibling SEMP project, which is
  // self-hosted for institutional reasons, and was carried over here by
  // mistake.) Both work; the endpoint is simply whatever .env.local says.
  console.log(`Setting up ${DATABASE_ID} at ${process.env.APPWRITE_ENDPOINT}`)
  await ensureDatabase()
  await setupMembers()
  await setupBiometricTemplates()
  await setupMeetings()
  await setupMeetingMembers()
  await setupOccurrences()
  await setupAttendanceRecords()
  // Categories before bacentas: a bacenta's category_id points at one.
  await setupConstituencies()
  await setupBacentaCategories()
  await setupBacentas()
  await setupBacentaMembers()
  await setupPushSubscriptions()
  await setupNotificationRuns()
  await setupSmsTemplates()
  await setupSmsMessages()
  await setupBuckets()

  console.log('\n─── summary ───')
  for (const [k, v] of Object.entries(stats)) {
    console.log(`  ${k.padEnd(12)} created ${v.created}   existing ${v.exists}`)
  }
  console.log('\nDone. Re-running this script should report only "existing".')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
