import { describe, expect, it } from 'vitest'
import {
  buildBacentaTree,
  diffMembership,
  headBacentaMerge,
  headEditScope,
  headRegistrationScope,
  headsAnything,
  normaliseName,
  sortByOrderThenName,
  validateGroupName,
} from '../tree'
import type { BacentaCategory, BacentaWithCount } from '../types'

const category = (id: string, name: string, sort = 100): BacentaCategory => ({
  $id: id,
  name,
  description: null,
  sort_order: sort,
  created_by: null,
  $createdAt: '2026-01-01T00:00:00.000Z',
})

const bacenta = (
  id: string,
  name: string,
  categoryId: string | null,
  sort = 100,
): BacentaWithCount => ({
  $id: id,
  name,
  category_id: categoryId,
  description: null,
  head_user_id: null,
  head_name: null,
  sort_order: sort,
  created_by: null,
  $createdAt: '2026-01-01T00:00:00.000Z',
  member_count: 0,
  category_name: null,
})

describe('buildBacentaTree', () => {
  it('files the choirs under Choir and the Technical Team on its own', () => {
    // The two shapes the church actually has, in one tree.
    const tree = buildBacentaTree(
      [category('choir', 'Choir')],
      [
        bacenta('biazo', 'Biazo', 'choir'),
        bacenta('living', 'Living Waters', 'choir'),
        bacenta('fresh', 'Fresh Oil', 'choir'),
        bacenta('tech', 'Technical Team', null),
      ],
    )

    expect(tree.categories).toHaveLength(1)
    expect(tree.categories[0].category.name).toBe('Choir')
    expect(tree.categories[0].bacentas.map((b) => b.name)).toEqual([
      'Biazo',
      'Fresh Oil',
      'Living Waters',
    ])
    expect(tree.standalone.map((b) => b.name)).toEqual(['Technical Team'])
    expect(tree.orphans).toHaveLength(0)
  })

  it('keeps a category that has no bacentas yet', () => {
    // A category is created before it is filled. Hiding an empty one makes the
    // create button look like it did nothing.
    const tree = buildBacentaTree([category('ushers', 'Ushers')], [])
    expect(tree.categories).toHaveLength(1)
    expect(tree.categories[0].bacentas).toEqual([])
  })

  it('surfaces a bacenta whose category is gone instead of dropping it', () => {
    // The failure this bucket exists to prevent: a group full of real people
    // silently disappearing from every screen while its rows sit in the
    // database.
    const tree = buildBacentaTree([], [bacenta('biazo', 'Biazo', 'deleted-category')])
    expect(tree.categories).toHaveLength(0)
    expect(tree.standalone).toHaveLength(0)
    expect(tree.orphans.map((b) => b.name)).toEqual(['Biazo'])
  })

  it('does not confuse a null category with a missing one', () => {
    const tree = buildBacentaTree([], [bacenta('tech', 'Technical Team', null)])
    expect(tree.standalone.map((b) => b.name)).toEqual(['Technical Team'])
    expect(tree.orphans).toEqual([])
  })
})

describe('sortByOrderThenName', () => {
  it('orders by sort_order first and name second', () => {
    const sorted = sortByOrderThenName([
      bacenta('c', 'Zion', null, 1),
      bacenta('a', 'Alpha', null, 2),
      bacenta('b', 'Beta', null, 2),
    ])
    expect(sorted.map((b) => b.name)).toEqual(['Zion', 'Alpha', 'Beta'])
  })

  it('does not mutate its input', () => {
    const input = [bacenta('b', 'Beta', null), bacenta('a', 'Alpha', null)]
    sortByOrderThenName(input)
    expect(input.map((b) => b.name)).toEqual(['Beta', 'Alpha'])
  })
})

