import { describe, expect, it } from 'vitest'
import { basontaDisplayName, buildBasontaTree } from '../tree'
import type { BasontaCategory, BasontaWithCount } from '../types'

const category = (id: string, name: string, sort = 100): BasontaCategory => ({
  $id: id,
  name,
  description: null,
  sort_order: sort,
  created_by: null,
  $createdAt: '2026-01-01T00:00:00.000Z',
})

const basonta = (
  id: string,
  name: string,
  categoryId: string | null,
  sort = 100,
): BasontaWithCount => ({
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

/**
 * `buildBasontaTree` delegates to `buildBacentaTree`, so these are not a second
 * copy of the tree tests — they pin the part the delegation could get wrong:
 * that the renamed `basontas` key comes back populated, and that the three
 * buckets still sort the church's real groups the way the page expects.
 */
describe('buildBasontaTree', () => {
  const choir = category('choir', 'Choir')

  it('nests the choirs under Choir and leaves the standalone groups alone', () => {
    const tree = buildBasontaTree(
      [choir],
      [
        basonta('biazo', 'Biazo', 'choir'),
        basonta('living', 'Living Waters', 'choir'),
        basonta('tech', 'Technical Team', null),
      ],
    )

    expect(tree.categories).toHaveLength(1)
    expect(tree.categories[0].category.name).toBe('Choir')
    // The renamed key is the whole risk in delegating — an empty array here
    // would render "Nothing in this category yet" over a populated choir.
    expect(tree.categories[0].basontas.map((b) => b.name)).toEqual(['Biazo', 'Living Waters'])
    expect(tree.standalone.map((b) => b.name)).toEqual(['Technical Team'])
    expect(tree.orphans).toHaveLength(0)
  })

  it('surfaces a basonta whose category was deleted rather than dropping it', () => {
    const tree = buildBasontaTree([choir], [basonta('media', 'Media', 'deleted-category')])

    // Dropping it would make a group full of real people vanish from every
    // screen while its rows sat in the database.
    expect(tree.orphans.map((b) => b.name)).toEqual(['Media'])
    expect(tree.standalone).toHaveLength(0)
    expect(tree.categories[0].basontas).toHaveLength(0)
  })

  it('keeps an empty category, because it is one somebody just created', () => {
    const tree = buildBasontaTree([choir], [])
    expect(tree.categories).toHaveLength(1)
    expect(tree.categories[0].basontas).toEqual([])
  })

  it('orders by sort_order first and name as the tiebreak', () => {
    const tree = buildBasontaTree(
      [choir],
      [
        basonta('fresh', 'Fresh Oil', 'choir', 100),
        basonta('biazo', 'Biazo', 'choir', 100),
        basonta('first', 'Zzz Sings First', 'choir', 1),
      ],
    )
    expect(tree.categories[0].basontas.map((b) => b.name)).toEqual([
      'Zzz Sings First',
      'Biazo',
      'Fresh Oil',
    ])
  })
})

describe('basontaDisplayName', () => {
  it('names the family when there is one', () => {
    expect(basontaDisplayName({ name: 'Biazo', category_name: 'Choir' })).toBe('Biazo · Choir')
  })

  it('leaves a standalone group as just its own name', () => {
    expect(basontaDisplayName({ name: 'Technical Team', category_name: null })).toBe(
      'Technical Team',
    )
    expect(basontaDisplayName({ name: 'Technical Team' })).toBe('Technical Team')
  })
})
