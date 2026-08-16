'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './fetcher'
import { queryKeys } from './keys'
import type { BirthdaysResponse } from '@/app/api/birthdays/route'
import type { BirthdayRunResponse } from '@/lib/notifications/types'

export function useBirthdays(days?: number) {
  return useQuery<BirthdaysResponse>({
    queryKey: [...queryKeys.birthdays, days ?? 'default'],
    queryFn: () => apiFetch(`/api/birthdays${days ? `?days=${days}` : ''}`),
    // The list changes at midnight Accra time and not otherwise. Refetching
    // hourly means a team member who left the tab open overnight sees the new
    // day's celebrants without having to remember to reload.
    refetchInterval: 60 * 60 * 1000,
  })
}

/**
 * Send the notification now, by hand — for the morning the scheduler did not
 * fire. Idempotent server-side: pressing it after the cron already ran comes
 * back `already_sent` and nobody's phone buzzes twice.
 */
export function useSendBirthdayNotification() {
  const qc = useQueryClient()
  return useMutation<BirthdayRunResponse, Error, void>({
    mutationFn: () => apiFetch('/api/notifications/birthday-run', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.birthdays }),
  })
}
