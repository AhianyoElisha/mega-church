'use client'

// Activate and end sessions.
//
// The single-active-session rule (PRD §2.2) is enforced on the server. This
// page's job is to make it OBVIOUS rather than surprising: while something is
// open, every other Activate button is disabled and says which session is
// blocking it, so nobody clicks and gets a 409 they have to interpret.

import { useState } from 'react'
import { CalendarDaysIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import { Banner, Card, EmptyState, LoadingRow, PageHeader, PageWrap, StatCard } from '@/components/ui'
import { useDialog } from '@/components/dialog'
import { useMeetings } from '@/lib/queries/meetings'
import { useActivateOccurrence, useActiveSession, useCloseOccurrence } from '@/lib/queries/occurrences'
import { useLiveStats } from '@/lib/queries/attendance'
import { SERVICE_IDS } from '@/lib/appwrite/config'

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

export default function ServicesPage() {
  const dialog = useDialog()
  const meetings = useMeetings()
  const active = useActiveSession(15_000)
  const activate = useActivateOccurrence()
  const close = useCloseOccurrence()
  const [error, setError] = useState<string | null>(null)

  const session = active.data?.ok ? active.data.session : null
  const stats = useLiveStats(session?.occurrence.$id ?? null)

  const rows = meetings.data?.ok ? meetings.data.meetings.filter((m) => !m.archived) : []
  const services = rows.filter((m) => m.kind === 'service')
  const others = rows.filter((m) => m.kind === 'meeting')

  const handleActivate = async (meetingId: string, name: string) => {
    setError(null)
    const res = await activate.mutateAsync({ meeting_id: meetingId }).catch((e: Error) => {
      setError(e.message)
      return null
    })
    if (res && !res.ok) setError(res.error)
    else if (res?.ok) {
      await dialog.alert({
        title: `${name} is open`,
        message: 'Kiosks will start accepting scans within a few seconds.',
      })
    }
  }

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
    const res = await close.mutateAsync({ occurrence_id: session.occurrence.$id })
    if (!res.ok) setError(res.error)
  }

  const blockedBy = session?.meeting.name ?? null

  return (
    <PageWrap>
      <PageHeader
        title="Services & sessions"
        subtitle="One session runs at a time. End the open one before starting the next."
      />

      {error && (
        <Banner tone="error" className="mb-6" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {/* The open session, if any. */}
      {session ? (
        <Card className="mb-8 border-primary-500! bg-primary-50! dark:bg-primary-900/20!">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <span aria-hidden className="size-2 animate-pulse rounded-full bg-primary-600" />
                <span className="text-xs font-semibold tracking-wide text-primary-800 uppercase dark:text-primary-300">
                  Session open
                </span>
              </div>
              <h2 className="text-2xl font-bold text-neutral-950 dark:text-white">
                {session.meeting.name}
              </h2>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                Started {formatTime(session.occurrence.opened_at)} ·{' '}
                {session.meeting.restricted
                  ? `${session.roster_size} authorised member${session.roster_size === 1 ? '' : 's'}`
                  : 'Open to every active member'}
              </p>
            </div>
            <div className="flex gap-3">
              <Button outline href="/monitor">
                Live view
              </Button>
              <Button color="red" onClick={handleClose} disabled={close.isPending}>
                {close.isPending ? 'Ending…' : 'End session'}
              </Button>
            </div>
          </div>

          {stats.data?.ok && (
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <StatCard label="Present" value={stats.data.stats.present} accent />
              <StatCard label="Expected" value={stats.data.stats.expected} />
              <StatCard
                label="By fingerprint"
                value={stats.data.stats.by_method.biometric}
                hint={`${stats.data.stats.by_method.manual} marked manually`}
              />
            </div>
          )}
        </Card>
      ) : (
        <Banner tone="info" className="mb-8">
          No session is open. Activate one below to start taking attendance.
        </Banner>
      )}

      <h2 className="mb-3 text-sm font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
        Sunday services
      </h2>
      {meetings.isLoading ? (
        <Card padded={false}>
          <LoadingRow />
        </Card>
      ) : (
        <div className="mb-10 grid gap-4 sm:grid-cols-2">
          {services.map((m) => {
            const isOpen = session?.meeting.$id === m.$id
            const disabled = !!session
            return (
              <Card key={m.$id} className={isOpen ? 'border-primary-500!' : undefined}>
                <div className="flex h-full flex-col">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-neutral-950 dark:text-white">
                        {m.name}
                      </h3>
                      <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                        {m.description}
                      </p>
                    </div>
                    {isOpen && <Badge color="green">Open</Badge>}
                  </div>

                  <p className="mb-4 text-xs text-neutral-400 dark:text-neutral-500">
                    Open to every active member. Last held {m.last_held ?? 'never'}.
                  </p>

                  <div className="mt-auto">
                    {isOpen ? (
                      <Button color="red" onClick={handleClose} disabled={close.isPending}>
                        End {m.name}
                      </Button>
                    ) : (
                      <>
                        <Button
                          color="primary"
                          onClick={() => handleActivate(m.$id, m.name)}
                          disabled={disabled || activate.isPending}
                        >
                          Activate {m.name}
                        </Button>
                        {disabled && (
                          // Naming the blocker is the whole point — "end First
                          // Service first" is actionable; a greyed-out button
                          // on its own is a puzzle.
                          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                            End {blockedBy} first
                            {m.$id === SERVICE_IDS.second && blockedBy?.includes('First')
                              ? ' — the two services cannot overlap.'
                              : '.'}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          Other meetings
        </h2>
        <Button plain href="/meetings">
          Manage meetings
        </Button>
      </div>

      {others.length === 0 ? (
        <EmptyState
          icon={CalendarDaysIcon}
          title="No meetings yet"
          message="Create a meeting and choose who is allowed to attend it."
          action={
            <Button color="primary" href="/meetings/new">
              Create a meeting
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {others.map((m) => {
            const isOpen = session?.meeting.$id === m.$id
            const disabled = !!session
            return (
              <Card key={m.$id} className={isOpen ? 'border-primary-500!' : undefined}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-neutral-950 dark:text-white">{m.name}</h3>
                  {isOpen && <Badge color="green">Open</Badge>}
                </div>
                <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
                  {m.roster_size} authorised · last held {m.last_held ?? 'never'}
                </p>
                {isOpen ? (
                  <Button color="red" onClick={handleClose} disabled={close.isPending}>
                    End
                  </Button>
                ) : (
                  <Button
                    outline
                    onClick={() => handleActivate(m.$id, m.name)}
                    disabled={disabled || activate.isPending || m.roster_size === 0}
                  >
                    Activate
                  </Button>
                )}
                {!isOpen && m.roster_size === 0 && (
                  // An empty roster would refuse everybody at the door.
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                    Nobody is authorised yet — add members first.
                  </p>
                )}
                {!isOpen && disabled && m.roster_size > 0 && (
                  <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                    End {blockedBy} first.
                  </p>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </PageWrap>
  )
}
