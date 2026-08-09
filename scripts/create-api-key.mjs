/**
 * Create the server API key this app needs and write it straight into
 * .env.local.
 *
 *   node scripts/create-api-key.mjs
 *
 * Requires the Appwrite CLI to be logged in (`appwrite login`).
 *
 * The secret is never printed — only a masked confirmation — so it does not
 * end up in a terminal scrollback, a screen share, or an agent transcript.
 * If you would rather do this by hand, the console path is
 * Overview → Integrations → API keys, and the scopes are listed below.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PROJECT_ID = process.env.APPWRITE_PROJECT_ID_OVERRIDE ?? '6a782a65003672af80ff'
const ENV_PATH = path.join(process.cwd(), '.env.local')

// Exactly what the app uses, and nothing more:
//   users/sessions — seed-users, and createEmailPasswordSession on /api/auth/login
//   databases…indexes — scripts/setup-appwrite.ts
//   documents/files/buckets — normal runtime reads and writes
const SCOPES = [
  'users.read',
  'users.write',
  'sessions.write',
  'databases.read',
  'databases.write',
  'collections.read',
  'collections.write',
  'attributes.read',
  'attributes.write',
  'indexes.read',
  'indexes.write',
  'documents.read',
  'documents.write',
  'files.read',
  'files.write',
  'buckets.read',
  'buckets.write',
]

function run(args) {
  return execFileSync('appwrite', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
}

let out
try {
  out = run([
    'project',
    'create-key',
    '--project-id',
    PROJECT_ID,
    '--key-id',
    'unique()',
    '--name',
    '"mega-church server"',
    '--scopes',
    ...SCOPES,
    '--json',
  ])
} catch (e) {
  console.error('\n✗ Could not create the key.\n')
  console.error(String(e.stderr || e.stdout || e.message).trim())
  console.error('\nIs the Appwrite CLI logged in?  appwrite login')
  process.exit(1)
}

let key
try {
  key = JSON.parse(out.slice(out.indexOf('{')))
} catch {
  console.error('\n✗ Unexpected CLI output:\n')
  console.error(out.slice(0, 500))
  process.exit(1)
}

const secret = key.secret
if (!secret) {
  console.error('\n✗ The CLI returned a key with no secret. Create one in the console instead.')
  process.exit(1)
}

if (!existsSync(ENV_PATH)) {
  console.error(`\n✗ ${ENV_PATH} does not exist. Copy .env.local.example to .env.local first.`)
  process.exit(1)
}

const before = readFileSync(ENV_PATH, 'utf8')
if (!/^APPWRITE_API_KEY=/m.test(before)) {
  console.error('\n✗ .env.local has no APPWRITE_API_KEY line to fill in.')
  process.exit(1)
}
const existing = /^APPWRITE_API_KEY=(.+)$/m.exec(before)
if (existing && existing[1].trim() !== '') {
  console.error('\n✗ APPWRITE_API_KEY is already set. Clear it first if you mean to replace it.')
  process.exit(1)
}

writeFileSync(ENV_PATH, before.replace(/^APPWRITE_API_KEY=.*$/m, `APPWRITE_API_KEY=${secret}`))

console.log(`\n✓ Created API key "${key.name}" (${key.$id})`)
console.log(`  scopes: ${SCOPES.length}`)
console.log(`  secret: ${secret.slice(0, 6)}…${secret.slice(-4)}  → written to .env.local`)
console.log('\nNext:  npm run setup:appwrite')
