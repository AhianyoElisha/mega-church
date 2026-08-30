// Centralised TanStack Query keys.
//
// Convention: the top-level key names the domain, so `invalidateQueries({
// queryKey: ['members'] })` clears every member query at once.

export const queryKeys = {
  members: (
    filters: {
      search?: string
      status?: string
      constituency?: string
      service?: string
    } = {},
  ) =>
    [
      'members',
      filters.search ?? '',
      filters.status ?? '',
      filters.constituency ?? '',
      // Part of the key, not just the URL: two filters that fetch different
      // rows must not share a cache entry, or switching service shows the
      // previous service's members until the refetch lands.
      filters.service ?? '',
    ] as const,
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

  // Constituencies and bacentas share the `groups` prefix so one
  // `invalidateQueries({ queryKey: ['groups'] })` after any group write
  // refreshes the lists, the counts and the dropdowns together — a member
  // reassigned on one screen changes a count on three others.
  constituencies: ['groups', 'constituencies'] as const,
  constituency: (id: string) => ['groups', 'constituencies', 'one', id] as const,
  bacentas: ['groups', 'bacentas'] as const,
  bacenta: (id: string) => ['groups', 'bacentas', 'one', id] as const,
  basontas: ['groups', 'basontas'] as const,
  basonta: (id: string) => ['groups', 'basontas', 'one', id] as const,
  myGroups: ['groups', 'mine'] as const,
  leaders: ['groups', 'leaders'] as const,

  birthdays: ['birthdays'] as const,

  // One `sms` prefix for templates, the log and the config status: creating a
  // template changes which options the tithe screen offers and which message
  // the birthday run would send, and sending changes the log — invalidating
  // each by hand is how one of them ends up stale.
  smsTemplates: (category?: string) => ['sms', 'templates', category ?? ''] as const,
  smsLog: (category?: string) => ['sms', 'log', category ?? ''] as const,
  // Under the same prefix as the rest, so a send invalidates it: the balance
  // shown after spending must not be the one read before.
  smsBalance: ['sms', 'balance'] as const,
  pushStatus: ['push', 'status'] as const,

  dashboard: ['dashboard'] as const,
} as const
