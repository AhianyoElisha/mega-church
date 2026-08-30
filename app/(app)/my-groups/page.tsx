'use client'

// A head's home.
//
// The switch between "Constituencies", "Bacentas" and "Basontas" is the whole
// point of the single `leader` label: the same person often heads more than
// one, and asking them to keep separate logins to see the parts of their own
// work is what this page exists to avoid. Someone who heads only one kind never
// sees the switch — there is nothing to switch to, and an inert tab is noise.

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
  const basontas = data?.ok ? data.basontas : []

  // Two or more populated kinds is what earns the switch.
  const kindsHeld = [constituencies.length, bacentas.length, basontas.length].filter(
    (n) => n > 0,
  ).length
  const hasSeveral = kindsHeld > 1
  // Default to whichever they actually have, so a head of one basonta lands on
  // their basonta rather than on an empty constituencies tab.
  const active: GroupKind =
    kind ??
    (constituencies.length > 0 ? 'constituency' : bacentas.length > 0 ? 'bacenta' : 'basonta')

  const totalMembers = useMemo(() => {
    const list =
      active === 'constituency' ? constituencies : active === 'bacenta' ? bacentas : basontas
    return list.reduce((n, g) => n + g.member_count, 0)
  }, [active, constituencies, bacentas, basontas])

  // A shepherd gets the same whole-church list an admin does — the API already
  // serves them everything, so the heading and the footer must agree with it.
  const isAdmin = user?.label === 'admin' || user?.label === 'shepherd'

  if (isLoading) {
    return (
      <PageWrap>
        <Card padded={false}>
          <LoadingRow />
        </Card>
      </PageWrap>
    )
  }

  if (constituencies.length === 0 && bacentas.length === 0 && basontas.length === 0) {
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
          message="You are signed in, but no constituency, bacenta or basonta names you as its head. Ask an administrator to appoint you, then reload this page."
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
            ? 'Every constituency, bacenta and basonta in the church.'
            : 'The groups you are responsible for.'
        }
      />

      {hasSeveral && (
        <TabBar
          className="mb-6"
          value={active}
          onChange={setKind}
          // Only the kinds they actually head. An inert "Basontas (0)" tab is
          // an invitation to click on nothing.
          tabs={[
            ...(constituencies.length > 0
              ? [{ value: 'constituency' as const, label: `Constituencies (${constituencies.length})` }]
              : []),
            ...(bacentas.length > 0
              ? [{ value: 'bacenta' as const, label: `Bacentas (${bacentas.length})` }]
              : []),
            ...(basontas.length > 0
              ? [{ value: 'basonta' as const, label: `Basontas (${basontas.length})` }]
              : []),
          ]}
        />
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <StatCard
          label={
            active === 'constituency'
              ? 'Constituencies you head'
              : active === 'bacenta'
                ? 'Bacentas you head'
                : 'Basontas you head'
          }
          value={
            active === 'constituency'
              ? constituencies.length
              : active === 'bacenta'
                ? bacentas.length
                : basontas.length
          }
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
          : active === 'bacenta'
            ? bacentas.map((b) => (
                <GroupTile
                  key={b.$id}
                  href={`/bacentas/${b.$id}`}
                  name={b.name}
                  description={b.description}
                  count={b.member_count}
                  subtitle={b.constituency_name}
                  icon="bacenta"
                />
              ))
            : basontas.map((b) => (
                <GroupTile
                  key={b.$id}
                  href={`/basontas/${b.$id}`}
                  name={b.name}
                  description={b.description}
                  count={b.member_count}
                  subtitle={b.category_name}
                  icon="basonta"
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
  icon: GroupKind
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
          {/* All three are free text from the database. `min-w-0` on the
              parent lets the column shrink; `wrap-anywhere` is what lets the
              TEXT shrink with it. Without it a long unbroken group name took
              the page to 1075px inside a 390px screen. */}
          <p className="wrap-anywhere font-semibold text-neutral-950 dark:text-white">{name}</p>
          {subtitle && (
            <p className="wrap-anywhere text-xs text-neutral-500 dark:text-neutral-400">
              {subtitle}
            </p>
          )}
          {description && (
            <p className="mt-1 line-clamp-2 wrap-anywhere text-sm text-neutral-500 dark:text-neutral-400">
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
