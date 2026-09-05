import { describe, expect, it } from 'vitest'
import {
  isPartner,
  outstandingPartners,
  paidByMember,
  paidMemberIds,
  paidPartners,
  summarise,
} from '../unpaid'
import {
  currentPeriod,
  currentYear,
  isPeriod,
  parsePeriod,
  periodLabel,
  periodsInYear,
  toPeriod,
} from '../period'

const partner = (id: string, over: Partial<{ benmp_partner: boolean; status: 'active' | 'inactive' }> = {}) => ({
  $id: id,
  benmp_partner: true,
  status: 'active' as const,
  ...over,
})

describe('isPartner', () => {
  it('reads `=== true` and nothing else', () => {
    expect(isPartner({ benmp_partner: true })).toBe(true)
    expect(isPartner({ benmp_partner: false })).toBe(false)
  })

  it('treats a MISSING field as not a partner', () => {
    // Most of the live congregation predates the checkbox, so the field is
    // absent on the majority of rows. The other reading texts hundreds of
    // people about a commitment they never made.
    expect(isPartner({})).toBe(false)
    expect(isPartner({ benmp_partner: undefined })).toBe(false)
    expect(isPartner({ benmp_partner: null })).toBe(false)
  })

  it('does not coerce the STRING "false", which is truthy', () => {
    // The bug this guards is old and specific: coercing enrols the very person
    // being taken off the list.
    expect(isPartner({ benmp_partner: 'false' })).toBe(false)
    expect(isPartner({ benmp_partner: 'true' })).toBe(false)
    expect(isPartner({ benmp_partner: 1 })).toBe(false)
  })
})

describe('outstandingPartners', () => {
  const members = [
    partner('a'),
    partner('b'),
    partner('c'),
    { $id: 'd', benmp_partner: false, status: 'active' as const },
    partner('e', { status: 'inactive' }),
  ]
  const rows = [
    { member_id: 'a', period: '2026-09' },
    { member_id: 'b', period: '2026-08' },
  ]

  it('excludes a partner who has already paid this month', () => {
    const out = outstandingPartners(members, rows, '2026-09').map((m) => m.$id)
    expect(out).not.toContain('a')
  })

  it('includes a partner who paid LAST month but not this one', () => {
    // The most common real case, and the one a naive "has ever paid" check
    // would silently drop.
    const out = outstandingPartners(members, rows, '2026-09').map((m) => m.$id)
    expect(out).toContain('b')
  })

  it('excludes somebody who is not a partner', () => {
    const out = outstandingPartners(members, rows, '2026-09').map((m) => m.$id)
    expect(out).not.toContain('d')
  })

  it('excludes an inactive partner', () => {
    const out = outstandingPartners(members, rows, '2026-09').map((m) => m.$id)
    expect(out).not.toContain('e')
  })

  it('returns exactly the people who should be reminded', () => {
    expect(outstandingPartners(members, rows, '2026-09').map((m) => m.$id)).toEqual(['b', 'c'])
  })

  it('preserves the order it was given', () => {
    const reversed = [...members].reverse()
    expect(outstandingPartners(reversed, rows, '2026-09').map((m) => m.$id)).toEqual(['c', 'b'])
  })

  it('a payment for a DIFFERENT month does not excuse this one', () => {
    const out = outstandingPartners([partner('x')], [{ member_id: 'x', period: '2025-09' }], '2026-09')
    expect(out.map((m) => m.$id)).toEqual(['x'])
  })

  it('with no rows at all, every active partner is outstanding', () => {
    expect(outstandingPartners(members, [], '2026-09').map((m) => m.$id)).toEqual(['a', 'b', 'c'])
  })
})

describe('paidPartners', () => {
  it('is the complement, over the same population', () => {
    const members = [partner('a'), partner('b'), { $id: 'c', benmp_partner: false, status: 'active' as const }]
    const rows = [{ member_id: 'a', period: '2026-09' }]
    expect(paidPartners(members, rows, '2026-09').map((m) => m.$id)).toEqual(['a'])
    expect(outstandingPartners(members, rows, '2026-09').map((m) => m.$id)).toEqual(['b'])
  })

  it('does not count a non-partner who somehow has a row', () => {
    // A row left behind after somebody was un-ticked. It must not inflate the
    // "paid" figure the treasurer reconciles against.
    const members = [{ $id: 'c', benmp_partner: false, status: 'active' as const }]
    const rows = [{ member_id: 'c', period: '2026-09' }]
    expect(paidPartners(members, rows, '2026-09')).toEqual([])
  })
})

