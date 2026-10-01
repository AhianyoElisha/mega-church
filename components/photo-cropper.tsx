'use client'

// Frame a member's photo before it is uploaded.
//
// Every photo goes through here, whichever door it came in by — a file the
// registrar picked, or a frame the camera dialog captured. The output is the
// same square JPEG in both cases, so the server's own normalisation is a
// safety net rather than the thing doing the framing: a face that a registrar
// centred on the screen is centred on the kiosk card, instead of wherever a
// centre-crop of the whole frame happened to land.
//
// The maths lives in `lib/members/crop.ts` and is unit-tested; this file is
// the DOM around it. Two things are easy to lose in a refactor:
//
//   nothing is mirrored      the same rule as the camera dialog — an usher
//                            compares the stored face against a real one.
//   object URLs are revoked  on close and whenever the file changes. A cropper
//                            that is opened for every member of a bacenta
//                            would otherwise hold every original in memory
//                            until the tab is closed.

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { useEffect, useRef, useState } from 'react'
import { MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import {
  CROP_OUTPUT_SIDE,
  MAX_ZOOM,
  MIN_ZOOM,
  clampPan,
  clampZoom,
  cropRect,
  displayedSize,
  imageOffset,
  type ImageSize,
  type Pan,
} from '@/lib/members/crop'

const OUTPUT_QUALITY = 0.9
const OUTPUT_NAME = 'photo.jpg'
const OUTPUT_MIME = 'image/jpeg'

const ZOOM_SLIDER_STEP = 0.01
/** One mouse-wheel notch (100 units) is roughly a 10 % zoom. */
const WHEEL_ZOOM_PER_UNIT = 0.001
/** Arrow keys nudge the crop by this many viewport pixels. */
const KEY_PAN_STEP = 10

const CENTRE: Pan = { x: 0, y: 0 }

type Loaded = {
  url: string
  el: HTMLImageElement
  size: ImageSize
}

export default function PhotoCropper({
  open,
  file,
  onCancel,
  onCropped,
  busy,
  error,
  title = 'Frame the photo',
}: {
  open: boolean
  file: File | null
  onCancel: () => void
  /** Called with the cropped 800x800 JPEG. */
  onCropped: (file: File) => void | Promise<void>
  /** The upload is in flight — keep the dialog open and the buttons disabled. */
  busy?: boolean
  /** A failed upload, shown in the dialog so the registrar can try again. */
  error?: string | null
  title?: string
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [viewport, setViewport] = useState(0)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [pan, setPan] = useState<Pan>(CENTRE)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)

  // Decode the file once, off screen, so its natural size is known before
  // anything is positioned. Modern browsers apply the EXIF orientation to
  // `naturalWidth`/`naturalHeight` AND to `drawImage`, so a sideways phone
  // JPEG is upright here and upright in the crop, consistently.
  useEffect(() => {
    if (!open || !file) {
      setLoaded(null)
      setLoadError(false)
      return
    }
    const url = URL.createObjectURL(file)
    const el = new Image()
    let cancelled = false
    el.onload = () => {
      if (cancelled) return
      setLoaded({ url, el, size: { width: el.naturalWidth, height: el.naturalHeight } })
      setZoom(MIN_ZOOM)
      setPan(CENTRE)
      setRenderError(null)
    }
    el.onerror = () => {
      if (!cancelled) setLoadError(true)
    }
    el.src = url
    return () => {
      cancelled = true
      URL.revokeObjectURL(url)
      setLoaded(null)
      setLoadError(false)
    }
  }, [open, file])

  // The viewport is as wide as the panel allows — full width on a phone —
  // so its side is measured, not assumed, and re-measured on rotation.
  useEffect(() => {
    const el = viewportRef.current
    if (!el || !loaded) return
    const measure = () => setViewport(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [loaded])

  // React registers `wheel` as passive, so `preventDefault` from an `onWheel`
  // prop is ignored and the page behind the dialog scrolls. A native listener
  // is the only way to claim the wheel for zooming.
  useEffect(() => {
    const el = viewportRef.current
    if (!el || !loaded) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => clampZoom(z * Math.exp(-e.deltaY * WHEEL_ZOOM_PER_UNIT)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [loaded])

  // Zooming out shrinks the room to pan; whatever pan was held is pulled back
  // inside the image so the viewport never shows its own background.
  useEffect(() => {
    if (!loaded || viewport <= 0) return
    setPan((p) => clampPan(loaded.size, viewport, zoom, p))
  }, [loaded, viewport, zoom])

  // --- Pointer handling: one finger pans, two pinch. -----------------------
  const pointers = useRef(new Map<number, Pan>())
  const dragStart = useRef<{ pan: Pan; at: Pan } | null>(null)
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null)

  const distanceBetween = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!loaded) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      dragStart.current = { pan, at: { x: e.clientX, y: e.clientY } }
      pinchStart.current = null
    } else if (pointers.current.size === 2) {
      dragStart.current = null
      pinchStart.current = { distance: distanceBetween(), zoom }
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!loaded || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size >= 2 && pinchStart.current) {
      const start = pinchStart.current
      const distance = distanceBetween()
      if (start.distance > 0 && distance > 0) {
        setZoom(clampZoom(start.zoom * (distance / start.distance)))
      }
      return
    }
    if (dragStart.current) {
      const start = dragStart.current
      setPan(
        clampPan(loaded.size, viewport, zoom, {
          x: start.pan.x + (e.clientX - start.at.x),
          y: start.pan.y + (e.clientY - start.at.y),
        }),
      )
    }
  }

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    pinchStart.current = null
    // Lifting one finger of a pinch leaves the other as a plain drag, started
    // from where it is now rather than jumping to where it first touched.
    const remaining = [...pointers.current.values()]
    dragStart.current = remaining.length === 1 ? { pan, at: remaining[0] } : null
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!loaded) return
    const step: Record<string, Pan> = {
      ArrowLeft: { x: KEY_PAN_STEP, y: 0 },
      ArrowRight: { x: -KEY_PAN_STEP, y: 0 },
      ArrowUp: { x: 0, y: KEY_PAN_STEP },
      ArrowDown: { x: 0, y: -KEY_PAN_STEP },
    }
    const delta = step[e.key]
    if (!delta) return
    e.preventDefault()
    setPan((p) => clampPan(loaded.size, viewport, zoom, { x: p.x + delta.x, y: p.y + delta.y }))
  }

  const reset = () => {
    setZoom(MIN_ZOOM)
    setPan(CENTRE)
  }

  const use = async () => {
    if (!loaded || viewport <= 0 || rendering || busy) return
    setRendering(true)
    setRenderError(null)
    try {
      const rect = cropRect(loaded.size, viewport, zoom, pan)
      const canvas = document.createElement('canvas')
      canvas.width = CROP_OUTPUT_SIDE
      canvas.height = CROP_OUTPUT_SIDE
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      // Source rect straight onto the output square. No transform, no flip.
      ctx.drawImage(loaded.el, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, CROP_OUTPUT_SIDE, CROP_OUTPUT_SIDE)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, OUTPUT_MIME, OUTPUT_QUALITY),
      )
      if (!blob) throw new Error('toBlob returned null')
      await onCropped(new File([blob], OUTPUT_NAME, { type: OUTPUT_MIME }))
    } catch {
      setRenderError('The photo could not be prepared. Try again, or choose a different file.')
    } finally {
      setRendering(false)
    }
  }

  const locked = Boolean(busy) || rendering
  const shown = loaded && viewport > 0 ? displayedSize(loaded.size, viewport, zoom) : null
  const offset = loaded && viewport > 0 ? imageOffset(loaded.size, viewport, zoom, pan) : null
  const message = error ?? renderError

  return (
    <Dialog open={open} onClose={locked ? () => {} : onCancel} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-neutral-950/70 backdrop-blur-sm" />
      <div className="fixed inset-0 flex w-screen items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-800">
          <DialogTitle className="text-lg font-semibold text-neutral-950 dark:text-white">
            {title}
          </DialogTitle>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Drag to move, slide to zoom. What is inside the square is what the kiosk shows.
          </p>

          <div
            ref={viewportRef}
            role="img"
            aria-label="Photo to crop. Use the arrow keys to move it."
            tabIndex={loaded ? 0 : -1}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onKeyDown={onKeyDown}
            // `touch-none` hands touch to the pointer events instead of the
            // page scroll; without it a drag on a phone scrolls the dialog.
            className="relative mx-auto mt-4 aspect-square w-full max-w-80 cursor-grab touch-none overflow-hidden rounded-xl bg-neutral-950 select-none focus:outline-2 focus:outline-offset-2 focus:outline-primary-500 active:cursor-grabbing"
          >
            {loaded && shown && offset ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={loaded.url}
                alt=""
                draggable={false}
                // `max-w-none` overrides the preflight `max-width: 100%`,
                // which would otherwise refuse to let the image zoom past
                // the viewport it is meant to overflow.
                className="pointer-events-none absolute max-w-none"
                style={{ width: shown.width, height: shown.height, left: offset.x, top: offset.y }}
              />
            ) : (
              <div className="flex size-full items-center justify-center p-6">
                <p role={loadError ? 'alert' : undefined} className="text-center text-sm text-white/80">
                  {loadError
                    ? 'This file could not be opened as an image. Choose a different one.'
                    : 'Opening the photo…'}
                </p>
              </div>
            )}

            {/* Rule-of-thirds grid, so a face can be placed rather than centred by guesswork. */}
            {loaded && (
              <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                <div className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
                <div className="absolute inset-0 rounded-xl ring-2 ring-primary-500/80 ring-inset" />
              </div>
            )}
          </div>

          <label className="mx-auto mt-4 flex w-full max-w-80 items-center gap-3 text-neutral-700 dark:text-neutral-300">
            <MagnifyingGlassMinusIcon aria-hidden="true" className="size-5 shrink-0" />
            <input
              type="range"
              aria-label="Zoom"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={ZOOM_SLIDER_STEP}
              value={zoom}
              disabled={!loaded || locked}
              onChange={(e) => setZoom(clampZoom(Number(e.target.value)))}
              className="w-full accent-primary-500"
            />
            <MagnifyingGlassPlusIcon aria-hidden="true" className="size-5 shrink-0" />
          </label>

          {message && (
            <p role="alert" className="mt-3 text-center text-sm text-red-600 dark:text-red-400">
              {message}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
            <Button plain onClick={reset} disabled={!loaded || locked} className="mr-auto">
              Reset
            </Button>
            <Button plain onClick={onCancel} disabled={locked}>
              Cancel
            </Button>
            <Button color="primary" onClick={use} disabled={!loaded || locked}>
              {busy ? 'Saving…' : rendering ? 'Preparing…' : 'Use photo'}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
