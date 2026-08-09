'use client'

// Sunday downloads.
//
// The unit here is the DAY, not a session: a Sunday holds two services, and
// "who was absent" is only answerable once both are accounted for. Per-session
// exports still exist on the history table below for meetings.

import { useState } from 'react'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import Input from '@/shared/Input'
import { Card } from '@/components/ui'
import { todayInAccra } from '@/lib/attendance/occurrenceResolver'

type Scope = 'first' | 'second' | 'absent' | 'all'

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
function href(date: string, scope: Scope): string {
  return `/api/reports/export?date=${encodeURIComponent(date)}&scope=${scope}`
}

export default function DayExport() {
  const [date, setDate] = useState(() => todayInAccra())

  return (
    <Card className="mb-6">
      <h2 className="text-base font-semibold text-neutral-950 dark:text-white">
        Download a Sunday
      </h2>
      <p className="mt-1 mb-5 text-sm text-neutral-500 dark:text-neutral-400">
        Every sheet carries the member&apos;s call number and WhatsApp number, so the list can be
        worked down by phone.
      </p>

      <div className="mb-5 max-w-xs">
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
              <Button color="primary" href={href(date, s.scope)} target="_blank" rel="noreferrer">
                <ArrowDownTrayIcon data-slot="icon" />
                {s.label}
              </Button>
            ) : (
              <Button outline href={href(date, s.scope)} target="_blank" rel="noreferrer">
                <ArrowDownTrayIcon data-slot="icon" />
                {s.label}
              </Button>
            )}
            <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
              {s.hint}
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
