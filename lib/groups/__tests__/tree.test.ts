import { describe, expect, it } from 'vitest'
import {
  buildBacentaTree,
  diffMembership,
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
