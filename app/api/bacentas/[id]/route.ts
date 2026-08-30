import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  bacentaMemberIds,
  careCandidates,
  bacentaNameTaken,
  canReadGroup,
  deleteBacentaCascade,
  getBacenta,
  listConstituencies,
  updateBacenta,
  validateGroupName,
} from '@/lib/groups/server'
import { resolveHead } from '@/lib/groups/heads'
import { buildGroupRoster } from '@/lib/groups/roster'
import type { BacentaResponse, GroupDetailResponse } from '@/lib/groups/types'

type Ctx = { params: Promise<{ id: string }> }

/** GET — the bacenta and everyone serving in it. Head-scoped, like the
 *  constituency route; see the note there on why this is a 403 and not a 404. */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(['admin', 'leader', 'shepherd', 'treasurer'])
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()

  if (!(await canReadGroup(databases, auth.user, 'bacenta', id))) {
    return NextResponse.json<GroupDetailResponse>(
      { ok: false, error: 'You do not head this bacenta.' },
      { status: 403 },
    )
  }

  const group = await getBacenta(databases, id)
  if (!group) {
    return NextResponse.json<GroupDetailResponse>(
      { ok: false, error: 'No such bacenta.' },
      { status: 404 },
    )
  }

  const memberIds = await bacentaMemberIds(databases, id)
  const [members, care] = await Promise.all([
    buildGroupRoster(databases, memberIds),
    // The care links ride along with the roster rather than being a second
    // request: the page needs both to render one table, and splitting them
    // gives it a state where it knows who is here but not who looks after them.
    careCandidates(databases, id),
  ])

  return NextResponse.json<GroupDetailResponse>(
    { ok: true, kind: 'bacenta', group, members, care },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

// PATCH — rename, re-describe, change head, or move to another category.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  let body: {
    name?: unknown
    constituency_id?: unknown
    description?: unknown
    head_user_id?: unknown
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return bad('Invalid request body.')
  }

  const { databases, users } = createAdminClient()
  const current = await getBacenta(databases, id)
  if (!current) return bad('No such bacenta.', 404)

  const fields: Record<string, unknown> = {}

  // The constituency may be moving in the same request as the name, and the
  // uniqueness check depends on which constituency the bacenta ends up in — so
  // resolve the destination before checking the name against it.
  let targetConstituency = current.constituency_id
  if (body.constituency_id !== undefined) {
    targetConstituency =
      typeof body.constituency_id === 'string' && body.constituency_id
        ? body.constituency_id
        : null
    if (targetConstituency) {
      const constituencies = await listConstituencies(databases)
      if (!constituencies.some((c) => c.$id === targetConstituency)) {
        return bad('That constituency no longer exists. Reload and pick another.')
      }
    }
    fields.constituency_id = targetConstituency
  }

  if (body.name !== undefined) {
    const shape = validateGroupName(body.name, { noun: 'bacenta' })
    if (!shape.ok) return bad(shape.error)
    if (await bacentaNameTaken(databases, shape.value, targetConstituency, id)) {
      return bad(`There is already a "${shape.value}" in that constituency.`)
    }
    fields.name = shape.value
  } else if (fields.constituency_id !== undefined) {
    // Moving an unrenamed bacenta into a constituency that already has one by
    // that name would create the duplicate the rename path refuses.
    if (await bacentaNameTaken(databases, current.name, targetConstituency, id)) {
      return bad(`There is already a "${current.name}" in that constituency.`)
    }
  }

  if (body.description !== undefined) {
    fields.description =
      typeof body.description === 'string' ? body.description.trim().slice(0, 512) || null : null
  }

  if (body.head_user_id !== undefined) {
    const head = await resolveHead(users, body.head_user_id)
    if (!head.ok) return bad(head.error)
    fields.head_user_id = head.user?.id ?? null
    fields.head_name = head.user?.name ?? null
  }

  if (Object.keys(fields).length === 0) return bad('Nothing to update.')

  const bacenta = await updateBacenta(databases, id, fields)
  return NextResponse.json<BacentaResponse>({ ok: true, bacenta })
}

/** DELETE — the bacenta and the join rows that put people in it. The members
 *  themselves are untouched; they simply stop serving in this group. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()
  try {
    const { released } = await deleteBacentaCascade(databases, id)
    return NextResponse.json({ ok: true, released })
  } catch {
    return NextResponse.json({ ok: false, error: 'No such bacenta.' }, { status: 404 })
  }
}

function bad(error: string, status = 400) {
  return NextResponse.json<BacentaResponse>({ ok: false, error }, { status })
}
