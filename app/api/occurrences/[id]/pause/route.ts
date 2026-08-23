import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { pauseOccurrence } from '@/lib/attendance/server'
import type { PauseResumeResponse } from '@/lib/meetings/types'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/occurrences/[id]/pause — stop the scanner without ending the session.
 *
 * Distinct from close in the one way that matters: nothing is frozen. The tally
 * is still computed from the rows when the session finally ends, so attendance
 * marked before the pause and after the resume belongs to the SAME occurrence
 * and is counted once. Closing and re-activating would give the church two
 * half-counts of one service and no way to add them up afterwards.
 */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()
  const result = await pauseOccurrence(databases, id, auth.user.email)

  if (!result.ok) {
    return NextResponse.json<PauseResumeResponse>(result, { status: 400 })
  }
  return NextResponse.json<PauseResumeResponse>(result)
}
