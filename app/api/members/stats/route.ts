import { NextResponse } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { listMembers } from '@/lib/members/server'
import { enrolmentByMember } from '@/lib/biometrics/server'
import type { MemberStatsResponse } from '@/lib/members/types'

// GET /api/members/stats — the dashboard's headline numbers.
export async function GET() {
  const auth = await requireRole(['admin', 'usher'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  const [members, enrolment] = await Promise.all([
    listMembers(databases),
    enrolmentByMember(databases),
  ])

  let active = 0
  let fully_enrolled = 0
  let partially_enrolled = 0
  let not_enrolled = 0

  for (const m of members) {
    if (m.status === 'active') active++
    const e = enrolment.get(m.$id)
    // "Partially enrolled" is the number that actually needs acting on: those
    // members will be turned away by a scanner and nobody will know why until
    // someone looks here.
    if (!e || e.template_count === 0) not_enrolled++
    else if (e.complete) fully_enrolled++
    else partially_enrolled++
  }

  return NextResponse.json<MemberStatsResponse>(
    {
      ok: true,
      stats: {
        total: members.length,
        active,
        inactive: members.length - active,
        fully_enrolled,
        partially_enrolled,
        not_enrolled,
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
