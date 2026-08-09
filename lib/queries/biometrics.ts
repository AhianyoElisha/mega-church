'use client'

// Two data sources, deliberately separate:
//   - /api/biometrics/*  — the Next server, template metadata, via apiFetch.
//   - the LOCAL bridge   — http://127.0.0.1:7788, for capture and health.
//
// Talking to localhost hardware from the browser is the entire reason the
// bridge exists, so those calls are direct fetches by design. They can never
// route through the Next server, which may be on a different machine than the
// scanner.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './fetcher'
import { queryKeys } from './keys'
import type {
  BiometricTemplateMeta,
  EnrolledMemberSummary,
  EnrollRequest,
  EnrollResponse,
  MatcherHealth,
} from '@/lib/biometrics/types'

export const BRIDGE_URL =
  process.env.NEXT_PUBLIC_CHURCH_BRIDGE_URL ?? 'http://127.0.0.1:7788'

// --- Local bridge ----------------------------------------------------------

export type BridgeHealth = {
  ok: boolean
  device: boolean
  /** The capture binary is present. */
  scanBin: boolean
  nbis: boolean
  busy: boolean
}

export type BridgeScanResult =
  | { ok: true; template: string; minutiae: number; variance: number | null }
  | { ok: false; error: string }

export function useBridgeHealth() {
  return useQuery<BridgeHealth>({
    queryKey: queryKeys.bridgeHealth,
    queryFn: async () => {
      const res = await fetch(`${BRIDGE_URL}/health`, { cache: 'no-store' })
      if (!res.ok) throw new Error('bridge unreachable')
      return (await res.json()) as BridgeHealth
    },
    refetchInterval: 10_000,
    retry: false,
    // A bridge being down is a normal state — the page still lists and deletes
    // enrolments. Surface it as data-absent, not a thrown error boundary.
    throwOnError: false,
  })
}

/**
 * The other half of the health picture: can the SERVER identify what the
 * scanner captures?
 *
 * `useBridgeHealth` runs in the browser and only proves the scanner is on this
 * machine. A server with no matcher returns `no_match` for every scan, which is
 * indistinguishable from an unknown finger until you ask this endpoint.
 */
export function useMatcherHealth() {
  return useQuery<{ ok: boolean; matcher: MatcherHealth }>({
    queryKey: queryKeys.matcherHealth,
    queryFn: () => apiFetch('/api/biometrics/matcher-health'),
    refetchInterval: 30_000,
    retry: false,
    throwOnError: false,
  })
}

/**
 * One capture round-trip. Long-running — the bridge waits for a finger — so
 * this is a plain function, not a query.
 *
 * `waitClear` makes the scanner wait for an EMPTY platen before arming, so one
 * press cannot be captured twice.
 */
export async function bridgeScan(
  timeoutS = 30,
  opts: { waitClear?: boolean } = {},
): Promise<BridgeScanResult> {
  try {
    const res = await fetch(`${BRIDGE_URL}/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeoutS, waitClear: opts.waitClear === true }),
    })
    return (await res.json()) as BridgeScanResult
  } catch {
    return { ok: false, error: 'bridge_unreachable' }
  }
}

// --- Next API --------------------------------------------------------------

export function useEnrolledMembers() {
  return useQuery<{ ok: boolean; members: EnrolledMemberSummary[] }>({
    queryKey: queryKeys.biometricsEnrolled,
    queryFn: () => apiFetch('/api/biometrics/templates'),
  })
}

export function useMemberTemplates(memberId: string | null) {
  return useQuery<{ ok: boolean; templates: BiometricTemplateMeta[] }>({
    queryKey: queryKeys.biometricsMember(memberId ?? ''),
    queryFn: () =>
      apiFetch(`/api/biometrics/templates?member_id=${encodeURIComponent(memberId!)}`),
    enabled: !!memberId,
  })
}

export function useEnrollFinger() {
  const qc = useQueryClient()
  return useMutation<EnrollResponse, Error, EnrollRequest>({
    mutationFn: (body) =>
      apiFetch<EnrollResponse>('/api/biometrics/enroll', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['biometrics'] })
      // Enrolment progress is shown on the member list too.
      qc.invalidateQueries({ queryKey: ['members'] })
    },
  })
}

export function useDeleteTemplates() {
  const qc = useQueryClient()
  return useMutation<
    { ok: boolean; deleted: number },
    Error,
    { member_id: string; finger_label?: string }
  >({
    mutationFn: ({ member_id, finger_label }) => {
      const params = new URLSearchParams({ member_id })
      if (finger_label) params.set('finger_label', finger_label)
      return apiFetch(`/api/biometrics/templates?${params}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['biometrics'] })
      qc.invalidateQueries({ queryKey: ['members'] })
    },
  })
}
