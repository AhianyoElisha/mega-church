'use client'

// The BENMP contributions ledger: who paid which month.
//
// One screen that is BOTH the report and the entry surface. Clicking a month
// records or undoes it, which means backfilling last March is the same gesture
// as recording this September — and the church has a lot of backfilling to do,
// because the partner checkbox arrived after most of the congregation was
// already registered.
//
// ## Two layouts, one cell
//
// A twelve-column table is a desktop shape. Measured on a 390px phone it needed
// 832px and scrolled 442px sideways, the sticky name column ate 319px of the
// viewport, and exactly ONE month cell was visible at rest. That is not a
// styling blemish; it is a screen a treasurer cannot use standing up.
//
// So the table is kept for `sm:` and up, and phones get a card per partner with
// the twelve months as a 6x2 grid — no horizontal scroll at all, every month
// reachable without hunting.
//
// Both layouts render the SAME `MonthCell`. What is clickable, what is refused
// and what it announces to a screen reader exists once; only the box around it
// changes. Two copies of that logic is how a future month stays tappable on
// phones for six months before anybody notices.
//
// ## The cell is a button, not a checkbox
//
// A checkbox announces itself as a form control that will be submitted with
// something. These save on click, one at a time, and there is no Save button
// anywhere — so `<button aria-pressed>` is what it actually is.

import { useMemo, useState } from 'react'
import { Banner, Card, LoadingRow, PageHeader, PageWrap, StatCard } from '@/components/ui'
import { Button } from '@/shared/Button'
import Input from '@/shared/Input'
import { useAuth } from '@/components/auth'
import { useBenmpYear, useToggleContribution, type BenmpPartner } from '@/lib/queries/benmp'
import { MONTH_ABBR, currentYear, periodLabel, periodsInYear, toPeriod } from '@/lib/benmp/period'
import { paidByMember } from '@/lib/benmp/unpaid'
import { matchesMemberSearch } from '@/lib/members/search'
import { fullName } from '@/lib/members/types'

/**
 * One month for one partner, in whichever layout is asking.
 *
 * Everything that decides BEHAVIOUR lives here — the disabled rules, the
 * accessible name, the pressed state — so the phone and the desktop cannot
 * disagree about them. `className` is the only thing either caller varies.
 */
function MonthCell({
  partner,
  period,
  monthIndex,
  isPaid,
  isFuture,
  canRecord,
  onToggle,
  className,
  showLabel = false,
}: {
  partner: BenmpPartner
  period: string
  monthIndex: number
  isPaid: boolean
  isFuture: boolean
  canRecord: boolean
  onToggle: (memberId: string, period: string, paid: boolean) => void
  className: string
  /** Phones show the month inside the cell; the table has a column header. */
  showLabel?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={isPaid}
      aria-label={`${fullName(partner)}, ${periodLabel(period)}: ${
        isPaid ? 'paid' : isFuture ? 'not started' : 'not recorded'
      }`}
      /*
       * Deliberately NOT disabled while a save is in flight. It was, and that
       * made rapid entry impossible: a treasurer working down a month clicks
       * the next cell long before the previous round trip returns, and every
       * one of those clicks was swallowed. Measured at ~1s per save, that is a
       * screen you cannot type into.
       *
       * Safe because the cell flips optimistically and each click sends the
       * intent for what is on screen NOW, and because both writes are
       * idempotent server-side — recording an already recorded month is
       * `changed: false`, not an error.
       */
      disabled={!canRecord || isFuture}
      onClick={() => onToggle(partner.$id, period, !isPaid)}
      className={[
        className,
        'rounded-lg font-semibold transition',
        isFuture
          ? 'cursor-not-allowed text-neutral-300 dark:text-neutral-700'
          : isPaid
            ? 'bg-primary-500 text-neutral-950 hover:bg-primary-600'
            : 'bg-neutral-100 text-neutral-400 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-500',
        canRecord && !isFuture ? 'cursor-pointer' : '',
      ].join(' ')}
    >
      {showLabel && (
        <span className="text-[11px] leading-none font-medium">{MONTH_ABBR[monthIndex]}</span>
      )}
      {/* A tick and the pressed state, never colour alone — §2.4 forbids
          relying on colour to carry meaning, and yellow-on-white is exactly the
          case it has in mind. The dot marks a month that has not happened. */}
      <span className={showLabel ? 'text-sm leading-none' : ''}>
        {isPaid ? '✓' : isFuture ? '·' : ''}
      </span>
      {!showLabel && <span className="sr-only">{MONTH_ABBR[monthIndex]}</span>}
    </button>
  )
}

