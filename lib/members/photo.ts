// Member photo URLs.
//
// Photos are served by the APP — `GET /api/photos/[fileId]` — not by Appwrite
// Storage directly. The bucket grants read to signed-in users only, and the
// browser SDK has no session to offer: login stores the Appwrite session as an
// httpOnly cookie on this app's own domain, which the browser sends to this
// app and to nobody else. A Storage URL built in the browser therefore answered
// 401 for everybody, including the kiosk, and every photo showed its `alt`.
//
// A same-origin path fixes that for free: an `<img>` to `/api/photos/...`
// carries the app cookie like any other request, the route checks it and
// streams the file through the admin client. Nothing here needs the SDK, so
// this module is plain and importable from anywhere.

const PHOTO_ROUTE = '/api/photos'

/**
 * @param size kept for callers, which pass the pixel size they will display
 *   at. The route serves the stored image (always 800x800 since the upload
 *   normalises), so the size does not go on the wire: one URL per file means
 *   one browser-cache entry per photo, however many places show it.
 */
export function memberPhotoUrl(
  photoFileId: string | null | undefined,
  size = 240,
): string | null {
  if (!photoFileId) return null
  return `${PHOTO_ROUTE}/${encodeURIComponent(photoFileId)}`
}