describe('paidMemberIds and paidByMember', () => {
  it('filters to the one period', () => {
    const ids = paidMemberIds(
      [
        { member_id: 'a', period: '2026-09' },
        { member_id: 'b', period: '2026-08' },
      ],
      '2026-09',
    )
    expect([...ids]).toEqual(['a'])
  })

  it('indexes a whole year by member in one pass', () => {
    const index = paidByMember([
      { member_id: 'a', period: '2026-01' },
      { member_id: 'a', period: '2026-02' },
      { member_id: 'b', period: '2026-01' },
    ])
    expect([...(index.get('a') ?? [])]).toEqual(['2026-01', '2026-02'])
    expect([...(index.get('b') ?? [])]).toEqual(['2026-01'])
    expect(index.get('c')).toBeUndefined()
  })
})

describe('summarise', () => {
  it('counts partners, paid and outstanding, ignoring non-partners', () => {
    const members = [
      partner('a'),
      partner('b'),
      partner('c'),
      { $id: 'd', benmp_partner: false, status: 'active' as const },
      partner('e', { status: 'inactive' }),
    ]
    expect(summarise(members, [{ member_id: 'a', period: '2026-09' }], '2026-09')).toEqual({
      partners: 3,
      paid: 1,
      outstanding: 2,
    })
  })
})

describe('periods', () => {
  it('sorts lexically in the order it sorts chronologically', () => {
    // The whole reason the month is zero-padded into one string. `2026-9`
    // would sort after `2026-10`, which puts September after October in every
    // list the church reads.
    const shuffled = ['2026-10', '2026-02', '2026-09', '2025-12']
    expect([...shuffled].sort()).toEqual(['2025-12', '2026-02', '2026-09', '2026-10'])
  })

  it('zero-pads single-digit months', () => {
    expect(toPeriod(2026, 9)).toBe('2026-09')
    expect(toPeriod(2026, 12)).toBe('2026-12')
  })

  it('parses and rejects', () => {
    expect(parsePeriod('2026-09')).toEqual({ year: 2026, month: 9 })
    expect(parsePeriod('2026-13')).toBeNull()
    expect(parsePeriod('2026-00')).toBeNull()
    expect(parsePeriod('2026-9')).toBeNull()
    expect(parsePeriod('not-a-period')).toBeNull()
    expect(parsePeriod('')).toBeNull()
  })

  it('isPeriod narrows', () => {
    expect(isPeriod('2026-09')).toBe(true)
    expect(isPeriod('2026-13')).toBe(false)
    expect(isPeriod(202609)).toBe(false)
    expect(isPeriod(null)).toBe(false)
  })

  it('gives twelve periods for a year, January first', () => {
    const year = periodsInYear(2026)
    expect(year).toHaveLength(12)
    expect(year[0]).toBe('2026-01')
    expect(year[11]).toBe('2026-12')
  })

  it('labels a period in words, and falls back rather than throwing', () => {
    expect(periodLabel('2026-09')).toBe('September 2026')
    expect(periodLabel('2026-01')).toBe('January 2026')
    expect(periodLabel('rubbish')).toBe('rubbish')
  })

  it('reads the month in ACCRA, not in the runtime timezone', () => {
    // 31 August, late enough that a westward server has already rolled into
    // September and an eastward one has not. Accra is what the congregation
    // uses, and the month decides who is dunned.
    const lateAugust = new Date('2026-08-31T23:30:00Z')
    expect(currentPeriod(lateAugust)).toBe('2026-08')
    expect(currentYear(lateAugust)).toBe(2026)
  })

  it('rolls December into the next January', () => {
    expect(currentPeriod(new Date('2026-12-31T23:59:00Z'))).toBe('2026-12')
    expect(currentPeriod(new Date('2027-01-01T00:30:00Z'))).toBe('2027-01')
    expect(currentYear(new Date('2027-01-01T00:30:00Z'))).toBe(2027)
  })
})
