// Pure aggregator for the live monitor. No Appwrite imports — the orchestrator
// fetches, this shapes.

import type { AttendanceRecord, LiveStats } from './types'

/** Timeline granularity. Five minutes is fine enough to see the pre-service
 *  rush and coarse enough that a two-hour service is 24 buckets, not 120. */
export const BUCKET_MINUTES = 5

/**
 * Floor an ISO timestamp to its bucket, returned as ISO. Null when the input
 * is not a date — `toISOString()` THROWS on NaN rather than returning a
 * sentinel, so this has to be checked before formatting, not after.
 */
function bucketOf(iso: string): string | null {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  const size = BUCKET_MINUTES * 60_000
  return new Date(Math.floor(t / size) * size).toISOString()
}

export function aggregateLive(
  occurrence_id: string,
  meeting_id: string,
  expected: number,
  records: AttendanceRecord[],
): LiveStats {
  const by_method = { biometric: 0, manual: 0 }
  const buckets = new Map<string, number>()

  for (const r of records) {
    if (r.method === 'manual') by_method.manual++
    else by_method.biometric++

    // A record with an unparseable timestamp still counts towards the totals;
    // it just does not land on the sparkline. Losing a mark because its clock
    // was wrong would be the worse trade.
    const at = bucketOf(r.marked_at)
    if (at !== null) buckets.set(at, (buckets.get(at) ?? 0) + 1)
  }

  const present = records.length
  return {
    occurrence_id,
    meeting_id,
    expected,
    present,
    // A service's `expected` is the active-member count, which people can and
    // do exceed on a good Sunday once visitors are registered. Never render a
    // negative outstanding.
    outstanding: Math.max(0, expected - present),
    by_method,
    timeline: [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([at, count]) => ({ at, count })),
  }
}
