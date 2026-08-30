import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  bacentaNameTaken,
  createBacenta,
  listBacentasWithCounts,
  listCategories,
  validateGroupName,
} from '@/lib/groups/server'
import { resolveHead } from '@/lib/groups/heads'
import type { BacentaResponse, ListBacentasResponse } from '@/lib/groups/types'

/**
 * GET /api/bacentas — categories and bacentas, flat.
 *
 * Flat and not pre-nested: `buildBacentaTree` does the nesting on the client so
 * the same payload feeds the tree view, the registration form's multi-select
 * and the member detail page without three shapes of the same data.
 */
export async function GET() {
  const auth = await requireRole(['admin', 'usher', 'shepherd', 'treasurer'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  const [categories, bacentas] = await Promise.all([
    listCategories(databases),
    listBacentasWithCounts(databases),
  ])
  return NextResponse.json<ListBacentasResponse>(
    { ok: true, categories, bacentas },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

/**
 * POST /api/bacentas — create one, categorised or standalone.
 *
 * Omitting `category_id` (or sending null) creates a STANDALONE bacenta like
 * the Technical Team: members sit directly under it, there are no siblings.
 * Passing a category id creates one of a family, like Biazo under Choir. There
 * is no third "type" field to keep in step — the presence of the category is
 * the whole distinction.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

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

  const categoryId =
    typeof body.category_id === 'string' && body.category_id ? body.category_id : null
  if (categoryId) {
    const categories = await listCategories(databases)
    if (!categories.some((c) => c.$id === categoryId)) {
      return bad('That category no longer exists. Reload and pick another.')
    }
  }

  const shape = validateGroupName(body.name, { noun: 'bacenta' })
  if (!shape.ok) return bad(shape.error)

  // Uniqueness is per-category, not global: "Youth" under Choir and "Youth"
  // under Ushers are two real, different groups, and a global unique index
  // would refuse the second one.
  if (await bacentaNameTaken(databases, shape.value, categoryId)) {
    return bad(
      categoryId
        ? `There is already a "${shape.value}" in that category.`
        : `There is already a bacenta called "${shape.value}".`,
    )
  }

  const head = await resolveHead(users, body.head_user_id)
  if (!head.ok) return bad(head.error)

  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 512) || null : null

  const bacenta = await createBacenta(
    databases,
    {
      name: shape.value,
      category_id: categoryId,
      description,
      head_user_id: head.user?.id ?? null,
      head_name: head.user?.name ?? null,
    },
    auth.user.email,
  )
  return NextResponse.json<BacentaResponse>({ ok: true, bacenta }, { status: 201 })
}

function bad(error: string, status = 400) {
  return NextResponse.json<BacentaResponse>({ ok: false, error }, { status })
}
