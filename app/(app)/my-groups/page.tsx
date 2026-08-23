'use client'

// A head's home.
//
// The switch between "Constituencies" and "Bacentas" is the whole point of the
// single `leader` label: the same person often heads both, and asking them to
// keep two logins to see the two halves of their own work is what this page
// exists to avoid. Someone who heads only one kind never sees the switch —
// there is nothing to switch to, and an inert tab is just noise.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { MapPinIcon, UserGroupIcon } from '@heroicons/react/24/outline'
import { Badge } from '@/shared/Badge'
import {
  Card,
  EmptyState,
  LoadingRow,
  PageHeader,
  PageWrap,
  StatCard,
  TabBar,
} from '@/components/ui'
import { useAuth } from '@/components/auth'
import { useMyGroups } from '@/lib/queries/groups'
import type { GroupKind } from '@/lib/groups/types'

export default function MyGroupsPage() {
  const { user } = useAuth()
  const { data, isLoading } = useMyGroups()
  const [kind, setKind] = useState<GroupKind | null>(null)

  const constituencies = data?.ok ? data.constituencies : []
  const bacentas = data?.ok ? data.bacentas : []

  const hasBoth = constituencies.length > 0 && bacentas.length > 0
  // Default to whichever they actually have, so a head of one bacenta lands on
  // their bacenta rather than on an empty constituencies tab.
  const active: GroupKind = kind ?? (constituencies.length > 0 ? 'constituency' : 'bacenta')

  const totalMembers = useMemo(
    () =>
      active === 'constituency'
        ? constituencies.reduce((n, c) => n + c.member_count, 0)
        : bacentas.reduce((n, b) => n + b.member_count, 0),
    [active, constituencies, bacentas],
  )

  const isAdmin = user?.label === 'admin'

  if (isLoading) {
    return (
      <PageWrap>
        <Card padded={false}>
          <LoadingRow />
        </Card>
      </PageWrap>
    )
  }

  if (constituencies.length === 0 && bacentas.length === 0) {
    return (
      <PageWrap>
        <PageHeader title="My groups" />
        {/*
          Not an error and not a 403. A leader account with nothing attached is
          an account created before the appointment was recorded — a normal
          state on the day somebody is given the job. Saying so beats a blank
          page that reads as a broken login.
        */}
        <EmptyState
          icon={UserGroupIcon}
          title="Nothing assigned to you yet"
          message="You are signed in, but no constituency or bacenta names you as its head. Ask an administrator to appoint you, then reload this page."
        />
      </PageWrap>
    )
  }

  return (
    <PageWrap>
      <PageHeader
        title={isAdmin ? 'All groups' : 'My groups'}
        subtitle={
          isAdmin
            ? 'Every constituency and bacenta in the church.'
            : 'The groups you are responsible for.'
        }
      />

      {hasBoth && (
        <TabBar
          className="mb-6"
          value={active}
          onChange={setKind}
          tabs={[
            { value: 'constituency', label: `Constituencies (${constituencies.length})` },
            { value: 'bacenta', label: `Bacentas (${bacentas.length})` },
          ]}
        />
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <StatCard
          label={active === 'constituency' ? 'Constituencies you head' : 'Bacentas you head'}
          value={active === 'constituency' ? constituencies.length : bacentas.length}
        />
        <StatCard label="Members in them" value={totalMembers} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {active === 'constituency'
          ? constituencies.map((c) => (
              <GroupTile
                key={c.$id}
                href={`/constituencies/${c.$id}`}
                name={c.name}
                description={c.description}
                count={c.member_count}
                icon="constituency"
              />
            ))
          : bacentas.map((b) => (
              <GroupTile
                key={b.$id}
                href={`/bacentas/${b.$id}`}
                name={b.name}
                description={b.description}
                count={b.member_count}
                subtitle={b.category_name}
                icon="bacenta"
              />
            ))}
      </div>

      {!isAdmin && (
        <p className="mt-8 text-sm text-neutral-400 dark:text-neutral-500">
          You can see and correct your members&rsquo; details, and register new members into a
          constituency you head. Moving somebody between groups, marking them inactive, and
          enrolling fingerprints are all done by an administrator.
        </p>
      )}
    </PageWrap>
  )
}

function GroupTile({
  href,
  name,
  description,
  subtitle,
  count,
  icon,
}: {
  href: string
  name: string
  description: string | null
  subtitle?: string | null
  count: number
  icon: 'constituency' | 'bacenta'
}) {
  const Icon = icon === 'constituency' ? MapPinIcon : UserGroupIcon
  return (
    <Link
      href={href}
      className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-900/5 transition hover:ring-primary-500/50 dark:bg-neutral-800 dark:ring-white/10"
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-primary-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-neutral-950 dark:text-white">{name}</p>
          {subtitle && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</p>
          )}
          {description && (
            <p className="mt-1 line-clamp-2 text-sm text-neutral-500 dark:text-neutral-400">
              {description}
            </p>
          )}
          <div className="mt-3">
            <Badge color={count > 0 ? 'green' : 'zinc'}>
              {count === 0 ? 'Nobody yet' : `${count} member${count === 1 ? '' : 's'}`}
            </Badge>
          </div>
        </div>
      </div>
    </Link>
  )
}
