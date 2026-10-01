import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { loadRegister } from '@/lib/reports/server'
import type { SessionRegisterResponse } from '@/lib/reports/register'

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/occurrences/[id]/register — one session's register: everyone
 * expected, with who came and when, plus anybody marked who was not expected.
 *
 * The same readers as the record log and the live stats. A `leader` is not
 * among them: a head's one report is the per-constituency download (PRD
 * §2.9), and widening that to an in-app register is a separate decision, not
 * something to inherit from a route that happens to be nearby.
 */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(['admin', 'usher', 'shepherd', 'treasurer'])
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()
  const register = await loadRegister(databases, id)
  if (!register) {
    return NextResponse.json<SessionRegisterResponse>(
      { ok: false, error: 'No such session.' },
      { status: 404 },
    )
  }
  return NextResponse.json<SessionRegisterResponse>(
    { ok: true, ...register },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
