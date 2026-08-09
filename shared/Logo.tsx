import Link from 'next/link'
import Image from 'next/image'
import clsx from 'clsx'
import React from 'react'

/**
 * The church mark plus the wordmark.
 *
 * The artwork is a circular badge, so it is rendered at a fixed HEIGHT with the
 * wordmark beside it rather than being scaled by width like a conventional
 * horizontal logo — a round mark stretched to fill a wide header slot would be
 * 128px tall inside an 80px header.
 *
 * Regenerate the PNGs from `brand/tmclogo.png` with `npm run build:brand`.
 */
interface LogoProps {
  className?: string
  href?: string
  /** Hide the wordmark and show the badge alone (tight spaces, the kiosk). */
  markOnly?: boolean
  /** Tailwind size class for the badge itself. */
  markClassName?: string
}

const Logo: React.FC<LogoProps> = ({
  className,
  href = '/',
  markOnly = false,
  markClassName = 'size-9 sm:size-10',
}) => {
  return (
    <Link
      href={href}
      className={clsx(
        'inline-flex items-center gap-2.5 focus:ring-0 focus:outline-hidden',
        className,
      )}
    >
      <Image
        src="/logo.png"
        alt="The Mega Church"
        width={512}
        height={512}
        // The mark appears in the header of every page, so it should not wait
        // in the queue behind page content.
        priority
        className={clsx('shrink-0 object-contain', markClassName)}
      />
      {!markOnly && (
        <span className="flex flex-col leading-none">
          <span className="text-sm font-bold tracking-tight text-neutral-950 dark:text-white">
            MEGA
          </span>
          <span className="text-sm font-bold tracking-tight text-primary-500">CHURCH</span>
        </span>
      )}
    </Link>
  )
}

export default Logo
