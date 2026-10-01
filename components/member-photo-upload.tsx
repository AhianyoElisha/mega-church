'use client'

// Photo capture for a member. This is not decoration: the kiosk shows it on
// the result screen and an usher checks a face against it before committing a
// manual check-in (PRD §2.4).
//
// Two ways in, and the order matters. TAKING the photo is offered first because
// it is what a registration desk actually does — the member is standing there.
// Uploading stays because it is the only path that works everywhere: there is
// no camera API outside a secure context, which is exactly how a kiosk PC on a
// church LAN is often reached.
//
// Both doors lead to the CROPPER, and the cropper is the only thing that
// uploads. A picked file and a captured frame are handed over raw; what leaves
// the browser is the square the registrar framed, so the kiosk card shows the
// face they chose and not the centre of whatever the sensor saw.

import { useEffect, useRef, useState } from 'react'
import { ArrowUpTrayIcon, CameraIcon } from '@heroicons/react/24/outline'
import Avatar from '@/shared/Avatar'
import { Button } from '@/shared/Button'
import CameraCapture, { cameraAvailable } from '@/components/camera-capture'
import PhotoCropper from '@/components/photo-cropper'
import { useUploadMemberPhoto } from '@/lib/queries/members'
import { memberPhotoUrl } from '@/lib/members/photo'

/** Same cap as the route; checked here so a 40 MB scan is refused before the crop. */
const MAX_BYTES = 5 * 1024 * 1024

export default function MemberPhotoUpload({
  memberId,
  photoFileId,
  initials,
  name,
}: {
  memberId: string
  photoFileId: string | null
  initials: string
  name: string
}) {
  const upload = useUploadMemberPhoto()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  // Show the chosen file immediately rather than waiting for a round-trip and
  // a CDN cache — on a slow connection the old photo otherwise lingers and
  // looks like the upload failed.
  const [preview, setPreview] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  // The raw photo waiting to be framed. Non-null IS the cropper being open.
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  // A failed upload is reported INSIDE the cropper, which still holds the
  // original — so the registrar presses again rather than photographing the
  // member a second time.
  const [cropError, setCropError] = useState<string | null>(null)

  // Resolved after mount, never during render: `navigator` does not exist on
  // the server, and a control that appears on hydration is much better than one
  // that vanishes.
  const [canUseCamera, setCanUseCamera] = useState(false)
  useEffect(() => setCanUseCamera(cameraAvailable()), [])

  /** One upload path for both doors, so a photo behaves identically either way. */
  const send = async (file: File) => {
    setError(null)
    setCropError(null)
    const localUrl = URL.createObjectURL(file)
    setPreview(localUrl)
    try {
      await upload.mutateAsync({ id: memberId, file })
      return true
    } catch (err) {
      setPreview(null)
      setCropError(err instanceof Error ? err.message : 'Upload failed.')
      return false
    } finally {
      URL.revokeObjectURL(localUrl)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Cleared at once so the same file can be picked again after a cancel or
    // a failure — a file input does not fire `change` for a repeat choice.
    e.target.value = ''
    if (!file) return
    setError(null)

    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('That image is over 5 MB.')
      return
    }

    setCropError(null)
    setPendingFile(file)
  }

  const src = preview ?? memberPhotoUrl(photoFileId, 320)

  return (
    <div className="flex flex-col items-center">
      <Avatar
        src={src}
        // Always given: they sit UNDER the photo, and are what shows when the
        // photo cannot be loaded (see `shared/Avatar.tsx`).
        initials={initials}
        alt={name}
        className="size-32 bg-primary-500 text-neutral-950"
      />

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {canUseCamera && (
          <Button
            type="button"
            color="primary"
            onClick={() => setCameraOpen(true)}
            disabled={upload.isPending}
          >
            <CameraIcon data-slot="icon" />
            Take photo
          </Button>
        )}
        <Button
          type="button"
          outline
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
        >
          <ArrowUpTrayIcon data-slot="icon" />
          {upload.isPending ? 'Saving…' : 'Upload'}
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleChange}
        className="hidden"
      />

      {error ? (
        <p role="alert" className="mt-3 max-w-56 text-center text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        <p className="mt-3 max-w-56 text-center text-xs text-neutral-400 dark:text-neutral-500">
          Shown on the kiosk when this member checks in.
        </p>
      )}

      <CameraCapture
        open={cameraOpen}
        title={`Photo for ${name}`}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => {
          // The camera dialog has already released the stream at capture; it
          // closes here and the cropper takes over the frame. Nothing is
          // uploaded until the cropper says so.
          setCameraOpen(false)
          setCropError(null)
          setPendingFile(file)
        }}
      />

      <PhotoCropper
        open={pendingFile !== null}
        file={pendingFile}
        busy={upload.isPending}
        error={cropError}
        title={`Photo for ${name}`}
        onCancel={() => {
          setPendingFile(null)
          setCropError(null)
        }}
        onCropped={async (file) => {
          // Closed only on success; a failure keeps the original on screen.
          if (await send(file)) setPendingFile(null)
        }}
      />
    </div>
  )
}
