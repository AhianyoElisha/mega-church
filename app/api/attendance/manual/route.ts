import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { processManual, resolveSessions } from '@/lib/attendance/server'
import type { ManualRequest, ScanResponse } from '@/lib/attendance/types'

/**
 * POST /api/attendance/manual — mark someone present by name.
 *
 * The fallback for a member whose finger will not read (dry hands, a plaster,
 * an incomplete enrolment). Available to admins, ushers, AND the kiosk itself,
 * because the person standing at a failing scanner is usually the one who
 * needs it.
 *
 * `dry_run: true` resolves the member and evaluates authorisation but writes
 * nothing, so the UI can show a photo and name to check against the person in
 * front of it before committing.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'usher', 'kiosk'])
  if ('error' in auth) return auth.error

  let body: Partial<ManualRequest>
  try {
    body = (await request.json()) as Partial<ManualRequest>
  } catch {
    return NextResponse.json<ScanResponse>(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  const member_id = typeof body.member_id === 'string' ? body.member_id.trim() : ''
  if (!member_id) {
    return NextResponse.json<ScanResponse>(
      { ok: false, error: 'Choose a member first.' },
      { status: 400 },
    )
  }

  const { databases } = createAdminClient()

  let session
  let pausedName: string | null = null
  try {
    const snapshot = await resolveSessions(databases)
    session = snapshot.session
    pausedName = snapshot.paused[0]?.meeting.name ?? null
  } catch (e) {
    return NextResponse.json<ScanResponse>(
      { ok: false, error: e instanceof Error ? e.message : 'Could not resolve the session.' },
      { status: 409 },
    )
  }
  if (!session) {
    // Paused and closed are both "not open" to this route, and both refuse.
    // They are NOT the same thing to whoever is standing at the scanner, so the
    // message distinguishes them — "wait" and "go away" are different answers.
    return NextResponse.json<ScanResponse>(
      {
        ok: false,
        error: pausedName
          ? `${pausedName} is paused. Check-in will start again when it is resumed.`
          : 'No session is open.',
      },
      { status: 423 },
    )
  }

  const result = await processManual(
    databases,
    session,
    {
      member_id,
      station: auth.user.station ?? body.station ?? null,
      note: typeof body.note === 'string' ? body.note.slice(0, 512) : null,
      dry_run: body.dry_run === true,
    },
    auth.user.email,
  )

  return NextResponse.json<ScanResponse>({ ok: true, result, session })
}
