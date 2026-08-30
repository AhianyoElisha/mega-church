import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  deleteMemberCascade,
  readBasontaIds,
  updateMember,
  validateMemberInput,
} from '@/lib/members/server'
import { memberDocToMember } from '@/lib/attendance/server'
import { invalidateCandidateCache } from '@/lib/biometrics/server'
import {
  basontaIdsForMember,
  constituencyExists,
  getConstituency,
  leaderScope,
  setMemberBasontas,
  unknownBasontaIds,
  careCandidates,
} from '@/lib/groups/server'
import { headEditScope } from '@/lib/groups/tree'
import { careAssignmentProblem } from '@/lib/groups/care'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import { fullName, type Member, type MemberResponse } from '@/lib/members/types'
import type { Models } from 'node-appwrite'

// Next 16: route params are async.
type Ctx = { params: Promise<{ id: string }> }

/**
 * GET — one member, with their bacentas and the NAME of their constituency.
 *
 * A `leader` may read a member who is in a constituency or a bacenta they head:
 * the same set their group page already shows them in full, so this adds no
 * visibility, it only makes the details reachable one row at a time.
 */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(['admin', 'usher', 'leader', 'shepherd'])
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()
  try {
    const [doc, basonta_ids] = await Promise.all([
      databases.getDocument(DATABASE_ID, COLLECTIONS.members, id),
      basontaIdsForMember(databases, id),
    ])
    const member = memberDocToMember(doc as Models.Document & Record<string, unknown>)

    if (auth.user.label === 'leader') {
      const heads = await leaderScope(databases, auth.user.id)
      const inScope =
        (member.constituency_id !== null &&
          heads.constituencies.some((c) => c.$id === member.constituency_id)) ||
        basonta_ids.some((b) => heads.bacentas.some((h) => h.$id === b))
      if (!inScope) {
        return NextResponse.json<MemberResponse>(
          { ok: false, error: 'That member is not in a group you head.' },
          { status: 403 },
        )
      }
    }

    const constituency = member.constituency_id
      ? await getConstituency(databases, member.constituency_id)
      : null

    return NextResponse.json<MemberResponse>({
      ok: true,
      member,
      basonta_ids,
      constituency_name: constituency?.name ?? null,
    })
  } catch {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'No such member.' },
      { status: 404 },
    )
  }
}