export default function BenmpPage() {
  const { user } = useAuth()
  const thisYear = currentYear()
  const [year, setYear] = useState(thisYear)
  const [search, setSearch] = useState('')
  const [failed, setFailed] = useState<string | null>(null)

  const query = useBenmpYear(year)
  const toggle = useToggleContribution()

  const data = query.data?.ok ? query.data : null
  const canRecord =
    user?.label === 'admin' || user?.label === 'treasurer' || user?.label === 'leader'

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
    // A refusal is reported rather than swallowed. Without this the cell springs
    // back and the person tries again, harder.
    if (!res.ok) setFailed(res.error)
  }

  const cellProps = (p: BenmpPartner, period: string, i: number) => ({
    partner: p,
    period,
    monthIndex: i,
    isPaid: paid.get(p.$id)?.has(period) ?? false,
    isFuture: !!data && period > data.current_period,
    canRecord,
    onToggle,
  })

  const noMatch = (
    <p className="text-sm text-neutral-500 dark:text-neutral-400">
      No partner matches “{search}”.
    </p>
  )

  return (
    <PageWrap>
      <PageHeader
        title="BENMP contributions"
        subtitle={
          data && !data.whole_church
            ? 'The partners in the constituencies you head. Tap a month to record or undo a payment.'
            : 'Every BENMP partner, month by month. Tap a month to record or undo a payment.'
        }
      />

      {failed && (
        <div className="mb-6">
          <Banner tone="error">{failed}</Banner>
        </div>
      )}

      {data && (
        // Three across even on a phone: these are single numbers, and stacking
        // them pushed the ledger itself a full screen down.
        <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-4">
          <StatCard label="Partners" value={String(data.summary.partners)} />
          <StatCard
            label={`Paid · ${periodLabel(data.current_period)}`}
            value={String(data.summary.paid)}
          />
          <StatCard label="Outstanding" value={String(data.summary.outstanding)} />
        </div>
      )}

      <Card className="mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="w-full sm:w-auto sm:min-w-[14rem] sm:flex-1">
            <label className="mb-1 block text-sm font-medium text-neutral-950 dark:text-white">
              Find a partner
            </label>
            <Input
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              placeholder="Name or member number"
            />
          </div>
          <div className="flex items-center justify-between gap-2 sm:justify-start">
            <Button plain onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
              ←
            </Button>
            <span className="min-w-[4rem] text-center text-lg font-semibold text-neutral-950 dark:text-white">
              {year}
            </span>
            {/* Never past the current year: a month that has not happened cannot
                have been paid, and the server refuses it anyway. */}
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
        <>
          {/* ---------- phones: a card per partner, no sideways scroll ------- */}
          <div className="space-y-3 sm:hidden">
            {rows.map((p) => (
              <Card key={p.$id}>
                <div className="mb-3">
                  <p className="font-semibold text-neutral-950 dark:text-white">{fullName(p)}</p>
                  {p.member_no && <p className="text-xs text-neutral-400">{p.member_no}</p>}
                </div>
                {/* Six across, two rows — a ~52px target per month on a 390px
                    screen, against a 44px minimum, with all twelve reachable
                    without hunting for them.
                    Four across below 360px: six there measured 40px wide, and
                    a target under 44px on the smallest phones is the one this
                    layout exists to fix. Three rows is the right trade. */}
                <div className="grid grid-cols-4 min-[360px]:grid-cols-6 gap-1.5">
                  {periods.map((period, i) => (
                    <MonthCell
                      key={period}
                      {...cellProps(p, period, i)}
                      showLabel
                      className={[
                        'flex h-11 flex-col items-center justify-center gap-0.5',
                        period === data.current_period
                          ? 'ring-2 ring-primary-500/60 ring-offset-1 dark:ring-offset-neutral-900'
                          : '',
                      ].join(' ')}
                    />
                  ))}
                </div>
              </Card>
            ))}
            {rows.length === 0 && <Card>{noMatch}</Card>}
          </div>

          {/* ---------- tablet and up: the year grid ------------------------- */}
          <Card padded={false} className="hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-neutral-950/5 dark:border-white/10">
                    <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left font-semibold text-neutral-950 dark:bg-neutral-900 dark:text-white">
                      Partner
                    </th>
                    {MONTH_ABBR.map((m, i) => {
                      const isCurrent = toPeriod(year, i + 1) === data.current_period
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
                  {rows.map((p) => (
                    <tr
                      key={p.$id}
                      className="border-b border-neutral-950/5 last:border-0 dark:border-white/10"
                    >
                      {/*
                        Capped and allowed to WRAP rather than truncate. Left to
                        size itself this column reached 319px, because the church
                        has names like "Bernice Serwaa Ofosuhene Peasah".
                        Truncating was the other option and is worse: two members
                        whose names differ late would read as the same row.
                      */}
                      <th
                        scope="row"
                        className="sticky left-0 z-10 max-w-[13rem] bg-white px-4 py-2 text-left font-medium break-words text-neutral-950 dark:bg-neutral-900 dark:text-white"
                      >
                        {fullName(p)}
                        {p.member_no && (
                          <span className="ml-2 text-xs font-normal text-neutral-400">
                            {p.member_no}
                          </span>
                        )}
                      </th>
                      {periods.map((period, i) => (
                        <td key={period} className="px-1 py-1 text-center">
                          <MonthCell {...cellProps(p, period, i)} className="h-9 w-9 text-sm" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && <div className="px-4 py-6">{noMatch}</div>}
          </Card>
        </>
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
