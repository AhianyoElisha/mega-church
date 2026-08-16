import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  bacentaMemberIds,
  bacentaNameTaken,
  canReadGroup,
  deleteBacentaCascade,
  getBacenta,
  listCategories,
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
  const auth = await requireRole(['admin', 'leader'])
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
  const members = await buildGroupRoster(databases, memberIds)

  return NextResponse.json<GroupDetailResponse>(
    { ok: true, kind: 'bacenta', group, members },
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
    category_id?: unknown
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

  // The category may be moving in the same request as the name, and the
  // uniqueness check depends on which category the bacenta ends up in — so
  // resolve the destination before checking the name against it.
  let targetCategory = current.category_id
  if (body.category_id !== undefined) {
    targetCategory =
      typeof body.category_id === 'string' && body.category_id ? body.category_id : null
    if (targetCategory) {
      const categories = await listCategories(databases)
      if (!categories.some((c) => c.$id === targetCategory)) {
        return bad('That category no longer exists. Reload and pick another.')
      }
    }
    fields.category_id = targetCategory
  }

  if (body.name !== undefined) {
    const shape = validateGroupName(body.name, { noun: 'bacenta' })
    if (!shape.ok) return bad(shape.error)
    if (await bacentaNameTaken(databases, shape.value, targetCategory, id)) {
      return bad(`There is already a "${shape.value}" in that category.`)
    }
    fields.name = shape.value
  } else if (fields.category_id !== undefined) {
    // Moving an unrenamed bacenta into a category that already has one by that
    // name would create the duplicate the rename path refuses.
    if (await bacentaNameTaken(databases, current.name, targetCategory, id)) {
      return bad(`There is already a "${current.name}" in that category.`)
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
    const { removed } = await deleteBacentaCascade(databases, id)
    return NextResponse.json({ ok: true, removed })
  } catch {
    return NextResponse.json({ ok: false, error: 'No such bacenta.' }, { status: 404 })
  }
}

function bad(error: string, status = 400) {
  return NextResponse.json<BacentaResponse>({ ok: false, error }, { status })
}
