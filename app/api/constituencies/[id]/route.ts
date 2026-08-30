import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  canReadGroup,
  deleteConstituencyCascade,
  getConstituency,
  listConstituencies,
  updateConstituency,
  validateGroupName,
} from '@/lib/groups/server'
import { resolveHead } from '@/lib/groups/heads'
import { buildGroupRoster } from '@/lib/groups/roster'
import { listMembers } from '@/lib/members/server'
import type { ConstituencyResponse, GroupDetailResponse } from '@/lib/groups/types'

// Next 16: route params are async.
type Ctx = { params: Promise<{ id: string }> }

/**
 * GET — the constituency and everyone who lives in it.
 *
 * The one route a constituency head reads. `canReadGroup` is the enforcement:
 * an admin may read any group, a leader only the ones naming them as head. The
 * UI showing a head just their own tiles is a convenience on top of this, not
 * instead of it (CLAUDE.md — server-side enforcement is mandatory).
 */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(['admin', 'leader', 'shepherd', 'treasurer'])
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()

  if (!(await canReadGroup(databases, auth.user, 'constituency', id))) {
    // 403 and not 404: the group exists, this account may not see it. Saying
    // so plainly beats a head hunting for a typo in a link that is correct.
    return NextResponse.json<GroupDetailResponse>(
      { ok: false, error: 'You do not head this constituency.' },
      { status: 403 },
    )
  }

  const group = await getConstituency(databases, id)
  if (!group) {
    return NextResponse.json<GroupDetailResponse>(
      { ok: false, error: 'No such constituency.' },
      { status: 404 },
    )
  }

  // Filtered server-side by `constituency_id` — a head's whole view is this one
  // query, and pulling the registry down to filter it here would not scale.
  const members = await listMembers(databases, { constituencyId: id })
  const roster = await buildGroupRoster(
    databases,
    members.map((m) => m.$id),
  )

  return NextResponse.json<GroupDetailResponse>(
    { ok: true, kind: 'constituency', group, members: roster },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

// PATCH — rename, re-describe, or change the head. Admin only.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  let body: { name?: unknown; description?: unknown; head_user_id?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return bad('Invalid request body.')
  }

  const { databases, users } = createAdminClient()
  const fields: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const others = (await listConstituencies(databases)).filter((c) => c.$id !== id)
    const name = validateGroupName(body.name, {
      taken: others.map((c) => c.name),
      noun: 'constituency',
    })
    if (!name.ok) return bad(name.error)
    fields.name = name.value
  }

  if (body.description !== undefined) {
    fields.description =
      typeof body.description === 'string' ? body.description.trim().slice(0, 512) || null : null
  }

  if (body.head_user_id !== undefined) {
    const head = await resolveHead(users, body.head_user_id)
    if (!head.ok) return bad(head.error)
    fields.head_user_id = head.user?.id ?? null
    // Kept in step with the id in the same write. A stale `head_name` beside a
    // fresh `head_user_id` is a list that names the wrong person.
    fields.head_name = head.user?.name ?? null
  }

  if (Object.keys(fields).length === 0) return bad('Nothing to update.')

  try {
    const constituency = await updateConstituency(databases, id, fields)
    return NextResponse.json<ConstituencyResponse>({ ok: true, constituency })
  } catch {
    return bad('No such constituency.', 404)
  }
}

/**
 * DELETE — remove the constituency, first clearing it off its members.
 *
 * The members survive; only their address does. See
 * `deleteConstituencyCascade` for why the clearing has to happen first.
 */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()
  try {
    const { cleared } = await deleteConstituencyCascade(databases, id)
    return NextResponse.json({ ok: true, cleared })
  } catch {
    return NextResponse.json({ ok: false, error: 'No such constituency.' }, { status: 404 })
  }
}

function bad(error: string, status = 400) {
  return NextResponse.json<ConstituencyResponse>({ ok: false, error }, { status })
}
