import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { isMemberType, MEMBER_TYPES } from '@/lib/appwrite/config'
import { bulkSetMemberType } from '@/lib/members/server'
import { invalidateCandidateCache } from '@/lib/biometrics/server'
import type { BulkTypeResponse } from '@/lib/members/students'

/**
 * POST /api/members/bulk-type — move a selection into one category.
 *
 * ADMIN ONLY. Setting `member_type` is constituency-head tier on a single
 * edit, and a head may do that one member at a time on the member's own
 * page, inside the scope `headEditScope` checks. A bulk route has no such
 * scope: a list of ids is a list of ids, and re-deriving "every one of these
 * lives in a constituency you head" here would be the same check written
 * twice, once by somebody who might get it wrong. So this door is admin's,
 * and a head is refused without being named — `requireRole` does that.
 *
 * Per-member refusals (a child with no phone becoming an adult) are REPORTED
 * in `failed`, never thrown: one person must not stop the other thirty-nine.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  let body: { member_ids?: unknown; member_type?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return bad('Invalid request body.')
  }

  const memberIds = Array.isArray(body.member_ids)
    ? [...new Set(body.member_ids.filter((v): v is string => typeof v === 'string' && !!v))]
    : []
  if (memberIds.length === 0) return bad('Pick at least one member.')

  if (!isMemberType(body.member_type)) {
    return bad(
      `"${String(body.member_type)}" is not a member category. Choose one of: ${MEMBER_TYPES.join(', ')}.`,
    )
  }

  const { databases } = createAdminClient()
  const result = await bulkSetMemberType(databases, memberIds, body.member_type)

  // The gallery carries each candidate's `member_type`, and a child must be
  // redirected to Save Church on the very next press, not at the next cache
  // tick.
  if (result.updated > 0) invalidateCandidateCache()

  return NextResponse.json<BulkTypeResponse>({ ok: true, ...result })
}

function bad(error: string, status = 400) {
  return NextResponse.json<BulkTypeResponse>({ ok: false, error }, { status })
}
