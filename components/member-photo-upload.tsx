'use client'

// Photo capture for a member. This is not decoration: the kiosk shows it on
// the result screen and an usher checks a face against it before committing a
// manual check-in (PRD §2.4).

import { useRef, useState } from 'react'
import { CameraIcon } from '@heroicons/react/24/outline'
import Avatar from '@/shared/Avatar'
import { useUploadMemberPhoto } from '@/lib/queries/members'
import { memberPhotoUrl } from '@/lib/members/photo'

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

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
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

    const localUrl = URL.createObjectURL(file)
    setPreview(localUrl)
    try {
      await upload.mutateAsync({ id: memberId, file })
    } catch (err) {
      setPreview(null)
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      URL.revokeObjectURL(localUrl)
      // Let the same file be re-picked after a failure.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const src = preview ?? memberPhotoUrl(photoFileId, 320)

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <Avatar
          src={src}
          initials={src ? undefined : initials}
          alt={name}
          className="size-32 bg-primary-500 text-neutral-950"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
          aria-label="Change photo"
          className="absolute right-0 bottom-0 flex size-10 cursor-pointer items-center justify-center rounded-full bg-neutral-950 text-white shadow-md disabled:opacity-50 dark:bg-white dark:text-neutral-950"
        >
          {upload.isPending ? (
            <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <CameraIcon className="size-5" />
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleChange}
          className="hidden"
        />
      </div>
      {error ? (
        <p role="alert" className="mt-3 max-w-48 text-center text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        <p className="mt-3 max-w-48 text-center text-xs text-neutral-400 dark:text-neutral-500">
          Shown on the kiosk when this member checks in.
        </p>
      )}
    </div>
  )
}
