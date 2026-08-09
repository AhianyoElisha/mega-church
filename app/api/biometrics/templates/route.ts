import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { FINGER_LABELS, type FingerLabel } from '@/lib/appwrite/config'
import {
  deleteTemplatesForFinger,
  deleteTemplatesForMember,
  listEnrolledSummaries,
  listTemplatesForMember,
  toMeta,
} from '@/lib/biometrics/server'

/**
 * GET /api/biometrics/templates[?member_id=…]
 *
 * Returns METADATA ONLY — never a template payload. The enrolment UI needs to
 * know which fingers are done and how many minutiae each capture found; it has
 * no use for the minutiae themselves, and shipping them to a browser would put
 * biometric data somewhere it has no reason to be.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  const memberId = request.nextUrl.searchParams.get('member_id')

  if (memberId) {
    const docs = await listTemplatesForMember(databases, memberId.trim())
    return NextResponse.json({ ok: true, templates: docs.map(toMeta) })
  }
  return NextResponse.json({ ok: true, members: await listEnrolledSummaries(databases) })
}

/**
 * DELETE /api/biometrics/templates?member_id=…[&finger_label=…]
 *
 * With a finger, clears just that finger so it can be re-taken. Without one,
 * clears the member's whole enrolment.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const memberId = request.nextUrl.searchParams.get('member_id')?.trim()
  if (!memberId) {
    return NextResponse.json(
      { ok: false, error: 'member_id query parameter is required.' },
      { status: 400 },
    )
  }

  const finger = request.nextUrl.searchParams.get('finger_label') as FingerLabel | null
  if (finger && !FINGER_LABELS.includes(finger)) {
    return NextResponse.json(
      { ok: false, error: `finger_label must be one of: ${FINGER_LABELS.join(', ')}.` },
      { status: 400 },
    )
  }

  const { databases } = createAdminClient()
  const deleted = finger
    ? await deleteTemplatesForFinger(databases, memberId, finger)
    : await deleteTemplatesForMember(databases, memberId)

  return NextResponse.json({ ok: true, deleted })
}
