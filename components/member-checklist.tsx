'use client'

// Tick which members are authorised for a meeting.
//
// The roster PERSISTS — this same component opens with the existing selection
// already ticked when a meeting is edited, which is what makes a meeting
// reusable without re-choosing everybody (PRD §1.4).

import { useMemo, useState } from 'react'
import { Button } from '@/shared/Button'
import { Checkbox } from '@/shared/Checkbox'
import Input from '@/shared/Input'
import Avatar from '@/shared/Avatar'
import { LoadingRow } from '@/components/ui'
import { useMembers } from '@/lib/queries/members'
import { memberPhotoUrl } from '@/lib/members/photo'
import { fullName, initials } from '@/lib/members/types'

export default function MemberChecklist({
  selected,
  onChange,
}: {
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [search, setSearch] = useState('')
  const [onlySelected, setOnlySelected] = useState(false)
  // Only active members can be marked present, so offering inactive ones here
  // would build a roster with dead entries in it.
  const { data, isLoading } = useMembers({ status: 'active' })

  const all = useMemo(() => (data?.ok ? data.members : []), [data])

  const visible = useMemo(() => {
    let list = all
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((m) => fullName(m).toLowerCase().includes(q))
    if (onlySelected) list = list.filter((m) => selected.has(m.$id))
    return list
  }, [all, search, onlySelected, selected])

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  // Select-all applies to what is CURRENTLY VISIBLE, not the whole registry —
  // filtering to "Choir" and hitting select-all should add the choir, not
  // everybody.
  const allVisibleSelected = visible.length > 0 && visible.every((m) => selected.has(m.$id))

  const toggleVisible = () => {
    const next = new Set(selected)
    if (allVisibleSelected) for (const m of visible) next.delete(m.$id)
    else for (const m of visible) next.add(m.$id)
    onChange(next)
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Search members…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button plain onClick={toggleVisible} disabled={visible.length === 0}>
          {allVisibleSelected ? 'Unselect' : 'Select'} {search ? 'these' : 'all'} ({visible.length})
        </Button>
        <Button plain onClick={() => setOnlySelected((v) => !v)}>
          {onlySelected ? 'Show everyone' : `Show selected (${selected.size})`}
        </Button>
        <span className="ml-auto text-sm font-medium text-neutral-600 dark:text-neutral-300">
          {selected.size} authorised
        </span>
      </div>

      <div className="max-h-96 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700">
        {isLoading ? (
          <LoadingRow label="Loading members…" />
        ) : visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
            {all.length === 0 ? 'No active members yet.' : 'Nobody matches that search.'}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {visible.map((m) => {
              const photo = memberPhotoUrl(m.photo_file_id, 64)
              const isOn = selected.has(m.$id)
              return (
                <li key={m.$id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                    <Checkbox checked={isOn} onChange={() => toggle(m.$id)} color="amber" />
                    <Avatar
                      src={photo}
                      initials={photo ? undefined : initials(m)}
                      className="size-8 bg-primary-500 text-neutral-950"
                      alt={fullName(m)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        {fullName(m)}
                      </span>
                      <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                        {m.call_number}
                        {!m.enrolment.complete && ' · fingerprints incomplete'}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
        Only these members can be marked present at this meeting. Anyone else who scans is told,
        by name, that they do not have access to it. This has no effect on the two Sunday services,
        which stay open to everyone.
      </p>
    </div>
  )
}
