import { describe, expect, it } from 'vitest'
import {
  canActivate,
  resolveOpenOccurrence,
  todayInAccra,
} from '@/lib/attendance/occurrenceResolver'
import type { MeetingOccurrence } from '@/lib/meetings/types'

function occ(id: string, status: 'open' | 'closed'): MeetingOccurrence {
  return {
    $id: id,
    meeting_id: `m-${id}`,
    occurrence_date: '2026-08-09',
    status,
    opened_at: '2026-08-09T08:00:00.000Z',
    closed_at: status === 'closed' ? '2026-08-09T10:00:00.000Z' : null,
    opened_by: 'admin@church',
    closed_by: null,
    present_count: 0,
  }
}

describe('todayInAccra', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(todayInAccra(new Date('2026-08-09T12:00:00Z'))).toBe('2026-08-09')
  })

  it('uses Accra time, not the server clock', () => {
    // Accra is UTC+0 with no DST, so 23:30Z is still the same calendar day —
    // a server in, say, Sydney must not roll this over to the 10th.
    expect(todayInAccra(new Date('2026-08-09T23:30:00Z'))).toBe('2026-08-09')
    expect(todayInAccra(new Date('2026-08-10T00:10:00Z'))).toBe('2026-08-10')
  })
})

describe('resolveOpenOccurrence', () => {
  it('reports none when nothing is open', () => {
    expect(resolveOpenOccurrence([occ('a', 'closed'), occ('b', 'closed')])).toEqual({
      kind: 'none',
    })
  })

  it('reports none for an empty list', () => {
    expect(resolveOpenOccurrence([])).toEqual({ kind: 'none' })
  })

  it('returns the single open occurrence', () => {
    const res = resolveOpenOccurrence([occ('a', 'closed'), occ('b', 'open')])
    expect(res.kind).toBe('open')
    expect(res.kind === 'open' && res.occurrence.$id).toBe('b')
  })

  it('refuses to pick when two are open', () => {
    // The invariant is enforced at write time; if it is ever violated the
    // caller must error rather than record attendance against a guess.
    const res = resolveOpenOccurrence([occ('a', 'open'), occ('b', 'open')])
    expect(res.kind).toBe('multiple')
    expect(res.kind === 'multiple' && res.occurrences).toHaveLength(2)
  })
})

describe('canActivate', () => {
  const live = { archived: false }

  it('allows activation when nothing is open', () => {
    expect(canActivate(live, [])).toEqual({ ok: true })
  })

  it('allows activation when the only other occurrence is closed', () => {
    expect(canActivate(live, [occ('a', 'closed')])).toEqual({ ok: true })
  })

  it('blocks Second Service while First Service is open', () => {
    const res = canActivate(live, [occ('first', 'open')])
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.reason).toBe('already_open')
    expect(res.ok === false && res.reason === 'already_open' && res.blocking.$id).toBe('first')
  })

  it('blocks a meeting while a service is open, not just the other service', () => {
    // The rule is one session globally, not "the two services are exclusive".
    // A committee meeting during First Service would leave the kiosk with two
    // possible answers to "what am I marking?".
    const res = canActivate(live, [occ('first', 'open')])
    expect(res.ok).toBe(false)
  })

  it('blocks an archived meeting', () => {
    const res = canActivate({ archived: true }, [])
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.reason).toBe('archived')
  })

  it('does NOT require the first service to have run before the second', () => {
    // A Sunday with only one service is normal. A rule requiring the first
    // would be discovered at 9am on that Sunday.
    expect(canActivate(live, [])).toEqual({ ok: true })
  })
})
