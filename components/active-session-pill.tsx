'use client'

// The most important status in the app, so it sits in the header on every
// screen: is a session open, and which one?
//
// Colour is never the only signal (PRD §2.4) — the dot is decorative and the
// meaning is carried by the words next to it.

import clsx from 'clsx'
import Link from 'next/link'
import { useActiveSession } from '@/lib/queries/occurrences'

export default function ActiveSessionPill({ className }: { className?: string }) {
  const { data, isLoading } = useActiveSession()

  if (isLoading) {
    return (
      <span
        className={clsx(
          className,
          'inline-flex items-center gap-x-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
        )}
      >
        Checking…
      </span>
    )
  }

  const session = data?.ok ? data.session : null

  if (!session) {
    return (
      <Link
        href="/services"
        className={clsx(
          className,
          'inline-flex items-center gap-x-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700',
        )}
      >
        <span aria-hidden className="size-1.5 rounded-full bg-neutral-400" />
        No session open
      </Link>
    )
  }

  return (
    <Link
      href="/monitor"
      // The meeting's name is arbitrary text an admin typed, and the longest
      // real one — "Live · First Service (Psalms Chapel)" — measured 246px
      // against 93px for the idle pill. Uncapped, it grew the header by more
      // than a nav item's worth at exactly the moment a service was running.
      // Capped and truncated, with the full name on hover and on /monitor.
      title={`Live · ${session.meeting.name}`}
      className={clsx(
        className,
        // Tighter in the 1024–1279 band, where the nav and the pill compete for
        // the same row: 160px there, 224px once there is room for both.
        'inline-flex min-w-0 max-w-40 items-center gap-x-1.5 rounded-full bg-primary-500 px-3 py-1.5 text-xs font-semibold text-neutral-950 transition hover:bg-primary-600 xl:max-w-56',
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-neutral-950" />
      <span className="truncate">Live · {session.meeting.name}</span>
    </Link>
  )
}
