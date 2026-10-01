import { describe, expect, it } from 'vitest'
import {
  buildRegister,
  expectedBasis,
  isExpected,
  registerSummary,
} from '../register'
import type { Member } from '@/lib/members/types'

function member(over: Partial<Member> & { $id: string }): Member {
  return {
    member_no: null,
    title: null,
    first_name: 'Ama',
    last_name: 'Serwaa',
    other_names: null,
    photo_file_id: null,
    birth_month: null,
    birth_day: null,
    address: null,
    call_number: '+233200000000',
    whatsapp_number: null,
    home_service: 'first',
    member_type: 'adult',
    programme: null,
    level: null,
    level_year: null,
    guardian_name: null,
    constituency_id: null,
    bacenta_id: null,
    care_of_member_id: null,
    benmp_partner: false,
    sms_template_id: null,
    status: 'active',
    created_by: null,
    $createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Member
}

const mark = (member_id: string, marked_at: string, method: 'biometric' | 'manual' = 'biometric') => ({
  member_id,
  marked_at,
  method,
})

describe('expectedBasis', () => {
  it('is the roster for a restricted meeting, whatever its slot', () => {
    expect(expectedBasis({ restricted: true, service_slot: null })).toBe('roster')
    expect(expectedBasis({ restricted: true, service_slot: 'first' })).toBe('roster')
  })
  it('is adults for First and Second Service', () => {
    expect(expectedBasis({ restricted: false, service_slot: 'first' })).toBe('adults')
    expect(expectedBasis({ restricted: false, service_slot: 'second' })).toBe('adults')
  })
  it('is children for Save Church', () => {
    expect(expectedBasis({ restricted: false, service_slot: 'save' })).toBe('children')
  })
  it('is everyone for an open meeting with no roster', () => {
    expect(expectedBasis({ restricted: false, service_slot: null })).toBe('everyone')
  })
})

describe('isExpected', () => {
  it('never expects an inactive member', () => {
    expect(isExpected('adults', { member_type: 'adult', status: 'inactive' })).toBe(false)
    expect(isExpected('children', { member_type: 'child', status: 'inactive' })).toBe(false)
    expect(isExpected('everyone', { member_type: 'adult', status: 'inactive' })).toBe(false)
  })
  it('does not expect a child at an adult service — they are marked at Save Church', () => {
    expect(isExpected('adults', { member_type: 'child', status: 'active' })).toBe(false)
    expect(isExpected('adults', { member_type: 'student', status: 'active' })).toBe(true)
    expect(isExpected('adults', { member_type: 'adult', status: 'active' })).toBe(true)
  })
  it('expects only children at Save Church', () => {
    expect(isExpected('children', { member_type: 'child', status: 'active' })).toBe(true)
    expect(isExpected('children', { member_type: 'adult', status: 'active' })).toBe(false)
  })
  it('expects every active member at an open meeting', () => {
    expect(isExpected('everyone', { member_type: 'child', status: 'active' })).toBe(true)
  })
})

describe('buildRegister', () => {
  const ama = member({ $id: 'ama', first_name: 'Ama', last_name: 'Serwaa', member_no: '2026001' })
  const kofi = member({ $id: 'kofi', first_name: 'Kofi', last_name: 'Mensah' })
  const yaw = member({ $id: 'yaw', first_name: 'Yaw', last_name: 'Boateng' })

  it('marks present and absent across the expected list', () => {
    const rows = buildRegister([ama, kofi, yaw], [mark('kofi', '2026-10-04T07:40:00.000Z')])
    expect(rows.map((r) => [r.member.$id, r.present, r.expected])).toEqual([
      ['ama', false, true],
      ['kofi', true, true],
      ['yaw', false, true],
    ])
    expect(rows[1].marked_at).toBe('2026-10-04T07:40:00.000Z')
    expect(rows[1].method).toBe('biometric')
    expect(rows[0].marked_at).toBeNull()
    expect(rows[0].method).toBeNull()
  })

  it('keeps the EARLIEST of two marks for one member', () => {
    const rows = buildRegister(
      [ama],
      [mark('ama', '2026-10-04T09:10:00.000Z', 'manual'), mark('ama', '2026-10-04T07:30:00.000Z')],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].marked_at).toBe('2026-10-04T07:30:00.000Z')
    expect(rows[0].method).toBe('biometric')
  })

  it('keeps a mark for somebody NOT on the expected list, named and flagged', () => {
    const left = member({ $id: 'left', first_name: 'Esi', last_name: 'Owusu', status: 'inactive' })
    const rows = buildRegister([ama], [mark('left', '2026-10-04T07:50:00.000Z')], [left])
    const stray = rows.find((r) => r.member.$id === 'left')
    expect(stray).toBeDefined()
    expect(stray!.present).toBe(true)
    expect(stray!.expected).toBe(false)
    expect(stray!.member.full_name).toBe('Esi Owusu')
    expect(stray!.member.deleted).toBe(false)
  })

  it('names a mark whose member was deleted rather than dropping it', () => {
    const rows = buildRegister([ama], [mark('gone', '2026-10-04T07:50:00.000Z')])
    const ghost = rows.find((r) => r.member.$id === 'gone')
    expect(ghost).toBeDefined()
    expect(ghost!.member.full_name).toBe('Deleted member')
    expect(ghost!.member.deleted).toBe(true)
    expect(ghost!.present).toBe(true)
    expect(ghost!.expected).toBe(false)
  })

  it('is alphabetical by full name, whether present or not', () => {
    const rows = buildRegister([yaw, ama, kofi], [mark('yaw', '2026-10-04T07:00:00.000Z')])
    expect(rows.map((r) => r.member.full_name)).toEqual(['Ama Serwaa', 'Kofi Mensah', 'Yaw Boateng'])
  })

  it('does not duplicate a member listed twice on the expected side', () => {
    const rows = buildRegister([ama, ama], [])
    expect(rows).toHaveLength(1)
  })

  it('carries the fields the table shows and nothing private beyond them', () => {
    const rows = buildRegister([ama], [])
    expect(rows[0].member).toEqual({
      $id: 'ama',
      full_name: 'Ama Serwaa',
      member_no: '2026001',
      call_number: '+233200000000',
      whatsapp_number: null,
      photo_file_id: null,
      member_type: 'adult',
      home_service: 'first',
      constituency_id: null,
      guardian_name: null,
      status: 'active',
      deleted: false,
    })
  })
})

describe('registerSummary', () => {
  it('adds up, counting an unexpected mark as present but not expected', () => {
    const ama = member({ $id: 'ama' })
    const kofi = member({ $id: 'kofi', first_name: 'Kofi' })
    const left = member({ $id: 'left', first_name: 'Esi', status: 'inactive' })
    const rows = buildRegister(
      [ama, kofi],
      [mark('ama', '2026-10-04T07:00:00.000Z', 'manual'), mark('left', '2026-10-04T07:05:00.000Z')],
      [left],
    )
    expect(registerSummary(rows)).toEqual({
      present: 2,
      expected: 2,
      absent: 1,
      by_method: { biometric: 1, manual: 1 },
    })
  })

  it('is all zeros for an empty register', () => {
    expect(registerSummary([])).toEqual({
      present: 0,
      expected: 0,
      absent: 0,
      by_method: { biometric: 0, manual: 0 },
    })
  })
})
