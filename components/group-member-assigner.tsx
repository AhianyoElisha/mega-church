'use client'

// Tick many members, assign them to a group in one action.
//
// This is the screen the church asked for by name: eighty people were
// registered before constituencies and bacentas existed, and filing them one
// member page at a time is not a thing anyone will actually finish.
//
// Shared by both group kinds because the interaction is identical, but the
// COPY is not — assigning to a constituency moves somebody out of where they
// were, assigning to a bacenta does not take anything away — and getting that
// wrong in either direction loses data quietly. See `noun`/`kind` below.

import { useMemo, useState } from 'react'
import { Button } from '@/shared/Button'
import { Checkbox } from '@/shared/Checkbox'
import Input from '@/shared/Input'
import Select from '@/shared/Select'
import Avatar from '@/shared/Avatar'
import { Badge } from '@/shared/Badge'
import { Banner, LoadingRow } from '@/components/ui'
import { useMembers } from '@/lib/queries/members'
import { memberPhotoUrl } from '@/lib/members/photo'
import { fullName, initials } from '@/lib/members/types'
import { matchesMemberSearch } from '@/lib/members/search'
import { useConstituencies } from '@/lib/queries/groups'
import type { GroupKind } from '@/lib/groups/types'

export default function GroupMemberAssigner({
  kind,
  groupName,
  /** Members already in this group — pre-ticked and shown as such. */
  currentMemberIds,
  onAssign,
  onRemove,
  busy,
}: {
  kind: GroupKind
  groupName: string
  currentMemberIds: string[]
  onAssign: (memberIds: string[]) => Promise<void>
  onRemove?: (memberIds: string[]) => Promise<void>
  busy?: boolean
}) {
  const [search, setSearch] = useState('')
  const [filterConstituency, setFilterConstituency] = useState('')
  const [filterAssigned, setFilterAssigned] = useState<'all' | 'unassigned' | 'in-group'>('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Only active members. Someone marked inactive cannot be scanned in, so
  // filing them into a bacenta builds a roster with dead entries in it.
  const { data, isLoading } = useMembers({ status: 'active' })
  const constituencies = useConstituencies()

  const current = useMemo(() => new Set(currentMemberIds), [currentMemberIds])
  const all = useMemo(() => (data?.ok ? data.members : []), [data])

  const visible = useMemo(() => {
    let list = all
    if (search.trim()) {
      list = list.filter((m) => matchesMemberSearch(m, search, { phone: true }))
    }
    if (filterConstituency === '__none__') {
      list = list.filter((m) => !m.constituency_id)
    } else if (filterConstituency) {
      list = list.filter((m) => m.constituency_id === filterConstituency)
    }
    if (filterAssigned === 'unassigned') list = list.filter((m) => !current.has(m.$id))
    if (filterAssigned === 'in-group') list = list.filter((m) => current.has(m.$id))
    return list
  }, [all, search, filterConstituency, filterAssigned, current])

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Select-all applies to what is CURRENTLY VISIBLE, not the whole registry.
   * Filtering to "everyone with no constituency" and pressing this should tick
   * those people, not all three thousand members.
   */
  const allVisiblePicked = visible.length > 0 && visible.every((m) => picked.has(m.$id))
  const toggleVisible = () => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (allVisiblePicked) for (const m of visible) next.delete(m.$id)
      else for (const m of visible) next.add(m.$id)
      return next
    })
  }

  const run = async (action: 'assign' | 'remove') => {
    setError(null)
    setNotice(null)
    const ids = [...picked]
    if (ids.length === 0) return
    try {
      if (action === 'assign') await onAssign(ids)
      else await onRemove?.(ids)
      setPicked(new Set())
      setNotice(
        action === 'assign'
          ? `${ids.length} member${ids.length === 1 ? '' : 's'} added to ${groupName}.`
          : `${ids.length} member${ids.length === 1 ? '' : 's'} removed from ${groupName}.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save. Try again.')
    }
  }

  // The one place the two kinds genuinely differ.
  const movesThem = kind === 'constituency'
  const alreadyElsewhere = movesThem
    ? [...picked].filter((id) => {
        const m = all.find((x) => x.$id === id)
        return m?.constituency_id && !current.has(id)
      }).length
    : 0

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input
          placeholder="Search name, phone or member no…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={filterConstituency}
          onChange={(e) => setFilterConstituency(e.target.value)}
        >
          <option value="">Any constituency</option>
          {/* The filter that makes the backlog tractable: show only the people
              who have not been filed anywhere yet. */}
          <option value="__none__">No constituency yet</option>
          {(constituencies.data?.ok ? constituencies.data.constituencies : []).map((c) => (
            <option key={c.$id} value={c.$id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={filterAssigned}
          onChange={(e) => setFilterAssigned(e.target.value as typeof filterAssigned)}
        >
          <option value="all">Everyone</option>
          <option value="unassigned">Not in {groupName}</option>
          <option value="in-group">Already in {groupName}</option>
        </Select>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Button plain onClick={toggleVisible} disabled={visible.length === 0}>
          {allVisiblePicked ? 'Unselect' : 'Select'} these ({visible.length})
        </Button>
        <span className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
          {picked.size} selected
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            color="primary"
            onClick={() => run('assign')}
            disabled={busy || picked.size === 0}
          >
            {busy ? 'Saving…' : `Add to ${groupName}`}
          </Button>
          {onRemove && (
            <Button
              plain
              onClick={() => run('remove')}
              disabled={busy || picked.size === 0}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      {/*
        Warn BEFORE the click, not after. A constituency is one-per-member, so
        adding somebody who already lives somewhere else silently moves them —
        which is usually intended, and occasionally a mis-click that nobody
        would otherwise notice until that constituency's count dropped.
      */}
      {alreadyElsewhere > 0 && (
        <Banner tone="warning" className="mb-3">
          {alreadyElsewhere} of the selected member{alreadyElsewhere === 1 ? ' is' : 's are'}{' '}
          already in another constituency. A member lives in exactly one, so adding them here
          moves them out of the other.
        </Banner>
      )}
      {!movesThem && picked.size > 0 && (
        <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
          A member can serve in several bacentas at once — adding them here does not take them
          out of any other.
        </p>
      )}

      {notice && (
        <Banner tone="success" className="mb-3" onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {error && (
        <Banner tone="error" className="mb-3" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      <div className="max-h-[28rem] overflow-y-auto rounded-xl bg-neutral-50 ring-1 ring-neutral-900/5 dark:bg-neutral-900/40 dark:ring-white/10">
        {isLoading ? (
          <LoadingRow label="Loading members…" />
        ) : visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
            {all.length === 0 ? 'No active members yet.' : 'Nobody matches those filters.'}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {visible.map((m) => {
              const photo = memberPhotoUrl(m.photo_file_id, 64)
              const inGroup = current.has(m.$id)
              return (
                <li key={m.$id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <Checkbox
                      checked={picked.has(m.$id)}
                      onChange={() => toggle(m.$id)}
                      color="amber"
                    />
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
                      </span>
                    </span>
                    {inGroup && <Badge color="green">In {groupName}</Badge>}
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
