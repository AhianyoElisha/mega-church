import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { closeOccurrence } from '@/lib/attendance/server'
import type { CloseOccurrenceResponse } from '@/lib/meetings/types'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/occurrences/[id]/close — end a session.
 *
 * Closing freezes the tally onto the occurrence and, because at most one thing
 * is open at a time, is what unblocks activating the next one.
 */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()
  const result = await closeOccurrence(databases, id, auth.user.email)

  if (!result.ok) {
    return NextResponse.json<CloseOccurrenceResponse>(result, { status: 400 })
  }
  return NextResponse.json<CloseOccurrenceResponse>(result)
}
