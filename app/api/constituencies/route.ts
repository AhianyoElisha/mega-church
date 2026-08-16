import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  createConstituency,
  listConstituencies,
  listConstituenciesWithCounts,
  validateGroupName,
} from '@/lib/groups/server'
import { resolveHead } from '@/lib/groups/heads'
import type {
  ConstituencyResponse,
  ListConstituenciesResponse,
} from '@/lib/groups/types'

/**
 * GET /api/constituencies — every constituency with its member count.
 *
 * Readable by more roles than it is writable by, deliberately: the member
 * registration form needs the list to fill its dropdown, and an usher doing a
 * manual check-in wants to see where somebody lives. Creating one is admin
 * only. A `leader` is NOT here — a head must not enumerate the constituencies
 * they do not head (see `/api/my-groups`).
 */
export async function GET() {
  const auth = await requireRole(['admin', 'usher'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  const constituencies = await listConstituenciesWithCounts(databases)
  return NextResponse.json<ListConstituenciesResponse>(
    { ok: true, constituencies },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

// POST /api/constituencies — admin only.
export async function POST(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  let body: { name?: unknown; description?: unknown; head_user_id?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return bad('Invalid request body.')
  }

  const { databases, users } = createAdminClient()

  // Re-checked server-side even though the form checks it (PRD §2.5). The
  // unique index catches a race; this produces a sentence a person can act on.
  const existing = await listConstituencies(databases)
  const name = validateGroupName(body.name, {
    taken: existing.map((c) => c.name),
    noun: 'constituency',
  })
  if (!name.ok) return bad(name.error)

  const head = await resolveHead(users, body.head_user_id)
  if (!head.ok) return bad(head.error)

  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 512) || null : null

  const constituency = await createConstituency(
    databases,
    {
      name: name.value,
      description,
      head_user_id: head.user?.id ?? null,
      head_name: head.user?.name ?? null,
    },
    auth.user.email,
  )
  return NextResponse.json<ConstituencyResponse>({ ok: true, constituency }, { status: 201 })
}

function bad(error: string, status = 400) {
  return NextResponse.json<ConstituencyResponse>({ ok: false, error }, { status })
}
