import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { listMembers } from '@/lib/members/server'
import { fullName } from '@/lib/members/types'

/**
 * GET /api/members/search?q=… — name lookup for manual check-in.
 *
 * Exists because the kiosk needs to find a member by name and must NOT be able
 * to read the registry. `/api/members` returns addresses, phone numbers,
 * birthdays and enrolment state for the whole congregation; a kiosk is an
 * appliance account, often signed in on a machine sitting unattended in a
 * public foyer, and anyone can open devtools on it.
 *
 * So this returns the two fields the manual flow actually renders — an id and
 * a name — for ACTIVE members only, and nothing else. Marking someone present
 * needs no more than that.
 */
const MAX_RESULTS = 8
const MIN_QUERY = 2

export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'usher', 'kiosk'])
  if ('error' in auth) return auth.error

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < MIN_QUERY) {
    // Not an error — an empty result for a too-short query keeps the caller
    // simple and stops a single keystroke listing the congregation.
    return NextResponse.json({ ok: true, members: [] })
  }

  const { databases } = createAdminClient()
  const matches = await listMembers(databases, { search: q, status: 'active' })

  return NextResponse.json(
    {
      ok: true,
      members: matches.slice(0, MAX_RESULTS).map((m) => ({
        $id: m.$id,
        full_name: fullName(m),
      })),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
