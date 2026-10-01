import { NextResponse, type NextRequest } from 'next/server'
import { ID } from 'node-appwrite'
import sharp from 'sharp'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { canReadGroup } from '@/lib/groups/server'
import { BUCKETS, COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'

type Ctx = { params: Promise<{ id: string }> }

/** Cap on what is ACCEPTED, not what is stored — the stored file is far smaller. */
const MAX_BYTES = 5 * 1024 * 1024
/**
 * What sharp is asked to decode. The cropper always sends JPEG, so this list
 * only matters for a client that bypasses it; kept narrow so an iPhone HEIC —
 * which this sharp build cannot decode — is refused by name rather than by a
 * decoder error that reads like the server broke.
 */
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

/**
 * Every stored photo is the same shape: an EXIF-upright 800x800 JPEG.
 *
 * Normalising here rather than trusting the client means a phone JPEG that
 * arrives sideways (orientation only in EXIF, which `<img>` honours and the
 * kiosk canvas does not) is rotated for real; a 12-megapixel original does not
 * become a 4 MB download on a tablet over church wifi; and whatever mime the
 * client claimed, what is stored is what sharp actually decoded.
 */
const OUTPUT_SIDE = 800
const OUTPUT_QUALITY = 85
const OUTPUT_NAME = 'photo.jpg'
const OUTPUT_MIME = 'image/jpeg'

/**
 * POST /api/members/[id]/photo — replace a member's profile photo.
 *
 * The photo is not decoration: it is what an usher checks a face against on the
 * kiosk confirmation card before committing a manual check-in (PRD §2.4).
 *
 * A constituency HEAD may set it, for a member who lives in a constituency they
 * head. That follows from letting them register: the photo is taken at the desk
 * where the person is standing, and a registration flow that has to stop and
 * wait for an admin to attach the face is one that produces members with no
 * photo. The scope check is `canReadGroup` on the member's OWN constituency —
 * the same call every other group read goes through — so a head cannot re-photo
 * a neighbour's member by putting their id in the URL.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const auth = await requireRole(['admin', 'leader'])
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases, storage } = createAdminClient()

  // Confirm the member exists BEFORE uploading, so a typo'd id cannot leave an
  // orphaned file in the bucket.
  let previousFileId: string | null = null
  let memberConstituencyId: string | null = null
  try {
    const doc = (await databases.getDocument(DATABASE_ID, COLLECTIONS.members, id)) as {
      photo_file_id?: string | null
      constituency_id?: string | null
    }
    previousFileId = doc.photo_file_id ?? null
    // Appwrite hands back an unset optional string as '', which is not a group.
    memberConstituencyId = doc.constituency_id || null
  } catch {
    return NextResponse.json({ ok: false, error: 'No such member.' }, { status: 404 })
  }

  if (auth.user.label !== 'admin') {
    // A member with no constituency belongs to no head, so there is nobody
    // here who is entitled to their photo. Refused rather than allowed to the
    // first head who asks — that is the unassigned pool, and it is readable by
    // every head (`/api/constituencies/[id]/unassigned`).
    const allowed =
      memberConstituencyId !== null &&
      (await canReadGroup(
        databases,
        { id: auth.user.id, label: auth.user.label },
        'constituency',
        memberConstituencyId,
      ))
    if (!allowed) {
      return NextResponse.json(
        { ok: false, error: 'That member is not in a constituency you head.' },
        { status: 403 },
      )
    }
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected a multipart upload.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'No file was attached.' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: 'That file is empty.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'That image is over 5 MB. Please use a smaller one.' },
      { status: 400 },
    )
  }
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json(
      { ok: false, error: 'Photos must be JPEG, PNG or WebP.' },
      { status: 400 },
    )
  }

  let normalised: Buffer
  try {
    normalised = await sharp(Buffer.from(await file.arrayBuffer()))
      // Apply the EXIF orientation to the pixels and drop the tag.
      .rotate()
      .resize(OUTPUT_SIDE, OUTPUT_SIDE, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: OUTPUT_QUALITY, mozjpeg: true })
      .toBuffer()
  } catch {
    // A file with an image mime and no image in it — truncated, mislabelled,
    // or a format this build cannot read. Said plainly, because the user's
    // next move is to pick a different file, not to retry this one.
    return NextResponse.json(
      { ok: false, error: 'That file could not be read as an image. Try a different photo.' },
      { status: 400 },
    )
  }

  // A `File` rather than `InputFile.fromBuffer`: the SDK's `InputFile.toFile()`
  // builds `new File([data], name)` with NO type, and a mime-less part is
  // stored as whatever Storage guesses. A File carries its own.
  const upload = new File([new Uint8Array(normalised)], OUTPUT_NAME, { type: OUTPUT_MIME })
  const created = await storage.createFile(BUCKETS.member_photos, ID.unique(), upload)
  await databases.updateDocument(DATABASE_ID, COLLECTIONS.members, id, {
    photo_file_id: created.$id,
  })

  // Bin the old file only after the new one is committed — a failure here
  // leaves a stray file, which is cheap; the reverse loses the only photo.
  if (previousFileId) {
    try {
      await storage.deleteFile(BUCKETS.member_photos, previousFileId)
    } catch {
      // Already gone, or storage hiccuped. Not worth failing the request.
    }
  }

  return NextResponse.json({ ok: true, photo_file_id: created.$id }, { status: 201 })
}
