import { describe, expect, it } from 'vitest'
import {
  attendanceTarget,
  canActivate,
  canResume,
  companionOf,
  companionOnlyMessage,
  pausedOccurrences,
  resolveOpenOccurrence,
  todayInAccra,
} from '@/lib/attendance/occurrenceResolver'
import { SERVICE_IDS } from '@/lib/appwrite/config'
import type { Meeting, MeetingOccurrence } from '@/lib/meetings/types'

function occ(
  id: string,
  status: 'open' | 'paused' | 'closed',
  parent: string | null = null,
): MeetingOccurrence {
  return {
    $id: id,
    meeting_id: parent ? SERVICE_IDS.save : `m-${id}`,
    occurrence_date: '2026-08-09',
    status,
    opened_at: '2026-08-09T08:00:00.000Z',
    paused_at: status === 'paused' ? '2026-08-09T09:00:00.000Z' : null,
    closed_at: status === 'closed' ? '2026-08-09T10:00:00.000Z' : null,
    opened_by: 'admin@church',
    closed_by: null,
    parent_occurrence_id: parent,
    present_count: 0,
  }
}

/** A meeting as `canActivate` sees it. Any id but Save Church's is ordinary. */
const live = { $id: 'youth-committee', archived: false }

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

// Save Church is a COMPANION: open for the whole of its parent service, never
// on the scanner. Every Sunday has two open rows, and the single-open rule has
// to see one.
describe('companions', () => {
  it('an open companion beside its parent is `open`, not `multiple`', () => {
    const parent = occ('first', 'open')
    const res = resolveOpenOccurrence([parent, occ('save', 'open', 'first')])
    expect(res).toEqual({ kind: 'open', occurrence: parent })
  })

  it('a companion alone is not an open session', () => {
    // Its parent closed (or was never there): nothing holds the scanner.
    expect(resolveOpenOccurrence([occ('save', 'open', 'first')])).toEqual({ kind: 'none' })
  })

  it('a companion does not block activating something else', () => {
    // The parent is what blocks. A companion left open by a crash between the
    // two close writes must not lock the Services page until somebody finds
    // a row no screen lists.
    expect(canActivate(live, [occ('save', 'open', 'first')])).toEqual({ ok: true })
  })

  it('a companion does not block a resume either', () => {
    expect(canResume(occ('a', 'paused'), [occ('save', 'open', 'first')])).toEqual({ ok: true })
  })

  it('is never in the paused list', () => {
    expect(pausedOccurrences([occ('a', 'paused'), occ('save', 'paused', 'a')])).toEqual([
      occ('a', 'paused'),
    ])
  })

  it('companionOf finds the open companion of a parent and nothing else', () => {
    const rows = [
      occ('first', 'open'),
      occ('save-old', 'closed', 'first'),
      occ('save', 'open', 'first'),
      occ('save-other', 'open', 'second'),
    ]
    expect(companionOf('first', rows)?.$id).toBe('save')
    expect(companionOf('second', rows)?.$id).toBe('save-other')
    expect(companionOf('nobody', rows)).toBeNull()
  })
})

describe('canActivate', () => {
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
    const res = canActivate({ ...live, archived: true }, [])
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.reason).toBe('archived')
  })

  it('does NOT require the first service to have run before the second', () => {
    // A Sunday with only one service is normal. A rule requiring the first
    // would be discovered at 9am on that Sunday.
    expect(canActivate(live, [])).toEqual({ ok: true })
  })

  it('refuses Save Church by itself, even with nothing open', () => {
    // It opens WITH an adult service. On its own there is no service for a
    // child to be redirected from, and the scanner would be marking a
    // children's session for every adult who touched it.
    expect(canActivate({ $id: SERVICE_IDS.save, archived: false }, [])).toEqual({
      ok: false,
      reason: 'companion_only',
    })
  })

  it('names the refusal', () => {
    expect(companionOnlyMessage('Save Church')).toBe(
      'Save Church opens with First or Second Service and cannot be activated on its own.',
    )
  })
})

