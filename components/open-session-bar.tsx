'use client'

// The open session, on the pages people go looking for it.
//
// /services owns activating and ending sessions and does it well. But "what is
// running, and how do I stop it" is the question admins arrive at /meetings
// with, and that page lists only `kind === 'meeting'` — so a running SERVICE is
// invisible there. Before this existed, a church with no custom meetings saw
// "No meetings yet" filling the page while First Service was live and the
// header said "Live · First Service", with no way to end it from that screen.

import { useState } from 'react'
import { Banner } from '@/components/ui'
import { useDialog } from '@/components/dialog'
import { Button } from '@/shared/Button'
import { useActiveSession, useCloseOccurrence } from '@/lib/queries/occurrences'

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Africa/Accra',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

export default function OpenSessionBar({ className }: { className?: string }) {
  const dialog = useDialog()
  const active = useActiveSession()
  const close = useCloseOccurrence()
  const [error, setError] = useState<string | null>(null)

  const session = active.data?.ok ? active.data.session : null

  // A REFUSAL IS NOT AN ABSENCE.
  //
  // `resolveActiveSession()` throws when more than one occurrence is open, and
  // `apiFetch` turns that 409 into a rejected query — so `data` is undefined
  // and the usual `data?.ok ? data.session : null` renders it as "no session
  // open". That is the worst possible reading: the kiosks are still scanning,
  // the operator is told nothing is running, and every End button is hidden
  // behind the session that will not resolve. Say what actually happened.
  const refusal =
    active.error?.message ??
    (active.data && !active.data.ok ? active.data.error : null)

  const handleClose = async () => {
    if (!session) return
    const ok = await dialog.confirm({
      title: `End ${session.meeting.name}?`,
      message:
        'Kiosks will stop accepting scans immediately and the attendance count will be frozen. ' +
        'You can then activate the next session.',
      confirmText: 'End session',
      tone: 'danger',
    })
    if (!ok) return
    setError(null)
    const res = await close.mutateAsync({ occurrence_id: session.occurrence.$id }).catch(
      (e: Error) => {
        setError(e.message)
        return null
      },
    )
    if (res && !res.ok) setError(res.error)
  }

  if (refusal) {
    return (
      <Banner tone="error" className={className}>
        <span className="font-semibold">Cannot read the open session.</span> {refusal}
      </Banner>
    )
  }

  if (!session) return null

  return (
    <div
      className={[
        'flex flex-wrap items-center justify-between gap-4 rounded-xl border-2 border-primary-500 bg-primary-50 px-4 py-3 dark:bg-primary-900/20',
        className ?? '',
      ].join(' ')}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-primary-600" />
          {/* Colour is never the only signal — the words carry it. PRD §2.4. */}
          <span className="text-xs font-semibold tracking-wide text-primary-800 uppercase dark:text-primary-300">
            Session open
          </span>
        </div>
        <p className="mt-0.5 font-semibold text-neutral-950 dark:text-white">
          {session.meeting.name}
          <span className="ml-2 font-normal text-sm text-neutral-600 dark:text-neutral-300">
            started {formatTime(session.occurrence.opened_at)}
          </span>
        </p>
        {error && (
          <p role="alert" className="mt-1 text-sm font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-3">
        <Button outline href="/monitor">
          Live view
        </Button>
        <Button color="red" onClick={handleClose} disabled={close.isPending}>
          {close.isPending ? 'Ending…' : 'End session'}
        </Button>
      </div>
    </div>
  )
}
