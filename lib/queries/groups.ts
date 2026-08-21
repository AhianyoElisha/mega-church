'use client'

// TanStack hooks for constituencies and bacentas.
//
// Every mutation invalidates the whole `groups` prefix rather than one key.
// That is not laziness: assigning members changes a count on the constituency
// list, the bacenta list, the member registry and the group's own page, and
// invalidating each by hand is how one of them ends up showing a stale number
// that a user then reports as "the assignment did not save".

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './fetcher'
import { queryKeys } from './keys'
import type {
  BacentaCategoryResponse,
  BacentaInput,
  BacentaResponse,
  ConstituencyInput,
  ConstituencyResponse,
  GroupDetailResponse,
  ListBacentasResponse,
  ListConstituenciesResponse,
  CreateLeaderResponse,
  ListLeadersResponse,
  MembershipMode,
  MembershipResponse,
  MyGroupsResponse,
} from '@/lib/groups/types'

const GROUPS = ['groups']

function useGroupMutation<TData, TVars>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient()
  return useMutation<TData, Error, TVars>({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: GROUPS })
      // Members carry their constituency and bacentas, so the registry is
      // stale after any of this too.
      void qc.invalidateQueries({ queryKey: ['members'] })
    },
  })
}

// --- constituencies ---------------------------------------------------------

/**
 * `enabled: false` matters here, not just as an optimisation.
 *
 * `/api/constituencies` is admin data and answers a `leader` with 403 (PRD
 * §5.2). A head opening their own group page must not fire it at all — the
 * request would fail, land in the query cache as an error, and give the page a
 * failed request to explain that has nothing to do with anything they did.
 */
export function useConstituencies(options: { enabled?: boolean } = {}) {
  return useQuery<ListConstituenciesResponse>({
    queryKey: queryKeys.constituencies,
    queryFn: () => apiFetch('/api/constituencies'),
    enabled: options.enabled ?? true,
  })
}

export function useConstituency(id: string | null) {
  return useQuery<GroupDetailResponse>({
    queryKey: queryKeys.constituency(id ?? ''),
    queryFn: () => apiFetch(`/api/constituencies/${encodeURIComponent(id!)}`),
    enabled: !!id,
  })
}

export function useCreateConstituency() {
  return useGroupMutation<ConstituencyResponse, ConstituencyInput>((body) =>
    apiFetch('/api/constituencies', { method: 'POST', body: JSON.stringify(body) }),
  )
}

export function useUpdateConstituency() {
  return useGroupMutation<ConstituencyResponse, { id: string } & Partial<ConstituencyInput>>(
    ({ id, ...body }) =>
      apiFetch(`/api/constituencies/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  )
}

export function useDeleteConstituency() {
  return useGroupMutation<{ ok: boolean }, { id: string }>(({ id }) =>
    apiFetch(`/api/constituencies/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  )
}

/** Bulk-file members into a constituency. `remove` clears them out of it. */
export function useAssignConstituency() {
  return useGroupMutation<
    MembershipResponse,
    { id: string; member_ids: string[]; mode?: 'add' | 'remove' }
  >(({ id, member_ids, mode = 'add' }) =>
    apiFetch(`/api/constituencies/${encodeURIComponent(id)}/members`, {
      method: 'POST',
      body: JSON.stringify({ member_ids, mode }),
    }),
  )
}

// --- bacentas ---------------------------------------------------------------

export function useBacentas() {
  return useQuery<ListBacentasResponse>({
    queryKey: queryKeys.bacentas,
    queryFn: () => apiFetch('/api/bacentas'),
  })
}

export function useBacenta(id: string | null) {
  return useQuery<GroupDetailResponse>({
    queryKey: queryKeys.bacenta(id ?? ''),
    queryFn: () => apiFetch(`/api/bacentas/${encodeURIComponent(id!)}`),
    enabled: !!id,
  })
}

export function useCreateBacenta() {
  return useGroupMutation<BacentaResponse, BacentaInput>((body) =>
    apiFetch('/api/bacentas', { method: 'POST', body: JSON.stringify(body) }),
  )
}

export function useUpdateBacenta() {
  return useGroupMutation<BacentaResponse, { id: string } & Partial<BacentaInput>>(
    ({ id, ...body }) =>
      apiFetch(`/api/bacentas/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  )
}

export function useDeleteBacenta() {
  return useGroupMutation<{ ok: boolean }, { id: string }>(({ id }) =>
    apiFetch(`/api/bacentas/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  )
}

export function useAssignBacenta() {
  return useGroupMutation<
    MembershipResponse,
    { id: string; member_ids: string[]; mode?: MembershipMode }
  >(({ id, member_ids, mode = 'add' }) =>
    apiFetch(`/api/bacentas/${encodeURIComponent(id)}/members`, {
      method: 'POST',
      body: JSON.stringify({ member_ids, mode }),
    }),
  )
}

// --- categories -------------------------------------------------------------

export function useCreateBacentaCategory() {
  return useGroupMutation<BacentaCategoryResponse, { name: string; description?: string | null }>(
    (body) => apiFetch('/api/bacenta-categories', { method: 'POST', body: JSON.stringify(body) }),
  )
}

export function useDeleteBacentaCategory() {
  return useGroupMutation<{ ok: boolean }, { id: string }>(({ id }) =>
    apiFetch(`/api/bacenta-categories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  )
}

// --- scoped + leaders -------------------------------------------------------

/** The groups the signed-in account heads. Admins get everything. */
export function useMyGroups() {
  return useQuery<MyGroupsResponse>({
    queryKey: queryKeys.myGroups,
    queryFn: () => apiFetch('/api/my-groups'),
  })
}

export function useLeaderAccounts() {
  return useQuery<ListLeadersResponse>({
    queryKey: queryKeys.leaders,
    queryFn: () => apiFetch('/api/leaders'),
  })
}

/**
 * Create a login for somebody about to be made a head.
 *
 * Invalidates the whole `groups` prefix, not just the leader list: the Head
 * dropdown on every group page reads that list, and the entire reason this
 * exists is that an admin creating a head expects to appoint them in the very
 * next click.
 */
export function useCreateLeader() {
  return useGroupMutation<CreateLeaderResponse, { name: string; email: string; password?: string }>(
    (vars) =>
      apiFetch('/api/leaders', {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
  )
}