// A paused session is running but off the scanner. Everything below is a
// consequence of it simply not being `open` — none of it is a special case.
describe('paused occurrences', () => {
  it('is not the live session, so the kiosk sees none', () => {
    expect(resolveOpenOccurrence([occ('a', 'paused')])).toEqual({ kind: 'none' })
  })

  it('does not count towards the two-open refusal', () => {
    const result = resolveOpenOccurrence([occ('a', 'paused'), occ('b', 'open')])
    expect(result).toEqual({ kind: 'open', occurrence: occ('b', 'open') })
  })

  // The whole point of pausing: it frees the slot so another activity can run.
  it('does NOT block activating something else', () => {
    expect(canActivate(live, [occ('a', 'paused')])).toEqual({ ok: true })
  })

  it('still blocks nothing even when several are paused', () => {
    expect(canActivate(live, [occ('a', 'paused'), occ('b', 'paused')])).toEqual({ ok: true })
  })
})

describe('canResume', () => {
  it('resumes a paused session when nothing else is open', () => {
    expect(canResume(occ('a', 'paused'), [])).toEqual({ ok: true })
  })

  it('ignores other PAUSED sessions — they hold no slot', () => {
    expect(canResume(occ('a', 'paused'), [occ('b', 'paused')])).toEqual({ ok: true })
  })

  // Pausing First Service to run a committee meeting is the point; resuming it
  // while that meeting is still open would put two on the scanner at once.
  it('refuses while another session is open, and names the blocker', () => {
    const blocking = occ('b', 'open')
    expect(canResume(occ('a', 'paused'), [blocking])).toEqual({
      ok: false,
      reason: 'already_open',
      blocking,
    })
  })

  it('refuses to resume something that is already open', () => {
    expect(canResume(occ('a', 'open'), [])).toEqual({ ok: false, reason: 'not_paused' })
  })

  it('refuses to resume a closed session — that is a new occurrence', () => {
    expect(canResume(occ('a', 'closed'), [])).toEqual({ ok: false, reason: 'not_paused' })
  })
})

// Where a mark lands. The one redirect in the system, decided purely from the
// member's TYPE and the open meeting — never from `home_service`, which does
// not gate attendance (PRD §2.1).
describe('attendanceTarget', () => {
  const meeting = (over: Partial<Meeting>): { meeting: Pick<Meeting, 'kind' | 'service_slot'> } => ({
    meeting: { kind: 'service', service_slot: 'first', ...over },
  })
  const child = { member_type: 'child' as const }
  const adult = { member_type: 'adult' as const }
  const student = { member_type: 'student' as const }

  it('sends a child at First Service to the companion', () => {
    expect(attendanceTarget(meeting({ service_slot: 'first' }), child)).toBe('companion')
  })

  it('sends a child at Second Service to the companion', () => {
    expect(attendanceTarget(meeting({ service_slot: 'second' }), child)).toBe('companion')
  })

  it('leaves an adult at a service exactly where they scanned', () => {
    expect(attendanceTarget(meeting({}), adult)).toBe('parent')
  })

  it('a student is an adult for this purpose', () => {
    expect(attendanceTarget(meeting({}), student)).toBe('parent')
  })

  it('a child at a restricted meeting goes to the meeting — the roster decides', () => {
    // A children's committee is a real thing, and redirecting its members to
    // Save Church would make it impossible to take.
    expect(
      attendanceTarget(meeting({ kind: 'meeting', service_slot: null }), child),
    ).toBe('parent')
  })

  it('a child at Save Church itself stays there', () => {
    // Not reachable today (Save Church cannot be activated alone), but if it
    // ever were, redirecting a child from Save Church to Save Church's
    // companion is a loop nobody wants.
    expect(attendanceTarget(meeting({ service_slot: 'save' }), child)).toBe('parent')
  })
})
