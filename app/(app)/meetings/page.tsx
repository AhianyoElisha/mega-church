'use client'

import { RectangleGroupIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/table'
import { Card, EmptyState, LoadingRow, PageHeader, PageWrap } from '@/components/ui'
import OpenSessionBar from '@/components/open-session-bar'
import { useMeetings } from '@/lib/queries/meetings'
import { useActiveSession } from '@/lib/queries/occurrences'

export default function MeetingsPage() {
  const { data, isLoading } = useMeetings()
  const active = useActiveSession()
  const openId = active.data?.ok ? active.data.session?.meeting.$id : undefined

  const meetings = data?.ok ? data.meetings : []
  const services = meetings.filter((m) => m.kind === 'service')
  const others = meetings.filter((m) => m.kind === 'meeting')

  return (
    <PageWrap>
      <PageHeader
        title="Meetings"
        subtitle="Beyond the two services. Each one has its own list of authorised members."
        actions={
          <Button color="primary" href="/meetings/new">
            Create a meeting
          </Button>
        }
      />

      {/* Above the list, and above the empty state in particular: a running
          SERVICE never appears in the table below, so without this the page
          reads "No meetings yet" while a session is live. */}
      <OpenSessionBar className="mb-6" />

      {isLoading ? (
        <Card padded={false}>
          <LoadingRow />
        </Card>
      ) : (
        <>
          {others.length === 0 ? (
            <EmptyState
              icon={RectangleGroupIcon}
              title="No meetings yet"
              message="Create one, tick the members who are allowed to attend, and it is ready to reopen any time."
              action={
                <Button color="primary" href="/meetings/new">
                  Create a meeting
                </Button>
              }
            />
          ) : (
            <Table grid striped>
              <TableHead>
                <TableRow>
                  <TableHeader>Meeting</TableHeader>
                  <TableHeader>Authorised</TableHeader>
                  <TableHeader>Last held</TableHeader>
                  <TableHeader>Status</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {others.map((m) => (
                  <TableRow key={m.$id} href={`/meetings/${m.$id}`}>
                    <TableCell>
                      <span className="block font-medium text-neutral-950 dark:text-white">
                        {m.name}
                      </span>
                      {m.description && (
                        <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                          {m.description}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {m.roster_size === 0 ? (
                        <span className="text-red-600 dark:text-red-400">Nobody yet</span>
                      ) : (
                        `${m.roster_size} member${m.roster_size === 1 ? '' : 's'}`
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {m.last_held ?? <span className="text-neutral-400">Never</span>}
                    </TableCell>
                    <TableCell>
                      {m.$id === openId ? (
                        <Badge color="green">Open now</Badge>
                      ) : m.archived ? (
                        <Badge color="zinc">Archived</Badge>
                      ) : (
                        <Badge color="yellow">Ready</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <h2 className="mt-10 mb-3 text-sm font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
            Sunday services
          </h2>
          <Card>
            <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
              The two services are permanent and open to every active member — they have no
              authorised list and cannot be deleted.
            </p>
            <div className="flex flex-wrap gap-3">
              {services.map((m) => (
                <span
                  key={m.$id}
                  className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  {m.name}
                  {m.$id === openId && <span className="ml-2 text-primary-600">● open</span>}
                </span>
              ))}
            </div>
          </Card>
        </>
      )}
    </PageWrap>
  )
}
