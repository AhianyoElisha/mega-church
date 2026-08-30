import { describe, expect, it } from 'vitest'
import { looksLikeMemberNo, matchesMemberSearch } from '../search'

const member = (over: Partial<Parameters<typeof matchesMemberSearch>[0]> = {}) => ({
  first_name: 'Ama',
  last_name: 'Serwaa',
  other_names: null,
  member_no: '2026042',
  call_number: '+233241234567',
  ...over,
})

describe('looksLikeMemberNo', () => {
  it('is true for digits only', () => {
    for (const t of ['2026001', '2026', '7', '  2026042  ']) {
      expect(looksLikeMemberNo(t)).toBe(true)
    }
  })

  it('is false for anything with a letter or a space in the middle', () => {
    for (const t of ['Ama', '2026 Ama', '2026a', '+233241234567', '', '   ']) {
      expect(looksLikeMemberNo(t)).toBe(false)
    }
  })
})

describe('matchesMemberSearch', () => {
  it('matches an exact member number', () => {
    expect(matchesMemberSearch(member(), '2026042')).toBe(true)
  })

  it('matches a member number by PREFIX', () => {
    // Typing the year finds everyone registered that year.
    expect(matchesMemberSearch(member(), '2026')).toBe(true)
    expect(matchesMemberSearch(member(), '202604')).toBe(true)
  })

  it('does not match a number that merely CONTAINS the term', () => {
    // `042` is the tail of 2026042. Prefix, not substring — otherwise typing a
    // year matches nothing useful and typing a sequence matches half the year.
    expect(matchesMemberSearch(member(), '042')).toBe(false)
  })

  it('does not match a name when digits were typed', () => {
    // Nobody types digits hoping to match a name, and merging the two makes
    // "2026" return the whole year plus anybody with 2026 in their name.
    expect(matchesMemberSearch(member({ first_name: '2026' }), '2026')).toBe(true)
    expect(matchesMemberSearch(member({ member_no: '2027001' }), '2026')).toBe(false)
  })

  it('matches a name case-insensitively, including other names', () => {
    expect(matchesMemberSearch(member(), 'ama')).toBe(true)
    expect(matchesMemberSearch(member(), 'SERWAA')).toBe(true)
    expect(matchesMemberSearch(member({ other_names: 'Akosua' }), 'akos')).toBe(true)
    expect(matchesMemberSearch(member(), 'Ama Serwaa')).toBe(true)
  })

  it('does not match somebody else', () => {
    expect(matchesMemberSearch(member(), 'Kofi')).toBe(false)
  })

  it('matches everything on an empty term', () => {
    expect(matchesMemberSearch(member(), '')).toBe(true)
    expect(matchesMemberSearch(member(), '   ')).toBe(true)
  })

  it('tolerates a member with no number yet', () => {
    // Pre-backfill rows, and anybody created if the allocator ever fails.
    expect(matchesMemberSearch(member({ member_no: null }), '2026')).toBe(false)
    expect(matchesMemberSearch(member({ member_no: null }), 'Ama')).toBe(true)
  })

  describe('with phone matching on', () => {
    const phone = { phone: true }

    it('finds a phone number typed as digits', () => {
      // The regression this pins: a phone number IS digits, so the
      // member-number branch would swallow it and the picker that has always
      // searched "name or number" would silently stop finding anybody.
      expect(matchesMemberSearch(member(), '24123', phone)).toBe(true)
    })

    it('finds a phone number typed with its +', () => {
      expect(matchesMemberSearch(member(), '+23324', phone)).toBe(true)
    })

    it('still finds by member number and by name', () => {
      expect(matchesMemberSearch(member(), '2026042', phone)).toBe(true)
      expect(matchesMemberSearch(member(), 'Ama', phone)).toBe(true)
    })

    it('does not match a phone when phone matching is off', () => {
      expect(matchesMemberSearch(member(), '24123')).toBe(false)
    })
  })
})
