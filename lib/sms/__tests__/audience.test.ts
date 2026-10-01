import { describe, expect, it } from 'vitest'
import { CHILDREN_NEVER_TEXTED, isSmsAudience, narrowAudience } from '@/lib/sms/audience'
import { SMS_AUDIENCES } from '@/lib/appwrite/config'

const adult = { $id: 'a', member_type: 'adult' as const }
const student = { $id: 's', member_type: 'student' as const }
const child = { $id: 'c', member_type: 'child' as const }
const everyone = [adult, student, child]

describe('narrowAudience', () => {
  it('all keeps adults and students', () => {
    const out = narrowAudience(everyone, 'all')
    expect(out.kept.map((m) => m.$id)).toEqual(['a', 's'])
  })

  it('students keeps students only', () => {
    const out = narrowAudience(everyone, 'students')
    expect(out.kept.map((m) => m.$id)).toEqual(['s'])
    expect(out.outside_audience).toBe(1)
    expect(out.reason).toMatch(/not a student/)
  })

  it('non_students keeps adults only — and never a child', () => {
    // "Non-student" is a category a child would fall into by elimination,
    // which is exactly why the rule is spelled as "adult" and not "not
    // student".
    const out = narrowAudience(everyone, 'non_students')
    expect(out.kept.map((m) => m.$id)).toEqual(['a'])
    expect(out.outside_audience).toBe(1)
    expect(out.reason).toMatch(/student/)
  })

  it('excludes a child from EVERY audience, and names why', () => {
    for (const audience of SMS_AUDIENCES) {
      const out = narrowAudience(everyone, audience)
      expect(out.kept).not.toContain(child)
      expect(out.children).toBe(1)
      expect(out.reason).toContain(CHILDREN_NEVER_TEXTED)
    }
  })

  it('counts everything dropped in excluded, children included', () => {
    const out = narrowAudience(everyone, 'students')
    expect(out.excluded).toBe(2)
    expect(out.children + out.outside_audience).toBe(out.excluded)
  })

  it('has no reason when nothing was dropped', () => {
    const out = narrowAudience([adult, student], 'all')
    expect(out.excluded).toBe(0)
    expect(out.reason).toBeNull()
  })

  it('joins several reasons rather than keeping the last', () => {
    // A sender who picked forty and reached twenty-one has to read every
    // cause, not whichever was written last.
    const out = narrowAudience([adult, adult, student, child, child, child], 'students')
    expect(out.excluded).toBe(5)
    expect(out.reason).toMatch(/2 are not students/)
    expect(out.reason).toMatch(/3 are Save Church children/)
  })

  it('leaves the input alone', () => {
    const input = [...everyone]
    narrowAudience(input, 'students')
    expect(input).toEqual(everyone)
  })
})

describe('isSmsAudience', () => {
  it('accepts exactly the configured values', () => {
    for (const a of SMS_AUDIENCES) expect(isSmsAudience(a)).toBe(true)
  })
  it('refuses a near miss rather than widening it', () => {
    // `student` (singular) meant something narrower than `all`; reading it as
    // `all` would text the whole congregation because of a typo.
    expect(isSmsAudience('student')).toBe(false)
    expect(isSmsAudience('everyone')).toBe(false)
    expect(isSmsAudience(undefined)).toBe(false)
    expect(isSmsAudience(null)).toBe(false)
  })
})
