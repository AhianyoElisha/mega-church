import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { activateOccurrence } from '@/lib/attendance/server'
import type { ActivateResponse } from '@/lib/meetings/types'

/**
 * POST /api/occurrences/activate — open a session.
 *
 * The single-active-session rule (PRD §2.2) is enforced inside
 * `activateOccurrence`, not here and not in the UI. A refusal comes back as
 * 409 with the blocking session attached, so the page can say
 * "End First Service before activating Second Service" rather than
 * "something went wrong".
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  let body: { meeting_id?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json<ActivateResponse>(
      { ok: false, error: 'Invalid request body.' },
      { status: 400 },
    )
  }

  const meetingId = typeof body.meeting_id === 'string' ? body.meeting_id.trim() : ''
  if (!meetingId) {
    return NextResponse.json<ActivateResponse>(
      { ok: false, error: 'meeting_id is required.' },
      { status: 400 },
    )
  }

  const { databases } = createAdminClient()
  const result = await activateOccurrence(databases, meetingId, auth.user.email)

  if (!result.ok) {
    return NextResponse.json<ActivateResponse>(result, {
      status: result.conflict ? 409 : 400,
    })
  }
  return NextResponse.json<ActivateResponse>({ ok: true, session: result.session }, { status: 201 })
}
