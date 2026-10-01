'use client'

// One session's register, readable in the app.
//
// The Reports page lists every session with a headcount; this is the roll
// behind one of them — who was expected, who came and when, who did not —
// without downloading a spreadsheet. The Export button is still here for
// anybody who wants the sheet.

import { use, useMemo, useState } from 'react'
import { ClipboardDocumentListIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import Avatar from '@/shared/Avatar'
import Input from '@/shared/Input'
import Select from '@/shared/Select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/table'
import { Banner, Card, EmptyState, LoadingRow, PageHeader, PageWrap, StatCard, TabBar } from '@/components/ui'
import { useOccurrenceRegister } from '@/lib/queries/attendance'
import { memberPhotoUrl } from '@/lib/members/photo'
import {
  BASIS_LABEL,
  registerSummary,
  type ExpectedBasis,
  type RegisterRow,
} from '@/lib/reports/register'

type Tab = 'present' | 'absent' | 'all'

/** Sentinel for the constituency filter's "nobody has one" bucket. Not an id. */
const NO_CONSTITUENCY = '__none__'

/** Africa/Accra wall clock, or a dash. */
function timeOf(iso: string | null): string {
  if (!iso) return '—'
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

/** The Accra calendar day of an instant, `YYYY-MM-DD`, or null. */
function accraDay(iso: string | null): string | null {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Africa/Accra',
    }).format(new Date(iso))
  } catch {
    return null
  }
}

/**
 * A time on the session's own day reads as a bare clock; one on a later day
 * says so. A Second Service nobody remembered to end until the small hours
 * reads "closed 02:25 the next day", not "closed 02:25", which would have an
 * admin wondering how a service ended before it began.
 */
