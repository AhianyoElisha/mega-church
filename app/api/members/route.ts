import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  createMember,
  listMembers,
  readBacentaIds,
  validateMemberInput,
} from '@/lib/members/server'
import { emptyEnrolment, enrolmentByMember } from '@/lib/biometrics/server'
import {
  bacentaMembershipIndex,
  constituencyExists,
  setMemberBacentas,
  unknownBacentaIds,
} from '@/lib/groups/server'
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
  const constituencyId = request.nextUrl.searchParams.get('constituency') ?? undefined

  // Appwrite has no joins; fetch every side in parallel and merge in memory.
  // The bacenta index is ONE pass over the join collection rather than a query
  // per member — a registry of three thousand people would otherwise be three
  // thousand round trips to fill in a column.
  const [members, enrolment, bacentaIndex] = await Promise.all([
    listMembers(databases, { search, status, constituencyId }),
    enrolmentByMember(databases),
    bacentaMembershipIndex(databases),
  ])

  const rows = members.map((m) => {
    const e = enrolment.get(m.$id) ?? emptyEnrolment(m.$id)
    const summary: MemberEnrolment = {
      member_id: m.$id,
      template_count: e.template_count,
      fingers_done: Object.keys(e.by_finger),
      complete: e.complete,
    }
    return { ...m, enrolment: summary, bacenta_ids: bacentaIndex.byMember.get(m.$id) ?? [] }
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

  // The shape check passed; now check the ids name real groups. A member filed
  // into a constituency that does not exist is invisible on every constituency
  // page while still looking assigned on their own.
  const constituencyId = validated.value.constituency_id
  if (typeof constituencyId === 'string' && !(await constituencyExists(databases, constituencyId))) {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'That constituency no longer exists. Reload and pick another.' },
      { status: 400 },
    )
  }

  const bacentaIds = readBacentaIds(body) ?? []
  const unknown = await unknownBacentaIds(databases, bacentaIds)
  if (unknown.length > 0) {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'One of those bacentas no longer exists. Reload and try again.' },
      { status: 400 },
    )
  }

  const member = await createMember(databases, validated.value, auth.user.email)

  // Bacentas are many-to-many, so they land in the join collection AFTER the
  // member row exists to point at. Ordered this way on purpose: a failure here
  // leaves a registered member with no bacentas, which an admin can fix from
  // the member page. The reverse order would leave join rows pointing at a
  // member id that was never created.
  if (bacentaIds.length > 0) {
    await setMemberBacentas(databases, member.$id, bacentaIds, auth.user.email)
  }

  return NextResponse.json<MemberResponse>(
    { ok: true, member, bacenta_ids: bacentaIds },
    { status: 201 },
  )
}
