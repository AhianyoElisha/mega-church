import { describe, expect, it } from 'vitest'
import {
  canManageTemplateCategory,
  canSendSmsCategory,
  sendableCategories,
} from '../permissions'
import { SMS_CATEGORIES } from '@/lib/appwrite/config'
import type { UserLabel } from '@/lib/auth/types'

describe('canSendSmsCategory', () => {
  it('lets an admin send every category', () => {
    for (const category of SMS_CATEGORIES) {
      expect(canSendSmsCategory('admin', category).ok).toBe(true)
    }
  })

  it('lets a treasurer send tithe', () => {
    expect(canSendSmsCategory('treasurer', 'tithe').ok).toBe(true)
  })

  it('refuses a treasurer every other category, by name', () => {
    for (const category of ['birthday', 'general'] as const) {
      const res = canSendSmsCategory('treasurer', category)
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.status).toBe(403)
      // NAMED, not silently downgraded to tithe. A caller told nothing assumes
      // the send happened — here, a hundred birthday messages.
      expect(res.error).toContain(category)
      expect(res.error).toContain('tithe')
    }
  })

  it('refuses every label that has no send rights at all', () => {
    // `leader` is deliberately absent: it sends `benmp` and only `benmp`,
    // covered in its own block at the foot of this file.
    const others: UserLabel[] = ['usher', 'kiosk', 'celebrations', 'shepherd']
    for (const label of others) {
      for (const category of SMS_CATEGORIES) {
        expect(canSendSmsCategory(label, category).ok).toBe(false)
      }
    }
  })

  it('refuses a new category to the treasurer by DEFAULT', () => {
    // The regression this pins: the rule is an allow-map, not a deny-list, so
    // adding a fourth SMS category cannot accidentally hand it to the
    // treasurer because somebody forgot to update a list of exclusions.
    const invented = 'building-fund' as (typeof SMS_CATEGORIES)[number]
    expect(canSendSmsCategory('treasurer', invented).ok).toBe(false)
    expect(canSendSmsCategory('admin', invented).ok).toBe(false)
  })
})

describe('canManageTemplateCategory', () => {
  it('lets an admin write any category', () => {
    for (const category of SMS_CATEGORIES) {
      expect(canManageTemplateCategory('admin', category).ok).toBe(true)
    }
  })

  it('lets a treasurer write a tithe template', () => {
    // The point of the change: a treasurer who may send but not write has to
    // ask an administrator to type the message for them.
    expect(canManageTemplateCategory('treasurer', 'tithe').ok).toBe(true)
  })

  it('refuses a treasurer every other category, by name', () => {
    for (const category of ['birthday', 'general'] as const) {
      const res = canManageTemplateCategory('treasurer', category)
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.status).toBe(403)
      expect(res.error).toContain(category)
      expect(res.error).toContain('tithe')
    }
  })

  it('refuses every label with no authority at all', () => {
    // `leader` is deliberately absent: it sends `benmp` and only `benmp`,
    // covered in its own block at the foot of this file.
    const others: UserLabel[] = ['usher', 'kiosk', 'celebrations', 'shepherd']
    for (const label of others) {
      for (const category of SMS_CATEGORIES) {
        expect(canManageTemplateCategory(label, category).ok).toBe(false)
      }
    }
  })

  it('agrees with canSendSmsCategory for every label and category', () => {
    // Authority over a category means both sending it and authoring it, and
    // both read one map. If these two ever disagree, somebody has split the
    // map without deciding they meant to.
    const labels: UserLabel[] = [
      'admin',
      'usher',
      'kiosk',
      'celebrations',
      'shepherd',
      'treasurer',
    ]
    for (const label of labels) {
      for (const category of SMS_CATEGORIES) {
        expect(canManageTemplateCategory(label, category).ok).toBe(
          canSendSmsCategory(label, category).ok,
        )
      }
    }
  })
})

describe('sendableCategories', () => {
  it('offers the treasurer tithe and benmp, and nothing else', () => {
    expect(sendableCategories('treasurer')).toEqual(['tithe', 'benmp'])
  })

  it('offers an admin every category', () => {
    expect(sendableCategories('admin')).toEqual(['birthday', 'tithe', 'general', 'benmp'])
  })

  it('offers nothing to a label with no send rights, or to nobody', () => {
    expect(sendableCategories('shepherd')).toEqual([])
    expect(sendableCategories(undefined)).toEqual([])
  })

  it('agrees with canSendSmsCategory for every label and category', () => {
    // The two must not drift: one decides what the UI offers, the other decides
    // what the server accepts, and a screen offering a choice that 403s is the
    // failure this pairing exists to prevent.
    const labels: UserLabel[] = [
      'admin',
      'usher',
      'kiosk',
      'celebrations',
      'shepherd',
      'treasurer',
    ]
    for (const label of labels) {
      for (const category of SMS_CATEGORIES) {
        expect(sendableCategories(label).includes(category)).toBe(
          canSendSmsCategory(label, category).ok,
        )
      }
    }
  })
})

/*
 * `leader` sends for the FIRST time, and only BENMP.
 *
 * This file asserted for months that a leader sends nothing at all. The church
 * asked for constituency heads to chase their own BENMP partners, so the grant
 * exists — but it is one category, and the tests below are mostly about
 * everything it is NOT.
 *
 * Note what these cannot prove: the map decides WHAT a leader may send and
 * cannot express WHO. The narrowing to partners in constituencies they head
 * lives in the send route, because it needs `leaderScope()` and a database.
 */
describe('a leader and BENMP', () => {
  it('may send benmp', () => {
    expect(canSendSmsCategory('leader', 'benmp').ok).toBe(true)
  })

  it('may send NOTHING else, and each refusal names the category', () => {
    for (const category of ['birthday', 'tithe', 'general'] as const) {
      const out = canSendSmsCategory('leader', category)
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected a refusal')
      expect(out.status).toBe(403)
      expect(out.error).toMatch(new RegExp(category, 'i'))
    }
  })

  it('is offered exactly benmp in the UI', () => {
    expect(sendableCategories('leader')).toEqual(['benmp'])
  })

  it('may write a benmp template but no other', () => {
    // Same map, same reasoning as the treasurer: authority over a category
    // means both sending it and wording it, or somebody has to type it for you.
    expect(canManageTemplateCategory('leader', 'benmp').ok).toBe(true)
    expect(canManageTemplateCategory('leader', 'tithe').ok).toBe(false)
  })

  it('a shepherd still sends nothing, benmp included', () => {
    // The new category must not leak to the read-only role. This is the test
    // that fails if somebody widens the map by pattern-matching on "benmp".
    expect(canSendSmsCategory('shepherd', 'benmp').ok).toBe(false)
    expect(sendableCategories('shepherd')).toEqual([])
  })

  it('an usher and a kiosk still send nothing', () => {
    expect(canSendSmsCategory('usher', 'benmp').ok).toBe(false)
    expect(canSendSmsCategory('kiosk', 'benmp').ok).toBe(false)
  })
})