function timeOn(iso: string | null, sessionDay: string): string {
  const t = timeOf(iso)
  const day = accraDay(iso)
  if (!day || day === sessionDay) return t
  const next = new Date(`${sessionDay}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return day === next.toISOString().slice(0, 10) ? `${t} the next day` : `${t} on ${day}`
}

/** `2026-10-04` as "Sunday 4 October 2026". The date is a calendar day in
 *  Accra, so it is formatted as one rather than parsed as a UTC instant and
 *  shifted by the viewer's own clock. */
function dateOf(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))))
  } catch {
    return ymd
  }
}

export default function SessionRegisterPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 16: route params are a promise, unwrapped with `use()` in a client
  // component page.
  const { id } = use(params)
  const register = useOccurrenceRegister(id)

  const [tab, setTab] = useState<Tab>('present')
  const [search, setSearch] = useState('')
  const [constituency, setConstituency] = useState('')

  const data = register.data?.ok ? register.data : null
  const rows = useMemo(() => data?.rows ?? [], [data])
  const summary = useMemo(() => registerSummary(rows), [rows])

  const constituencyName = useMemo(() => {
    const names = new Map((data?.constituencies ?? []).map((c) => [c.id, c.name]))
    return (cid: string | null) => (cid ? (names.get(cid) ?? 'Unknown constituency') : null)
  }, [data])

  const hasUnplaced = useMemo(() => rows.some((r) => !r.member.constituency_id), [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (tab === 'present' && !r.present) return false
      if (tab === 'absent' && (r.present || !r.expected)) return false
      if (constituency === NO_CONSTITUENCY && r.member.constituency_id) return false
      if (constituency && constituency !== NO_CONSTITUENCY && r.member.constituency_id !== constituency)
        return false
      if (q) {
        const name = r.member.full_name.toLowerCase()
        const no = r.member.member_no ?? ''
        if (!name.includes(q) && !no.startsWith(q)) return false
      }
      return true
    })
  }, [rows, tab, search, constituency])

  if (register.isLoading) {
    return (
      <PageWrap>
        <Card padded={false}>
          <LoadingRow />
        </Card>
      </PageWrap>
    )
  }

  if (!data) {
    return (
      <PageWrap>
        <PageHeader title="Session" back={{ href: '/reports', label: 'Reports' }} />
        <EmptyState
          icon={ClipboardDocumentListIcon}
          title="No such session"
          message={
            register.data?.ok === false
              ? register.data.error
              : (register.error?.message ?? 'It may have been removed.')
          }
          action={
            <Button color="primary" href="/reports">
              Back to reports
            </Button>
          }
        />
      </PageWrap>
    )
  }

  const { occurrence, meeting, companion, parent, basis } = data
  const isSave = meeting.service_slot === 'save'
  const live = occurrence.status !== 'closed'
  const day = occurrence.occurrence_date
  const when =
    `${dateOf(day)} · opened ${timeOn(occurrence.opened_at, day)}` +
    (occurrence.closed_at
      ? ` · closed ${timeOn(occurrence.closed_at, day)}`
      : occurrence.status === 'paused'
        ? ' · paused'
        : ' · still open')

  const tabs: { value: Tab; label: string }[] = [
    { value: 'present', label: `Present (${summary.present})` },
    { value: 'absent', label: `Absent (${summary.absent})` },
    { value: 'all', label: `Everyone (${rows.length})` },
  ]

  return (
    <PageWrap>
      <PageHeader
        title={meeting.name}
        subtitle={when}
        back={{ href: '/reports', label: 'Reports' }}
        actions={
          <>
            {live && (
              <Button color="primary" href="/monitor">
                Live view
              </Button>
            )}
            {companion && (
              <Button outline href={`/reports/${companion.occurrence.$id}`}>
                {companion.meeting.name} register
              </Button>
            )}
            {parent && (
              <Button outline href={`/reports/${parent.occurrence.$id}`}>
                {parent.meeting.name} register
              </Button>
            )}
            <Button outline href={`/api/reports/export?occurrence_id=${occurrence.$id}`}>
              Export
            </Button>
          </>
        }
      />

      {live && (
        <Banner tone="info" className="mb-6">
          This session is {occurrence.status === 'paused' ? 'paused' : 'still open'}. The
          register below is a snapshot; the live view updates as people arrive.
        </Banner>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Present" value={summary.present} accent />
        <StatCard label="Expected" value={summary.expected} hint={BASIS_LABEL[basis]} />
        <StatCard label="Absent" value={summary.absent} />
        <StatCard
          label="By fingerprint"
          value={summary.by_method.biometric}
          hint={`${summary.by_method.manual} marked manually`}
        />
        {companion && (
          <StatCard
            label={companion.meeting.name}
            value={companion.present}
            hint="Children marked at the children’s service"
          />
        )}
      </div>

      <Card className="mb-4" padded={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or member no…"
            aria-label="Search the register"
            className="sm:max-w-xs"
          />
          {(data.constituencies.length > 0 || hasUnplaced) && (
            <Select
              value={constituency}
              onChange={(e) => setConstituency(e.target.value)}
              aria-label="Filter by constituency"
              className="sm:max-w-xs"
            >
              <option value="">All constituencies</option>
              {data.constituencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {hasUnplaced && <option value={NO_CONSTITUENCY}>No constituency</option>}
            </Select>
          )}
          <TabBar tabs={tabs} value={tab} onChange={setTab} className="sm:ml-auto" />
        </div>
      </Card>

      {visible.length === 0 ? (
        <EmptyState
          icon={ClipboardDocumentListIcon}
          title={
            search || constituency
              ? 'Nobody matches'
              : tab === 'present'
                ? 'Nobody was marked present'
                : tab === 'absent'
                  ? 'Nobody was absent'
                  : 'Nobody expected'
          }
          message={
            search || constituency
              ? 'Clear the search or the constituency filter.'
              : tab === 'present' && live
                ? 'Nobody has checked in yet.'
                : tab === 'absent'
                  ? 'Everyone expected was there.'
                  : 'Nobody is on the expected list for this session.'
          }
        />
      ) : (
        <Table grid striped>
          <TableHead>
            <TableRow>
              <TableHeader>Name</TableHeader>
              <TableHeader>Member no.</TableHeader>
              <TableHeader>Constituency</TableHeader>
              <TableHeader>{isSave ? 'Parent or guardian' : 'Call number'}</TableHeader>
              {tab === 'all' && <TableHeader>Present</TableHeader>}
              <TableHeader>Marked at</TableHeader>
              <TableHeader>Method</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((r) => (
              <RegisterTableRow
                key={r.member.$id}
                row={r}
                showPresent={tab === 'all'}
                constituency={constituencyName(r.member.constituency_id)}
                basis={basis}
              />
            ))}
          </TableBody>
        </Table>
      )}

      <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">
        Expected means {BASIS_LABEL[basis]}
        {basis === 'adults' && ' — children who scanned were marked at Save Church instead'}. A mark
        for somebody no longer on that list is kept and labelled rather than dropped. Marked at is
        the first mark of the session, in Accra time.
      </p>
    </PageWrap>
  )
}

function RegisterTableRow({
  row,
  showPresent,
  constituency,
  basis,
}: {
  row: RegisterRow
  showPresent: boolean
  constituency: string | null
  basis: ExpectedBasis
}) {
  const m = row.member
  const photo = memberPhotoUrl(m.photo_file_id, 64)
  return (
    <TableRow href={m.deleted ? undefined : `/members/${m.$id}`}>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar
            src={photo}
            initials={photo ? undefined : m.full_name.slice(0, 2).toUpperCase()}
            className="size-8 bg-primary-500 text-neutral-950"
            alt={m.full_name}
          />
          <div className="min-w-0">
            <div className="font-medium text-neutral-950 dark:text-white">{m.full_name}</div>
            {!row.expected && (
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                {m.deleted
                  ? 'Record since deleted'
                  : m.status === 'inactive'
                    ? 'Marked present; inactive since'
                    : basis === 'adults' && m.member_type === 'child'
                      ? 'Marked present; since moved to Save Church'
                      : basis === 'children' && m.member_type !== 'child'
                        ? 'Marked present; no longer a Save Church child'
                        : 'Marked present; not on the expected list'}
              </div>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="tabular-nums">{m.member_no ?? '—'}</TableCell>
      <TableCell>
        {constituency ?? <span className="text-neutral-400 dark:text-neutral-500">—</span>}
      </TableCell>
      <TableCell className="tabular-nums">
        {m.call_number ?? <span className="text-neutral-400 dark:text-neutral-500">—</span>}
        {m.member_type === 'child' && m.guardian_name && (
          <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">{m.guardian_name}</span>
        )}
      </TableCell>
      {showPresent && (
        <TableCell>
          <Badge color={row.present ? 'green' : 'zinc'}>{row.present ? 'Yes' : 'No'}</Badge>
        </TableCell>
      )}
      <TableCell className="tabular-nums">{timeOf(row.marked_at)}</TableCell>
      <TableCell>
        {row.method ? (
          <Badge color={row.method === 'biometric' ? 'green' : 'yellow'}>
            {row.method === 'biometric' ? 'Fingerprint' : 'Manual'}
          </Badge>
        ) : (
          <span className="text-neutral-400 dark:text-neutral-500">—</span>
        )}
      </TableCell>
    </TableRow>
  )
}
