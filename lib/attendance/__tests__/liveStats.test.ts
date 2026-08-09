import { describe, expect, it } from 'vitest'
import { aggregateLive } from '@/lib/attendance/liveStats'
import type { AttendanceRecord } from '@/lib/attendance/types'

function rec(
  id: string,
  marked_at: string,
  method: 'biometric' | 'manual' = 'biometric',
): AttendanceRecord {
  return {
    $id: id,
    $createdAt: marked_at,
    occurrence_id: 'occ1',
    meeting_id: 'meet1',
    member_id: `mem-${id}`,
    marked_at,
    method,
    marked_by: null,
    station: null,
    note: null,
  }
}

describe('aggregateLive', () => {
  it('counts an empty occurrence without dividing by zero', () => {
    const s = aggregateLive('occ1', 'meet1', 50, [])
    expect(s.present).toBe(0)
    expect(s.outstanding).toBe(50)
    expect(s.timeline).toEqual([])
  })

  it('splits biometric and manual marks', () => {
    const s = aggregateLive('occ1', 'meet1', 10, [
      rec('a', '2026-08-09T08:00:00.000Z'),
      rec('b', '2026-08-09T08:01:00.000Z', 'manual'),
      rec('c', '2026-08-09T08:02:00.000Z'),
    ])
    expect(s.present).toBe(3)
    expect(s.by_method).toEqual({ biometric: 2, manual: 1 })
    expect(s.outstanding).toBe(7)
  })

  it('never reports negative outstanding when turnout beats expectation', () => {
    // A service's `expected` is the active-member count, which a good Sunday
    // genuinely exceeds once visitors have been registered mid-service.
    const s = aggregateLive('occ1', 'meet1', 2, [
      rec('a', '2026-08-09T08:00:00.000Z'),
      rec('b', '2026-08-09T08:00:30.000Z'),
      rec('c', '2026-08-09T08:01:00.000Z'),
    ])
    expect(s.outstanding).toBe(0)
  })

  it('buckets the timeline into five-minute slots', () => {
    const s = aggregateLive('occ1', 'meet1', 10, [
      rec('a', '2026-08-09T08:00:10.000Z'),
      rec('b', '2026-08-09T08:04:59.000Z'),
      rec('c', '2026-08-09T08:05:00.000Z'),
    ])
    expect(s.timeline).toEqual([
      { at: '2026-08-09T08:00:00.000Z', count: 2 },
      { at: '2026-08-09T08:05:00.000Z', count: 1 },
    ])
  })

  it('returns the timeline in chronological order regardless of input order', () => {
    const s = aggregateLive('occ1', 'meet1', 10, [
      rec('late', '2026-08-09T09:00:00.000Z'),
      rec('early', '2026-08-09T08:00:00.000Z'),
    ])
    expect(s.timeline.map((t) => t.at)).toEqual([
      '2026-08-09T08:00:00.000Z',
      '2026-08-09T09:00:00.000Z',
    ])
  })

  it('still counts a record whose timestamp is unparseable', () => {
    // Losing somebody from the total because their clock was wrong is the
    // worse failure; it just does not land on the sparkline.
    const s = aggregateLive('occ1', 'meet1', 10, [
      rec('good', '2026-08-09T08:00:00.000Z'),
      rec('bad', 'not-a-date'),
    ])
    expect(s.present).toBe(2)
    expect(s.timeline).toHaveLength(1)
  })
})
