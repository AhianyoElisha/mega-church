// The geometry behind the photo cropper, kept pure so it can be unit-tested
// without a DOM.
//
// Model: an image of natural size (W x H) is shown inside a SQUARE viewport of
// side V. At zoom 1 the image is scaled so its SHORTER side exactly fills the
// viewport — "cover" — so the crop is the largest square the image can give,
// centred. Zoom multiplies that scale; a pan shifts the image, in viewport
// pixels, away from centre. The one invariant every helper preserves is that
// the viewport never shows anything but image: a crop that leaves the frame
// would store a photo with a blank stripe down one side, and a kiosk card with
// a stripe on it looks like a broken upload.

export type ImageSize = { width: number; height: number }
export type Pan = { x: number; y: number }
export type CropRect = { sx: number; sy: number; sw: number; sh: number }

/** Zoom is relative to "cover": 1x is the whole shorter side, 4x is a quarter of it. */
export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

/** Side of the stored square. Matches the server's own normalisation. */
export const CROP_OUTPUT_SIDE = 800

/** Scale at which the image's shorter side fills the viewport exactly. */
export function coverScale(image: ImageSize, viewport: number): number {
  const shorter = Math.min(image.width, image.height)
  if (shorter <= 0 || viewport <= 0) return 0
  return viewport / shorter
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** Pixel size of the image as displayed in the viewport at this zoom. */
export function displayedSize(image: ImageSize, viewport: number, zoom: number): ImageSize {
  const scale = coverScale(image, viewport) * clampZoom(zoom)
  return { width: image.width * scale, height: image.height * scale }
}

/**
 * The furthest the image may be panned in each axis without exposing the
 * viewport's background. Zero on the axis where the image fits exactly, which
 * is always the shorter one at zoom 1.
 */
export function panLimit(image: ImageSize, viewport: number, zoom: number): Pan {
  const shown = displayedSize(image, viewport, zoom)
  return {
    x: Math.max(0, (shown.width - viewport) / 2),
    y: Math.max(0, (shown.height - viewport) / 2),
  }
}

/** Clamp a pan into the range where the image still covers the viewport. */
export function clampPan(image: ImageSize, viewport: number, zoom: number, pan: Pan): Pan {
  const limit = panLimit(image, viewport, zoom)
  const x = Number.isFinite(pan.x) ? pan.x : 0
  const y = Number.isFinite(pan.y) ? pan.y : 0
  // `|| 0` folds the -0 that Math.max(-0, n) yields at a zero limit; a -0 pan
  // is harmless to draw with but confusing to compare in a test or a log.
  return {
    x: Math.min(limit.x, Math.max(-limit.x, x)) || 0,
    y: Math.min(limit.y, Math.max(-limit.y, y)) || 0,
  }
}

/**
 * Where the image's top-left corner sits in viewport coordinates. Used by the
 * cropper to position the <img>, and by `cropRect` to invert that position.
 */
export function imageOffset(image: ImageSize, viewport: number, zoom: number, pan: Pan): Pan {
  const shown = displayedSize(image, viewport, zoom)
  const safe = clampPan(image, viewport, zoom, pan)
  return {
    x: (viewport - shown.width) / 2 + safe.x,
    y: (viewport - shown.height) / 2 + safe.y,
  }
}

/**
 * The source rectangle, in natural image pixels, that the viewport is showing.
 * Feed it straight to `drawImage(img, sx, sy, sw, sh, 0, 0, out, out)`.
 *
 * `sw === sh` always — the viewport is square — and the rect is clamped inside
 * the image even if the pan handed in was not, so a stale pan after a zoom
 * change cannot produce a crop with nothing in it.
 */
export function cropRect(image: ImageSize, viewport: number, zoom: number, pan: Pan): CropRect {
  const scale = coverScale(image, viewport) * clampZoom(zoom)
  if (scale <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 }

  const side = viewport / scale
  const offset = imageOffset(image, viewport, zoom, pan)
  const sx = Math.min(Math.max(0, -offset.x / scale), Math.max(0, image.width - side))
  const sy = Math.min(Math.max(0, -offset.y / scale), Math.max(0, image.height - side))
  return { sx, sy, sw: side, sh: side }
}
