'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './fetcher'
import { queryKeys } from './keys'
import type {
  ListMembersResponse,
  MemberInput,
  MemberResponse,
  MemberStatsResponse,
} from '@/lib/members/types'

export function useMembers(
  filters: {
    search?: string
    status?: string
    constituency?: string
    /** `first` | `second` — the member's usual service, never a gate on
     *  attendance (PRD §2.1). */
    service?: string
  } = {},
) {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.status) params.set('status', filters.status)
  if (filters.constituency) params.set('constituency', filters.constituency)
  if (filters.service) params.set('service', filters.service)
  const qs = params.toString()
  return useQuery<ListMembersResponse>({
    queryKey: queryKeys.members(filters),
    queryFn: () => apiFetch(`/api/members${qs ? `?${qs}` : ''}`),
  })
}

export function useMember(id: string | null) {
  return useQuery<MemberResponse>({
    queryKey: queryKeys.member(id ?? ''),
    queryFn: () => apiFetch(`/api/members/${encodeURIComponent(id!)}`),
    enabled: !!id,
  })
}

export function useMemberStats() {
  return useQuery<MemberStatsResponse>({
    queryKey: queryKeys.memberStats,
    queryFn: () => apiFetch('/api/members/stats'),
  })
}

export function useCreateMember() {
  const qc = useQueryClient()
  return useMutation<MemberResponse, Error, MemberInput>({
    mutationFn: (body) =>
      apiFetch('/api/members', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  })
}

export function useUpdateMember() {
  const qc = useQueryClient()
  return useMutation<MemberResponse, Error, { id: string } & Partial<MemberInput>>({
    mutationFn: ({ id, ...body }) =>
      apiFetch(`/api/members/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  })
}

export function useDeleteMember() {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean }, Error, { id: string }>({
    mutationFn: ({ id }) =>
      apiFetch(`/api/members/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  })
}

/** Photo upload is multipart, so it bypasses the JSON body helper. */
export function useUploadMemberPhoto() {
  const qc = useQueryClient()
  return useMutation<{ ok: true; photo_file_id: string }, Error, { id: string; file: File }>({
    mutationFn: async ({ id, file }) => {
      const form = new FormData()
      form.append('file', file)
      return apiFetch(`/api/members/${encodeURIComponent(id)}/photo`, {
        method: 'POST',
        body: form,
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  })
}
