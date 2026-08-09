'use client'

import { useMemo, useState } from 'react'
import { ChartBarIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import Select from '@/shared/Select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/table'
import { Card, EmptyState, LoadingRow, PageHeader, PageWrap, StatCard } from '@/components/ui'
import { useMeetings } from '@/lib/queries/meetings'
import { useOccurrences } from '@/lib/queries/occurrences'

export default function ReportsPage() {
  const [meetingId, setMeetingId] = useState('')
  const meetings = useMeetings()
  const { data, isLoading } = useOccurrences(meetingId || undefined)

  const rows = useMemo(() => (data?.ok ? data.occurrences : []), [data])

  // Averages over CLOSED sessions only — an open one is still filling up and
  // would drag the mean down for as long as it runs.
  const closed = rows.filter((r) => r.status === 'closed')
  const total = closed.reduce((n, r) => n + r.present_count, 0)
  const average = closed.length > 0 ? Math.round(total / closed.length) : 0
  const best = closed.reduce((m, r) => Math.max(m, r.present_count), 0)

  return (
    <PageWrap>
      <PageHeader
        title="Reports"
        subtitle="Every session ever held, and the register behind it."
      />

      <Card className="mb-6" padded={false}>
        <div className="p-4">
          <Select value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
            <option value="">All services and meetings</option>
            {(meetings.data?.ok ? meetings.data.meetings : []).map((m) => (
              <option key={m.$id} value={m.$id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {isLoading ? (
        <Card padded={false}>
          <LoadingRow />
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ChartBarIcon}
          title="Nothing to report yet"
          message="Sessions appear here once they have been held."
        />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <StatCard label="Sessions held" value={closed.length} />
            <StatCard label="Average attendance" value={average} hint="Closed sessions only" />
            <StatCard label="Best turnout" value={best} accent />
          </div>

          <Table grid striped>
            <TableHead>
              <TableRow>
                <TableHeader>Session</TableHeader>
                <TableHeader>Date</TableHeader>
                <TableHeader>Present</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((o) => (
                <TableRow key={o.$id}>
                  <TableCell className="font-medium text-neutral-950 dark:text-white">
                    {o.meeting_name}
                  </TableCell>
                  <TableCell className="tabular-nums">{o.occurrence_date}</TableCell>
                  <TableCell className="tabular-nums">{o.present_count}</TableCell>
                  <TableCell>
                    <Badge color={o.status === 'open' ? 'green' : 'zinc'}>
                      {o.status === 'open' ? 'Open now' : 'Closed'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button plain href={`/api/reports/export?occurrence_id=${o.$id}`}>
                      Export
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">
            An export lists every active member with a Yes/No column, not just those who came —
            the gaps are usually what you are looking for.
          </p>
        </>
      )}
    </PageWrap>
  )
}
