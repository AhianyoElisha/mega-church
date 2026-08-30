import { describe, expect, it } from 'vitest'
import {
  buildBacentaTree,
  diffMembership,
  headBasontaMerge,
  headEditScope,
  headRegistrationScope,
  headsAnything,
  normaliseName,
  sortByOrderThenName,
  validateGroupName,
} from '../tree'
import type { BacentaWithCount, Constituency } from '../types'

const constituency = (id: string, name: string, sort = 100): Constituency => ({
  $id: id,
  name,
  description: null,
  head_user_id: null,
  head_name: null,
  sort_order: sort,
  created_by: null,
  $createdAt: '2026-01-01T00:00:00.000Z',
})

const bacenta = (
  id: string,
  name: string,
  constituencyId: string | null,
  sort = 100,
): BacentaWithCount => ({
  $id: id,
  name,
  constituency_id: constituencyId,
  description: null,
  head_user_id: null,
  head_name: null,
  sort_order: sort,
  created_by: null,
  $createdAt: '2026-01-01T00:00:00.000Z',
  member_count: 0,
  constituency_name: null,
})

describe('buildBacentaTree', () => {
  const alos = constituency('alos', 'Alos')
  const anagkazo = constituency('anagkazo', 'Anagkazo')

  it('files each place under the constituency it belongs to', () => {
    const tree = buildBacentaTree(
      [alos, anagkazo],
      [
        bacenta('anloga', 'Anloga Bacenta', 'alos'),
        bacenta('bomso', 'Bomso Bacenta', 'alos'),
        bacenta('elsewhere', 'Somewhere Else', 'anagkazo'),
      ],
    )
    expect(tree.constituencies).toHaveLength(2)
    expect(tree.constituencies[0].constituency.name).toBe('Alos')
    expect(tree.constituencies[0].bacentas.map((b) => b.name)).toEqual([
      'Anloga Bacenta',
      'Bomso Bacenta',
    ])
    expect(tree.constituencies[1].bacentas.map((b) => b.name)).toEqual(['Somewhere Else'])
    expect(tree.unfiled).toHaveLength(0)
  })

  it('shows a bacenta with no constituency rather than dropping it', () => {
    // The migration has not run yet for these, and a place full of real people
    // that vanishes from every screen is the failure this bucket prevents.
    const tree = buildBacentaTree([alos], [bacenta('anloga', 'Anloga Bacenta', null)])
    expect(tree.unfiled.map((b) => b.name)).toEqual(['Anloga Bacenta'])
    expect(tree.constituencies[0].bacentas).toHaveLength(0)
  })

  it('treats a constituency that no longer exists as unfiled', () => {
    // Same human fix as never having been filed — pick a constituency — so the
    // two do not need separate buckets.
    const tree = buildBacentaTree([alos], [bacenta('ghost', 'Ghost Bacenta', 'deleted')])
    expect(tree.unfiled.map((b) => b.name)).toEqual(['Ghost Bacenta'])
  })

  it('keeps a constituency that has no bacentas yet', () => {
    const tree = buildBacentaTree([alos], [])
    expect(tree.constituencies).toHaveLength(1)
    expect(tree.constituencies[0].bacentas).toEqual([])
  })

  it('orders by sort_order then name', () => {
    const tree = buildBacentaTree(
      [alos],
      [
        bacenta('b', 'Bomso', 'alos', 100),
        bacenta('a', 'Anloga', 'alos', 100),
        bacenta('z', 'Zzz First', 'alos', 1),
      ],
    )
    expect(tree.constituencies[0].bacentas.map((b) => b.name)).toEqual([
      'Zzz First',
      'Anloga',
      'Bomso',
    ])
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
  const heads = { constituencies: ['c1', 'c2'], basontas: ['b1'] }

  it('accepts a registration into a constituency they head', () => {
    expect(headRegistrationScope({ constituency_id: 'c1', basonta_ids: [] }, heads)).toEqual({
      ok: true,
      constituency_id: 'c1',
      basonta_ids: [],
    })
  })

  it('accepts bacentas they head alongside it', () => {
    const out = headRegistrationScope({ constituency_id: 'c2', basonta_ids: ['b1'] }, heads)
    expect(out).toEqual({ ok: true, constituency_id: 'c2', basonta_ids: ['b1'] })
  })

  it('de-duplicates a repeated bacenta id', () => {
    const out = headRegistrationScope({ constituency_id: 'c1', basonta_ids: ['b1', 'b1'] }, heads)
    expect(out).toEqual({ ok: true, constituency_id: 'c1', basonta_ids: ['b1'] })
  })

  it('refuses a bacenta-only head — they cannot say where anybody LIVES', () => {
    const out = headRegistrationScope(
      { constituency_id: 'c1' },
      { constituencies: [], basontas: ['b1'] },
    )
    expect(out).toMatchObject({ ok: false, status: 403 })
  })

  // The rule that /api/reports/export already follows: a head who does not say
  // which constituency is REFUSED, never defaulted to their first one. A wrong
  // guess is invisible afterwards — the member simply appears in the wrong
  // roster, and nobody knows to look.
  it('refuses an omitted constituency rather than defaulting to their first', () => {
    const out = headRegistrationScope({ basonta_ids: [] }, heads)
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
    const out = headRegistrationScope({ constituency_id: 'c1', basonta_ids: ['b9'] }, heads)
    expect(out).toMatchObject({ ok: false, status: 403 })
  })

  it('refuses the whole registration when ONE bacenta is foreign', () => {
    const out = headRegistrationScope({ constituency_id: 'c1', basonta_ids: ['b1', 'b9'] }, heads)
    expect(out.ok).toBe(false)
  })

  it('treats a non-string constituency as not given', () => {
    expect(headRegistrationScope({ constituency_id: 42 }, heads)).toMatchObject({
      ok: false,
      status: 400,
    })
  })
})

describe('headBasontaMerge', () => {
  // The whole reason this function exists: a head only ever sees their own
  // bacentas, so writing their tick-list verbatim would silently remove the
  // member from every other one.
  it('preserves memberships the head cannot see', () => {
    expect(headBasontaMerge([], ['choir', 'tech'], ['tech'])).toEqual(['choir'])
  })

  it('applies the head’s ticks within their own bacentas', () => {
    expect(headBasontaMerge(['tech'], ['choir'], ['tech']).sort()).toEqual(['choir', 'tech'])
  })

  it('removes from a bacenta the head heads when they untick it', () => {
    expect(headBasontaMerge([], ['choir', 'tech'], ['tech'])).toEqual(['choir'])
  })

  it('ignores a tick for a bacenta they do not head', () => {
    expect(headBasontaMerge(['choir'], [], ['tech'])).toEqual([])
  })

  it('does not duplicate one they already had', () => {
    expect(headBasontaMerge(['tech'], ['tech'], ['tech'])).toEqual(['tech'])
  })

  it('leaves everything alone for a head who heads no bacenta', () => {
    expect(headBasontaMerge([], ['choir', 'tech'], [])).toEqual(['choir', 'tech'])
  })
})

describe('headEditScope', () => {
  const heads = { constituencies: ['c1'], bacentas: ['p1'], basontas: ['b1'] }
  const member = { constituency_id: 'c1', bacenta_id: 'p1', basonta_ids: ['b1', 'b2'] }

  it('lets a head correct an ordinary field', () => {
    const out = headEditScope(
      { fields: { call_number: '+233240000000' }, basonta_ids: undefined },
      member,
      heads,
    )
    expect(out).toEqual({
      ok: true,
      fields: { call_number: '+233240000000' },
      basonta_ids: undefined,
    })
  })

  it('reaches a member through a BASONTA they head, with no constituency in common', () => {
    const out = headEditScope(
      { fields: { address: 'x' }, basonta_ids: undefined },
      { constituency_id: 'somewhere-else', bacenta_id: null, basonta_ids: ['b1'] },
      heads,
    )
    expect(out.ok).toBe(true)
  })

  it('reaches a member through a BACENTA they head — the place, not the choir', () => {
    const out = headEditScope(
      { fields: { address: 'x' }, basonta_ids: undefined },
      { constituency_id: 'somewhere-else', bacenta_id: 'p1', basonta_ids: [] },
      heads,
    )
    expect(out.ok).toBe(true)
  })

  it('refuses a member in no group they head', () => {
    const out = headEditScope(
      { fields: { address: 'x' }, basonta_ids: undefined },
      { constituency_id: 'c9', bacenta_id: 'p9', basonta_ids: ['b9'] },
      heads,
    )
    expect(out).toMatchObject({ ok: false, status: 403 })
  })

  it('refuses a member in no group at all', () => {
    const out = headEditScope(
      { fields: { address: 'x' }, basonta_ids: undefined },
      { constituency_id: null, bacenta_id: null, basonta_ids: [] },
      heads,
    )
    expect(out).toMatchObject({ ok: false, status: 403 })
  })

  it('refuses MOVING the member to another bacenta, and says so', () => {
    // The same rule as constituency_id one level down: where somebody LIVES is
    // an administrator's to change.
    const out = headEditScope(
      { fields: { bacenta_id: 'p2' }, basonta_ids: undefined },
      member,
      heads,
    )
    expect(out).toMatchObject({ ok: false, status: 403 })
    if (out.ok) throw new Error('expected a refusal')
    expect(out.error).toMatch(/different bacenta/i)
  })

  it('accepts bacenta_id resent UNCHANGED and drops it from the write', () => {
    // The shared form always sends it; resending what is already stored is not
    // a move, and treating it as one would refuse every ordinary edit.
    const out = headEditScope(
      { fields: { bacenta_id: 'p1', address: 'x' }, basonta_ids: undefined },
      member,
      heads,
    )
    expect(out).toEqual({ ok: true, fields: { address: 'x' }, basonta_ids: undefined })
  })

  it('lets a head record who looks after somebody', () => {
    // Deliberately NOT refused: it is the head's own pastoral work, it grants
    // the named carer nothing, and the server still checks it separately.
    const out = headEditScope(
      { fields: { care_of_member_id: 'm2' }, basonta_ids: undefined },
      member,
      heads,
    )
    expect(out).toEqual({
      ok: true,
      fields: { care_of_member_id: 'm2' },
      basonta_ids: undefined,
    })
  })

  // Named, not silently dropped — a head who is told nothing assumes it saved.
  it('refuses a status change and says so', () => {
    const out = headEditScope({ fields: { status: 'inactive' }, basonta_ids: undefined }, member, heads)
    expect(out).toMatchObject({ ok: false, status: 403 })
    if (out.ok) throw new Error('expected a refusal')
    expect(out.error).toMatch(/active or inactive/i)
  })

  it('refuses a birthday-message change', () => {
    const out = headEditScope({ fields: { sms_template_id: 't1' }, basonta_ids: undefined }, member, heads)
    expect(out).toMatchObject({ ok: false, status: 403 })
  })

  it('refuses MOVING the member to another constituency', () => {
    const out = headEditScope(
      { fields: { constituency_id: 'c2' }, basonta_ids: undefined },
      member,
      heads,
    )
    expect(out).toMatchObject({ ok: false, status: 403 })
  })

  // The shared form always sends the field. Resending what is already stored is
  // not a move, and must not be treated as one.
  it('accepts the constituency it already has, and drops it from the write', () => {
    const out = headEditScope(
      { fields: { constituency_id: 'c1', address: 'x' }, basonta_ids: undefined },
      member,
      heads,
    )
    expect(out).toEqual({ ok: true, fields: { address: 'x' }, basonta_ids: undefined })
  })

  it('treats a null constituency resent as null as unchanged', () => {
    const out = headEditScope(
      { fields: { constituency_id: null }, basonta_ids: undefined },
      { constituency_id: null, bacenta_id: null, basonta_ids: ['b1'] },
      heads,
    )
    expect(out).toEqual({ ok: true, fields: {}, basonta_ids: undefined })
  })

  it('merges bacentas rather than replacing them', () => {
    const out = headEditScope({ fields: {}, basonta_ids: [] }, member, heads)
    // b2 is outside their reach and survives; b1 is theirs and was unticked.
    expect(out).toEqual({ ok: true, fields: {}, basonta_ids: ['b2'] })
  })

  it('leaves bacentas untouched when the request never mentions them', () => {
    const out = headEditScope({ fields: { address: 'x' }, basonta_ids: undefined }, member, heads)
    if (!out.ok) throw new Error('expected acceptance')
    expect(out.basonta_ids).toBeUndefined()
  })
})
