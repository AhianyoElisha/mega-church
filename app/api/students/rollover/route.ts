import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { rolloverStudents } from '@/lib/members/server'
import { invalidateCandidateCache } from '@/lib/biometrics/server'
import { todayInAccra } from '@/lib/attendance/occurrenceResolver'
import { ROLLOVER_ACTIONS, isRolloverAction, type RolloverResponse } from '@/lib/members/students'

/**
 * POST /api/students/rollover — promote, repeat or graduate a selection.
 *
 * ADMIN ONLY. A shepherd reads the roll and the page hides these buttons from
 * them; this is what actually refuses them, without naming them.
 *
 * "Today" is Accra's today, not the server's: the academic year turns over on
 * a calendar date, and a server in another zone would stamp the wrong year on
 * everybody confirmed on the evening of the boundary.
 *
 * The transitions are pure (`lib/members/students.ts`) and a refusal —
 * promote at level 800, a non-student in the selection — comes back BY NAME
 * against that member in `failed`, while the rest of the batch is written.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  let body: { member_ids?: unknown; action?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return bad('Invalid request body.')
  }

  const memberIds = Array.isArray(body.member_ids)
    ? [...new Set(body.member_ids.filter((v): v is string => typeof v === 'string' && !!v))]
    : []
  if (memberIds.length === 0) return bad('Pick at least one student.')

  if (!isRolloverAction(body.action)) {
    return bad(`"${String(body.action)}" is not a rollover action. Choose one of: ${ROLLOVER_ACTIONS.join(', ')}.`)
  }

  const { databases } = createAdminClient()
  const result = await rolloverStudents(databases, memberIds, body.action, todayInAccra())

  // `graduate` changes `member_type`, which the gallery carries. The other two
  // do not, but one invalidation after any successful write is cheaper than
  // a rule about which action needs it that someone later gets wrong.
  if (result.updated > 0) invalidateCandidateCache()

  return NextResponse.json<RolloverResponse>({ ok: true, action: body.action, ...result })
}

function bad(error: string, status = 400) {
  return NextResponse.json<RolloverResponse>({ ok: false, error }, { status })
}
