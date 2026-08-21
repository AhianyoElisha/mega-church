'use client'

// Sunday downloads.
//
// The unit here is the DAY, not a session: a Sunday holds two services, and
// "who was absent" is only answerable once both are accounted for. Per-session
// exports still exist on the history table below for meetings.
//
// Two shapes, one component:
//
//   no `constituency` prop   the admin's Reports page. Offers the whole church
//                            plus a per-constituency picker.
//   `constituency` given     the group's own page, for an admin OR the head who
//                            runs it. Fixed to that group, so a head has no
//                            control that could ask for somebody else's people —
//                            and the server refuses it anyway if they try.

import { useState } from 'react'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import Input from '@/shared/Input'
import Select from '@/shared/Select'
import { Card } from '@/components/ui'
import { todayInAccra } from '@/lib/attendance/occurrenceResolver'
import { useConstituencies } from '@/lib/queries/groups'

type Scope = 'first' | 'second' | 'absent' | 'all'

/** Sentinel for "one workbook, every constituency, tabs per group". Not a real
 *  id, and never sent as `constituency_id` — it switches the request to
 *  `by=constituency` instead. */
const EVERY = '__every__'

const SCOPES: { scope: Scope; label: string; hint: string; primary?: boolean }[] = [
  {
    scope: 'first',
    label: 'First Service',
    hint: 'Everyone marked present at First Service (Psalms Chapel).',
  },
  {
    scope: 'second',
    label: 'Second Service',
    hint: 'Everyone marked present at Second Service.',
  },
  {
    scope: 'absent',
    label: 'Absent',
    hint: 'Active members who were at neither service — the call list.',
  },
  {
    scope: 'all',
    label: 'All three, one workbook',
    hint: 'One file with three tabs — First Service, Second Service, Absent.',
    primary: true,
  },
]

/** Opened in a new tab so the client router never intercepts the download and
 *  navigates to the .xlsx instead of saving it. */
function href(date: string, scope: Scope, constituencyId: string | null): string {
  const params = new URLSearchParams({ date, scope })
  if (constituencyId === EVERY) params.set('by', 'constituency')
  else if (constituencyId) params.set('constituency_id', constituencyId)
  return `/api/reports/export?${params.toString()}`
}

export default function DayExport({
  constituency,
}: {
  /** Fixes every download to one group. Given on a group's own page. */
  constituency?: { id: string; name: string }
} = {}) {
  const [date, setDate] = useState(() => todayInAccra())
  const [group, setGroup] = useState<string>('')
  const fixed = constituency ?? null

  // Only fetched for the admin's picker. A head cannot enumerate
  // constituencies — that API answers a leader with 403 — so when the group is
  // fixed the request is not made at all, rather than made and swallowed.
  const constituencies = useConstituencies({ enabled: !fixed })
  const selected = fixed ? fixed.id : group || null

  const options = constituencies.data?.ok ? constituencies.data.constituencies : []

  return (
    <Card className="mb-6">
      <h2 className="text-base font-semibold text-neutral-950 dark:text-white">
        {fixed ? `Download a Sunday — ${fixed.name}` : 'Download a Sunday'}
      </h2>
      <p className="mt-1 mb-5 text-sm text-neutral-500 dark:text-neutral-400">
        {fixed ? (
          <>
            Only members of {fixed.name}. Every sheet carries the call number and WhatsApp number,
            so the list can be worked down by phone.
          </>
        ) : (
          <>
            Every sheet carries the member&apos;s call number and WhatsApp number, so the list can
            be worked down by phone.
          </>
        )}
      </p>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 sm:max-w-xl">
        <div>
          <label
            htmlFor="export-date"
            className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
          >
            Date
          </label>
          <Input
            id="export-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {!fixed && (
          <div>
            <label
              htmlFor="export-group"
              className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Constituency
            </label>
            <Select
              id="export-group"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              disabled={constituencies.isLoading}
            >
              <option value="">The whole church</option>
              {options.map((c) => (
                <option key={c.$id} value={c.$id}>
                  {c.name}
                </option>
              ))}
              <option value={EVERY}>Every constituency, one workbook</option>
            </Select>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {SCOPES.map((s) => (
          <div
            key={s.scope}
            className="flex flex-col gap-2 rounded-xl bg-neutral-50 p-4 dark:bg-neutral-900/40"
          >
            {/* `Button`'s props are a discriminated union — colour and outline
                cannot both be passed, even as undefined — so the two variants
                are separate elements rather than one with a ternary. */}
            {s.primary ? (
              <Button
                color="primary"
                href={href(date, s.scope, selected)}
                target="_blank"
                rel="noreferrer"
              >
                <ArrowDownTrayIcon data-slot="icon" />
                {s.label}
              </Button>
            ) : (
              <Button
                outline
                href={href(date, s.scope, selected)}
                target="_blank"
                rel="noreferrer"
              >
                <ArrowDownTrayIcon data-slot="icon" />
                {s.label}
              </Button>
            )}
            <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
              {selected === EVERY
                ? `${s.hint} One tab per constituency.`
                : s.hint}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">
        If a service was not held on the chosen date the sheet says so in its header — otherwise a
        day with no service would look identical to a day everybody missed.
      </p>
    </Card>
  )
}
