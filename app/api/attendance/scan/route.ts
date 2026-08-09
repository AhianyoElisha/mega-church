import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { processScan, resolveActiveSession } from '@/lib/attendance/server'
import { MatcherUnavailableError } from '@/lib/services/biometricService'
import type { ScanRequest, ScanResponse } from '@/lib/attendance/types'

/**
 * POST /api/attendance/scan — kiosk only.
 *
 * The kiosk never sends a session id. The server resolves the one open session
 * itself, because a kiosk that has been sitting on a counter since yesterday
 * would otherwise cheerfully post into a session that closed hours ago.
 *
 * Status codes:
 *   200 — a ScanResult (marked | already_marked | not_authorised |
 *         inactive_member | no_match)
 *   401 — not authenticated
 *   403 — not a kiosk account
 *   400 — malformed body
 *   423 — no session is open (locked)
 *   503 — this server cannot match fingerprints at all. NOT the same as
 *         no_match, and the kiosk renders it completely differently.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole('kiosk')
  if ('error' in auth) return auth.error

  let body: Partial<ScanRequest>
  try {
    body = (await request.json()) as Partial<ScanRequest>
  } catch {
    return NextResponse.json<ScanResponse>(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  const fingerprint_data = body.fingerprint_data
  if (typeof fingerprint_data !== 'string' || fingerprint_data.length === 0) {
    return NextResponse.json<ScanResponse>(
      { ok: false, error: 'Missing fingerprint_data' },
      { status: 400 },
    )
  }

  const { databases } = createAdminClient()

  let session
  try {
    session = await resolveActiveSession(databases)
  } catch (e) {
    return NextResponse.json<ScanResponse>(
      { ok: false, error: e instanceof Error ? e.message : 'Could not resolve the session.' },
      { status: 409 },
    )
  }
  if (!session) {
    return NextResponse.json<ScanResponse>(
      { ok: false, error: 'No session is open.' },
      { status: 423 },
    )
  }

  try {
    const result = await processScan(databases, session, {
      fingerprint_data,
      // The kiosk asserts its own station, but the account's configured one
      // wins — a station label is provenance for the audit trail, and letting
      // a client set it freely would make it worthless.
      station: auth.user.station ?? body.station ?? null,
    })
    return NextResponse.json<ScanResponse>({ ok: true, result, session })
  } catch (e) {
    if (e instanceof MatcherUnavailableError) {
      // "This server cannot match" must never reach the kiosk as "that finger
      // did not match". 503 + the explanation; the kiosk shows a banner naming
      // the fault and keeps manual check-in available.
      return NextResponse.json<ScanResponse>({ ok: false, error: e.message }, { status: 503 })
    }
    throw e
  }
}