/**
 * PATCH — correct a member's details.
 *
 * Admins, and a group HEAD for a member in a constituency or bacenta they head.
 * A head who registers somebody and mistypes their phone number has to be able
 * to fix it; sending that back through an admin is how the number stays wrong.
 *
 * What a head may NOT change is enforced by `headEditScope` and refused BY
 * NAME rather than silently dropped, so nobody comes away believing an edit
 * landed. Their bacenta ticks are MERGED, never written verbatim — see
 * `headBacentaMerge`, and note that this is the same hazard as the
 * `undefined` / `[]` rule a few lines down, one level deeper.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(['admin', 'leader'])
  if ('error' in auth) return auth.error
  const isAdmin = auth.user.label === 'admin'

  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'Invalid request body.' },
      { status: 400 },
    )
  }

  const validated = validateMemberInput(body as Record<string, unknown>, { partial: true })
  if (!validated.ok) {
    return NextResponse.json<MemberResponse>({ ok: false, error: validated.error }, { status: 400 })
  }

  // `undefined` means the request never mentioned bacentas and they must be
  // left alone; `[]` means the form sent an empty tick-list and they must be
  // cleared. Collapsing the two would make every unrelated edit — a corrected
  // phone number — silently remove somebody from their choir.
  const bacentaIds = readBasontaIds(body)

  if (Object.keys(validated.value).length === 0 && bacentaIds === undefined) {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'Nothing to update.' },
      { status: 400 },
    )
  }

  const { databases } = createAdminClient()

  let fields = validated.value
  let effectiveBacentaIds = bacentaIds

  /**
   * The member as they stand.
   *
   * Loaded for EVERY caller, not just a head: an edit is only meaningful
   * against what is already there. A head needs it for the scope check, the
   * "did you MOVE them" comparison and the basonta merge; an admin needs it for
   * the care check, which has to know which bacenta the member ends up in when
   * the request does not mention one.
   */
  let current: { member: Member; basonta_ids: string[] }
  try {
    const [doc, currentBasontas] = await Promise.all([
      databases.getDocument(DATABASE_ID, COLLECTIONS.members, id),
      basontaIdsForMember(databases, id),
    ])
    current = {
      member: memberDocToMember(doc as Models.Document & Record<string, unknown>),
      basonta_ids: currentBasontas,
    }
  } catch {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'No such member.' },
      { status: 404 },
    )
  }

  if (!isAdmin) {

    const heads = await leaderScope(databases, auth.user.id)
    const narrowed = headEditScope(
      { fields, basonta_ids: bacentaIds },
      {
        constituency_id: current.member.constituency_id,
        bacenta_id: current.member.bacenta_id,
        basonta_ids: current.basonta_ids,
      },
      {
        constituencies: heads.constituencies.map((c) => c.$id),
        bacentas: heads.bacentas.map((b) => b.$id),
        basontas: heads.basontas.map((b) => b.$id),
      },
    )
    if (!narrowed.ok) {
      return NextResponse.json<MemberResponse>(
        { ok: false, error: narrowed.error },
        { status: narrowed.status },
      )
    }
    fields = narrowed.fields
    effectiveBacentaIds = narrowed.basonta_ids

    // The no-op `constituency_id` may have been dropped above, which can empty
    // a request that looked non-empty to the check further up.
    if (Object.keys(fields).length === 0 && effectiveBacentaIds === undefined) {
      return NextResponse.json<MemberResponse>(
        { ok: false, error: 'Nothing to update.' },
        { status: 400 },
      )
    }
  }

  const constituencyId = fields.constituency_id
  if (typeof constituencyId === 'string' && !(await constituencyExists(databases, constituencyId))) {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'That constituency no longer exists. Reload and pick another.' },
      { status: 400 },
    )
  }
  if (
    effectiveBacentaIds !== undefined &&
    (await unknownBasontaIds(databases, effectiveBacentaIds)).length > 0
  ) {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'One of those basontas no longer exists. Reload and try again.' },
      { status: 400 },
    )
  }

  /**
   * The care link, checked against the OTHER members before it is written.
   *
   * Everything that makes an assignment wrong needs the rest of the bacenta to
   * see — an inactive carer, one from another place, or one whose own chain
   * comes back round to this member. `careAssignmentProblem` is pure and
   * unit-tested; this is the only place that gives it the data.
   *
   * The bacenta being checked against is the one the member ENDS UP in, so a
   * request that moves them and assigns a carer in the same PATCH is judged on
   * the destination rather than on where they used to live.
   */
  if ('care_of_member_id' in fields) {
    const carerId = fields.care_of_member_id as string | null
    const destination =
      'bacenta_id' in fields
        ? (fields.bacenta_id as string | null)
        : current.member.bacenta_id

    if (carerId !== null && destination === null) {
      return NextResponse.json<MemberResponse>(
        {
          ok: false,
          error:
            'Put this member in a bacenta first — being looked after is something ' +
            'that happens inside one.',
        },
        { status: 400 },
      )
    }

    if (carerId !== null && destination !== null) {
      const candidates = await careCandidates(databases, destination)
      const index = new Map(candidates.map((c) => [c.$id, c]))
      // The member may not be in `destination` yet, so their own row is put in
      // with the bacenta they are moving to — otherwise the check reads them as
      // belonging nowhere and refuses a perfectly good assignment.
      index.set(id, {
        $id: id,
        full_name: fullName(current.member),
        status: current.member.status,
        bacenta_id: destination,
        care_of_member_id: current.member.care_of_member_id,
      })
      const problem = careAssignmentProblem(id, carerId, index)
      if (problem) {
        return NextResponse.json<MemberResponse>({ ok: false, error: problem }, { status: 400 })
      }
    }
  }

  try {
    const member =
      Object.keys(fields).length > 0
        ? await updateMember(databases, id, fields)
        : memberDocToMember(
            (await databases.getDocument(DATABASE_ID, COLLECTIONS.members, id)) as Models.Document &
              Record<string, unknown>,
          )
    if (effectiveBacentaIds !== undefined) {
      await setMemberBasontas(databases, id, effectiveBacentaIds, auth.user.email)
    }
    // A member flipped to `inactive` must drop out of the matcher's gallery
    // immediately, not at the next 60s cache expiry.
    if ('status' in fields) invalidateCandidateCache()
    return NextResponse.json<MemberResponse>({
      ok: true,
      member,
      basonta_ids: effectiveBacentaIds ?? (await basontaIdsForMember(databases, id)),
    })
  } catch {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'No such member.' },
      { status: 404 },
    )
  }
}

/**
 * Hard delete, with the manual cascade Appwrite does not provide.
 *
 * This destroys attendance history. The UI asks twice and suggests marking the
 * member inactive instead, which is almost always what is actually wanted.
 */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()
  try {
    const removed = await deleteMemberCascade(databases, id)
    invalidateCandidateCache()
    return NextResponse.json({ ok: true, removed })
  } catch {
    return NextResponse.json({ ok: false, error: 'No such member.' }, { status: 404 })
  }
}
