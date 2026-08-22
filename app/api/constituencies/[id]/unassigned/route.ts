import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { canReadGroup, getConstituency, listUnassignedMembers } from '@/lib/groups/server'
import type { ListUnassignedResponse } from '@/lib/groups/types'

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/constituencies/[id]/unassigned — members who belong nowhere yet.
 *
 * A head needs this to do the one write they are allowed: claiming somebody
 * who lives in their area but was registered before constituencies existed.
 * There are 84 such members today, and nobody knows where they live except the
 * heads who recognise the names.
 *
 * It is the ONLY window onto the wider registry a head gets, and it is the
 * narrowest one that makes the feature work. Members already filed into
 * another constituency never appear here, so this cannot be used to browse a
 * neighbour's roster — that is `canReadGroup`'s job on the detail route, and
 * this endpoint simply never returns them.
 *
 * `[id]` is still checked even though the list does not depend on it. A head
 * asking about a constituency they do not run has no business receiving a
 * working answer, and letting the id go unvalidated because "the response is
 * the same anyway" is how the check stops being there at all when the response
 * later stops being the same.
 */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(['admin', 'leader'])
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()

  if (!(await getConstituency(databases, id))) {
    return NextResponse.json<ListUnassignedResponse>(
      { ok: false, error: 'No such constituency.' },
      { status: 404 },
    )
  }

  const allowed = await canReadGroup(
    databases,
    { id: auth.user.id, label: auth.user.label },
    'constituency',
    id,
  )
  if (!allowed) {
    return NextResponse.json<ListUnassignedResponse>(
      { ok: false, error: 'You do not head that constituency.' },
      { status: 403 },
    )
  }

  const members = await listUnassignedMembers(databases)
  return NextResponse.json<ListUnassignedResponse>(
    { ok: true, members },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
