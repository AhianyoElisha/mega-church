import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/appwrite/server'
import { probeBiometricMatcher } from '@/lib/services/biometricService'

/**
 * GET /api/biometrics/matcher-health — can THIS server identify a fingerprint?
 *
 * The kiosk already probes the bridge from the browser, which proves the
 * scanner is attached to the machine the operator is standing at. It proves
 * nothing about the server handling /api/attendance/scan, and that is the half
 * that fails silently: a kiosk pointed at a server with no matcher gets
 * `no_match` for every scan, rendered as "not recognised", indistinguishable
 * from an unknown finger.
 *
 * Open to every role, because the account that needs the answer is the one
 * standing at the broken kiosk.
 */
export async function GET() {
  const auth = await requireRole(['admin', 'usher', 'kiosk'])
  if ('error' in auth) return auth.error

  const matcher = await probeBiometricMatcher()
  // Never cached: this is the diagnostic, and a stale green is worse than no
  // answer at all.
  return NextResponse.json(
    { ok: true, matcher },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