describe('validateGroupName', () => {
  it('collapses whitespace so two rows cannot render identically', () => {
    const res = validateGroupName('  Living   Waters ')
    expect(res).toEqual({ ok: true, value: 'Living Waters' })
  })

  it('rejects a duplicate regardless of case or spacing', () => {
    const res = validateGroupName('living  waters', {
      taken: ['Living Waters'],
      noun: 'bacenta',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('already exists')
  })

  it('rejects an empty name with the caller’s noun', () => {
    const res = validateGroupName('   ', { noun: 'constituency' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('Give the constituency a name.')
  })

  it('rejects a name over the column width', () => {
    expect(validateGroupName('x'.repeat(97)).ok).toBe(false)
    expect(validateGroupName('x'.repeat(96)).ok).toBe(true)
  })
})

describe('normaliseName', () => {
  it('is the identity the duplicate check relies on', () => {
    expect(normaliseName('  Fresh   OIL ')).toBe('fresh oil')
  })
})

describe('diffMembership', () => {
  it('add only ever adds', () => {
    // The group-select assigner sends `add`, so someone off-screen behind a
    // search filter must not be removed.
    expect(diffMembership(['a', 'b'], ['b', 'c'], 'add')).toEqual({
      toAdd: ['c'],
      toRemove: [],
    })
  })

  it('remove only ever removes, and ignores people who were never in', () => {
    expect(diffMembership(['a', 'b'], ['b', 'z'], 'remove')).toEqual({
      toAdd: [],
      toRemove: ['b'],
    })
  })

  it('set makes the group exactly the list', () => {
    expect(diffMembership(['a', 'b'], ['b', 'c'], 'set')).toEqual({
      toAdd: ['c'],
      toRemove: ['a'],
    })
  })

  it('set with an empty list empties the group', () => {
    expect(diffMembership(['a', 'b'], [], 'set')).toEqual({
      toAdd: [],
      toRemove: ['a', 'b'],
    })
  })

  it('is a no-op when nothing changed', () => {
    expect(diffMembership(['a', 'b'], ['a', 'b'], 'set')).toEqual({ toAdd: [], toRemove: [] })
  })
})

describe('headsAnything', () => {
  const withHead = (id: string | null) => ({ head_user_id: id })

  it('is true when they head a constituency', () => {
    expect(headsAnything('u1', [withHead('u1')], [])).toBe(true)
  })

  it('is true when they head only a bacenta', () => {
    expect(headsAnything('u1', [withHead('u2')], [withHead('u1')])).toBe(true)
  })

  it('is true for someone who heads both — the case the one-login design is for', () => {
    expect(headsAnything('u1', [withHead('u1')], [withHead('u1')])).toBe(true)
  })

  it('is false for a leader account nobody has appointed yet', () => {
    expect(headsAnything('u1', [withHead('u2')], [withHead('u3')])).toBe(false)
  })
})

describe('headRegistrationScope', () => {
  const heads = { constituencies: ['c1', 'c2'], bacentas: ['b1'] }

  it('accepts a registration into a constituency they head', () => {
    expect(headRegistrationScope({ constituency_id: 'c1', bacenta_ids: [] }, heads)).toEqual({
      ok: true,
      constituency_id: 'c1',
      bacenta_ids: [],
    })
  })

  it('accepts bacentas they head alongside it', () => {
    const out = headRegistrationScope({ constituency_id: 'c2', bacenta_ids: ['b1'] }, heads)
    expect(out).toEqual({ ok: true, constituency_id: 'c2', bacenta_ids: ['b1'] })
  })

  it('de-duplicates a repeated bacenta id', () => {
    const out = headRegistrationScope({ constituency_id: 'c1', bacenta_ids: ['b1', 'b1'] }, heads)
    expect(out).toEqual({ ok: true, constituency_id: 'c1', bacenta_ids: ['b1'] })
  })

  it('refuses a bacenta-only head — they cannot say where anybody LIVES', () => {
    const out = headRegistrationScope(
      { constituency_id: 'c1' },
      { constituencies: [], bacentas: ['b1'] },
    )
    expect(out).toMatchObject({ ok: false, status: 403 })
  })

  // The rule that /api/reports/export already follows: a head who does not say
  // which constituency is REFUSED, never defaulted to their first one. A wrong
  // guess is invisible afterwards — the member simply appears in the wrong
  // roster, and nobody knows to look.
  it('refuses an omitted constituency rather than defaulting to their first', () => {
    const out = headRegistrationScope({ bacenta_ids: [] }, heads)
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(out).not.toMatchObject({ constituency_id: 'c1' })
  })

  it('refuses an empty-string constituency the same way', () => {
    expect(headRegistrationScope({ constituency_id: '' }, heads)).toMatchObject({
      ok: false,
      status: 400,
    })
  })

  it('refuses a constituency they do not head', () => {
    const out = headRegistrationScope({ constituency_id: 'c9' }, heads)
    expect(out).toMatchObject({ ok: false, status: 403 })
    if (out.ok) throw new Error('expected a refusal')
    expect(out.error).toContain('do not head that constituency')
  })

  it('refuses a bacenta they do not head, even into their own constituency', () => {
    const out = headRegistrationScope({ constituency_id: 'c1', bacenta_ids: ['b9'] }, heads)
    expect(out).toMatchObject({ ok: false, status: 403 })
  })

  it('refuses the whole registration when ONE bacenta is foreign', () => {
    const out = headRegistrationScope({ constituency_id: 'c1', bacenta_ids: ['b1', 'b9'] }, heads)
    expect(out.ok).toBe(false)
  })

  it('treats a non-string constituency as not given', () => {
    expect(headRegistrationScope({ constituency_id: 42 }, heads)).toMatchObject({
      ok: false,
      status: 400,
    })
  })
})

describe('headBacentaMerge', () => {
  // The whole reason this function exists: a head only ever sees their own
  // bacentas, so writing their tick-list verbatim would silently remove the
  // member from every other one.
  it('preserves memberships the head cannot see', () => {
    expect(headBacentaMerge([], ['choir', 'tech'], ['tech'])).toEqual(['choir'])
  })

  it('applies the head’s ticks within their own bacentas', () => {
    expect(headBacentaMerge(['tech'], ['choir'], ['tech']).sort()).toEqual(['choir', 'tech'])
  })

  it('removes from a bacenta the head heads when they untick it', () => {
    expect(headBacentaMerge([], ['choir', 'tech'], ['tech'])).toEqual(['choir'])
  })

  it('ignores a tick for a bacenta they do not head', () => {
    expect(headBacentaMerge(['choir'], [], ['tech'])).toEqual([])
  })

  it('does not duplicate one they already had', () => {
    expect(headBacentaMerge(['tech'], ['tech'], ['tech'])).toEqual(['tech'])
  })

  it('leaves everything alone for a head who heads no bacenta', () => {
    expect(headBacentaMerge([], ['choir', 'tech'], [])).toEqual(['choir', 'tech'])
  })
})

describe('headEditScope', () => {
  const heads = { constituencies: ['c1'], bacentas: ['b1'] }
  const member = { constituency_id: 'c1', bacenta_ids: ['b1', 'b2'] }

  it('lets a head correct an ordinary field', () => {
    const out = headEditScope(
      { fields: { call_number: '+233240000000' }, bacenta_ids: undefined },
      member,
      heads,
    )
    expect(out).toEqual({
      ok: true,
      fields: { call_number: '+233240000000' },
      bacenta_ids: undefined,
    })
  })

  it('reaches a member through a BACENTA they head, with no constituency in common', () => {
    const out = headEditScope(
      { fields: { address: 'x' }, bacenta_ids: undefined },
      { constituency_id: 'somewhere-else', bacenta_ids: ['b1'] },
      heads,
    )
    expect(out.ok).toBe(true)
  })

  it('refuses a member in no group they head', () => {
    const out = headEditScope(
      { fields: { address: 'x' }, bacenta_ids: undefined },
      { constituency_id: 'c9', bacenta_ids: ['b9'] },
      heads,
    )
    expect(out).toMatchObject({ ok: false, status: 403 })
  })

  it('refuses a member with no constituency and no shared bacenta', () => {
    const out = headEditScope(
      { fields: { address: 'x' }, bacenta_ids: undefined },
      { constituency_id: null, bacenta_ids: [] },
      heads,
    )
    expect(out).toMatchObject({ ok: false, status: 403 })
  })

  // Named, not silently dropped — a head who is told nothing assumes it saved.
  it('refuses a status change and says so', () => {
    const out = headEditScope({ fields: { status: 'inactive' }, bacenta_ids: undefined }, member, heads)
    expect(out).toMatchObject({ ok: false, status: 403 })
    if (out.ok) throw new Error('expected a refusal')
    expect(out.error).toMatch(/active or inactive/i)
  })

  it('refuses a birthday-message change', () => {
    const out = headEditScope({ fields: { sms_template_id: 't1' }, bacenta_ids: undefined }, member, heads)
    expect(out).toMatchObject({ ok: false, status: 403 })
  })

  it('refuses MOVING the member to another constituency', () => {
    const out = headEditScope(
      { fields: { constituency_id: 'c2' }, bacenta_ids: undefined },
      member,
      heads,
    )
    expect(out).toMatchObject({ ok: false, status: 403 })
  })

  // The shared form always sends the field. Resending what is already stored is
  // not a move, and must not be treated as one.
  it('accepts the constituency it already has, and drops it from the write', () => {
    const out = headEditScope(
      { fields: { constituency_id: 'c1', address: 'x' }, bacenta_ids: undefined },
      member,
      heads,
    )
    expect(out).toEqual({ ok: true, fields: { address: 'x' }, bacenta_ids: undefined })
  })

  it('treats a null constituency resent as null as unchanged', () => {
    const out = headEditScope(
      { fields: { constituency_id: null }, bacenta_ids: undefined },
      { constituency_id: null, bacenta_ids: ['b1'] },
      heads,
    )
    expect(out).toEqual({ ok: true, fields: {}, bacenta_ids: undefined })
  })

  it('merges bacentas rather than replacing them', () => {
    const out = headEditScope({ fields: {}, bacenta_ids: [] }, member, heads)
    // b2 is outside their reach and survives; b1 is theirs and was unticked.
    expect(out).toEqual({ ok: true, fields: {}, bacenta_ids: ['b2'] })
  })

  it('leaves bacentas untouched when the request never mentions them', () => {
    const out = headEditScope({ fields: { address: 'x' }, bacenta_ids: undefined }, member, heads)
    if (!out.ok) throw new Error('expected acceptance')
    expect(out.bacenta_ids).toBeUndefined()
  })
})
