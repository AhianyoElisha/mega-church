'use client'

// Member photo URLs, built from the browser SDK.
//
// A preview URL is public-by-file-permission on the bucket. It is used on the
// kiosk, which may be signed in as an appliance account, so the URL must not
// depend on the viewer's session.

import { storage } from '@/lib/appwrite/client'
import { BUCKETS } from '@/lib/appwrite/config'

export function memberPhotoUrl(
  photoFileId: string | null | undefined,
  size = 240,
): string | null {
  if (!photoFileId) return null
  try {
    return storage.getFilePreview(BUCKETS.member_photos, photoFileId, size, size).toString()
  } catch {
    // A misconfigured endpoint should cost an avatar, not the page.
    return null
  }
}
