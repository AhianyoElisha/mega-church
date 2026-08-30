import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  deleteMeetingCascade,
  getMeeting,
  getRoster,
  isProtected,
  setRoster,
} from '@/lib/meetings/server'
import { meetingDocToMeeting } from '@/lib/attendance/server'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import type { MeetingDetailResponse } from '@/lib/meetings/types'
import type { Models } from 'node-appwrite'

type Ctx = { params: Promise<{ id: string }> }

// GET — the meeting plus its authorised roster, so the editor opens with the
// right boxes already ticked. This is what makes a meeting reusable without
// re-selecting anybody (PRD §1.4).
export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(['admin', 'shepherd', 'treasurer'])
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()

  const meeting = await getMeeting(databases, id)
  if (!meeting) {
    return NextResponse.json<MeetingDetailResponse>(
      { ok: false, error: 'No such meeting.' },
      { status: 404 },
    )
  }

  return NextResponse.json<MeetingDetailResponse>({
    ok: true,
    meeting,
    member_ids: await getRoster(databases, id),
  })
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  let body: {
    name?: unknown
    description?: unknown
    member_ids?: unknown
    archived?: unknown
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json<MeetingDetailResponse>(
      { ok: false, error: 'Invalid request body.' },
      { status: 400 },
    )
  }

  const { databases } = createAdminClient()
  const existing = await getMeeting(databases, id)
  if (!existing) {
    return NextResponse.json<MeetingDetailResponse>(
      { ok: false, error: 'No such meeting.' },
      { status: 404 },
    )
  }

  const fields: Record<string, unknown> = {}

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) {
      return NextResponse.json<MeetingDetailResponse>(
        { ok: false, error: 'A meeting needs a name.' },
        { status: 400 },
      )
    }
    // The two services may be renamed (a church may call the first one
    // something else) but not turned into something they are not.
    fields.name = name.slice(0, 96)
  }
  if (body.description !== undefined) {
    fields.description =
      typeof body.description === 'string' ? body.description.trim().slice(0, 512) || null : null
  }
  if (typeof body.archived === 'boolean') {
    if (isProtected(id) && body.archived) {
      return NextResponse.json<MeetingDetailResponse>(
        { ok: false, error: 'The two services cannot be archived.' },
        { status: 400 },
      )
    }
    fields.archived = body.archived
  }

  let meeting = existing
  if (Object.keys(fields).length > 0) {
    const doc = await databases.updateDocument(DATABASE_ID, COLLECTIONS.meetings, id, fields)
    meeting = meetingDocToMeeting(doc as Models.Document & Record<string, unknown>)
  }

  // Roster edits. `member_ids` absent means "leave the roster alone"; an empty
  // ARRAY means "clear it", which is a different and deliberate instruction.
  if (Array.isArray(body.member_ids)) {
    if (isProtected(id)) {
      // A roster on a service would gate it, and the services are open to every
      // active member by design (PRD §2.1).
      return NextResponse.json<MeetingDetailResponse>(
        {
          ok: false,
          error:
            'The services are open to every member, so they do not have a roster. ' +
            'Restrict a meeting instead.',
        },
        { status: 400 },
      )
    }
    const ids = [
      ...new Set(body.member_ids.filter((v): v is string => typeof v === 'string' && !!v)),
    ]
    await setRoster(databases, id, ids, auth.user.email)
  }

  return NextResponse.json<MeetingDetailResponse>({
    ok: true,
    meeting,
    member_ids: await getRoster(databases, id),
  })
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()
  const res = await deleteMeetingCascade(databases, id)
  if (!res.ok) return NextResponse.json(res, { status: 400 })
  return NextResponse.json({ ok: true })
}
