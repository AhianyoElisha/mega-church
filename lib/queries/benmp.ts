'use client'

// TanStack hooks for BENMP contributions.
//
// The toggle mutation invalidates BOTH the `benmp` prefix and the `sms` one:
// recording a payment changes the grid AND changes who the reminder screen
// offers, and a stale recipient list is exactly how somebody who paid this
// morning gets dunned this afternoon.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './fetcher'
import { queryKeys } from './keys'

export type BenmpPartner = {
  $id: string
  first_name: string
  last_name: string
  other_names: string | null
  member_no: string | null
  constituency_id: string | null
}

export type BenmpYearData = {
  ok: true
  year: number
  current_period: string
  partners: BenmpPartner[]
  contributions: { member_id: string; period: string }[]
  summary: { partners: number; paid: number; outstanding: number }
  whole_church: boolean
}

export type BenmpYearResponse = BenmpYearData | { ok: false; error: string }

export function useBenmpYear(year: number) {
  return useQuery({
    queryKey: queryKeys.benmpYear(year),
    /*
     * The SIGNAL is forwarded, and it is load-bearing here.
     *
     * Without it `cancelQueries()` has nothing to cancel: the request runs to
     * completion and TanStack writes its now-stale result straight over the
     * optimistic tick. Measured, that turned a ~200 ms flip into ~1,000 ms —
     * the cell moved, sprang back, and only settled when the NEXT refetch
     * landed. `apiFetch` already spreads its init into `fetch`, so the whole
     * fix is passing the argument the query function is handed.
     */
    queryFn: ({ signal }) =>
      apiFetch<BenmpYearResponse>(`/api/benmp/contributions?year=${year}`, { signal }),
  })
}

export type ToggleVars = { member_id: string; period: string; paid: boolean }
export type ToggleResponse =
  | { ok: true; changed: boolean; paid: boolean }
  | { ok: false; error: string }

/**
 * Tick or untick one month, OPTIMISTICALLY.
 *
 * ## Why this is not a plain invalidate-and-refetch
 *
 * Because it was, and clicking a cell took **3,795 ms** to visibly change —
 * measured in the browser against the live project, not estimated. The write
 * itself is quick; the cost is what follows it, a refetch of every partner and
 * every contribution in the year.
 *
 * Four seconds is unusable for the job this screen exists for. A treasurer
 * entering a month's takings clicks fifty cells in a sitting, and each one sat
 * inert — the button disables itself while the mutation is in flight, so it
 * looked broken rather than busy. The first thing anybody does with a control
 * that does not respond is press it again.
 *
 * So the cell flips immediately and the server confirms afterwards. On a
 * refusal the cache is rolled back to precisely what it was, and the page shows
 * the server's own words.
 *
 * This is the same reasoning the candidate cache follows when it serves a stale
 * gallery rather than making one member wait 5.7 seconds at the scanner: the
 * person in front of the screen should not pay for a round trip they cannot see.
 */
export function useToggleContribution() {
  const qc = useQueryClient()

  return useMutation<
    ToggleResponse,
    Error,
    ToggleVars,
    { key: readonly unknown[]; previous: BenmpYearResponse | undefined }
  >({
    mutationFn: (vars) =>
      apiFetch<ToggleResponse>('/api/benmp/contributions', {
        method: 'POST',
        body: JSON.stringify(vars),
      }),

    onMutate: (vars) => {
      const year = Number(vars.period.slice(0, 4))
      const key = queryKeys.benmpYear(year)

      const previous = qc.getQueryData<BenmpYearResponse>(key)

      /*
       * Cancellation is FIRED, never awaited before the write below.
       *
       * `await cancelQueries()` is the documented shape and it is wrong here:
       * it waits for the in-flight refetch to settle, which measured ~1,000 ms
       * on this screen and put the delay back exactly where the optimism was
       * meant to remove it. Cancellation takes effect synchronously; only the
       * promise is slow, and nothing needs it.
       */
      void qc.cancelQueries({ queryKey: key })

      qc.setQueryData<BenmpYearResponse>(key, (old) => {
        if (!old?.ok) return old
        const without = old.contributions.filter(
          (c) => !(c.member_id === vars.member_id && c.period === vars.period),
        )
        const contributions = vars.paid
          ? [...without, { member_id: vars.member_id, period: vars.period }]
          : without

        // The summary is recomputed rather than nudged by one. Incrementing a
        // counter drifts the moment a click lands on a month that is not the
        // current one — and backfilling past months is half of what this screen
        // is for.
        const paidNow = new Set(
          contributions.filter((c) => c.period === old.current_period).map((c) => c.member_id),
        )
        const paid = old.partners.filter((p) => paidNow.has(p.$id)).length

        return {
          ...old,
          contributions,
          summary: { partners: old.summary.partners, paid, outstanding: old.summary.partners - paid },
        }
      })

      return { key, previous }
    },

    onError: (_err, _vars, context) => {
      // Put back exactly what was there, rather than refetching: a refetch here
      // would race the next click and could restore a DIFFERENT wrong state.
      if (context) qc.setQueryData(context.key, context.previous)
    },

    onSettled: (data, _err, _vars, context) => {
      /*
       * A refusal rolls back via `onError`, not here: `apiFetch` THROWS on any
       * non-2xx, so a 403 from the scope check never arrives as data. This
       * branch covers only the shape where the server answers 200 with
       * `ok: false`, which no current path produces — kept because the response
       * type permits it and a silent optimistic tick standing over a server
       * that holds nothing is the one outcome this screen must not have.
       */
      if (data && !data.ok && context) {
        qc.setQueryData(context.key, context.previous)
        return
      }
      // Reconcile with the server in the background. The cell has already
      // moved, so this costs the person nothing.
      if (context) qc.invalidateQueries({ queryKey: context.key })
      // The reminder screen reads the same facts. Without this, a treasurer who
      // records ten payments and then opens /sms is offered all ten.
      qc.invalidateQueries({ queryKey: ['sms'] })
    },
  })
}
