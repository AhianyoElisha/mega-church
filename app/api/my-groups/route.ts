import { NextResponse } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  bacentaCounts,
  basontaCounts,
  constituencyCounts,
  leaderScope,
  listBacentasWithCounts,
  listBasontaCategories,
  listBasontasWithCounts,
  listConstituencies,
  listConstituenciesWithCounts,
} from '@/lib/groups/server'
import type { MyGroupsResponse } from '@/lib/groups/types'

/**
 * GET /api/my-groups — the groups the signed-in account is responsible for.
 *
 * One route serving two roles, which is what lets one page render both:
 *
 *   leader  exactly the constituencies and bacentas naming them as head. The
 *           scope is resolved from the database per request, never from
 *           anything the client sent — a head cannot ask for someone else's
 *           bacenta by putting its id in a query string, because the id is
 *           never read from the request at all.
 *   admin   everything, so the same screen doubles as an overview.
 *
 * A leader who heads a constituency AND a bacenta gets both lists populated.
 * That is the case the single `leader` label exists for: one login, and the
 * page offers a switch between the two kinds of data rather than two accounts.
 *
 * Returning empty lists is a legitimate answer, not an error — it means an
 * account was created before anybody was appointed to anything, and the page
 * says so. A 403 there would look like a broken login.
 */
export async function GET() {
  const auth = await requireRole(['admin', 'leader', 'shepherd'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()

  // A shepherd sees every group, exactly as an admin does — the difference
  // between them is what they may WRITE, and this route writes nothing.
  if (auth.user.label === 'admin' || auth.user.label === 'shepherd') {
    const [constituencies, bacentas, basontas] = await Promise.all([
      listConstituenciesWithCounts(databases),
      listBacentasWithCounts(databases),
      listBasontasWithCounts(databases),
    ])
    return NextResponse.json<MyGroupsResponse>(
      { ok: true, constituencies, bacentas, basontas },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  const [scope, cCounts, bCounts, sCounts, allConstituencies, basontaCategories] = await Promise.all([
    leaderScope(databases, auth.user.id),
    constituencyCounts(databases),
    bacentaCounts(databases),
    basontaCounts(databases),
    listConstituencies(databases),
    listBasontaCategories(databases),
  ])
  const constituencyNames = new Map(allConstituencies.map((c) => [c.$id, c.name]))
  const basontaCatNames = new Map(basontaCategories.map((c) => [c.$id, c.name]))

  return NextResponse.json<MyGroupsResponse>(
    {
      ok: true,
      constituencies: scope.constituencies.map((c) => ({
        ...c,
        member_count: cCounts.get(c.$id) ?? 0,
      })),
      bacentas: scope.bacentas.map((b) => ({
        ...b,
        member_count: bCounts.get(b.$id) ?? 0,
        constituency_name: b.constituency_id
          ? (constituencyNames.get(b.constituency_id) ?? null)
          : null,
      })),
      basontas: scope.basontas.map((b) => ({
        ...b,
        member_count: sCounts.get(b.$id) ?? 0,
        category_name: b.category_id ? (basontaCatNames.get(b.category_id) ?? null) : null,
      })),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
