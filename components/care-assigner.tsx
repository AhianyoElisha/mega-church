'use client'

// Who looks after whom, inside one bacenta.
//
// The church's reason for this existing: a bacenta gets large enough that
// nobody can keep track of everyone, so members are put under other members to
// be checked on. The person doing the looking-after needs NO ACCOUNT — this is
// a record of responsibility, not a permission — which is why nothing on this
// screen creates a login or grants anybody anything.

import { useMemo, useState } from 'react'
import Select from '@/shared/Select'
import { Banner } from '@/components/ui'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/table'
import { careAssignmentProblem, eligibleCarers, type CareCandidate } from '@/lib/groups/care'

export default function CareAssigner({
  members,
  readOnly,
  busy,
  onAssign,
}: {
  members: CareCandidate[]
  readOnly?: boolean
  busy?: boolean
  onAssign: (memberId: string, carerId: string | null) => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const index = useMemo(() => new Map(members.map((m) => [m.$id, m])), [members])
  const byName = useMemo(
    () => [...members].sort((a, b) => a.full_name.localeCompare(b.full_name, 'en')),
    [members],
  )

  /**
   * How many people each member is responsible for — shown so the church can
   * see the load before adding to it, the same reason `/api/leaders` reports
   * what somebody already heads.
   */
  const charges = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of members) {
      if (m.care_of_member_id) {
        counts.set(m.care_of_member_id, (counts.get(m.care_of_member_id) ?? 0) + 1)
      }
    }
    return counts
  }, [members])

  const change = async (memberId: string, raw: string) => {
    const carerId = raw || null
    setError(null)

    // Checked here as well as on the server, and NOT because the server check
    // is optional — it is the enforcement. This one exists so the refusal is
    // instant and names the reason, rather than arriving as a failed request
    // after a round trip.
    const problem = careAssignmentProblem(memberId, carerId, index)
    if (problem) {
      setError(problem)
      return
    }

    setPending(memberId)
    try {
      await onAssign(memberId, carerId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save. Try again.')
    } finally {
      setPending(null)
    }
  }

  if (members.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Nobody is in this bacenta yet. Add members first, then say who looks after whom.
      </p>
    )
  }

  return (
    <div>
      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      <Table dense grid striped>
        <TableHead>
          <TableRow>
            <TableHeader>Member</TableHeader>
            <TableHeader>Looked after by</TableHeader>
            <TableHeader>Looks after</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {byName.map((m) => {
            // Only people the server would actually accept. The dropdown and
            // the check come from the same module, so a choice on screen can
            // never be one that then fails.
            const options = eligibleCarers(m.$id, m.bacenta_id, members)
            const looksAfter = charges.get(m.$id) ?? 0
            return (
              <TableRow key={m.$id}>
                <TableCell>
                  <span className="wrap-anywhere font-medium text-neutral-950 dark:text-white">
                    {m.full_name}
                  </span>
                  {m.status !== 'active' && (
                    <span className="ml-2 text-xs text-neutral-400">inactive</span>
                  )}
                </TableCell>
                <TableCell>
                  {readOnly ? (
                    <span className="text-sm">
                      {m.care_of_member_id ? (
                        (index.get(m.care_of_member_id)?.full_name ?? 'Somebody else')
                      ) : (
                        <span className="text-neutral-400">Nobody</span>
                      )}
                    </span>
                  ) : (
                    <Select
                      value={m.care_of_member_id ?? ''}
                      disabled={busy || pending === m.$id}
                      onChange={(e) => void change(m.$id, e.target.value)}
                    >
                      {/* Nobody is a legitimate answer, not a placeholder —
                          most of a bacenta is unassigned the day it is made. */}
                      <option value="">— nobody —</option>
                      {options.map((c) => (
                        <option key={c.$id} value={c.$id}>
                          {c.full_name}
                        </option>
                      ))}
                    </Select>
                  )}
                </TableCell>
                <TableCell>
                  {looksAfter === 0 ? (
                    <span className="text-neutral-400">—</span>
                  ) : (
                    `${looksAfter} member${looksAfter === 1 ? '' : 's'}`
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
