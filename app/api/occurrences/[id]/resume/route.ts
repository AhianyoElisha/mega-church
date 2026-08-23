import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { resumeOccurrence } from '@/lib/attendance/server'
import type { PauseResumeResponse } from '@/lib/meetings/types'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/occurrences/[id]/resume — put a paused session back on the scanner.
 *
 * A 409 with the blocking session attached when something else is open, for the
 * same reason activate does it: "End the committee meeting before resuming
 * First Service" is actionable, "cannot resume" sends an admin hunting.
 */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()
  const result = await resumeOccurrence(databases, id, auth.user.email)

  if (!result.ok) {
    return NextResponse.json<PauseResumeResponse>(result, {
      status: result.conflict ? 409 : 400,
    })
  }
  return NextResponse.json<PauseResumeResponse>(result)
}
