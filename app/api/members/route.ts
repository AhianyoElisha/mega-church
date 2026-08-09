import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { createMember, listMembers, validateMemberInput } from '@/lib/members/server'
import { emptyEnrolment, enrolmentByMember } from '@/lib/biometrics/server'
import type {
  ListMembersResponse,
  MemberEnrolment,
  MemberResponse,
} from '@/lib/members/types'

// GET /api/members — registry list, each row joined to its enrolment progress.
// Ushers may read it (they look people up for a manual check-in); only admins
// may write.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'usher'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  const search = request.nextUrl.searchParams.get('search') ?? undefined
  const status = request.nextUrl.searchParams.get('status') ?? undefined

  // Appwrite has no joins; fetch both sides in parallel and merge in memory.
  const [members, enrolment] = await Promise.all([
    listMembers(databases, { search, status }),
    enrolmentByMember(databases),
  ])

  const rows = members.map((m) => {
    const e = enrolment.get(m.$id) ?? emptyEnrolment(m.$id)
    const summary: MemberEnrolment = {
      member_id: m.$id,
      template_count: e.template_count,
      fingers_done: Object.keys(e.by_finger),
      complete: e.complete,
    }
    return { ...m, enrolment: summary }
  })

  return NextResponse.json<ListMembersResponse>(
    { ok: true, members: rows, total: rows.length },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

// POST /api/members — register a member. Admin only.
export async function POST(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'Invalid request body.' },
      { status: 400 },
    )
  }

  // Re-validate server-side even though the form already did. The browser is
  // not a trusted validator (PRD §2.5).
  const validated = validateMemberInput(body as Record<string, unknown>)
  if (!validated.ok) {
    return NextResponse.json<MemberResponse>({ ok: false, error: validated.error }, { status: 400 })
  }

  const { databases } = createAdminClient()
  const member = await createMember(databases, validated.value, auth.user.email)
  return NextResponse.json<MemberResponse>({ ok: true, member }, { status: 201 })
}
