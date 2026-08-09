// Centralised TanStack Query keys.
//
// Convention: the top-level key names the domain, so `invalidateQueries({
// queryKey: ['members'] })` clears every member query at once.

export const queryKeys = {
  members: (filters: { search?: string; status?: string } = {}) =>
    ['members', filters.search ?? '', filters.status ?? ''] as const,
  member: (id: string) => ['members', 'one', id] as const,
  memberStats: ['members', 'stats'] as const,

  meetings: ['meetings'] as const,
  meeting: (id: string) => ['meetings', 'one', id] as const,
  meetingRoster: (id: string) => ['meetings', 'roster', id] as const,

  occurrences: (filters: { meetingId?: string } = {}) =>
    ['occurrences', filters.meetingId ?? ''] as const,
  occurrence: (id: string) => ['occurrences', 'one', id] as const,
  /** The single globally-open occurrence, or null. PRD §2.2. */
  activeOccurrence: ['occurrences', 'active'] as const,

  attendanceLive: (occurrenceId: string) => ['attendance', 'live', occurrenceId] as const,
  attendanceRecords: (occurrenceId: string) =>
    ['attendance', 'records', occurrenceId] as const,
  memberAttendance: (memberId: string) => ['attendance', 'member', memberId] as const,

  biometricsEnrolled: ['biometrics', 'enrolled'] as const,
  biometricsMember: (memberId: string) => ['biometrics', 'member', memberId] as const,
  bridgeHealth: ['biometrics', 'bridge-health'] as const,
  matcherHealth: ['biometrics', 'matcher-health'] as const,

  dashboard: ['dashboard'] as const,
} as const
