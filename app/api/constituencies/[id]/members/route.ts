import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { assignConstituency, constituencyCounts, getConstituency } from '@/lib/groups/server'
import type { MembershipResponse } from '@/lib/groups/types'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST — file a batch of already-registered members into this constituency.
 *
 * This is the screen the church asked for: tick eighty people who were
 * registered before the constituencies existed and assign them in one action,
 * rather than opening eighty member pages.
 *
 * Note what "assign" means for a constituency and does NOT mean for a bacenta:
 * a member lives in exactly one place, so assigning them here MOVES them out
 * of wherever they were. The UI says so before it sends. The bacenta version
 * of this route (`/api/bacentas/[id]/members`) adds instead, because serving in
 * a second group takes nothing away from the first.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  let body: { member_ids?: unknown; mode?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return bad('Invalid request body.')
  }

  const memberIds = Array.isArray(body.member_ids)
    ? [...new Set(body.member_ids.filter((v): v is string => typeof v === 'string' && !!v))]
    : []
  if (memberIds.length === 0) return bad('Pick at least one member.')

  // `set` is meaningless here. A constituency is not a list to be replaced —
  // it is a field on each member — and accepting the word would imply a
  // "clear everyone else out" behaviour this route does not perform.
  const mode = body.mode === 'remove' ? 'remove' : 'add'

  const { databases } = createAdminClient()
  if (!(await getConstituency(databases, id))) {
    return bad('No such constituency.', 404)
  }

  const touched = await assignConstituency(
    databases,
    id,
    mode === 'add'
      ? { mode: 'assign', memberIds }
      : { mode: 'unassign', memberIds },
  )

  // Read the count back rather than computing it: members may have moved in or
  // out from another screen while this batch was being ticked, and a number
  // derived from the request would disagree with the list the user is about to
  // see refresh.
  const counts = await constituencyCounts(databases)

  return NextResponse.json<MembershipResponse>({
    ok: true,
    added: mode === 'add' ? touched : 0,
    removed: mode === 'remove' ? touched : 0,
    total: counts.get(id) ?? 0,
  })
}

function bad(error: string, status = 400) {
  return NextResponse.json<MembershipResponse>({ ok: false, error }, { status })
}
