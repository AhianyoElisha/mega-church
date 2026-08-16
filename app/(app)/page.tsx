'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import Avatar from '@/shared/Avatar'
import { Button } from '@/shared/Button'
import { Banner, Card, LoadingRow, PageHeader, PageWrap, StatCard } from '@/components/ui'
import { apiFetch } from '@/lib/queries/fetcher'
import { queryKeys } from '@/lib/queries/keys'
import { memberPhotoUrl } from '@/lib/members/photo'
import type { DashboardResponse } from '@/app/api/dashboard/route'

export default function DashboardPage() {
  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey: queryKeys.dashboard,
    queryFn: () => apiFetch('/api/dashboard'),
    refetchInterval: 60_000,
  })

  if (isLoading) {
    return (
      <PageWrap>
        <Card padded={false}>
          <LoadingRow />
        </Card>
      </PageWrap>
    )
  }

  const d = data
  const session = d?.session ?? null

  return (
    <PageWrap>
      <PageHeader
        title="Overview"
        subtitle="Attendance at a glance."
        actions={
          session ? (
            <Button color="primary" href="/monitor">
              Live view
            </Button>
          ) : (
            <Button color="primary" href="/services">
              Start a session
            </Button>
          )
        }
      />

      {session ? (
        <Banner tone="warning" className="mb-8">
          <strong>{session.meeting.name}</strong> is open now.{' '}
          <Link href="/monitor" className="underline">
            Watch it live
          </Link>
          .
        </Banner>
      ) : (
        <Banner tone="info" className="mb-8">
          No session is open. Kiosks are idle until you activate one.
        </Banner>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Members" value={d?.members.total ?? '—'} />
        <StatCard label="Active" value={d?.members.active ?? '—'} />
        <StatCard label="Fully enrolled" value={d?.members.fully_enrolled ?? '—'} />
        <StatCard
          label="Need fingerprints"
          value={d?.members.needs_enrolment ?? '—'}
          hint="Active members a scanner cannot yet recognise"
          accent={(d?.members.needs_enrolment ?? 0) > 0}
        />
      </div>

      {(d?.members.needs_enrolment ?? 0) > 0 && (
        <Banner tone="warning" className="mb-8">
          {d!.members.needs_enrolment} active member
          {d!.members.needs_enrolment === 1 ? '' : 's'} still need fingerprints. They will be
          turned away by a scanner and have to be marked in by hand.{' '}
          <Link href="/members" className="underline">
            Review the registry
          </Link>
          .
        </Banner>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-base font-semibold text-neutral-950 dark:text-white">
            Recent sessions
          </h2>
          {(d?.recent.length ?? 0) === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              No sessions have been held yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {d!.recent.map((r) => (
                <li
                  key={r.$id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3 py-2.5 text-sm dark:bg-neutral-700/40"
                >
                  <span className="min-w-0 truncate font-medium text-neutral-800 dark:text-neutral-200">
                    {r.meeting_name}
                  </span>
                  <span className="shrink-0 text-neutral-400 tabular-nums">
                    {r.occurrence_date}
                  </span>
                  <span className="w-16 shrink-0 text-right font-semibold text-neutral-900 tabular-nums dark:text-white">
                    {r.present_count}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Button plain href="/reports">
              All reports
            </Button>
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold text-neutral-950 dark:text-white">
              {/* Tomorrow, not today. The flyer has to be made before the day —
                  see BIRTHDAY_LEAD_DAYS. */}
              Birthdays tomorrow
            </h2>
            <Link href="/birthdays" className="text-sm text-primary-600 hover:underline">
              All birthdays
            </Link>
          </div>
          {(d?.birthdays.length ?? 0) === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Nobody is celebrating tomorrow.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {d!.birthdays.map((b) => {
                const photo = memberPhotoUrl(b.photo_file_id, 64)
                return (
                  <li key={b.$id}>
                    <Link
                      href={`/members/${b.$id}`}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    >
                      <Avatar
                        src={photo}
                        initials={photo ? undefined : b.full_name.slice(0, 2).toUpperCase()}
                        className="size-9 bg-primary-500 text-neutral-950"
                        alt={b.full_name}
                      />
                      <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        {b.full_name}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          {d?.birthdays_for && (
            <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">
              For {d.birthdays_for}. The birthday team is notified automatically each morning.
            </p>
          )}
        </Card>
      </div>
    </PageWrap>
  )
}
