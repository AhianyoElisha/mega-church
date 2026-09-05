'use client'

// The BENMP contributions grid: partners down, Jan–Dec across.
//
// One screen that is BOTH the report and the entry surface. Clicking a cell
// records or undoes that month, which means backfilling last March is the same
// gesture as recording this September — and the church has a lot of backfilling
// to do, because the partner checkbox arrived after most of the congregation
// was already registered.
//
// ## Why not a month-at-a-time checklist
//
// Because the question the church actually asked was "which months did they pay
// and which didn't". A checklist answers "who paid in September" and makes the
// other question a twelve-step navigation. The grid answers both, and the row
// of ticks IS the report they wanted to come back to.
//
// ## The cell is a button, not a checkbox
//
// A checkbox announces itself as a form control that will be submitted with
// something. These save on click, one cell at a time, and there is no Save
// button anywhere — so a `<button aria-pressed>` is what it actually is. It
// also keeps the grid keyboard-navigable without a tab stop per month.

import { useMemo, useState } from 'react'
import { Banner, Card, LoadingRow, PageHeader, PageWrap, StatCard } from '@/components/ui'
import { Button } from '@/shared/Button'
import Input from '@/shared/Input'
import { useAuth } from '@/components/auth'
import { useBenmpYear, useToggleContribution } from '@/lib/queries/benmp'
import { MONTH_ABBR, currentYear, periodLabel, periodsInYear, toPeriod } from '@/lib/benmp/period'
import { paidByMember } from '@/lib/benmp/unpaid'
import { matchesMemberSearch } from '@/lib/members/search'
import { fullName } from '@/lib/members/types'

