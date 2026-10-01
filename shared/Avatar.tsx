'use client'

import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import React, { forwardRef, useEffect, useState } from 'react'
import { TouchTarget } from './Button'
import { Link } from './link'

type AvatarProps = {
  src?: string | null
  square?: boolean
  initials?: string
  alt?: string
  className?: string
}

export default function Avatar({
  src = null,
  square = false,
  initials,
  alt = '',
  className,
  ...props
}: AvatarProps & React.ComponentPropsWithoutRef<'span'>) {
  // A photo that cannot be loaded shows the initials underneath it instead of
  // the browser's broken-image glyph and the alt text. A 401 for a signed-out
  // tab, a 404 for a file the console deleted, a flaky connection — each of
  // them otherwise renders a name in a box that looks like a failed upload.
  // Reset when `src` changes, or one bad photo would hide every good one that
  // followed it in a re-used row.
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])

  return (
    <span
      data-slot="avatar"
      {...props}
      className={clsx(
        className,
        // Basic layout — overflow-hidden is required for rounded clipping to work
        'inline-grid shrink-0 overflow-hidden align-middle [--avatar-radius:20%] *:col-start-1 *:row-start-1',
        'outline -outline-offset-1 outline-black/10 dark:outline-white/10',
        // Border radius
        square ? 'rounded-(--avatar-radius) *:rounded-(--avatar-radius)' : 'rounded-full *:rounded-full'
      )}
    >
      {initials && (
        <svg
          className="size-full fill-current p-[5%] text-[48px] font-medium uppercase select-none"
          viewBox="0 0 100 100"
          aria-hidden={alt ? undefined : 'true'}
        >
          {alt && <title>{alt}</title>}
          <text x="50%" y="50%" alignmentBaseline="middle" dominantBaseline="middle" textAnchor="middle" dy=".125em">
            {initials}
          </text>
        </svg>
      )}
      {src && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="size-full object-cover" src={src} alt={alt} onError={() => setFailed(true)} />
      )}
    </span>
  )
}

export const AvatarButton = forwardRef(function AvatarButton(
  {
    src,
    square = false,
    initials,
    alt,
    className,
    ...props
  }: AvatarProps &
    (Omit<Headless.ButtonProps, 'as' | 'className'> | Omit<React.ComponentPropsWithoutRef<typeof Link>, 'className'>),
  ref: React.ForwardedRef<HTMLElement>
) {
  let classes = clsx(
    className,
    square ? 'rounded-[20%]' : 'rounded-full',
    'relative inline-grid focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-blue-500'
  )

  return 'href' in props ? (
    <Link {...props} className={classes} ref={ref as React.ForwardedRef<HTMLAnchorElement>}>
      <TouchTarget>
        <Avatar src={src} square={square} initials={initials} alt={alt} />
      </TouchTarget>
    </Link>
  ) : (
    <Headless.Button {...props} className={classes} ref={ref}>
      <TouchTarget>
        <Avatar src={src} square={square} initials={initials} alt={alt} />
      </TouchTarget>
    </Headless.Button>
  )
})
