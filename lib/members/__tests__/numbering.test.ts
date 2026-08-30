import { describe, expect, it } from 'vitest'
import {
  RESERVED_MEMBER_NUMBERS,
  backfillOrder,
  formatMemberNo,
  nextMemberNo,
  parseMemberNo,
} from '../numbering'

describe('parseMemberNo', () => {
  it('splits the year from the sequence', () => {
    expect(parseMemberNo('2026001')).toEqual({ year: 2026, seq: 1 })
    expect(parseMemberNo('2026157')).toEqual({ year: 2026, seq: 157 })
    expect(parseMemberNo('2027001')).toEqual({ year: 2027, seq: 1 })
  })

  it('reads a four-digit sequence, which is what happens past 999', () => {
    expect(parseMemberNo('20261000')).toEqual({ year: 2026, seq: 1000 })
  })

  it('rejects anything that is not a member number', () => {
    for (const bad of ['', '2026', 'abc', '2026abc', '20260000', null, undefined, 7, '  ']) {
      expect(parseMemberNo(bad)).toBeNull()
    }
  })

  it('tolerates surrounding whitespace, because a pasted number carries it', () => {
    expect(parseMemberNo('  2026001  ')).toEqual({ year: 2026, seq: 1 })
  })
})

describe('formatMemberNo', () => {
  it('pads the sequence to three digits', () => {
    expect(formatMemberNo(2026, 1)).toBe('2026001')
    expect(formatMemberNo(2026, 42)).toBe('2026042')
    expect(formatMemberNo(2026, 999)).toBe('2026999')
  })

  it('lets the number grow rather than truncating past 999', () => {
    expect(formatMemberNo(2026, 1000)).toBe('20261000')
  })

  it('round-trips with parseMemberNo', () => {
    for (const seq of [1, 9, 10, 99, 100, 999, 1000, 12345]) {
      expect(parseMemberNo(formatMemberNo(2026, seq))).toEqual({ year: 2026, seq })
    }
  })
})

describe('nextMemberNo', () => {
  // Every case passes an explicit `reserved` so the church's real reservation
  // cannot make or break an unrelated assertion.
  const none: string[] = []

  it('starts a year at 001', () => {
    expect(nextMemberNo([], 2026, none)).toBe('2026001')
    expect(nextMemberNo(['2026001'], 2027, none)).toBe('2027001')
  })

  it('continues from the highest taken', () => {
    expect(nextMemberNo(['2026001', '2026002', '2026003'], 2026, none)).toBe('2026004')
  })

  it('ignores other years entirely', () => {
    expect(nextMemberNo(['2025900', '2026002', '2027050'], 2026, none)).toBe('2026003')
  })

  it('ignores nulls and rubbish, which is what a half-backfilled table holds', () => {
    expect(nextMemberNo([null, undefined, '', 'nonsense', '2026007'], 2026, none)).toBe('2026008')
  })

  it('does NOT fill a gap left by a deleted member', () => {
    // Reissuing 002 would give a new person the number a deleted one had, and
    // every paper record naming it would now point at somebody else.
    expect(nextMemberNo(['2026001', '2026003'], 2026, none)).toBe('2026004')
  })

  it('crosses 999 by growing the number, and keeps counting correctly after', () => {
    expect(nextMemberNo(['2026999'], 2026, none)).toBe('20261000')
    // The regression this pins: a LEXICAL maximum of these strings is
    // "2026999", so a sort-based allocator would hand out 20261000 a second
    // time. Numeric parsing is what makes 1001 the answer.
    expect(nextMemberNo(['2026999', '20261000'], 2026, none)).toBe('20261001')
  })

  it('never issues a reserved number, even when it is next in line', () => {
    expect(nextMemberNo(['2026001', '2026002'], 2026, ['2026003'])).toBe('2026004')
  })

  it('skips a run of consecutive reservations', () => {
    expect(nextMemberNo(['2026001'], 2026, ['2026002', '2026003', '2026004'])).toBe('2026005')
  })

  it('does NOT let a distant reservation raise the floor', () => {
    // The regression this pins is the one that would have shipped: counting a
    // reservation towards the maximum meant that with 2026005 held and nothing
    // issued, the church's FIRST member was handed 2026006.
    expect(nextMemberNo([], 2026, ['2026005'])).toBe('2026001')
    expect(nextMemberNo(['2026001'], 2026, ['2026009'])).toBe('2026002')
  })

  it('skips the reservation when the count finally reaches it', () => {
    expect(nextMemberNo(['2026001', '2026002', '2026003'], 2026, ['2026004'])).toBe('2026005')
  })

  it("holds Hayford Budu's place by default", () => {
    // The real reservation, exercised through the default argument — the
    // backfill and every live registration take this path.
    expect(RESERVED_MEMBER_NUMBERS['2026005']).toContain('Hayford Budu')
    // The pastor, his wife and the two heads with member rows take 001-004,
    // Hayford's 005 is held, and the congregation starts at 006.
    expect(nextMemberNo(['2026001', '2026002', '2026003', '2026004'], 2026)).toBe('2026006')
    // And it does not disturb the start of the year.
    expect(nextMemberNo([], 2026)).toBe('2026001')
  })
})

describe('backfillOrder', () => {
  const m = (id: string, createdAt: string) => ({
    $id: id,
    $createdAt: createdAt,
    full_name: id,
  })

  const pastor = m('kwame', '2026-08-16T11:31:56.000Z')
  const wife = m('bernice', '2026-08-16T11:58:14.000Z')
  const headA = m('michael', '2026-08-20T00:00:00.000Z')
  const headB = m('frank', '2026-08-21T00:00:00.000Z')
  const early = m('early-joiner', '2026-08-01T00:00:00.000Z')
  const late = m('late-joiner', '2026-08-25T00:00:00.000Z')

  it('puts the two named people first, then heads, then everyone by join date', () => {
    const ordered = backfillOrder([late, headB, early, wife, headA, pastor], {
      firstIds: ['kwame', 'bernice'],
      headIds: ['michael', 'frank'],
    })
    expect(ordered.map((x) => x.$id)).toEqual([
      'kwame',
      'bernice',
      'michael',
      'frank',
      // `early-joiner` registered before either head, and still comes after
      // them — the head ordering is a decision, not a date.
      'early-joiner',
      'late-joiner',
    ])
  })

  it('keeps a head who is also one of the named few in their earlier place', () => {
    // Bernice heads Tsalack AND is number two. Listing her in both must not
    // move her down to the head block.
    const ordered = backfillOrder([headA, wife, pastor], {
      firstIds: ['kwame', 'bernice'],
      headIds: ['bernice', 'michael'],
    })
    expect(ordered.map((x) => x.$id)).toEqual(['kwame', 'bernice', 'michael'])
  })

  it('does not mutate the array it was given', () => {
    const input = [late, pastor]
    backfillOrder(input, { firstIds: ['kwame'], headIds: [] })
    expect(input.map((x) => x.$id)).toEqual(['late-joiner', 'kwame'])
  })

  it('names nobody special and still orders by join date', () => {
    const ordered = backfillOrder([late, early], { firstIds: [], headIds: [] })
    expect(ordered.map((x) => x.$id)).toEqual(['early-joiner', 'late-joiner'])
  })
})
