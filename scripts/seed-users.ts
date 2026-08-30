/**
 * Create the starter accounts, one per role.
 *
 *   npm run seed:users
 *
 * Idempotent: an account that already exists gets its label re-applied but its
 * password left alone, so re-running this after someone has changed a password
 * does not silently reset it.
 *
 * Passwords come from env so this file never contains a credential:
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 *   SEED_USHER_EMAIL / SEED_USHER_PASSWORD
 *   SEED_KIOSK_EMAIL / SEED_KIOSK_PASSWORD
 *   SEED_LEADER_EMAIL / SEED_LEADER_PASSWORD
 *   SEED_CELEBRATIONS_EMAIL / SEED_CELEBRATIONS_PASSWORD
 *   SEED_TREASURER_EMAIL / SEED_TREASURER_PASSWORD
 *
 * A role whose env vars are absent is skipped, so this stays safe to re-run on
 * a project that only wants some of them.
 *
 * The `leader` seed is a TEMPLATE, not the whole story: the church will have
 * one leader account per head. Create the rest in the Appwrite console with
 * the same `leader` label, then appoint each one from the constituency or
 * bacenta page — what a leader can see comes from being named as head, never
 * from the label.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { AppwriteException, ID, Query } from 'node-appwrite'
import { createAdminClient } from '../lib/appwrite/server'
import { USER_LABELS, type UserLabel } from '../lib/appwrite/config'

const { users } = createAdminClient()

type Seed = {
  label: UserLabel
  email: string | undefined
  password: string | undefined
  name: string
  /** Written to prefs.station for a kiosk — provenance on its scans. */
  station?: string
}

const SEEDS: Seed[] = [
  {
    label: USER_LABELS.admin,
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
    name: 'Church Administrator',
  },
  {
    label: USER_LABELS.usher,
    email: process.env.SEED_USHER_EMAIL,
    password: process.env.SEED_USHER_PASSWORD,
    name: 'Usher',
  },
  {
    label: USER_LABELS.kiosk,
    email: process.env.SEED_KIOSK_EMAIL,
    password: process.env.SEED_KIOSK_PASSWORD,
    name: 'Entrance Kiosk',
    station: 'Main entrance',
  },
  {
    label: USER_LABELS.leader,
    email: process.env.SEED_LEADER_EMAIL,
    password: process.env.SEED_LEADER_PASSWORD,
    name: 'Group Head',
  },
  {
    label: USER_LABELS.celebrations,
    email: process.env.SEED_CELEBRATIONS_EMAIL,
    password: process.env.SEED_CELEBRATIONS_PASSWORD,
    name: 'Birthday Team',
  },
  {
    label: USER_LABELS.shepherd,
    email: process.env.SEED_SHEPHERD_EMAIL,
    password: process.env.SEED_SHEPHERD_PASSWORD,
    name: 'Shepherd',
  },
  {
    label: USER_LABELS.treasurer,
    email: process.env.SEED_TREASURER_EMAIL,
    password: process.env.SEED_TREASURER_PASSWORD,
    name: 'Church Treasurer',
  },
]

async function findByEmail(email: string) {
  const res = await users.list([Query.equal('email', email), Query.limit(1)])
  return res.users[0] ?? null
}

async function seed(s: Seed) {
  if (!s.email || !s.password) {
    console.log(`  · ${s.label}: skipped (SEED_${s.label.toUpperCase()}_EMAIL/PASSWORD not set)`)
    return
  }

  let user = await findByEmail(s.email)
  if (!user) {
    try {
      user = await users.create(ID.unique(), s.email, undefined, s.password, s.name)
      console.log(`  ✓ ${s.label}: created ${s.email}`)
    } catch (err) {
      if (!(err instanceof AppwriteException) || err.code !== 409) throw err
      user = await findByEmail(s.email)
      if (!user) throw err
    }
  } else {
    console.log(`  · ${s.label}: ${s.email} exists — password left unchanged`)
  }

  // Exactly one label per user (CLAUDE.md). Replace rather than append, so a
  // re-run after a role change corrects it instead of granting both.
  await users.updateLabels(user.$id, [s.label])
  if (s.station) {
    await users.updatePrefs(user.$id, { ...(user.prefs ?? {}), station: s.station })
  }
  console.log(`    label=${s.label}${s.station ? ` station="${s.station}"` : ''}`)
}

async function main() {
  const required = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY']
  const missing = required.filter((k) => !process.env[k])
  if (missing.length > 0) {
    console.error(`Missing env: ${missing.join(', ')}`)
    process.exit(1)
  }
  /**
   * `--only=treasurer,usher` seeds just those roles.
   *
   * Not a convenience. This script CREATES an account for every SEED_*_EMAIL it
   * finds, so a stale variable quietly provisions a login nobody asked for. The
   * live example is `SEED_LEADER_EMAIL`, which names the TEMPLATE head account
   * (`leader@megachurch.local`) from before the four real heads existed: it is
   * still there, and a bare run keeps re-labelling it rather than letting it be
   * retired.
   *
   * Seeding one role is the common case after the first setup, and it should
   * not require emptying and restoring half of `.env.local` to be safe.
   */
  const onlyArg = process.argv.find((a) => a.startsWith('--only='))
  const only = onlyArg
    ? new Set(
        onlyArg
          .slice('--only='.length)
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      )
    : null

  if (only) {
    const unknown = [...only].filter((v) => !SEEDS.some((s) => s.label === v))
    if (unknown.length > 0) {
      console.error(
        `Unknown role(s): ${unknown.join(', ')}. ` +
          `Known: ${SEEDS.map((s) => s.label).join(', ')}.`,
      )
      process.exit(1)
    }
  }

  const todo = only ? SEEDS.filter((s) => only.has(s.label)) : SEEDS
  console.log(
    only
      ? `Seeding accounts: ${[...only].join(', ')} (--only)`
      : 'Seeding accounts… (all roles with SEED_*_EMAIL set)',
  )
  for (const s of todo) await seed(s)
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
