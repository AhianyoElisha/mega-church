'use client'

// The open session, on the pages people go looking for it.
//
// /services owns activating and ending sessions and does it well. But "what is
// running, and how do I stop it" is the question admins arrive at /meetings
// with, and that page lists only `kind === 'meeting'` — so a running SERVICE is
// invisible there. Before this existed, a church with no custom meetings saw
// "No meetings yet" filling the page while First Service was live and the
// header said "Live · First Service", with no way to end it from that screen.
//
// It renders PAUSED sessions too, and that is not decoration: a paused session
// is invisible to every "is anything open?" check by design, so without a row
// of its own it would be a service the church has forgotten it is still in the
// middle of.

import { useState } from 'react'
import { Banner } from '@/components/ui'
import { useAuth } from '@/components/auth'
import { useDialog } from '@/components/dialog'
import { Button } from '@/shared/Button'
import {
  useActiveSession,
  useCloseOccurrence,
  usePauseOccurrence,
  useResumeOccurrence,
} from '@/lib/queries/occurrences'
import type { ActiveSession } from '@/lib/meetings/types'

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
  // Only an admin acts on a session. Everyone else who can see this bar — a
  // shepherd reading /meetings — gets the same information and no buttons; a
  // control that 403s is worse than no control.
  const { user } = useAuth()
  const canAct = user?.label === 'admin'
  const dialog = useDialog()
  const active = useActiveSession()
  const close = useCloseOccurrence()
  const pause = usePauseOccurrence()
  const resume = useResumeOccurrence()
  const [error, setError] = useState<string | null>(null)

  const session = active.data?.ok ? active.data.session : null
  const paused = active.data?.ok ? active.data.paused : []

  // A REFUSAL IS NOT AN ABSENCE.
  //
  // `resolveSessions()` throws when more than one occurrence is open, and
  // `apiFetch` turns that 409 into a rejected query — so `data` is undefined
  // and the usual `data?.ok ? data.session : null` renders it as "no session
  // open". That is the worst possible reading: the kiosks are still scanning,
  // the operator is told nothing is running, and every End button is hidden
  // behind the session that will not resolve. Say what actually happened.
  const refusal =
    active.error?.message ??
    (active.data && !active.data.ok ? active.data.error : null)

  const run = async <T extends { ok: boolean; error?: string }>(p: Promise<T>) => {
    setError(null)
    const res = await p.catch((e: Error) => {
      setError(e.message)
      return null
    })
    if (res && !res.ok) setError(res.error ?? 'That did not work.')
  }

  const handleClose = async (target: ActiveSession) => {
    const ok = await dialog.confirm({
      title: `End ${target.meeting.name}?`,
      message:
        'Kiosks will stop accepting scans immediately and the attendance count will be frozen. ' +
        'You can then activate the next session.',
      confirmText: 'End session',
      tone: 'danger',
    })
    if (!ok) return
    await run(close.mutateAsync({ occurrence_id: target.occurrence.$id }))
  }

  const handlePause = async (target: ActiveSession) => {
    const ok = await dialog.confirm({
      title: `Pause ${target.meeting.name}?`,
      message:
        'Kiosks stop accepting scans, but the session stays open and nothing is counted up yet — ' +
        'everyone already marked stays marked. You can activate another session while it is ' +
        'paused, then resume this one.',
      confirmText: 'Pause session',
    })
    if (!ok) return
    await run(pause.mutateAsync({ occurrence_id: target.occurrence.$id }))
  }

  const handleResume = async (target: ActiveSession) => {
    await run(resume.mutateAsync({ occurrence_id: target.occurrence.$id }))
  }

  if (refusal) {
    return (
      <Banner tone="error" className={className}>
        <span className="font-semibold">Cannot read the open session.</span> {refusal}
      </Banner>
    )
  }

  if (!session && paused.length === 0) return null
  const busy = close.isPending || pause.isPending || resume.isPending

  return (
    <div className={['space-y-3', className ?? ''].join(' ')}>
      {session && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border-2 border-primary-500 bg-primary-50 px-4 py-3 dark:bg-primary-900/20">
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
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button outline href="/monitor">
              Live view
            </Button>
            {canAct && (
              <>
                <Button outline onClick={() => handlePause(session)} disabled={busy}>
                  {pause.isPending ? 'Pausing…' : 'Pause'}
                </Button>
                <Button color="red" onClick={() => handleClose(session)} disabled={busy}>
                  {close.isPending ? 'Ending…' : 'End session'}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {paused.map((p) => (
        <div
          key={p.occurrence.$id}
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 dark:border-neutral-600 dark:bg-neutral-800/60"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span aria-hidden className="size-2 rounded-full bg-neutral-400" />
              <span className="text-xs font-semibold tracking-wide text-neutral-600 uppercase dark:text-neutral-300">
                Session paused
              </span>
            </div>
            <p className="mt-0.5 font-semibold text-neutral-950 dark:text-white">
              {p.meeting.name}
              <span className="ml-2 font-normal text-sm text-neutral-600 dark:text-neutral-300">
                {p.occurrence.paused_at
                  ? `paused ${formatTime(p.occurrence.paused_at)}`
                  : 'not taking scans'}
              </span>
            </p>
          </div>
          {canAct && (
            <div className="flex shrink-0 flex-wrap gap-3">
              <Button color="primary" onClick={() => handleResume(p)} disabled={busy}>
                {resume.isPending ? 'Resuming…' : 'Resume'}
              </Button>
              <Button plain onClick={() => handleClose(p)} disabled={busy}>
                End session
              </Button>
            </div>
          )}
        </div>
      ))}

      {error && (
        <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
