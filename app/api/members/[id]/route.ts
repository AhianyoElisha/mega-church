import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { deleteMemberCascade, updateMember, validateMemberInput } from '@/lib/members/server'
import { memberDocToMember } from '@/lib/attendance/server'
import { invalidateCandidateCache } from '@/lib/biometrics/server'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import type { MemberResponse } from '@/lib/members/types'
import type { Models } from 'node-appwrite'

// Next 16: route params are async.
type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(['admin', 'usher'])
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.members, id)
    return NextResponse.json<MemberResponse>({
      ok: true,
      member: memberDocToMember(doc as Models.Document & Record<string, unknown>),
    })
  } catch {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'No such member.' },
      { status: 404 },
    )
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

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
  if (Object.keys(validated.value).length === 0) {
    return NextResponse.json<MemberResponse>(
      { ok: false, error: 'Nothing to update.' },
      { status: 400 },
    )
  }

  const { databases } = createAdminClient()
  try {
    const member = await updateMember(databases, id, validated.value)
    // A member flipped to `inactive` must drop out of the matcher's gallery
    // immediately, not at the next 60s cache expiry.
    if ('status' in validated.value) invalidateCandidateCache()
    return NextResponse.json<MemberResponse>({ ok: true, member })
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
