import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  assignConstituency,
  canReadGroup,
  constituencyCounts,
  getConstituency,
} from '@/lib/groups/server'
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
  /**
   * A group HEAD may call this, narrowly. See the two guards below.
   *
   * The church's own words: a head knows who lives in their area, and 84
   * members were registered before constituencies existed. Making the head ask
   * an admin to file each of them is how that backlog stays a backlog.
   */
  const auth = await requireRole(['admin', 'leader'])
  if ('error' in auth) return auth.error
  const isAdmin = auth.user.label === 'admin'

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

  if (!isAdmin) {
    // Guard 1 — it has to be their own constituency.
    const allowed = await canReadGroup(
      databases,
      { id: auth.user.id, label: auth.user.label },
      'constituency',
      id,
    )
    if (!allowed) return bad('You do not head that constituency.', 403)

    // Guard 2 — a head may ADD, never remove. Removing sets the member's
    // constituency to null, which is indistinguishable from "never assigned"
    // and would let a head quietly empty a roster an admin had filled. If a
    // head files somebody by mistake, an admin can move them; the reverse
    // mistake has no such backstop.
    if (mode !== 'add') {
      return bad(
        'A group head can add members to their constituency but not remove them. ' +
          'Ask an administrator to move somebody out.',
        403,
      )
    }
  }

  const touched = await assignConstituency(
    databases,
    id,
    mode === 'add'
      ? {
          mode: 'assign',
          memberIds,
          // Guard 3, and the one that actually protects other heads: an admin
          // may MOVE a member between constituencies, a head may only claim
          // one who belongs to none. Enforced inside `assignConstituency` so
          // it sits next to the write rather than in front of it.
          onlyUnassigned: !isAdmin,
        }
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
    // A head who ticks somebody who was filed elsewhere between the list
    // loading and the button being pressed gets a number that is smaller than
    // what they ticked. Saying so beats silently doing less than was asked.
    skipped: mode === 'add' ? memberIds.length - touched : 0,
  })
}

function bad(error: string, status = 400) {
  return NextResponse.json<MembershipResponse>({ ok: false, error }, { status })
}
