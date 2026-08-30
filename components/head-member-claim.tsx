'use client'

// A group head claiming members who belong to no constituency yet.
//
// Deliberately NOT `GroupMemberAssigner`. That component is the admin's tool:
// it filters across every constituency, it can remove people, and assigning
// through it MOVES a member out of wherever they were. Reusing it here with
// half the controls hidden would put a head one prop away from powers the
// server refuses anyway — and hidden controls are how a UI ends up disagreeing
// with the rules underneath it.
//
// What a head can do is narrower and is the whole of this file: see the people
// nobody has claimed, tick the ones who live in their area, add them.

import { useMemo, useState } from 'react'
import { UserGroupIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Checkbox } from '@/shared/Checkbox'
import Input from '@/shared/Input'
import Avatar from '@/shared/Avatar'
import { Banner, EmptyState, LoadingRow } from '@/components/ui'
import { useUnassignedMembers } from '@/lib/queries/groups'
import { memberPhotoUrl } from '@/lib/members/photo'
import { fullName, initials, birthdayLabel } from '@/lib/members/types'
import { matchesMemberSearch } from '@/lib/members/search'

export default function HeadMemberClaim({
  constituencyId,
  groupName,
  busy,
  onClaim,
}: {
  constituencyId: string
  groupName: string
  busy?: boolean
  /** Resolves with how many were actually added — the server skips anybody who
   *  gained a constituency between this list loading and the button. */
  onClaim: (memberIds: string[]) => Promise<{ added: number; skipped: number }>
}) {
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useUnassignedMembers(constituencyId)
  const all = useMemo(() => (data?.ok ? data.members : []), [data])

  const visible = useMemo(() => {
    if (!search.trim()) return all
    return all.filter((m) => matchesMemberSearch(m, search, { phone: true }))
  }, [all, search])

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submit = async () => {
    setError(null)
    setNotice(null)
    try {
      const res = await onClaim([...picked])
      setPicked(new Set())
      setNotice(
        res.skipped > 0
          ? `${res.added} added to ${groupName}. ${res.skipped} were claimed by another ` +
            `constituency while you were choosing, so they were left alone.`
          : `${res.added} member${res.added === 1 ? '' : 's'} added to ${groupName}.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add those members.')
    }
  }

  if (isLoading) return <LoadingRow />

  if (all.length === 0) {
    return (
      <EmptyState
        icon={UserGroupIcon}
        title="Everybody has a constituency"
        message="There is nobody left unassigned to claim. New members appear here as they are registered."
      />
    )
  }

  return (
    <div>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        These {all.length} members have not been placed in any constituency yet. Tick the ones who
        live in {groupName} and add them.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by name, phone or member no"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        {picked.size > 0 && (
          <Button plain onClick={() => setPicked(new Set())}>
            Clear ({picked.size})
          </Button>
        )}
        <Button color="primary" onClick={submit} disabled={picked.size === 0 || busy}>
          {busy
            ? 'Adding…'
            : `Add ${picked.size} to ${groupName}`}
        </Button>
      </div>

      {error && <Banner tone="error" className="mb-4">{error}</Banner>}
      {notice && (
        <Banner tone="success" className="mb-4" onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      {/* Only somebody who has never been assigned appears here, so there is no
          "you are about to move this person" warning to give — that case cannot
          arise, and the server refuses it if it somehow does. */}
      <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {visible.map((m) => (
          <li key={m.$id}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900/40">
              <Checkbox checked={picked.has(m.$id)} onChange={() => toggle(m.$id)} />
              <Avatar
                src={memberPhotoUrl(m.photo_file_id)}
                initials={initials(m)}
                className="size-9"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-neutral-950 dark:text-white">
                  {fullName(m)}
                </span>
                <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {m.call_number}
                  {birthdayLabel(m) && ` · ${birthdayLabel(m)}`}
                </span>
              </span>
            </label>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Nobody unassigned matches “{search}”.
          </li>
        )}
      </ul>
    </div>
  )
}
