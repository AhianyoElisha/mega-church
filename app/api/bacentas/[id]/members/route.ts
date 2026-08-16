import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { applyBacentaMembership, getBacenta } from '@/lib/groups/server'
import type { MembershipMode, MembershipResponse } from '@/lib/groups/types'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST — change who serves in this bacenta.
 *
 * Unlike the constituency version, this ADDS by default and takes nothing
 * away: a chorister joining the technical team stays in the choir, and someone
 * may sing in two choirs at once. That is the whole reason bacenta membership
 * is a join collection rather than a field.
 *
 *   add     put these members in, leave everyone else alone   ← the assigner
 *   remove  take these members out, leave everyone else alone
 *   set     the bacenta ends up being exactly these members   ← destructive
 *
 * `set` is only sent by the explicit "replace the whole list" control. Sending
 * it from a filtered view would quietly remove everyone who happened to be off
 * screen behind a search box.
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

  const mode: MembershipMode =
    body.mode === 'set' || body.mode === 'remove' ? body.mode : 'add'

  // An empty list is meaningful for `set` (empty the bacenta) and meaningless
  // for the other two, where it would be a no-op the caller did not intend.
  if (memberIds.length === 0 && mode !== 'set') return bad('Pick at least one member.')

  const { databases } = createAdminClient()
  if (!(await getBacenta(databases, id))) return bad('No such bacenta.', 404)

  const result = await applyBacentaMembership(
    databases,
    id,
    memberIds,
    mode,
    auth.user.email,
  )
  return NextResponse.json<MembershipResponse>({ ok: true, ...result })
}

function bad(error: string, status = 400) {
  return NextResponse.json<MembershipResponse>({ ok: false, error }, { status })
}
