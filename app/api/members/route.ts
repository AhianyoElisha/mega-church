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
  leaderScope,
  setMemberBacentas,
  unknownBacentaIds,
} from '@/lib/groups/server'
import { headRegistrationScope } from '@/lib/groups/tree'
import type {
  ListMembersResponse,
  MemberEnrolment,
  MemberResponse,
} from '@/lib/members/types'

// GET /api/members — registry list, each row joined to its enrolment progress.
// Ushers may read it (they look people up for a manual check-in); only admins
// may write.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'usher', 'shepherd'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  const search = request.nextUrl.searchParams.get('search') ?? undefined
  const status = request.nextUrl.searchParams.get('status') ?? undefined
  const constituencyId = request.nextUrl.searchParams.get('constituency') ?? undefined
  const homeService = request.nextUrl.searchParams.get('service') ?? undefined

  // Appwrite has no joins; fetch every side in parallel and merge in memory.
  // The bacenta index is ONE pass over the join collection rather than a query
  // per member — a registry of three thousand people would otherwise be three
  // thousand round trips to fill in a column.
  const [members, enrolment, bacentaIndex] = await Promise.all([
    listMembers(databases, { search, status, constituencyId, homeService }),
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

/**
 * POST /api/members — register a member.
 *
 * Admins, and a constituency HEAD registering into their own constituency.
 *
 * The head is otherwise read-only (PRD §5.2) and this is the deliberate second
 * exception, alongside claiming an unassigned member on
 * `/api/constituencies/[id]/members`. The church's reason is the same one: the
 * head is the person standing in front of the new member, and routing every
 * registration through an admin is how a congregation ends up with a paper list
 * nobody has typed in.
 *
 * What a head may NOT do here is decide anything outside their own group. The
 * narrowing is `headRegistrationScope`, and everything it does not name is
 * forced below rather than read from the request — see the block marked
 * "forced, never read".
 *
 * Biometric enrolment is untouched by any of this: `/api/biometrics/enroll`
 * stays admin-only, so a head registers the person and an admin enrols the
 * fingerprints.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'leader'])
  if ('error' in auth) return auth.error
  const isAdmin = auth.user.label === 'admin'

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
  const fields = validated.value
  let bacentaIds = readBacentaIds(body) ?? []

  if (!isAdmin) {
    // Resolved from the database, never from the request: the client says which
    // constituency it wants, and this says which ones it is entitled to want.
    const scope = await leaderScope(databases, auth.user.id)
    const narrowed = headRegistrationScope(
      { constituency_id: fields.constituency_id, bacenta_ids: bacentaIds },
      {
        constituencies: scope.constituencies.map((c) => c.$id),
        bacentas: scope.bacentas.map((b) => b.$id),
      },
    )
    if (!narrowed.ok) {
      return NextResponse.json<MemberResponse>(
        { ok: false, error: narrowed.error },
        { status: narrowed.status },
      )
    }

    fields.constituency_id = narrowed.constituency_id
    bacentaIds = narrowed.bacenta_ids

    // Forced, never read from the request — both of these are church-wide
    // decisions that happen to live on the member row:
    //
    //   status            `inactive` is what removes somebody from the
    //                     matcher's gallery. A head registering a new member is
    //                     registering an active one by definition, and letting
    //                     the field through would hand a head a lever over
    //                     whether a scanner recognises a person at all.
    //   sms_template_id   picks which birthday text the church sends, at the
    //                     church's cost and in the church's voice. `/api/sms/*`
    //                     already refuses a leader, so a head cannot even see
    //                     the wordings they would be choosing between. Null is
    //                     the standard message, never "send nothing".
    //
    // `benmp_partner` is deliberately NOT forced, and is written down here for
    // the same reason as in `headEditScope`: an absent entry in this list is
    // invisible, and the next reader cannot tell "considered" from "missed".
    // It records something the MEMBER said — that they partner with the
    // campaign — and the head at the desk is who they said it to.
    fields.status = 'active'
    fields.sms_template_id = null
  }

  // The shape check passed; now check the ids name real groups. A member filed
  // into a constituency that does not exist is invisible on every constituency
  // page while still looking assigned on their own.
  const constituencyId = fields.constituency_id
  if (typeof constituencyId === 'string' && !(await constituencyExists(databases, constituencyId))) {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'That constituency no longer exists. Reload and pick another.' },
      { status: 400 },
    )
  }

  const unknown = await unknownBacentaIds(databases, bacentaIds)
  if (unknown.length > 0) {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'One of those bacentas no longer exists. Reload and try again.' },
      { status: 400 },
    )
  }

  const member = await createMember(databases, fields, auth.user.email)

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
