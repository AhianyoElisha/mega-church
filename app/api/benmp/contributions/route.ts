import { NextResponse, type NextRequest } from 'next/server'
import type { Models } from 'node-appwrite'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import { listMembers } from '@/lib/members/server'
import { memberDocToMember } from '@/lib/attendance/server'
import { leaderScope } from '@/lib/groups/server'
import {
  contributionsForYear,
  recordContribution,
  unrecordContribution,
} from '@/lib/benmp/server'
import { currentPeriod, currentYear, isPeriod, parsePeriod } from '@/lib/benmp/period'
import { isPartner, summarise } from '@/lib/benmp/unpaid'
import type { Member } from '@/lib/members/types'

/**
 * The BENMP year grid, and the tick that fills it in.
 *
 * ## Who
 *
 * Reading: admin, treasurer, shepherd and leader. A shepherd reads the whole
 * church and writes nothing, which falls out of appearing on the GET only.
 *
 * Writing: admin, treasurer, and a constituency head for their OWN members.
 * The treasurer is the point of the feature — dues are money and money is
 * theirs — and the head is who is standing in front of the partner handing it
 * over. An usher is absent from both: they work the door, not the ledger.
 *
 * ## Scope
 *
 * A leader sees and records only partners in constituencies they head, resolved
 * per request from `leaderScope()` and never from anything the client sent. A
 * bacenta or basonta head is not enough: `benmp_partner` is a constituency-tier
 * fact already (it sits with `status` in `headEditScope`), and being able to
 * record somebody's money is not a lesser act than being able to correct their
 * phone number.
 */

type ContributionsResponse =
  | {
      ok: true
      year: number
      current_period: string
      /*
       * The NAME PARTS, not a composed `full_name`.
       *
       * `matchesMemberSearch` takes the parts, and the grid's search box has to
       * behave the way search behaves on every other page — a church that types
       * a surname on the registry and gets a hit expects the same here. The
       * display name is composed client-side with the same `fullName()` helper
       * the rest of the app uses, so there is one definition of how a name is
       * put together rather than two that can drift.
       */
      partners: {
        $id: string
        first_name: string
        last_name: string
        other_names: string | null
        member_no: string | null
        constituency_id: string | null
      }[]
      contributions: { member_id: string; period: string }[]
      summary: { partners: number; paid: number; outstanding: number }
      /** False for a leader, whose grid is one constituency's worth. */
      whole_church: boolean
    }
  | { ok: false; error: string }

function bad(error: string, status = 400) {
  return NextResponse.json<ContributionsResponse>({ ok: false, error }, { status })
}

/**
 * The partners this account may see.
 *
 * `wholeChurch` is the flag, not an empty list: a leader who heads no
 * constituency gets `[]` with `wholeChurch: false`, and that is a real state —
 * somebody appointed nowhere yet — rather than an error. Reading an empty list
 * as "no filter applied" is how they would be handed the whole congregation.
 */
