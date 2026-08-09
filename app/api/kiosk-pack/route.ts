// Serve the kiosk provisioning pack.
//
// The point of this endpoint: a fresh Windows PC should be set up by
// downloading a few MB from this app, not by cloning the repo onto it. That is
// only possible because the server matches fingerprints in-process — a kiosk
// no longer needs a local Next server, and therefore no repo, no node_modules,
// and no Appwrite key on the machine.
//
// Streams from Appwrite Storage through this route rather than handing out a
// storage URL, so the bucket stays private and the download inherits the
// caller's session.
import { NextResponse } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { BUCKETS } from '@/lib/appwrite/config'

/** Single well-known id, overwritten by each build — always "the current pack". */
const FILE_ID = 'current'

export async function GET() {
  // Admin only: this is a provisioning artifact, and a kiosk account has no
  // reason to pull it.
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { storage } = createAdminClient() as unknown as {
    storage: {
      getFile(bucket: string, id: string): Promise<{ name: string; sizeOriginal: number }>
      getFileDownload(bucket: string, id: string): Promise<ArrayBuffer>
    }
  }

  let meta: { name: string; sizeOriginal: number }
  try {
    meta = await storage.getFile(BUCKETS.kiosk_downloads, FILE_ID)
  } catch {
    // Not published yet. Name the fix rather than 404ing into silence — the
    // person hitting this is in the middle of provisioning a kiosk.
    return NextResponse.json(
      {
        ok: false,
        error:
          'No kiosk pack has been published yet. On a Windows machine with the built ' +
          'binaries, run: npm run build:kiosk-pack',
      },
      { status: 404 },
    )
  }

  const bytes = await storage.getFileDownload(BUCKETS.kiosk_downloads, FILE_ID)
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${meta.name}"`,
      'Content-Length': String(meta.sizeOriginal),
      // A stale pack is worse than a slow one: it would install last month's
      // binaries and look fine doing it.
      'Cache-Control': 'private, no-store',
    },
  })
}
