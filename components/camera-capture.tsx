'use client'

// Take a member's photo with the device camera, instead of hunting for a file.
//
// The photo is not decoration: the kiosk shows it on the result screen and an
// usher checks a face against it before committing a manual check-in (PRD §2.4).
// A registration desk that has to photograph somebody, transfer the file and
// then upload it is a desk that ends up with members who have no photo — which
// is precisely the case the usher cannot resolve.
//
// Three things here are load-bearing and easy to lose in a refactor:
//
//   the stream is ALWAYS stopped   on close, on unmount, and before switching
//                                  cameras. A MediaStream nobody stopped keeps
//                                  the lens active and the indicator light on
//                                  after the dialog is gone, which reads to the
//                                  person being photographed as being recorded.
//   playsInline + muted            without both, iOS Safari takes the video
//                                  fullscreen and the shutter button is no
//                                  longer on screen to press.
//   nothing is mirrored            the operator is photographing somebody
//                                  ACROSS a desk, not taking a selfie, so the
//                                  self-view convention does not apply — and a
//                                  face stored mirrored is a face an usher
//                                  compares against backwards.

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowPathIcon, CameraIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'

/** Longest side of the stored image. A face at 1280px is far more than the
 *  kiosk result card needs, and keeps a capture well under the 5 MB cap. */
const MAX_DIMENSION = 1280
const JPEG_QUALITY = 0.85

/**
 * Is there a camera API at all?
 *
 * `navigator.mediaDevices` is undefined outside a secure context — so this is
 * false over plain http, which is exactly how a kiosk PC on a church LAN is
 * often reached. The caller uses it to not offer the button, rather than
 * offering one that fails; upload still works everywhere.
 *
 * Must be called from an effect: it is false during server rendering, and a
 * button that appears on hydration is better than one that disappears.
 */
export function cameraAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}

type Phase = 'starting' | 'live' | 'review' | 'error'