export default function BenmpPage() {
  const { user } = useAuth()
  const thisYear = currentYear()
  const [year, setYear] = useState(thisYear)
  const [search, setSearch] = useState('')
  const [failed, setFailed] = useState<string | null>(null)

  const query = useBenmpYear(year)
  const toggle = useToggleContribution()

  const data = query.data?.ok ? query.data : null
  const canRecord = user?.label === 'admin' || user?.label === 'treasurer' || user?.label === 'leader'

  const periods = useMemo(() => periodsInYear(year), [year])

  // Indexed once per render rather than scanned per cell: fifty partners is 600
  // cells, and the naive version is 600 array scans on every keystroke here.
  const paid = useMemo(() => paidByMember(data?.contributions ?? []), [data?.contributions])

  const rows = useMemo(() => {
    const all = data?.partners ?? []
    if (!search.trim()) return all
    return all.filter((p) => matchesMemberSearch(p, search))
  }, [data?.partners, search])

  const onToggle = async (memberId: string, period: string, nowPaid: boolean) => {
    setFailed(null)
    const res = await toggle.mutateAsync({ member_id: memberId, period, paid: nowPaid })
    // A refusal is reported rather than swallowed. Without this the cell simply
    // springs back and the person tries again, harder.
    if (!res.ok) setFailed(res.error)
  }

  return (
    <PageWrap>
      <PageHeader
        title="BENMP contributions"
        subtitle={
          data && !data.whole_church
            ? 'The partners in the constituencies you head. Click a month to record or undo a payment.'
            : 'Every BENMP partner, month by month. Click a month to record or undo a payment.'
        }
      />

      {failed && (
        <div className="mb-6">
          <Banner tone="error">{failed}</Banner>
        </div>
      )}

      {data && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Partners" value={String(data.summary.partners)} />
          <StatCard
            label={`Paid — ${periodLabel(data.current_period)}`}
            value={String(data.summary.paid)}
          />
          <StatCard label="Still outstanding" value={String(data.summary.outstanding)} />
        </div>
      )}

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[14rem] flex-1">
            <label className="mb-1 block text-sm font-medium text-neutral-950 dark:text-white">
              Find a partner
            </label>
            <Input
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              placeholder="Name or member number"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button plain onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
              ←
            </Button>
            <span className="min-w-[4rem] text-center text-lg font-semibold text-neutral-950 dark:text-white">
              {year}
            </span>
            {/* Never past the current year: a month that has not happened
                cannot have been paid, and the server refuses it anyway. */}
            <Button
              plain
              onClick={() => setYear((y) => Math.min(thisYear, y + 1))}
              disabled={year >= thisYear}
              aria-label="Next year"
            >
              →
            </Button>
          </div>
        </div>
      </Card>

      {query.isLoading && (
        <Card padded={false}>
          <LoadingRow />
        </Card>
      )}

      {query.data && !query.data.ok && <Banner tone="error">{query.data.error}</Banner>}

      {data && data.partners.length === 0 && (
        <Card>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No BENMP partners yet. A member becomes one when their{' '}
            <strong>BENMP Partner</strong> box is ticked on their own page — an administrator or
            their constituency head can do that.
          </p>
        </Card>
      )}

      {data && data.partners.length > 0 && (
        <Card padded={false}>
          {/* The table scrolls inside its own box. Thirteen columns do not fit
              a phone, and a page that scrolls sideways as a whole loses the
              name column that makes the row mean anything. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-950/5 dark:border-white/10">
                  <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left font-semibold text-neutral-950 dark:bg-neutral-900 dark:text-white">
                    Partner
                  </th>
                  {MONTH_ABBR.map((m, i) => {
                    const period = toPeriod(year, i + 1)
                    const isCurrent = period === data.current_period
                    return (
                      <th
                        key={m}
                        className={`px-2 py-3 text-center font-semibold ${
                          isCurrent
                            ? 'text-primary-600 dark:text-primary-500'
                            : 'text-neutral-500 dark:text-neutral-400'
                        }`}
                      >
                        {m}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const mine = paid.get(p.$id)
                  return (
                    <tr
                      key={p.$id}
                      className="border-b border-neutral-950/5 last:border-0 dark:border-white/10"
                    >
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-white px-4 py-2 text-left font-medium text-neutral-950 dark:bg-neutral-900 dark:text-white"
                      >
                        {fullName(p)}
                        {p.member_no && (
                          <span className="ml-2 text-xs font-normal text-neutral-400">
                            {p.member_no}
                          </span>
                        )}
                      </th>
                      {periods.map((period, i) => {
                        const isPaid = mine?.has(period) ?? false
                        const future = period > data.current_period
                        return (
                          <td key={period} className="px-1 py-1 text-center">
                            <button
                              type="button"
                              aria-pressed={isPaid}
                              aria-label={`${fullName(p)}, ${periodLabel(period)}: ${
                                isPaid ? 'paid' : 'not recorded'
                              }`}
                              disabled={!canRecord || future || toggle.isPending}
                              onClick={() => onToggle(p.$id, period, !isPaid)}
                              className={[
                                'h-8 w-8 rounded-lg text-sm font-semibold transition',
                                future
                                  ? 'cursor-not-allowed text-neutral-200 dark:text-neutral-700'
                                  : isPaid
                                    ? 'bg-primary-500 text-neutral-950 hover:bg-primary-600'
                                    : 'bg-neutral-100 text-neutral-300 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-600',
                                canRecord && !future ? 'cursor-pointer' : '',
                              ].join(' ')}
                            >
                              {/* A tick AND the pressed state, never colour
                                  alone — §2.4 forbids relying on colour to
                                  carry meaning, and yellow-on-white is exactly
                                  the case it has in mind. */}
                              {isPaid ? '✓' : future ? '·' : ''}
                              <span className="sr-only">{MONTH_ABBR[i]}</span>
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <p className="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">
              No partner matches “{search}”.
            </p>
          )}
        </Card>
      )}

      {data && !canRecord && (
        <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
          You can see this record but not change it. An administrator, a treasurer or the
          partner&rsquo;s own constituency head records a payment.
        </p>
      )}
    </PageWrap>
  )
}
