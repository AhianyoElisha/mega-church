'use client'

// The birthday team's screen.
//
// The lead time is the reason this page exists. The church used to see
// birthdays on the day, which is too late for anyone who has to design a flyer
// and schedule a post — so the first and largest block is TOMORROW, and today
// is demoted to a footnote because that work is already done or already late.

import { useState } from 'react'
import Link from 'next/link'
import { CakeIcon } from '@heroicons/react/24/outline'
import Avatar from '@/shared/Avatar'
import { Badge } from '@/shared/Badge'
import { Button } from '@/shared/Button'
import { Banner, Card, EmptyState, LoadingRow, PageHeader, PageWrap } from '@/components/ui'
import PushManager from '@/components/push-manager'
import { useAuth } from '@/components/auth'
import { useBirthdays, useSendBirthdayNotification } from '@/lib/queries/birthdays'
import { memberPhotoUrl } from '@/lib/members/photo'
import { daysAwayLabel, monthDayLabel, type Celebrant } from '@/lib/birthdays/upcoming'

export default function BirthdaysPage() {
  const { user } = useAuth()
  const { data, isLoading } = useBirthdays()
  const send = useSendBirthdayNotification()
  const [sendResult, setSendResult] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  const isAdmin = user?.label === 'admin'

  const handleSend = async () => {
    setSendResult(null)
    setSendError(null)
    try {
      const res = await send.mutateAsync()
      if (!res.ok) {
        setSendError(res.error)
        return
      }
      setSendResult(describeRun(res))
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'The notification did not go out.')
    }
  }

  if (isLoading) {
    return (
      <PageWrap>
        <Card padded={false}>
          <LoadingRow label="Loading birthdays…" />
        </Card>
      </PageWrap>
    )
  }

  const toPrepare = data?.to_prepare ?? []
  const todayCelebrants = data?.today_celebrants ?? []
  // Everything past tomorrow — tomorrow already has its own block above.
  const later = (data?.upcoming ?? []).filter((c) => c.days_away > (data?.lead_days ?? 1))

  return (
    <PageWrap>
      <PageHeader
        title="Birthdays"
        subtitle="Who is celebrating, a day ahead — so the flyer and the shoutout are ready in time."
        actions={
          isAdmin && (
            <Button color="primary" onClick={handleSend} disabled={send.isPending}>
              {send.isPending ? 'Sending…' : 'Send notification now'}
            </Button>
          )
        }
      />

      {sendResult && (
        <Banner tone="success" className="mb-6" onDismiss={() => setSendResult(null)}>
          {sendResult}
        </Banner>
      )}
      {sendError && (
        <Banner tone="error" className="mb-6" onDismiss={() => setSendError(null)}>
          {sendError}
        </Banner>
      )}

      <section className="mb-8">
        <h2 className="mb-3 flex items-baseline gap-3 text-sm font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          Tomorrow — prepare these
          {toPrepare.length > 0 && <Badge color="yellow">{toPrepare.length}</Badge>}
        </h2>
        {toPrepare.length === 0 ? (
          <Card>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Nobody is celebrating tomorrow. Nothing to prepare.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {toPrepare.map((c) => (
              <CelebrantCard key={c.$id} celebrant={c} prominent linkable={isAdmin} />
            ))}
          </div>
        )}
      </section>

      {todayCelebrants.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
            Celebrating today
          </h2>
          <Card padded={false}>
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-700">
              {todayCelebrants.map((c) => (
                <CelebrantRow key={c.$id} celebrant={c} linkable={isAdmin} />
              ))}
            </ul>
          </Card>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          Coming up
        </h2>
        {later.length === 0 ? (
          <EmptyState
            icon={CakeIcon}
            title="Nothing else this month"
            message="Birthdays appear here as they approach. Members with no birthday recorded never appear — add one on their member page."
          />
        ) : (
          <Card padded={false}>
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-700">
              {later.map((c) => (
                <CelebrantRow key={c.$id} celebrant={c} linkable={isAdmin} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      <PushManager />

      <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">
        The alert goes out automatically each morning for the next day&rsquo;s birthdays. It is
        sent once per day — pressing &ldquo;Send notification now&rdquo; after it has already
        gone will not send it twice.
      </p>
    </PageWrap>
  )
}

function CelebrantCard({
  celebrant,
  prominent,
  linkable,
}: {
  celebrant: Celebrant
  prominent?: boolean
  linkable?: boolean
}) {
  const photo = memberPhotoUrl(celebrant.photo_file_id, 128)
  const inner = (
    <>
      <Avatar
        src={photo}
        initials={photo ? undefined : celebrant.full_name.slice(0, 2).toUpperCase()}
        className={prominent ? 'size-16 bg-primary-500 text-neutral-950' : 'size-10 bg-primary-500 text-neutral-950'}
        alt={celebrant.full_name}
      />
      <div className="min-w-0">
        <p className="truncate text-lg font-semibold text-neutral-950 dark:text-white">
          {celebrant.full_name}
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {monthDayLabel(celebrant.birth_month, celebrant.birth_day)}
        </p>
        {/* The number the shoutout goes out on. WhatsApp when it differs,
            because that is where the message is actually sent. */}
        <p className="mt-1 text-sm text-neutral-600 tabular-nums dark:text-neutral-300">
          {celebrant.whatsapp_number ?? celebrant.call_number}
          {celebrant.whatsapp_number && celebrant.whatsapp_number !== celebrant.call_number && (
            <span className="ml-1 text-xs text-neutral-400">WhatsApp</span>
          )}
        </p>
      </div>
    </>
  )

  const className =
    'flex items-center gap-4 rounded-2xl bg-primary-50 p-5 shadow-sm ring-1 ring-primary-500/40 dark:bg-primary-900/20 dark:ring-primary-500/30'

  return linkable ? (
    <Link href={`/members/${celebrant.$id}`} className={`${className} transition hover:ring-primary-500`}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  )
}

function CelebrantRow({ celebrant, linkable }: { celebrant: Celebrant; linkable?: boolean }) {
  const photo = memberPhotoUrl(celebrant.photo_file_id, 64)
  const inner = (
    <>
      <Avatar
        src={photo}
        initials={photo ? undefined : celebrant.full_name.slice(0, 2).toUpperCase()}
        className="size-9 bg-primary-500 text-neutral-950"
        alt={celebrant.full_name}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {celebrant.full_name}
        </span>
        <span className="block text-xs text-neutral-500 dark:text-neutral-400">
          {monthDayLabel(celebrant.birth_month, celebrant.birth_day)} ·{' '}
          {celebrant.whatsapp_number ?? celebrant.call_number}
        </span>
      </span>
      {/* Colour AND a word — the days-away label is the information, the tint
          is only emphasis (PRD §2.4). */}
      <Badge color={celebrant.days_away === 0 ? 'green' : celebrant.days_away <= 7 ? 'yellow' : 'zinc'}>
        {daysAwayLabel(celebrant.days_away)}
      </Badge>
    </>
  )

  return (
    <li>
      {linkable ? (
        <Link
          href={`/members/${celebrant.$id}`}
          className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          {inner}
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">{inner}</div>
      )}
    </li>
  )
}

function describeRun(res: {
  status: 'sent' | 'already_sent' | 'nobody_celebrating' | 'no_subscribers'
  sent: number
  failed: number
  celebrant_count: number
}): string {
  switch (res.status) {
    case 'sent':
      return (
        `Sent to ${res.sent} device${res.sent === 1 ? '' : 's'}` +
        (res.failed > 0 ? `, ${res.failed} failed.` : '.')
      )
    case 'already_sent':
      return 'Today’s notification has already gone out. Nobody was alerted twice.'
    case 'nobody_celebrating':
      return 'Nobody is celebrating tomorrow, so no notification was sent.'
    case 'no_subscribers':
      return 'Nobody has turned notifications on yet. Use the panel below to enable them on this device.'
  }
}
