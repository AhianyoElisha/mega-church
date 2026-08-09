'use client'

// The live view. Realtime pushes each arrival; the polled aggregate is the
// backstop that reconciles the totals if a websocket message is ever missed.

import { useEffect, useState } from 'react'
import { SignalIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import Avatar from '@/shared/Avatar'
import { Banner, Card, EmptyState, LoadingRow, PageHeader, PageWrap, StatCard } from '@/components/ui'
import { useActiveSession } from '@/lib/queries/occurrences'
import { useAttendanceRecords, useLiveStats } from '@/lib/queries/attendance'
import { subscribeToOccurrence } from '@/lib/realtime/attendance'
import { memberPhotoUrl } from '@/lib/members/photo'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queries/keys'

function timeOf(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Africa/Accra',
    }).format(new Date(iso))
  } catch {
    return '—'
  }
}

export default function MonitorPage() {
  const qc = useQueryClient()
  const active = useActiveSession(15_000)
  const session = active.data?.ok ? active.data.session : null
  const occurrenceId = session?.occurrence.$id ?? null

  const stats = useLiveStats(occurrenceId)
  const records = useAttendanceRecords(occurrenceId)
  /**
   * Only ever set to 'live' by a message actually ARRIVING.
   *
   * `client.subscribe()` resolves whether or not the websocket ever connects —
   * the SDK reconnects in the background and reports failures to the console
   * only. Flipping the badge on subscribe therefore shows a green "Live" over
   * a socket that is failing every second, which is precisely the kind of
   * lying status light this codebase exists to avoid. Traffic is the only
   * proof available, so traffic is what the badge waits for.
   */
  const [realtimeConfirmed, setRealtimeConfirmed] = useState(false)

  // Subscribe for the life of this occurrence. A new arrival invalidates both
  // queries rather than being spliced in by hand — the server stays the single
  // source of truth for what a count means.
  useEffect(() => {
    if (!occurrenceId) return
    let teardown: (() => void) | null = null
    let cancelled = false
    setRealtimeConfirmed(false)

    subscribeToOccurrence(occurrenceId, () => {
      setRealtimeConfirmed(true)
      qc.invalidateQueries({ queryKey: queryKeys.attendanceLive(occurrenceId) })
      qc.invalidateQueries({ queryKey: queryKeys.attendanceRecords(occurrenceId) })
    })
      .then((fn) => {
        if (cancelled) fn()
        else teardown = fn
      })
      .catch(() => {
        // No websocket at all. The 15s poll still keeps this page correct, so
        // there is nothing to show the user beyond the cadence they already
        // see in the badge.
      })

    return () => {
      cancelled = true
      teardown?.()
    }
  }, [occurrenceId, qc])

  if (active.isLoading) {
    return (
      <PageWrap>
        <Card padded={false}>
          <LoadingRow />
        </Card>
      </PageWrap>
    )
  }

  if (!session) {
    return (
      <PageWrap>
        <PageHeader title="Live attendance" />
        <EmptyState
          icon={SignalIcon}
          title="No session is open"
          message="Activate a service or a meeting to start taking attendance."
          action={
            <Button color="primary" href="/services">
              Go to services
            </Button>
          }
        />
      </PageWrap>
    )
  }

  const s = stats.data?.ok ? stats.data.stats : null
  const rows = records.data?.ok ? records.data.records : []
  const pct = s && s.expected > 0 ? Math.min(100, Math.round((s.present / s.expected) * 100)) : 0

  return (
    <PageWrap>
      <PageHeader
        title={session.meeting.name}
        subtitle={
          session.meeting.restricted
            ? `Authorised members only · ${session.roster_size} on the list`
            : 'Open to every active member'
        }
        actions={
          <>
            <Badge color={realtimeConfirmed ? 'green' : 'yellow'}>
              {realtimeConfirmed ? '● Live' : 'Refreshing every 15s'}
            </Badge>
            <Button outline href={`/api/reports/export?occurrence_id=${session.occurrence.$id}`}>
              Export register
            </Button>
          </>
        }
      />

      {active.data?.ok === false && (
        <Banner tone="error" className="mb-6">
          {active.data.error}
        </Banner>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Present" value={s?.present ?? '—'} accent />
        <StatCard label="Expected" value={s?.expected ?? '—'} />
        <StatCard label="Still to come" value={s?.outstanding ?? '—'} />
        <StatCard
          label="By fingerprint"
          value={s?.by_method.biometric ?? '—'}
          hint={s ? `${s.by_method.manual} marked manually` : undefined}
        />
      </div>

      {s && s.expected > 0 && (
        <Card className="mb-6">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
              Turnout
            </span>
            <span className="text-sm font-semibold text-neutral-900 tabular-nums dark:text-white">
              {pct}%
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
            <div
              className="h-full rounded-full bg-primary-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Turnout"
            />
          </div>
        </Card>
      )}

      <Card padded={false}>
        <h2 className="px-5 pt-5 pb-3 text-base font-semibold text-neutral-950 dark:text-white">
          Arrivals
        </h2>
        {records.isLoading ? (
          <LoadingRow />
        ) : rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-neutral-400 dark:text-neutral-500">
            Nobody has checked in yet.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {rows.map((r) => {
              const photo = memberPhotoUrl(r.member.photo_file_id, 64)
              return (
                <li key={r.$id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar
                    src={photo}
                    initials={photo ? undefined : r.member.full_name.slice(0, 2).toUpperCase()}
                    className="size-9 bg-primary-500 text-neutral-950"
                    alt={r.member.full_name}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-neutral-900 dark:text-neutral-100">
                    {r.member.full_name}
                  </span>
                  <Badge color={r.method === 'biometric' ? 'green' : 'yellow'}>
                    {r.method === 'biometric' ? 'Fingerprint' : 'Manual'}
                  </Badge>
                  <span className="w-14 shrink-0 text-right text-sm text-neutral-400 tabular-nums">
                    {timeOf(r.marked_at)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </PageWrap>
  )
}
