// Starting message templates.
//
// Idempotent, like `setup-appwrite.ts`: it creates a template only when no
// template of that name already exists in that category, and NEVER overwrites
// a body somebody has edited. The church owns this wording — these are a
// starting point so the automatic birthday run has something to send on day
// one, not a house style to be preserved.
//
//   npx tsx --conditions=react-server scripts/seed-sms-templates.ts
//
// The flag is required because this imports `lib/sms/server.ts`, which pulls
// `server-only` (CLAUDE.md).

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createAdminClient } from '../lib/appwrite/server'
import { type SmsCategory } from '../lib/appwrite/config'
import { createTemplate, listTemplates, templateNameTaken } from '../lib/sms/server'
import { countParts, render } from '../lib/sms/render'

const SAMPLE = { first_name: 'Ama', last_name: 'Serwaa', other_names: null }

/**
 * Every one of these fits in a single 160-character SMS part once rendered.
 *
 * That is a constraint, not a coincidence: a two-part message doubles the cost
 * per member, and on a congregation of a few hundred birthdays a year the
 * difference is real money. The script checks it below rather than trusting
 * that whoever edits this file counted.
 */
const SEEDS: {
  name: string
  category: SmsCategory
  body: string
  is_default: boolean
}[] = [
  {
    name: 'Standard birthday',
    category: 'birthday',
    is_default: true,
    body:
      `Happy birthday, {{first_name}}! The whole church is celebrating with you today. ` +
      `May this new year be full of God's goodness. - {{church}}`,
  },
  {
    // The reason the per-member override exists. An elder or a bereaved member
    // is not addressed the same way as everybody else, and having a second
    // wording ready is what makes that switch a choice rather than a project.
    name: 'Formal birthday',
    category: 'birthday',
    is_default: false,
    body:
      `Dear {{full_name}}, the leadership and members of {{church}} wish you a ` +
      `happy birthday. May the Lord bless you and keep you.`,
  },
  {
    name: 'Tithe thank you',
    category: 'tithe',
    is_default: true,
    body:
      `Thank you, {{first_name}}, for your faithfulness in your tithe. ` +
      `May the Lord open the windows of heaven over you. - {{church}}`,
  },
  {
    name: 'Tithe thank you (short)',
    category: 'tithe',
    is_default: false,
    body: `God bless you, {{first_name}}. Your tithe has been received with thanks. - {{church}}`,
  },
  {
    name: 'General announcement',
    category: 'general',
    is_default: true,
    body: `Hello {{first_name}}, a message from {{church}}: `,
  },
]

async function main() {
  const required = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY']
  const missing = required.filter((k) => !process.env[k])
  if (missing.length > 0) {
    console.error(`Missing env: ${missing.join(', ')}. Put them in .env.local.`)
    process.exit(1)
  }

  const { databases } = createAdminClient()
  let created = 0
  let existing = 0

  for (const seed of SEEDS) {
    const rendered = render(seed.body, SAMPLE)
    if (!rendered.ok) {
      // A seed that cannot render is a typo in this file, and it must not reach
      // the database — a broken template only fails on somebody's birthday.
      console.error(`  ✗ ${seed.name}: ${rendered.error}`)
      process.exit(1)
    }
    const parts = countParts(rendered.text)
    if (parts.parts > 1) {
      console.error(
        `  ✗ ${seed.name}: renders to ${parts.characters} characters, ${parts.parts} parts. ` +
          `Every seeded template must fit one part — shorten it.`,
      )
      process.exit(1)
    }

    const clash = await templateNameTaken(databases, seed.category, seed.name)
    if (clash) {
      console.log(`  · ${seed.category}/${seed.name} exists — left exactly as it is`)
      existing++
      continue
    }

    // `is_default` is passed through, but `createTemplate` also promotes the
    // FIRST template in a category regardless. A category whose only template
    // is not the default is one the automatic run cannot send from.
    await createTemplate(databases, seed, 'seed-sms-templates')
    console.log(
      `  ✓ ${seed.category}/${seed.name} created` +
        `${seed.is_default ? ' (default)' : ''} — ${parts.characters} chars, 1 part`,
    )
    created++
  }

  console.log(`\n─── summary ───`)
  console.log(`  created ${created}   existing ${existing}`)
  for (const category of ['birthday', 'tithe', 'general'] as SmsCategory[]) {
    const all = await listTemplates(databases, category)
    const defaults = all.filter((t) => t.is_default)
    console.log(
      `  ${category.padEnd(9)} ${all.length} template(s), ` +
        `default: ${defaults[0]?.name ?? 'NONE'}${defaults.length > 1 ? ` ⚠ ${defaults.length} defaults!` : ''}`,
    )
  }
  console.log(
    `\nThis wording is a starting point, not a house style. Edit it on /sms → Templates.`,
  )
  console.log(`Re-running this script will not touch anything you have changed.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
