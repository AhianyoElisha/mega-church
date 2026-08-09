'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './fetcher'
import { queryKeys } from './keys'
import type {
  ActivateResponse,
  ActiveSessionResponse,
  CloseOccurrenceResponse,
} from '@/lib/meetings/types'

/**
 * The single globally-open session, or null (PRD §2.2).
 *
 * Polled rather than pushed: it changes a handful of times a day, and every
 * screen in the app shows it, so a cheap poll beats holding a websocket open
 * on pages that have no other realtime need. The kiosk polls the same endpoint
 * on its own faster cadence.
 */
export function useActiveSession(pollMs = 30_000) {
  return useQuery<ActiveSessionResponse>({
    queryKey: queryKeys.activeOccurrence,
    queryFn: () => apiFetch('/api/attendance/active'),
    refetchInterval: pollMs,
    staleTime: 10_000,
  })
}

export function useActivateOccurrence() {
  const qc = useQueryClient()
  return useMutation<ActivateResponse, Error, { meeting_id: string }>({
    mutationFn: (body) =>
      apiFetch('/api/occurrences/activate', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['occurrences'] })
      qc.invalidateQueries({ queryKey: ['meetings'] })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

export function useCloseOccurrence() {
  const qc = useQueryClient()
  return useMutation<CloseOccurrenceResponse, Error, { occurrence_id: string }>({
    mutationFn: ({ occurrence_id }) =>
      apiFetch(`/api/occurrences/${encodeURIComponent(occurrence_id)}/close`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['occurrences'] })
      qc.invalidateQueries({ queryKey: ['attendance'] })
      qc.invalidateQueries({ queryKey: ['meetings'] })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}

export function useOccurrences(meetingId?: string) {
  return useQuery({
    queryKey: queryKeys.occurrences({ meetingId }),
    queryFn: () =>
      apiFetch<{
        ok: true
        occurrences: {
          $id: string
          meeting_id: string
          meeting_name: string
          occurrence_date: string
          status: 'open' | 'closed'
          opened_at: string
          closed_at: string | null
          present_count: number
        }[]
      }>(
        meetingId
          ? `/api/occurrences?meeting_id=${encodeURIComponent(meetingId)}`
          : '/api/occurrences',
      ),
  })
}
