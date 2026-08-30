import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { assignBacenta, bacentaMemberIds, getBacenta } from '@/lib/groups/server'
import type { MembershipResponse } from '@/lib/groups/types'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST — put members into this bacenta, or take them out.
 *
 * A bacenta is where somebody LIVES, so membership is a FIELD on the member and
 * assigning MOVES them out of whichever bacenta they were in. There is no `set`
 * mode and no diff: those belong to a join, and this is not one.
 *
 * That is the whole difference from `/api/basontas/[id]/members`, which adds
 * without removing because a chorister really can run the sound desk too. The
 * two routes look similar and mean opposite things, which is exactly why the
 * church needed two words.
 *
 *   assign    these members now live here, wherever they lived before
 *   unassign  these members live nowhere until they are filed again
 *
 * Admin-only. A head does not move people between places, for the same reason
 * they do not move them between constituencies — see `headEditScope`.
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

  /**
   * REFUSED rather than defaulted.
   *
   * The join routes speak `add`/`remove`/`set`; this one speaks
   * `assign`/`unassign`, because a place is a field and there is no diff to
   * apply. Falling back to `assign` for anything unrecognised is what turns a
   * mistyped `remove` into the exact opposite of what was asked — everybody
   * named gets ADDED to the bacenta they were being taken out of.
   */
  if (body.mode !== 'assign' && body.mode !== 'unassign') {
    return bad('mode must be "assign" or "unassign".')
  }
  const mode = body.mode
  if (memberIds.length === 0) return bad('Pick at least one member.')

  const { databases } = createAdminClient()
  if (!(await getBacenta(databases, id))) return bad('No such bacenta.', 404)

  const touched = await assignBacenta(databases, id, { mode, memberIds })

  // `total` is read back rather than inferred: a member already in this bacenta
  // is counted by `touched` but changes nothing, so arithmetic on the old count
  // would drift from what the page then loads.
  const after = (await bacentaMemberIds(databases, id)).length
  return NextResponse.json<MembershipResponse>({
    ok: true,
    added: mode === 'assign' ? touched : 0,
    removed: mode === 'unassign' ? touched : 0,
    total: after,
  })
}

function bad(error: string, status = 400) {
  return NextResponse.json<MembershipResponse>({ ok: false, error }, { status })
}
