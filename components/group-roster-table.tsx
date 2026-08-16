'use client'

// The roster a group's page shows. Shared by constituencies, bacentas and the
// read-only view a head sees, so all three read identically — a head comparing
// notes with an admin over the phone is looking at the same columns.

import Link from 'next/link'
import Avatar from '@/shared/Avatar'
import { Badge } from '@/shared/Badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/table'
import { memberPhotoUrl } from '@/lib/members/photo'
import { monthDayLabel } from '@/lib/birthdays/upcoming'
import type { GroupMember } from '@/lib/groups/types'

export default function GroupRosterTable({
  members,
  /** Heads get no links out — every member page is admin-only. */
  linkToMembers = true,
}: {
  members: GroupMember[]
  linkToMembers?: boolean
}) {
  if (members.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
        Nobody has been added to this group yet.
      </p>
    )
  }

  return (
    <Table dense grid striped>
      <TableHead>
        <TableRow>
          <TableHeader>Name</TableHeader>
          <TableHeader>Call number</TableHeader>
          <TableHeader>Birthday</TableHeader>
          <TableHeader>Attended</TableHeader>
          <TableHeader>Last seen</TableHeader>
          <TableHeader>Status</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {members.map((m) => {
          const photo = memberPhotoUrl(m.photo_file_id, 64)
          return (
            <TableRow key={m.$id} href={linkToMembers ? `/members/${m.$id}` : undefined}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar
                    src={photo}
                    initials={photo ? undefined : m.full_name.slice(0, 2).toUpperCase()}
                    className="size-9 bg-primary-500 text-neutral-950"
                    alt={m.full_name}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-neutral-950 dark:text-white">
                      {m.full_name}
                    </span>
                    <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                      {m.home_service === 'first' ? 'First Service' : 'Second Service'}
                    </span>
                  </span>
                </div>
              </TableCell>
              <TableCell className="tabular-nums">
                {/* A head's most common action is ringing somebody, so the
                    number is a tel: link rather than text to copy out. */}
                <Link href={`tel:${m.call_number}`} className="hover:underline">
                  {m.call_number}
                </Link>
              </TableCell>
              <TableCell>
                {m.birth_month && m.birth_day ? (
                  monthDayLabel(m.birth_month, m.birth_day)
                ) : (
                  <span className="text-neutral-400">—</span>
                )}
              </TableCell>
              <TableCell className="tabular-nums">
                {m.attendance_count === 0 ? (
                  <span className="text-neutral-400">Never</span>
                ) : (
                  `${m.attendance_count}×`
                )}
              </TableCell>
              <TableCell className="tabular-nums">
                {m.last_seen ?? <span className="text-neutral-400">—</span>}
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
  )
}
