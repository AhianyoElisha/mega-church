import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { setLeaderPassword } from '@/lib/groups/heads'
import type { SetLeaderPasswordResponse } from '@/lib/groups/types'

type Ctx = { params: Promise<{ id: string }> }

/**
 * PATCH /api/leaders/[id] — give a group head a new password.
 *
 * Admin only, and only for accounts carrying the `leader` label — see
 * `setLeaderPassword`, where that restriction is enforced and explained.
 *
 * Send `{ "password": "…" }` to set a chosen one, or omit it to have a readable
 * one generated. Either way the value comes back exactly once and is never
 * stored: this app has no reset flow, so the string in the response is the only
 * copy that will ever exist.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  let body: { password?: unknown } = {}
  try {
    // An empty body is legitimate and means "generate one for me", so a parse
    // failure is tolerated rather than refused.
    body = (await request.json()) as typeof body
  } catch {
    body = {}
  }

  if (body.password !== undefined && body.password !== null && typeof body.password !== 'string') {
    return NextResponse.json<SetLeaderPasswordResponse>(
      { ok: false, error: 'password must be a string.' },
      { status: 400 },
    )
  }

  const { users } = createAdminClient()
  const result = await setLeaderPassword(users, id, (body.password as string | null) ?? null)

  if (!result.ok) {
    return NextResponse.json<SetLeaderPasswordResponse>(
      { ok: false, error: result.error },
      { status: result.status },
    )
  }

  return NextResponse.json<SetLeaderPasswordResponse>(
    { ok: true, name: result.name, email: result.email, password: result.password },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
