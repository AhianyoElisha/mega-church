'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './fetcher'
import { queryKeys } from './keys'
import type {
  ListMeetingsResponse,
  MeetingDetailResponse,
  MeetingInput,
} from '@/lib/meetings/types'

export function useMeetings() {
  return useQuery<ListMeetingsResponse>({
    queryKey: queryKeys.meetings,
    queryFn: () => apiFetch('/api/meetings'),
  })
}

export function useMeeting(id: string | null) {
  return useQuery<MeetingDetailResponse>({
    queryKey: queryKeys.meeting(id ?? ''),
    queryFn: () => apiFetch(`/api/meetings/${encodeURIComponent(id!)}`),
    enabled: !!id,
  })
}

export function useCreateMeeting() {
  const qc = useQueryClient()
  return useMutation<MeetingDetailResponse, Error, MeetingInput>({
    mutationFn: (body) =>
      apiFetch('/api/meetings', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings'] }),
  })
}

export function useUpdateMeeting() {
  const qc = useQueryClient()
  return useMutation<
    MeetingDetailResponse,
    Error,
    {
      id: string
      name?: string
      description?: string | null
      /** Absent leaves the roster alone; an empty array clears it. */
      member_ids?: string[]
      archived?: boolean
    }
  >({
    mutationFn: ({ id, ...body }) =>
      apiFetch(`/api/meetings/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings'] }),
  })
}

export function useArchiveMeeting() {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean }, Error, { id: string; archived: boolean }>({
    mutationFn: ({ id, archived }) =>
      apiFetch(`/api/meetings/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings'] }),
  })
}
