'use client'

// The student roll: who is at university, what they read, and which level they
// are at THIS academic year.
//
// Nothing here runs on a schedule. A student carries `level_year`, the year
// their level was last confirmed, and "due for update" is derived by comparing
// it with today's academic year (`lib/members/students.ts`). Once a year the
// church opens this page, filters to "Due", ticks everybody and presses
// Promote — or Repeat for the ones who stayed, Graduate for the ones who left.
//
// Admin writes; a shepherd reads. Every control is gated on `isAdmin` here so a
// shepherd is never offered a button that answers 403 — the API refusing is
// the enforcement, the gate is the courtesy.

import { useMemo, useState, type ReactNode } from 'react'
import { AcademicCapIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import Input from '@/shared/Input'
import Select from '@/shared/Select'
import { Checkbox } from '@/shared/Checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/table'
import {
  Banner,
  Card,
  EmptyState,
  LoadingRow,
  PageHeader,
  PageWrap,
  StatCard,
  TabBar,
} from '@/components/ui'
import { useAuth } from '@/components/auth'
import { useDialog } from '@/components/dialog'
import { useMembers, useStudentRollover, useUpdateMember } from '@/lib/queries/members'
import { fullName, type MemberWithEnrolment } from '@/lib/members/types'
import { matchesMemberSearch } from '@/lib/members/search'
import { todayInAccra } from '@/lib/attendance/occurrenceResolver'
import {
  academicYear,
  isDueForUpdate,
  levelLabel,
  levelOptions,
  type RolloverAction,
} from '@/lib/members/students'

const ACTION_COPY: Record<RolloverAction, { title: string; message: string; button: string }> = {
  promote: {
    title: 'Promote',
    message:
      'Each selected student goes up one level and is confirmed for this academic year. Anyone already at the top level, or with no level recorded, is skipped and named.',
    button: 'Promote',
  },
  repeat: {
    title: 'Repeat',
    message:
      'Each selected student keeps their level and is confirmed for this academic year, so they stop showing as due.',
    button: 'Confirm level',
  },
  graduate: {
    title: 'Graduate',
    message:
      'Each selected student becomes an adult member. Their programme, level and year are cleared.',
    button: 'Graduate',
  },
}

export default function StudentsPage() {
  const { user } = useAuth()
  const isAdmin = user?.label === 'admin'
  const dialog = useDialog()

  // Accra's today, exactly as the server stamps it, so the badge and the
  // rollover cannot disagree about which academic year it is.
  const today = todayInAccra()
  const year = academicYear(today)

  const students = useMembers({ type: 'student' })
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'all' | 'due'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<ReactNode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rollover = useStudentRollover()

  const all = useMemo(() => (students.data?.ok ? students.data.members : []), [students.data])
  const due = useMemo(() => all.filter((m) => isDueForUpdate(m, today)), [all, today])
  const rows = useMemo(() => {
    let list = view === 'due' ? due : all
    if (search.trim()) list = list.filter((m) => matchesMemberSearch(m, search))
    return list
  }, [all, due, view, search])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allVisibleSelected = rows.length > 0 && rows.every((m) => selected.has(m.$id))
  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(rows.map((m) => m.$id)))

  const runAction = async (action: RolloverAction) => {
    const ids = [...selected]
    if (ids.length === 0) return
    setError(null)
    setNotice(null)
    const copy = ACTION_COPY[action]
    const ok = await dialog.confirm({
      title: `${copy.title} ${ids.length} student${ids.length === 1 ? '' : 's'}?`,
      message: copy.message,
      confirmText: copy.button,
      tone: action === 'graduate' ? 'danger' : 'primary',
    })
    if (!ok) return
    try {
      const res = await rollover.mutateAsync({ member_ids: ids, action })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setNotice(
        <>
          <p>
            {res.updated} {action === 'graduate' ? 'graduated' : action === 'promote' ? 'promoted' : 'confirmed'}.
          </p>
          {res.failed.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {res.failed.map((f) => (
                <li key={f.member_id}>
                  <span className="font-medium">{f.name}</span> — {f.error}
                </li>
              ))}
            </ul>
          )}
        </>,
      )
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update those students.')
    }
  }

  return (
    <PageWrap>
      <PageHeader
        title="Students"
        subtitle={`University students on the roll. Academic year ${year}/${year + 1}.`}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Students" value={students.isLoading ? '…' : all.length} />
        <StatCard
          label="Due for update"
          value={students.isLoading ? '…' : due.length}
          hint="Level not yet confirmed this academic year"
          accent={due.length > 0}
        />
        <StatCard label="Academic year" value={`${year}/${String(year + 1).slice(2)}`} hint="Turns over in August" />
      </div>

      {notice && (
        <Banner tone="success" className="mb-4" onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {error && (
        <Banner tone="error" className="mb-4" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      <Card className="mb-4" padded={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <TabBar
            tabs={[
              { value: 'all', label: `All (${all.length})` },
              { value: 'due', label: `Due for update (${due.length})` },
            ]}
            value={view}
            onChange={setView}
          />
          <Input
            className="sm:max-w-xs"
            placeholder="Search by name or member no…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Card>

      {isAdmin && selected.size > 0 && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              <span className="font-semibold tabular-nums">{selected.size}</span> selected
            </p>
            <div className="flex flex-wrap gap-2">
              <Button color="primary" disabled={rollover.isPending} onClick={() => runAction('promote')}>
                Promote
              </Button>
              <Button outline disabled={rollover.isPending} onClick={() => runAction('repeat')}>
                Repeat (no change)
              </Button>
              <Button outline disabled={rollover.isPending} onClick={() => runAction('graduate')}>
                Graduate
              </Button>
              <Button plain onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        </Card>
      )}

      {students.isLoading ? (
        <Card padded={false}>
          <LoadingRow label="Loading students…" />
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={AcademicCapIcon}
          title={
            all.length === 0
              ? 'No students on the roll yet'
              : view === 'due'
                ? 'Nobody is due for an update'
                : 'No students match that search'
          }
          message={
            all.length === 0
              ? isAdmin
                ? 'Add students below, or mark members as students from the Members page.'
                : 'An administrator adds students from the Members page.'
              : undefined
          }
        />
      ) : (
        <Table dense grid striped>
          <TableHead>
            <TableRow>
              {isAdmin && (
                <TableHeader>
                  <Checkbox
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    color="amber"
                    aria-label="Select every student shown"
                  />
                </TableHeader>
              )}
              <TableHeader>Member no.</TableHeader>
              <TableHeader>Name</TableHeader>
              <TableHeader>Programme</TableHeader>
              <TableHeader>Level</TableHeader>
              <TableHeader>Confirmed</TableHeader>
              <TableHeader>Rollover</TableHeader>
              {isAdmin && <TableHeader className="sr-only">Edit</TableHeader>}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((m) => (
              <StudentRow
                key={m.$id}
                member={m}
                today={today}
                canEdit={isAdmin}
                selected={selected.has(m.$id)}
                onToggle={() => toggle(m.$id)}
                onError={setError}
              />
            ))}
          </TableBody>
        </Table>
      )}

      {isAdmin ? (
        <AddStudents />
      ) : (
        <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">
          You can read the roll; promoting, confirming and graduating students is an
          administrator&rsquo;s job.
        </p>
      )}
    </PageWrap>
  )
}

/**
 * One student. Reads as a row; for an admin, "Edit" turns the programme and
 * level cells into inputs and saves through the ordinary member PATCH — the
 * same route the member page uses, so the same validation applies and a level
 * saved here is stamped with this academic year exactly as one saved there.
 */
function StudentRow({
  member: m,
  today,
  canEdit,
  selected,
  onToggle,
  onError,
}: {
  member: MemberWithEnrolment
  today: string
  canEdit: boolean
  selected: boolean
  onToggle: () => void
  onError: (msg: string | null) => void
}) {
  const update = useUpdateMember()
  const [editing, setEditing] = useState(false)
  const [programme, setProgramme] = useState(m.programme ?? '')
  const [level, setLevel] = useState(m.level ? String(m.level) : '')
  const dueNow = isDueForUpdate(m, today)

  const startEdit = () => {
    setProgramme(m.programme ?? '')
    setLevel(m.level ? String(m.level) : '')
    setEditing(true)
  }

  const save = async () => {
    onError(null)
    try {
      const res = await update.mutateAsync({
        id: m.$id,
        programme: programme.trim() || null,
        level: level ? Number(level) : null,
      })
      if (!res.ok) {
        onError(res.error)
        return
      }
      setEditing(false)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save.')
    }
  }

  return (
    <TableRow href={editing || canEdit ? undefined : `/members/${m.$id}`}>
      {canEdit && (
        <TableCell>
          <Checkbox
            checked={selected}
            onChange={onToggle}
            color="amber"
            aria-label={`Select ${fullName(m)}`}
          />
        </TableCell>
      )}
      <TableCell className="tabular-nums whitespace-nowrap">
        {m.member_no ?? <span className="text-neutral-400">—</span>}
      </TableCell>
      <TableCell>
        <a href={`/members/${m.$id}`} className="font-medium text-neutral-950 hover:underline dark:text-white">
          {fullName(m)}
        </a>
        {m.status === 'inactive' && (
          <Badge color="zinc" className="ml-2">
            Inactive
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {editing ? (
          <Input
            value={programme}
            onChange={(e) => setProgramme(e.target.value)}
            placeholder="BSc Computer Science"
            sizeClass="h-9 px-3 py-1.5"
          />
        ) : (
          (m.programme ?? <span className="text-neutral-400">—</span>)
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {editing ? (
          <Select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">—</option>
            {levelOptions().map((l) => (
              <option key={l} value={l}>
                Level {l}
              </option>
            ))}
          </Select>
        ) : (
          levelLabel(m.level)
        )}
      </TableCell>
      <TableCell className="tabular-nums">
        {m.level_year ?? <span className="text-neutral-400">never</span>}
      </TableCell>
      <TableCell>
        {/* A word as well as a colour: the whole point of the column is to be
            scanned down once a year. */}
        {dueNow ? <Badge color="yellow">Due for update</Badge> : <Badge color="green">Up to date</Badge>}
      </TableCell>
      {canEdit && (
        <TableCell className="whitespace-nowrap">
          {editing ? (
            <span className="flex gap-1.5">
              <Button color="primary" onClick={save} disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button plain onClick={() => setEditing(false)} disabled={update.isPending}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button plain onClick={startEdit}>
              Edit
            </Button>
          )}
        </TableCell>
      )}
    </TableRow>
  )
}

/**
 * Move existing adults onto the roll, with their programme and level entered
 * inline. Searches ACTIVE ADULTS only — a child is not a candidate, and an
 * inactive member is not at church.
 *
 * The query is not fired until two characters are typed. The alternative,
 * loading every adult in the church to filter it here, is the whole registry
 * fetched again by a page that already holds the students.
 */
function AddStudents() {
  const [term, setTerm] = useState('')
  const ready = term.trim().length >= 2
  const candidates = useMembers(
    { type: 'adult', status: 'active', search: ready ? term.trim() : undefined },
    { enabled: ready },
  )
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)

  const list = candidates.data?.ok ? candidates.data.members : []

  return (
    <Card className="mt-8">
      <h2 className="text-base font-semibold text-neutral-950 dark:text-white">Add students</h2>
      <p className="mt-1 mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        Find an adult member and move them onto the roll with their programme and level. Their
        record stays exactly as it is otherwise.
      </p>
      <Input
        placeholder="Search active adults by name or member no…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      {added && (
        <Banner tone="success" className="mt-3" onDismiss={() => setAdded(null)}>
          {added} is now on the roll.
        </Banner>
      )}
      {error && (
        <Banner tone="error" className="mt-3" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {ready && (
        <div className="mt-3 max-h-96 overflow-y-auto rounded-xl bg-neutral-50 ring-1 ring-neutral-900/5 dark:bg-neutral-900/40 dark:ring-white/10">
          {candidates.isLoading ? (
            <LoadingRow label="Searching…" />
          ) : list.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">
              No active adult matches that.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-700">
              {list.slice(0, 25).map((m) => (
                <CandidateRow
                  key={m.$id}
                  member={m}
                  onAdded={(name) => {
                    setError(null)
                    setAdded(name)
                  }}
                  onError={setError}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

function CandidateRow({
  member: m,
  onAdded,
  onError,
}: {
  member: MemberWithEnrolment
  onAdded: (name: string) => void
  onError: (msg: string) => void
}) {
  const update = useUpdateMember()
  const [programme, setProgramme] = useState('')
  const [level, setLevel] = useState('')

  const add = async () => {
    try {
      const res = await update.mutateAsync({
        id: m.$id,
        member_type: 'student',
        programme: programme.trim() || null,
        level: level ? Number(level) : null,
      })
      if (!res.ok) {
        onError(res.error)
        return
      }
      onAdded(fullName(m))
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add that student.')
    }
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {fullName(m)}
        </span>
        <span className="block text-xs text-neutral-500 tabular-nums dark:text-neutral-400">
          {m.member_no ?? '—'}
        </span>
      </span>
      <Input
        className="sm:w-56"
        placeholder="Programme"
        value={programme}
        onChange={(e) => setProgramme(e.target.value)}
        sizeClass="h-9 px-3 py-1.5"
      />
      <Select className="sm:w-36" value={level} onChange={(e) => setLevel(e.target.value)}>
        <option value="">Level —</option>
        {levelOptions().map((l) => (
          <option key={l} value={l}>
            Level {l}
          </option>
        ))}
      </Select>
      <Button color="primary" onClick={add} disabled={update.isPending}>
        {update.isPending ? 'Adding…' : 'Add'}
      </Button>
    </li>
  )
}
