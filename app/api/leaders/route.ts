import { NextResponse } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { createLeaderAccount, listLeaderAccounts } from '@/lib/groups/heads'
import { listBacentas, listBasontas, listConstituencies } from '@/lib/groups/server'
import type {
  CreateLeaderResponse,
  GroupKind,
  ListLeadersResponse,
} from '@/lib/groups/types'

/**
 * GET /api/leaders — accounts that can be appointed head of a group.
 *
 * Admin only, and not merely for tidiness: this enumerates real user accounts
 * with their email addresses, which is exactly the list nobody below admin
 * should be able to page through.
 *
 * Each row carries what that person already heads, so an admin can see at a
 * glance that Kwame runs Ahodwo and the Technical Team before handing him a
 * third. Heading two things is normal and supported; heading six usually means
 * the wrong name was picked twice.
 */
export async function GET() {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { databases, users } = createAdminClient()
  const [constituencies, bacentas, basontas] = await Promise.all([
    listConstituencies(databases),
    listBacentas(databases),
    listBasontas(databases),
  ])

  const heldBy = new Map<string, { kind: GroupKind; name: string }[]>()
  const note = (userId: string | null, kind: GroupKind, name: string) => {
    if (!userId) return
    heldBy.set(userId, [...(heldBy.get(userId) ?? []), { kind, name }])
  }
  for (const c of constituencies) note(c.head_user_id, 'constituency', c.name)
  for (const b of bacentas) note(b.head_user_id, 'bacenta', b.name)
  // Basonta headships count towards the same load. The warning this list feeds
  // is "heading six usually means the wrong name was picked twice", and it
  // stops being true the moment a whole kind of group is left out of the tally.
  for (const b of basontas) note(b.head_user_id, 'basonta', b.name)

  const leaders = await listLeaderAccounts(users, heldBy)
  return NextResponse.json<ListLeadersResponse>(
    { ok: true, leaders },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

/**
 * POST /api/leaders — create a login for somebody about to be made a head.
 *
 * Appointing a head and giving that head a way to sign in are one job to the
 * person doing it, and splitting them across this app and the Appwrite console
 * is what made the whole feature look missing: a church that had never opened
 * the console saw an empty Head dropdown and reasonably concluded there was no
 * way to add a head at all.
 *
 * The new account carries exactly the `leader` label. It heads nothing yet —
 * that is a separate, deliberate act on the group's own page, and a leader who
 * heads nothing sees empty lists rather than a 403 (PRD §5.1).
 */
export async function POST(request: Request) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  let body: { name?: unknown; email?: unknown; password?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json<CreateLeaderResponse>(
      { ok: false, error: 'Send a JSON body.' },
      { status: 400 },
    )
  }

  if (typeof body.name !== 'string' || typeof body.email !== 'string') {
    return NextResponse.json<CreateLeaderResponse>(
      { ok: false, error: 'A name and an email address are both required.' },
      { status: 400 },
    )
  }

  const { users } = createAdminClient()
  const created = await createLeaderAccount(users, {
    name: body.name,
    email: body.email,
    password: typeof body.password === 'string' ? body.password : null,
  })

  if (!created.ok) {
    // 409 for a duplicate email so the client can tell "already exists" from
    // "you typed something wrong" without parsing the message.
    const status = created.error.startsWith('An account already exists') ? 409 : 400
    return NextResponse.json<CreateLeaderResponse>(
      { ok: false, error: created.error },
      { status },
    )
  }

  return NextResponse.json<CreateLeaderResponse>(
    {
      ok: true,
      leader: { id: created.id, name: created.name, email: created.email, heads: [] },
      password: created.password,
    },
    { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
  )
}
