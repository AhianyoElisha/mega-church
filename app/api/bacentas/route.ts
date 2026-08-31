import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  bacentaNameTaken,
  createBacenta,
  leaderScope,
  listBacentasWithCounts,
  listConstituencies,
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
  const auth = await requireRole(['admin', 'usher', 'shepherd', 'treasurer', 'leader'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  const [constituencies, bacentas] = await Promise.all([
    listConstituencies(databases),
    listBacentasWithCounts(databases),
  ])

  /**
   * A leader gets the places inside constituencies THEY head, and nothing else.
   *
   * They are here because a constituency head may now move a member between the
   * places in their own constituency, and a picker needs a list. That is the
   * only reason, so the list is narrowed to exactly what the move is allowed to
   * target — `headEditScope` refuses any other destination anyway, and offering
   * a neighbour's bacenta would be offering a button that 403s.
   *
   * Narrowed HERE rather than in the page, because a path prefix cannot express
   * "only the places in constituencies this person heads" and the client is not
   * where scope decisions belong (PRD §2.5).
   */
  if (auth.user.label === 'leader') {
    const heads = await leaderScope(databases, auth.user.id)
    const mine = new Set(heads.constituencies.map((c) => c.$id))
    return NextResponse.json<ListBacentasResponse>(
      {
        ok: true,
        constituencies: constituencies.filter((c) => mine.has(c.$id)),
        bacentas: bacentas.filter((b) => b.constituency_id !== null && mine.has(b.constituency_id)),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  return NextResponse.json<ListBacentasResponse>(
    { ok: true, constituencies, bacentas },
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

  const constituencyId =
    typeof body.constituency_id === 'string' && body.constituency_id
      ? body.constituency_id
      : null
  if (constituencyId) {
    const constituencies = await listConstituencies(databases)
    if (!constituencies.some((c) => c.$id === constituencyId)) {
      return bad('That constituency no longer exists. Reload and pick another.')
    }
  }

  const shape = validateGroupName(body.name, { noun: 'bacenta' })
  if (!shape.ok) return bad(shape.error)

  // Uniqueness is per-category, not global: "Youth" under Choir and "Youth"
  // under Ushers are two real, different groups, and a global unique index
  // would refuse the second one.
  // Unique WITHIN a constituency: two constituencies may each have a place the
  // congregation calls "Central", and both are real.
  if (await bacentaNameTaken(databases, shape.value, constituencyId)) {
    return bad(
      constituencyId
        ? `There is already a "${shape.value}" in that constituency.`
        : `There is already a bacenta called "${shape.value}" with no constituency.`,
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
      constituency_id: constituencyId,
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
