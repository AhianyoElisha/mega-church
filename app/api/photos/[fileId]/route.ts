import { NextResponse, type NextRequest } from 'next/server'
import { AppwriteException } from 'node-appwrite'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { BUCKETS, USER_LABELS } from '@/lib/appwrite/config'

type Ctx = { params: Promise<{ fileId: string }> }

/**
 * An Appwrite id: up to 36 characters of `a-z A-Z 0-9 . - _`, not starting
 * with a special character. Checked before Storage is asked so a garbage path
 * costs a 400 here and not a round-trip that comes back as a confusing error
 * from the SDK.
 */
const FILE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/

/** What the upload route stores; only used if Storage reports no mime. */
const FALLBACK_MIME = 'image/jpeg'

/**
 * A file id is never reused: replacing a photo uploads a NEW file and deletes
 * the old one, so this URL is in effect a content hash and may be cached for as
 * long as the browser likes. `private` because the body is a person's face
 * behind a session — a shared cache must not hand it to the next visitor.
 */
const CACHE_CONTROL = 'private, max-age=31536000, immutable'

/**
 * GET /api/photos/[fileId] — a member's photo, for an `<img>`.
 *
 * Every signed-in label may load one. The kiosk needs the photo on its result
 * card (PRD §2.4), ushers and heads need it on rosters, and a shepherd reads
 * everything — there is no label for whom the face is off limits while the
 * name beside it is not. Not signed in is a 401, which the `<img>` renders as
 * its `onError` fallback (see `shared/Avatar.tsx`).
 *
 * The file is fetched through the admin client because the bucket grants read
 * to `Role.users()` and the browser cannot present a session to Storage — see
 * `lib/members/photo.ts`. The check that matters happened in `requireRole`.
 */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(Object.values(USER_LABELS))
  if ('error' in auth) return auth.error

  const { fileId } = await params
  if (!FILE_ID_RE.test(fileId)) {
    return NextResponse.json({ ok: false, error: 'Not a valid file id.' }, { status: 400 })
  }

  const { storage } = createAdminClient()
  try {
    // Metadata and bytes in parallel; the metadata is only for the mime.
    const [meta, bytes] = await Promise.all([
      storage.getFile(BUCKETS.member_photos, fileId),
      storage.getFileView(BUCKETS.member_photos, fileId),
    ])
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': meta.mimeType || FALLBACK_MIME,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': CACHE_CONTROL,
        // The body is an image chosen by whoever uploaded it; never let a
        // browser second-guess the type into something it would execute.
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    if (e instanceof AppwriteException && e.code === 404) {
      return NextResponse.json({ ok: false, error: 'No such photo.' }, { status: 404 })
    }
    // Storage down or refusing: the avatar falls back to initials, and the
    // status says it was not the id that was wrong.
    return NextResponse.json({ ok: false, error: 'Photo storage did not respond.' }, { status: 502 })
  }
}
