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
import type { MemberType } from '@/lib/appwrite/config'
import type { BulkTypeResponse, RolloverAction, RolloverResponse } from '@/lib/members/students'

export function useMembers(
  filters: {
    search?: string
    status?: string
    constituency?: string
    /** `first` | `second` — the member's usual service, never a gate on
     *  attendance (PRD §2.1). */
    service?: string
    /** `adult` | `student` | `child` — the member category. */
    type?: string
  } = {},
  opts: {
    /** False keeps the query idle — a search box that has not been typed in
     *  yet must not fetch the whole registry to have something to filter. */
    enabled?: boolean
  } = {},
) {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.status) params.set('status', filters.status)
  if (filters.constituency) params.set('constituency', filters.constituency)
  if (filters.service) params.set('service', filters.service)
  if (filters.type) params.set('type', filters.type)
  const qs = params.toString()
  return useQuery<ListMembersResponse>({
    queryKey: queryKeys.members(filters),
    queryFn: () => apiFetch(`/api/members${qs ? `?${qs}` : ''}`),
    enabled: opts.enabled ?? true,
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

/**
 * The bulk category move on /members. Admin only, and the server says so; the
 * page hides the controls from everyone else so nobody is offered a 403.
 */
export function useBulkMemberType() {
  const qc = useQueryClient()
  return useMutation<BulkTypeResponse, Error, { member_ids: string[]; member_type: MemberType }>({
    mutationFn: (body) =>
      apiFetch('/api/members/bulk-type', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  })
}

/** Promote / repeat / graduate a selection on /students. Admin only. */
export function useStudentRollover() {
  const qc = useQueryClient()
  return useMutation<RolloverResponse, Error, { member_ids: string[]; action: RolloverAction }>({
    mutationFn: (body) =>
      apiFetch('/api/students/rollover', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  })
}
