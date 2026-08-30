import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  createMeeting,
  lastHeldByMeeting,
  listMeetings,
  rosterSizes,
  setRoster,
} from '@/lib/meetings/server'
import type { ListMeetingsResponse, MeetingDetailResponse } from '@/lib/meetings/types'

// GET /api/meetings — every meeting, with roster size and when it last ran.
export async function GET() {
  const auth = await requireRole(['admin', 'shepherd', 'treasurer'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  const [meetings, sizes, lastHeld] = await Promise.all([
    listMeetings(databases),
    rosterSizes(databases),
    lastHeldByMeeting(databases),
  ])

  return NextResponse.json<ListMeetingsResponse>(
    {
      ok: true,
      meetings: meetings.map((m) => ({
        ...m,
        roster_size: sizes.get(m.$id) ?? 0,
        last_held: lastHeld.get(m.$id) ?? null,
      })),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

// POST /api/meetings — create a meeting and persist the ticked roster in one
// request, so a half-created meeting with no authorised members cannot exist.
export async function POST(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  let body: { name?: unknown; description?: unknown; member_ids?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json<MeetingDetailResponse>(
      { ok: false, error: 'Invalid request body.' },
      { status: 400 },
    )
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json<MeetingDetailResponse>(
      { ok: false, error: 'Give the meeting a name.' },
      { status: 400 },
    )
  }
  if (name.length > 96) {
    return NextResponse.json<MeetingDetailResponse>(
      { ok: false, error: 'That name is too long (max 96 characters).' },
      { status: 400 },
    )
  }

  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 512) : null

  const memberIds = Array.isArray(body.member_ids)
    ? [...new Set(body.member_ids.filter((v): v is string => typeof v === 'string' && !!v))]
    : []

  const { databases } = createAdminClient()
  const meeting = await createMeeting(databases, { name, description }, auth.user.email)

  if (memberIds.length > 0) {
    await setRoster(databases, meeting.$id, memberIds, auth.user.email)
  }

  return NextResponse.json<MeetingDetailResponse>(
    { ok: true, meeting, member_ids: memberIds },
    { status: 201 },
  )
}
