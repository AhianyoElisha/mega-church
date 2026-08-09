import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID, FINGER_LABELS, type FingerLabel } from '@/lib/appwrite/config'
import { decodeXytTemplate } from '@/lib/biometrics/codec'
import {
  MAX_TEMPLATES_PER_ENROLL,
  listTemplatesForMember,
  storeTemplates,
} from '@/lib/biometrics/server'
import { fullName } from '@/lib/members/types'
import { memberDocToMember } from '@/lib/attendance/server'
import type { EnrollRequest, EnrollResponse } from '@/lib/biometrics/types'
import type { Models } from 'node-appwrite'

/**
 * POST /api/biometrics/enroll — store one finger's three presses.
 *
 * Enrolment is per FINGER, not per member, so re-doing a thumb that never
 * reads well does not wipe the other three fingers. Templates only; the raw
 * image never leaves the machine that captured it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  let body: Partial<EnrollRequest>
  try {
    body = (await request.json()) as Partial<EnrollRequest>
  } catch {
    return NextResponse.json<EnrollResponse>(
      { ok: false, error: 'Invalid request body.' },
      { status: 400 },
    )
  }

  const member_id = typeof body.member_id === 'string' ? body.member_id.trim() : ''
  if (!member_id) {
    return NextResponse.json<EnrollResponse>(
      { ok: false, error: 'member_id is required.' },
      { status: 400 },
    )
  }

  const finger_label = body.finger_label as FingerLabel
  if (!FINGER_LABELS.includes(finger_label)) {
    return NextResponse.json<EnrollResponse>(
      { ok: false, error: `finger_label must be one of: ${FINGER_LABELS.join(', ')}.` },
      { status: 400 },
    )
  }

  const templates = Array.isArray(body.templates) ? body.templates : []
  // Validate the payloads here as well as in the store — a malformed template
  // that reaches the database is a member who silently cannot be identified.
  const valid = templates.filter(
    (t): t is string => typeof t === 'string' && decodeXytTemplate(t) !== null,
  )
  if (valid.length === 0) {
    return NextResponse.json<EnrollResponse>(
      { ok: false, error: 'No usable fingerprint captures in that request.' },
      { status: 400 },
    )
  }
  if (valid.length > MAX_TEMPLATES_PER_ENROLL) {
    return NextResponse.json<EnrollResponse>(
      { ok: false, error: `Send at most ${MAX_TEMPLATES_PER_ENROLL} captures per finger.` },
      { status: 400 },
    )
  }

  const { databases } = createAdminClient()

  let full_name: string
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTIONS.members, member_id)
    full_name = fullName(memberDocToMember(doc as Models.Document & Record<string, unknown>))
  } catch {
    return NextResponse.json<EnrollResponse>(
      { ok: false, error: 'No such member.' },
      { status: 404 },
    )
  }

  const { created, deleted } = await storeTemplates(databases, {
    member_id,
    finger_label,
    templates: valid,
    // Replacing is the default: capturing a finger again means the earlier
    // attempt was unsatisfactory, and keeping both would leave the bad one in
    // the gallery forever.
    replace: body.replace !== false,
    created_by: auth.user.email,
  })

  const all = await listTemplatesForMember(databases, member_id)

  return NextResponse.json<EnrollResponse>(
    {
      ok: true,
      member_id,
      full_name,
      finger_label,
      created,
      deleted,
      total_templates: all.length,
    },
    { status: 201 },
  )
}
