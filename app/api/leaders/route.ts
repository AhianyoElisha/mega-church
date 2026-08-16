import { NextResponse } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { listLeaderAccounts } from '@/lib/groups/heads'
import { listBacentas, listConstituencies } from '@/lib/groups/server'
import type { GroupKind, ListLeadersResponse } from '@/lib/groups/types'

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
  const [constituencies, bacentas] = await Promise.all([
    listConstituencies(databases),
    listBacentas(databases),
  ])

  const heldBy = new Map<string, { kind: GroupKind; name: string }[]>()
  const note = (userId: string | null, kind: GroupKind, name: string) => {
    if (!userId) return
    heldBy.set(userId, [...(heldBy.get(userId) ?? []), { kind, name }])
  }
  for (const c of constituencies) note(c.head_user_id, 'constituency', c.name)
  for (const b of bacentas) note(b.head_user_id, 'bacenta', b.name)

  const leaders = await listLeaderAccounts(users, heldBy)
  return NextResponse.json<ListLeadersResponse>(
    { ok: true, leaders },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