export default function CameraCapture({
  open,
  onClose,
  onCapture,
  busy,
  title = 'Take a photo',
}: {
  open: boolean
  onClose: () => void
  /** Called with a JPEG the caller can upload as-is. */
  onCapture: (file: File) => void | Promise<void>
  /** The upload is in flight — keep the review open and the buttons disabled. */
  busy?: boolean
  title?: string
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // The live stream, held in a ref as well as state: cleanup runs from an
  // unmount closure that must see the CURRENT stream, not the one captured
  // when the effect was created.
  const streamRef = useRef<MediaStream | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)

  const [phase, setPhase] = useState<Phase>('starting')
  const [error, setError] = useState<string | null>(null)
  const [shot, setShot] = useState<{ url: string; file: File } | null>(null)
  const [deviceIds, setDeviceIds] = useState<string[]>([])
  const [deviceIndex, setDeviceIndex] = useState(0)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const start = useCallback(
    async (deviceId?: string) => {
      stop()
      setPhase('starting')
      setError(null)
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : {
                // A registrar with a phone points it AWAY from themselves. On a
                // laptop with only a front camera this degrades to that camera
                // rather than failing, which is why it is `ideal` and not
                // `exact`.
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
          audio: false,
        })
        streamRef.current = next
        setStream(next)
        setPhase('live')

        // Ids only become readable AFTER permission is granted, so the camera
        // list can only be built here — never before the first successful call.
        const devices = await navigator.mediaDevices.enumerateDevices()
        const cams = devices.filter((d) => d.kind === 'videoinput').map((d) => d.deviceId)
        setDeviceIds(cams)
        if (deviceId) {
          const at = cams.indexOf(deviceId)
          if (at >= 0) setDeviceIndex(at)
        }
      } catch (e) {
        setPhase('error')
        setError(describe(e))
      }
    },
    [stop],
  )

  // Open and close. The cleanup is the important half: leaving it out is how
  // the lens stays live after the dialog closes.
  useEffect(() => {
    if (open) {
      setShot(null)
      void start()
    } else {
      stop()
      setPhase('starting')
      setError(null)
    }
  }, [open, start, stop])

  useEffect(() => () => stop(), [stop])

  // `phase` is in the deps because the <video> only exists while live — the
  // element the stream attaches to is not in the tree until then.
  useEffect(() => {
    const el = videoRef.current
    if (!el || !stream) return
    el.srcObject = stream
    void el.play().catch(() => {
      /* autoplay refused; nothing to do but let the frame sit */
    })
  }, [stream, phase])

  // Object URLs are revoked when the shot is replaced or the dialog closes; a
  // retaken photo would otherwise leak one blob per press.
  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url)
    }
  }, [shot])

  const switchCamera = () => {
    if (deviceIds.length < 2) return
    const next = (deviceIndex + 1) % deviceIds.length
    setDeviceIndex(next)
    void start(deviceIds[next])
  }

  const capture = async () => {
    const el = videoRef.current
    if (!el || !el.videoWidth) return

    const scale = Math.min(1, MAX_DIMENSION / Math.max(el.videoWidth, el.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(el.videoWidth * scale)
    canvas.height = Math.round(el.videoHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob) {
      setPhase('error')
      setError('The photo could not be saved. Try again, or upload a file instead.')
      return
    }

    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
    // The camera is released the moment there is a photo to look at. Holding it
    // open through the review is the difference between an indicator light that
    // goes out and one that stays on while somebody decides.
    stop()
    setShot({ url: URL.createObjectURL(file), file })
    setPhase('review')
  }

  const retake = () => {
    if (shot) URL.revokeObjectURL(shot.url)
    setShot(null)
    void start(deviceIds[deviceIndex])
  }

  const use = async () => {
    if (!shot) return
    await onCapture(shot.file)
  }

  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-neutral-950/70 backdrop-blur-sm" />
      <div className="fixed inset-0 flex w-screen items-center justify-center p-4">
        <DialogPanel className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-800">
          <DialogTitle className="text-lg font-semibold text-neutral-950 dark:text-white">
            {title}
          </DialogTitle>

          <div className="mt-4 aspect-4/3 w-full overflow-hidden rounded-xl bg-neutral-950">
            {phase === 'review' && shot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shot.url} alt="The photo just taken" className="size-full object-cover" />
            ) : phase === 'error' ? (
              <div className="flex size-full items-center justify-center p-6">
                <p role="alert" className="text-center text-sm text-white/80">
                  {error}
                </p>
              </div>
            ) : (
              <video
                ref={videoRef}
                // Both are required or iOS Safari plays this fullscreen and the
                // shutter button is no longer reachable.
                playsInline
                muted
                className="size-full object-cover"
              />
            )}
          </div>

          {phase === 'starting' && (
            <p className="mt-3 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Waiting for the camera. Your browser may ask for permission first.
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
            {phase === 'live' && deviceIds.length > 1 && (
              <Button plain onClick={switchCamera} className="mr-auto">
                <ArrowPathIcon data-slot="icon" />
                Switch camera
              </Button>
            )}

            {phase === 'review' ? (
              <>
                <Button plain onClick={retake} disabled={busy}>
                  Retake
                </Button>
                <Button color="primary" onClick={use} disabled={busy}>
                  {busy ? 'Saving…' : 'Use this photo'}
                </Button>
              </>
            ) : phase === 'error' ? (
              <>
                <Button plain onClick={onClose}>
                  Close
                </Button>
                <Button color="primary" onClick={() => void start()}>
                  Try again
                </Button>
              </>
            ) : (
              <>
                <Button plain onClick={onClose}>
                  Cancel
                </Button>
                <Button color="primary" onClick={capture} disabled={phase !== 'live'}>
                  <CameraIcon data-slot="icon" />
                  Take photo
                </Button>
              </>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

/**
 * Turn a getUserMedia rejection into something a registrar can act on.
 *
 * The DOMException names are the only reliable signal — the messages differ per
 * browser — and "could not start the camera" is useless to somebody who simply
 * pressed Block on the permission prompt and can un-block it.
 */
function describe(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was refused. Allow it for this site in your browser, then try again — or upload a photo file instead.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. Upload a photo file instead.'
    case 'NotReadableError':
      return 'The camera is already in use by another app. Close that app and try again.'
    default:
      return 'The camera could not be started. Upload a photo file instead.'
  }
}
