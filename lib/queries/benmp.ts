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

export type BenmpYearResponse =
  | {
      ok: true
      year: number
      current_period: string
      partners: BenmpPartner[]
      contributions: { member_id: string; period: string }[]
      summary: { partners: number; paid: number; outstanding: number }
      whole_church: boolean
    }
  | { ok: false; error: string }

export function useBenmpYear(year: number) {
  return useQuery({
    queryKey: queryKeys.benmpYear(year),
    queryFn: () => apiFetch<BenmpYearResponse>(`/api/benmp/contributions?year=${year}`),
  })
}

export type ToggleVars = { member_id: string; period: string; paid: boolean }
export type ToggleResponse = { ok: true; changed: boolean; paid: boolean } | { ok: false; error: string }

export function useToggleContribution() {
  const qc = useQueryClient()
  return useMutation<ToggleResponse, Error, ToggleVars>({
    mutationFn: (vars) =>
      apiFetch<ToggleResponse>('/api/benmp/contributions', {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['benmp'] })
      // The reminder screen reads the same facts. Without this, a treasurer who
      // records ten payments and then opens /sms is offered all ten.
      qc.invalidateQueries({ queryKey: ['sms'] })
    },
  })
}
