'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './fetcher'
import { queryKeys } from './keys'
import type {
  AttendanceListResponse,
  LiveStatsResponse,
  ManualRequest,
  MemberHistoryResponse,
  ScanResponse,
} from '@/lib/attendance/types'

export function useLiveStats(occurrenceId: string | null, pollMs = 15_000) {
  return useQuery<LiveStatsResponse>({
    queryKey: queryKeys.attendanceLive(occurrenceId ?? ''),
    queryFn: () =>
      apiFetch(`/api/attendance/live?occurrence_id=${encodeURIComponent(occurrenceId!)}`),
    enabled: !!occurrenceId,
    // Realtime pushes the individual rows; this poll is the backstop that
    // reconciles the aggregate if a websocket message is missed.
    refetchInterval: pollMs,
    staleTime: 5_000,
  })
}

export function useAttendanceRecords(occurrenceId: string | null) {
  return useQuery<AttendanceListResponse>({
    queryKey: queryKeys.attendanceRecords(occurrenceId ?? ''),
    queryFn: () =>
      apiFetch(`/api/attendance/records?occurrence_id=${encodeURIComponent(occurrenceId!)}`),
    enabled: !!occurrenceId,
  })
}

export function useMemberHistory(memberId: string | null) {
  return useQuery<MemberHistoryResponse>({
    queryKey: queryKeys.memberAttendance(memberId ?? ''),
    queryFn: () =>
      apiFetch(`/api/attendance/member/${encodeURIComponent(memberId!)}`),
    enabled: !!memberId,
  })
}

/** Manual check-in. `dry_run: true` resolves the member without writing, so
 *  the UI can show a confirmation card first. */
export function useManualCheckIn() {
  const qc = useQueryClient()
  return useMutation<ScanResponse, Error, ManualRequest>({
    mutationFn: (body) =>
      apiFetch('/api/attendance/manual', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_data, vars) => {
      if (vars.dry_run) return
      qc.invalidateQueries({ queryKey: ['attendance'] })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
  })
}