async function visiblePartners(
  databases: ReturnType<typeof createAdminClient>['databases'],
  label: string,
  userId: string,
): Promise<{ members: Member[]; wholeChurch: boolean }> {
  const all = await listMembers(databases, { status: 'active' })
  const partners = all.filter(isPartner)
  if (label !== 'leader') return { members: partners, wholeChurch: true }

  const scope = await leaderScope(databases, userId)
  const mine = new Set(scope.constituencies.map((c) => c.$id))
  return {
    members: partners.filter((m) => m.constituency_id !== null && mine.has(m.constituency_id)),
    wholeChurch: false,
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'treasurer', 'shepherd', 'leader'])
  if ('error' in auth) return auth.error

  const raw = request.nextUrl.searchParams.get('year')
  const year = raw === null ? currentYear() : Number(raw)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return bad('That is not a year.')
  }

  const { databases } = createAdminClient()
  const [{ members, wholeChurch }, rows] = await Promise.all([
    visiblePartners(databases, auth.user.label, auth.user.id),
    contributionsForYear(databases, year),
  ])

  // The grid renders only these members, so the rows are narrowed to match.
  // Sending a leader every contribution in the church would leak who else pays
  // through a payload nobody looks at.
  const visible = new Set(members.map((m) => m.$id))
  const contributions = rows
    .filter((r) => visible.has(r.member_id))
    .map((r) => ({ member_id: r.member_id, period: r.period }))

  const period = currentPeriod()
  return NextResponse.json<ContributionsResponse>(
    {
      ok: true,
      year,
      current_period: period,
      partners: members.map((m) => ({
        $id: m.$id,
        first_name: m.first_name,
        last_name: m.last_name,
        other_names: m.other_names,
        member_no: m.member_no,
        constituency_id: m.constituency_id,
      })),
      contributions,
      // Summarised over the SAME population the caller can see, so a head's
      // "18 outstanding" means eighteen of theirs and not eighteen church-wide.
      summary: summarise(members, contributions, period),
      whole_church: wholeChurch,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

/**
 * Tick or untick one (member, month).
 *
 * A single toggle endpoint rather than POST-to-record and DELETE-to-undo,
 * because the gesture in the UI is one thing — a cell that is on or off — and
 * two endpoints for one gesture is two places for the scope check to drift.
 *
 * `paid: false` DELETES the row rather than writing a false, because absence is
 * how this collection spells "not paid" and a second spelling is a second thing
 * that can disagree with the first.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'treasurer', 'leader'])
  if ('error' in auth) return auth.error

  let body: { member_id?: unknown; period?: unknown; paid?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return bad('Invalid request body.')
  }

  if (typeof body.member_id !== 'string' || body.member_id.length === 0) {
    return bad('member_id is required.')
  }
  if (typeof body.period !== 'string' || !isPeriod(body.period)) {
    return bad('period must be a month, like 2026-09.')
  }
  // Refused rather than coerced, the same posture as `benmp_partner` itself:
  // the string "false" is truthy, and coercing it records a payment nobody made.
  if (typeof body.paid !== 'boolean') {
    return bad('paid must be true or false.')
  }

  /*
   * A month that has not happened yet cannot have been paid.
   *
   * This is not pedantry: the grid renders all twelve cells of the year, so
   * December is on screen and one row above the mouse in January. A tick there
   * would quietly excuse somebody from a reminder eleven months early, and
   * nothing on the page would look wrong.
   */
  const period = body.period
  if (body.paid && period > currentPeriod()) {
    return bad('That month has not started yet.')
  }
  if (parsePeriod(period)!.year < 2000) return bad('That is not a month.')

  const { databases } = createAdminClient()

  /*
   * ONE member is fetched, not the registry.
   *
   * This used to call `visiblePartners()`, which lists every active member in
   * the church and filters — to answer a question about a single person. That
   * made recording one tick take **1,908 ms**, measured in the browser against
   * the live project. A treasurer entering a month's takings pays that per
   * click, and the screen exists to be clicked fifty times in a sitting.
   *
   * The GET above still reads the whole registry, and should: it renders every
   * partner. A write does not.
   */
  let target: Member | null = null
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.members, body.member_id)
    target = memberDocToMember(doc as Models.Document & Record<string, unknown>)
  } catch {
    target = null
  }

  // Same three conditions `visiblePartners` applied, checked directly on the
  // one row: a partner, active, and — for a head — inside their own
  // constituency. Order does not matter because all three answer alike below.
  let allowed = target !== null && isPartner(target) && target.status === 'active'
  if (allowed && auth.user.label === 'leader') {
    const scope = await leaderScope(databases, auth.user.id)
    const mine = new Set(scope.constituencies.map((c) => c.$id))
    allowed = target!.constituency_id !== null && mine.has(target!.constituency_id)
  }

  if (!allowed || !target) {
    /*
     * One message for three different refusals — not in scope, not a partner,
     * not active — and deliberately so. Distinguishing them would tell a head
     * whether somebody outside their constituency exists, and the fix for all
     * three is the same conversation with an administrator.
     */
    return NextResponse.json<ContributionsResponse>(
      {
        ok: false,
        error:
          'That member is not a BENMP partner you can record for. ' +
          'An administrator or their constituency head can tick them as a partner first.',
      },
      { status: 403 },
    )
  }

  const outcome = body.paid
    ? await recordContribution(databases, target.$id, period, auth.user.email)
    : await unrecordContribution(databases, target.$id, period)

  if (!outcome.ok) return bad(outcome.error, outcome.status)
  return NextResponse.json({ ok: true, changed: outcome.changed, paid: body.paid })
}
