'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { UsersIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import Avatar from '@/shared/Avatar'
import Input from '@/shared/Input'
import Select from '@/shared/Select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/table'
import { Card, EmptyState, LoadingRow, PageHeader, PageWrap } from '@/components/ui'
import { useAuth } from '@/components/auth'
import { useMembers } from '@/lib/queries/members'
import { useConstituencies } from '@/lib/queries/groups'
import { memberPhotoUrl } from '@/lib/members/photo'
import { birthdayLabel, fullName, initials } from '@/lib/members/types'
import { TEMPLATES_PER_MEMBER } from '@/lib/appwrite/config'

export default function MembersPage() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [enrolment, setEnrolment] = useState('')
  const [constituency, setConstituency] = useState('')
  const [service, setService] = useState('')

  const constituencies = useConstituencies()

  // The API's fulltext search needs two characters; below that, send nothing
  // and let the client filter the full list rather than firing a useless query.
  //
  // Constituency goes to the SERVER (it is an indexed field) while the
  // "unassigned" case is filtered here — Appwrite cannot express "is null" as
  // a query, so asking for it server-side would return everybody.
  //
  // Service is server-side for the same reason as constituency: it is an
  // indexed enum with no null case, so there is nothing to fix up afterwards.
  const { data, isLoading } = useMembers({
    search: search.trim().length >= 2 ? search.trim() : undefined,
    status: status || undefined,
    constituency: constituency && constituency !== '__none__' ? constituency : undefined,
    service: service || undefined,
  })

  // Every filter, so the empty state can tell "nothing matches" from "nobody is
  // registered". Listing them individually is how `constituency` came to be
  // left out of that test, which offered "Register a member" to an admin whose
  // only problem was a filter set to a constituency nobody is in yet.
  const filtered = Boolean(search || status || enrolment || constituency || service)

  const rows = useMemo(() => {
    let list = data?.ok ? data.members : []
    if (search.trim().length === 1) {
      const q = search.trim().toLowerCase()
      list = list.filter((m) => fullName(m).toLowerCase().includes(q))
    }
    if (enrolment === 'complete') list = list.filter((m) => m.enrolment.complete)
    if (enrolment === 'incomplete') list = list.filter((m) => !m.enrolment.complete)
    // The one filter the server cannot do — see the note on `useMembers`.
    if (constituency === '__none__') list = list.filter((m) => !m.constituency_id)
    return list
  }, [data, search, enrolment, constituency])

  const isAdmin = user?.label === 'admin'

  return (
    <PageWrap>
      <PageHeader
        title="Members"
        subtitle="Everyone registered with the church."
        actions={
          isAdmin && (
            <Button color="primary" href="/members/new">
              Register a member
            </Button>
          )
        }
      />

      <Card className="mb-6" padded={false}>
        {/* `grid-cols-1`, not a bare `grid`: an implicit column takes a floor
            from its widest item and refuses to shrink below it, which is what
            put /sms into a horizontal scroll on a phone. Five controls at
            three across, so the last row is the two narrowest. */}
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </Select>
          <Select value={enrolment} onChange={(e) => setEnrolment(e.target.value)}>
            <option value="">Any enrolment</option>
            <option value="complete">Fully enrolled</option>
            <option value="incomplete">Needs enrolment</option>
          </Select>
          {/* Which service the member usually attends. A filter on the
              REGISTRY only: attendance is never gated by `home_service`, and
              anyone here may be marked present at either service (PRD §2.1). */}
          <Select value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">Any service</option>
            <option value="first">First Service</option>
            <option value="second">Second Service</option>
          </Select>
          <Select value={constituency} onChange={(e) => setConstituency(e.target.value)}>
            <option value="">Any constituency</option>
            <option value="__none__">No constituency yet</option>
            {(constituencies.data?.ok ? constituencies.data.constituencies : []).map((c) => (
              <option key={c.$id} value={c.$id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {isLoading ? (
        <Card padded={false}>
          <LoadingRow label="Loading members…" />
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={filtered ? 'No members match those filters' : 'No members yet'}
          message={
            filtered
              ? 'Try widening the search.'
              : 'Register the first member to start taking attendance.'
          }
          action={
            isAdmin && !filtered ? (
              <Button color="primary" href="/members/new">
                Register a member
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
            {rows.length} member{rows.length === 1 ? '' : 's'}
          </p>
          <Table dense grid striped>
            <TableHead>
              <TableRow>
                <TableHeader>Name</TableHeader>
                <TableHeader>Call number</TableHeader>
                <TableHeader>Birthday</TableHeader>
                <TableHeader>Fingerprints</TableHeader>
                <TableHeader>Status</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((m) => {
                const photo = memberPhotoUrl(m.photo_file_id, 64)
                return (
                  <TableRow key={m.$id} href={`/members/${m.$id}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={photo}
                          initials={photo ? undefined : initials(m)}
                          className="size-9 bg-primary-500 text-neutral-950"
                          alt={fullName(m)}
                        />
                        <div className="min-w-0">
                          <span className="block truncate font-medium text-neutral-950 dark:text-white">
                            {fullName(m)}
                          </span>
                          <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                            {m.home_service === 'first' ? 'First Service' : 'Second Service'}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">{m.call_number}</TableCell>
                    <TableCell>
                      {birthdayLabel(m) ?? <span className="text-neutral-400">—</span>}
                    </TableCell>
                    <TableCell>
                      {/* Both a colour and a word. Someone half-enrolled will
                          be turned away by a scanner, so it has to be legible
                          at a glance. */}
                      <Badge color={m.enrolment.complete ? 'green' : m.enrolment.template_count > 0 ? 'yellow' : 'zinc'}>
                        {m.enrolment.complete
                          ? 'Complete'
                          : m.enrolment.template_count > 0
                            ? `${m.enrolment.template_count}/${TEMPLATES_PER_MEMBER}`
                            : 'None'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge color={m.status === 'active' ? 'green' : 'zinc'}>
                        {m.status === 'active' ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </>
      )}

      {user?.label === 'shepherd' ? (
        <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">
          You are signed in as a shepherd. You can read the whole registry; changing it is an
          administrator&rsquo;s job.
        </p>
      ) : (
        !isAdmin && (
          <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">
            You are signed in as an usher. <Link href="/monitor" className="underline">Go to the live view</Link>{' '}
            to mark attendance.
          </p>
        )
      )}
    </PageWrap>
  )
}
