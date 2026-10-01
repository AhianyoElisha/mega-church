import { describe, expect, it } from 'vitest'
import { validateMemberInput } from '../server'

const base = { first_name: 'Ama', last_name: 'Mensah', call_number: '024 123 4567' }

function ok(res: ReturnType<typeof validateMemberInput>) {
  if (!res.ok) throw new Error(`expected ok, got: ${res.error}`)
  return res.value
}
function refused(res: ReturnType<typeof validateMemberInput>) {
  if (res.ok) throw new Error('expected a refusal')
  return res.error
}

describe('validateMemberInput — member_type', () => {
  it('defaults to adult on create and writes it explicitly', () => {
    expect(ok(validateMemberInput(base)).member_type).toBe('adult')
  })

  it('refuses a category it does not know, by name', () => {
    const err = refused(
      validateMemberInput({ ...base, member_type: 'teenager' as unknown as 'adult' }),
    )
    expect(err).toMatch(/teenager/)
  })

  it('leaves the type alone on a partial edit that does not mention it', () => {
    const out = ok(validateMemberInput({ address: 'x' }, { partial: true, currentType: 'student' }))
    expect('member_type' in out).toBe(false)
  })
})

describe('validateMemberInput — call number by category', () => {
  it('refuses an adult without one', () => {
    const err = refused(validateMemberInput({ ...base, call_number: '' }))
    expect(err).toMatch(/call number is required/i)
  })

  it('refuses a student without one', () => {
    refused(validateMemberInput({ ...base, call_number: '', member_type: 'student' }))
  })

  it('accepts a child with only a name, storing null', () => {
    const out = ok(validateMemberInput({ first_name: 'Kofi', last_name: 'Boateng', member_type: 'child' }))
    expect(out.call_number).toBeNull()
  })

  it('accepts a child WITH a number and normalises it', () => {
    const out = ok(validateMemberInput({ ...base, member_type: 'child' }))
    expect(out.call_number).toBe('+233241234567')
  })

  it('on PATCH, refuses call_number: null to an adult and accepts it for a child', () => {
    refused(validateMemberInput({ call_number: null }, { partial: true, currentType: 'adult' }))
    const out = ok(validateMemberInput({ call_number: null }, { partial: true, currentType: 'child' }))
    expect(out.call_number).toBeNull()
  })

  it('on PATCH with no currentType, reads the member as an adult — the strict direction', () => {
    refused(validateMemberInput({ call_number: '' }, { partial: true }))
  })

  it('refuses moving a child with no number INTO a texted category', () => {
    const err = refused(
      validateMemberInput(
        { member_type: 'adult' },
        { partial: true, currentType: 'child', currentCallNumber: null },
      ),
    )
    expect(err).toMatch(/call number/i)
  })

  it('lets a child with a stored number become a student without resending it', () => {
    const out = ok(
      validateMemberInput(
        { member_type: 'student' },
        { partial: true, currentType: 'child', currentCallNumber: '+233241234567' },
      ),
    )
    expect(out.member_type).toBe('student')
    expect('call_number' in out).toBe(false)
  })

  it('lets a child become an adult when the same request carries the number', () => {
    const out = ok(
      validateMemberInput(
        { member_type: 'adult', call_number: '0201112222' },
        { partial: true, currentType: 'child', currentCallNumber: null },
      ),
    )
    expect(out.call_number).toBe('+233201112222')
  })
})

describe('validateMemberInput — student fields', () => {
  it('refuses a level on an adult, by name', () => {
    const err = refused(validateMemberInput({ ...base, level: 300 }))
    expect(err).toMatch(/level/i)
    expect(err).toMatch(/student/i)
  })

  it('refuses a programme and a level_year on a non-student', () => {
    expect(refused(validateMemberInput({ ...base, programme: 'BSc CS' }))).toMatch(/programme/i)
    expect(refused(validateMemberInput({ ...base, level_year: 2026 }))).toMatch(/level year/i)
  })

  it('accepts them on a student', () => {
    const out = ok(
      validateMemberInput({ ...base, member_type: 'student', programme: ' BSc CS ', level: 300, level_year: 2026 }),
    )
    expect(out).toMatchObject({ programme: 'BSc CS', level: 300, level_year: 2026 })
  })

  it('accepts a student with no level — the bulk move fills it in later', () => {
    const out = ok(validateMemberInput({ ...base, member_type: 'student' }))
    expect(out.member_type).toBe('student')
    expect('level' in out).toBe(false)
  })

  it('refuses a level that is not a whole step in range', () => {
    refused(validateMemberInput({ ...base, member_type: 'student', level: 250 }))
    refused(validateMemberInput({ ...base, member_type: 'student', level: 900 }))
    refused(validateMemberInput({ ...base, member_type: 'student', level: 0 }))
  })

  it('refuses an implausible level_year', () => {
    refused(validateMemberInput({ ...base, member_type: 'student', level_year: 26 }))
  })

  it('accepts null for every student field on anyone — clearing is always fine', () => {
    const out = ok(
      validateMemberInput(
        { programme: null, level: null, level_year: null },
        { partial: true, currentType: 'adult' },
      ),
    )
    expect(out).toEqual({ programme: null, level: null, level_year: null })
  })

  it('uses the STORED type on a PATCH that does not mention it', () => {
    const out = ok(validateMemberInput({ level: 400 }, { partial: true, currentType: 'student' }))
    expect(out.level).toBe(400)
  })

  it('uses the NEW type when the same PATCH changes it', () => {
    const out = ok(
      validateMemberInput(
        { member_type: 'student', level: 100 },
        { partial: true, currentType: 'adult', currentCallNumber: '+233241234567' },
      ),
    )
    expect(out).toMatchObject({ member_type: 'student', level: 100 })
  })

  it('clears the three student fields when the type changes AWAY from student', () => {
    const out = ok(
      validateMemberInput(
        { member_type: 'adult' },
        { partial: true, currentType: 'student', currentCallNumber: '+233241234567' },
      ),
    )
    expect(out).toEqual({ member_type: 'adult', programme: null, level: null, level_year: null, guardian_name: null })
  })

  it('does NOT clear anything when the form resends the stored type', () => {
    const out = ok(
      validateMemberInput(
        { member_type: 'student', address: 'x' },
        { partial: true, currentType: 'student' },
      ),
    )
    expect(out).toEqual({ member_type: 'student', address: 'x' })
  })
})

describe('validateMemberInput — guardian_name', () => {
  it('is refused on an adult or a student, by name', () => {
    expect(refused(validateMemberInput({ ...base, guardian_name: 'Mum' }))).toMatch(/guardian/i)
    expect(
      refused(validateMemberInput({ ...base, member_type: 'student', guardian_name: 'Mum' })),
    ).toMatch(/guardian/i)
  })

  it('is accepted on a child and null is accepted anywhere', () => {
    const out = ok(
      validateMemberInput({ first_name: 'K', last_name: 'B', member_type: 'child', guardian_name: ' Mrs Boateng ' }),
    )
    expect(out.guardian_name).toBe('Mrs Boateng')
    ok(validateMemberInput({ guardian_name: null }, { partial: true, currentType: 'adult' }))
  })

  it('is cleared when a child becomes a student', () => {
    const out = ok(
      validateMemberInput(
        { member_type: 'student' },
        { partial: true, currentType: 'child', currentCallNumber: '+233241234567' },
      ),
    )
    expect(out.guardian_name).toBeNull()
  })
})
