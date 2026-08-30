import { describe, expect, it } from 'vitest'
import { careAssignmentProblem, eligibleCarers, membersInCareOf } from '../care'
import type { CareCandidate } from '../care'

const person = (
  id: string,
  opts: Partial<Omit<CareCandidate, '$id'>> = {},
): CareCandidate => ({
  $id: id,
  full_name: id,
  status: 'active',
  bacenta_id: 'anloga',
  care_of_member_id: null,
  ...opts,
})

const index = (...people: CareCandidate[]) => new Map(people.map((p) => [p.$id, p]))

describe('careAssignmentProblem', () => {
  it('allows nobody — an unassigned member is a normal state', () => {
    const members = index(person('ama'))
    expect(careAssignmentProblem('ama', null, members)).toBeNull()
  })

  it('allows an ordinary assignment inside one bacenta', () => {
    const members = index(person('ama'), person('kofi'))
    expect(careAssignmentProblem('ama', 'kofi', members)).toBeNull()
  })

  it('refuses somebody looking after themselves', () => {
    const members = index(person('ama'))
    expect(careAssignmentProblem('ama', 'ama', members)).toContain('themselves')
  })

  it('refuses an inactive carer, naming them', () => {
    const members = index(person('ama'), person('kofi', { status: 'inactive' }))
    const problem = careAssignmentProblem('ama', 'kofi', members)
    expect(problem).toContain('kofi')
    expect(problem).toContain('inactive')
  })

  it('refuses a carer from a different bacenta', () => {
    const members = index(person('ama'), person('kofi', { bacenta_id: 'bomso' }))
    expect(careAssignmentProblem('ama', 'kofi', members)).toContain('same bacenta')
  })

  it('refuses when the member is in no bacenta at all', () => {
    const members = index(person('ama', { bacenta_id: null }), person('kofi'))
    expect(careAssignmentProblem('ama', 'kofi', members)).toContain('not in a bacenta')
  })

  it('refuses a member or carer that has vanished', () => {
    expect(careAssignmentProblem('ghost', 'kofi', index(person('kofi')))).toContain(
      'no longer exists',
    )
    expect(careAssignmentProblem('ama', 'ghost', index(person('ama')))).toContain(
      'no longer exists',
    )
  })

  // --- the part worth the module ------------------------------------------

  it('allows a CHAIN, which is the ordinary shape of a bacenta', () => {
    // ama -> kofi -> yaa. Adding ama under kofi is fine even though kofi is
    // himself looked after.
    const members = index(
      person('ama'),
      person('kofi', { care_of_member_id: 'yaa' }),
      person('yaa'),
    )
    expect(careAssignmentProblem('ama', 'kofi', members)).toBeNull()
  })

  it('refuses a direct two-person loop', () => {
    // kofi is already looked after by ama; putting ama under kofi closes it.
    const members = index(person('ama'), person('kofi', { care_of_member_id: 'ama' }))
    const problem = careAssignmentProblem('ama', 'kofi', members)
    expect(problem).toContain('loop')
    expect(problem).toContain('ama')
    expect(problem).toContain('kofi')
  })

  it('refuses a longer loop and names the whole chain', () => {
    // ama <- ... kofi -> yaa -> ama. Assigning ama under kofi closes a triangle.
    const members = index(
      person('ama'),
      person('kofi', { care_of_member_id: 'yaa' }),
      person('yaa', { care_of_member_id: 'ama' }),
    )
    const problem = careAssignmentProblem('ama', 'kofi', members)
    expect(problem).toContain('loop')
    expect(problem).toContain('kofi')
    expect(problem).toContain('yaa')
  })

  it('TERMINATES when the stored data already contains a cycle', () => {
    // Written before this check existed, or by a direct database edit. Without
    // the `seen` set this walk never ends and the request hangs instead of
    // being refused — a far worse failure than a wrong answer.
    const members = index(
      person('ama'),
      person('kofi', { care_of_member_id: 'yaa' }),
      person('yaa', { care_of_member_id: 'kofi' }),
    )
    expect(careAssignmentProblem('ama', 'kofi', members)).toBeNull()
  })

  it('does not mistake a shared carer for a loop', () => {
    // Two people under the same carer is normal and must stay allowed.
    const members = index(
      person('ama'),
      person('esi', { care_of_member_id: 'kofi' }),
      person('kofi'),
    )
    expect(careAssignmentProblem('ama', 'kofi', members)).toBeNull()
  })
})

describe('membersInCareOf', () => {
  it('finds everyone directly under somebody', () => {
    const people = [
      person('ama', { care_of_member_id: 'kofi' }),
      person('esi', { care_of_member_id: 'kofi' }),
      person('yaa', { care_of_member_id: 'ama' }),
      person('kofi'),
    ]
    expect(membersInCareOf('kofi', people).map((m) => m.$id).sort()).toEqual(['ama', 'esi'])
  })

  it('is empty for somebody responsible for nobody', () => {
    expect(membersInCareOf('kofi', [person('kofi')])).toEqual([])
  })
})

describe('eligibleCarers', () => {
  it('offers only people the assignment check would actually accept', () => {
    const people = [
      person('ama'),
      person('kofi'),
      person('esi', { status: 'inactive' }),
      person('kwesi', { bacenta_id: 'bomso' }),
    ]
    expect(eligibleCarers('ama', 'anloga', people).map((m) => m.$id)).toEqual(['kofi'])
  })

  it('offers nobody when the member is in no bacenta', () => {
    expect(eligibleCarers('ama', null, [person('kofi')])).toEqual([])
  })

  it('never offers a choice careAssignmentProblem would refuse', () => {
    // The two must not drift: one decides what the dropdown shows, the other
    // decides what the route accepts, and a menu offering a doomed option is
    // the failure this pairing exists to prevent.
    const people = [
      person('ama'),
      person('kofi', { care_of_member_id: 'ama' }),
      person('yaa'),
      person('esi', { status: 'inactive' }),
    ]
    const byId = new Map(people.map((p) => [p.$id, p]))
    for (const candidate of eligibleCarers('ama', 'anloga', people)) {
      expect(careAssignmentProblem('ama', candidate.$id, byId)).toBeNull()
    }
    expect(eligibleCarers('ama', 'anloga', people).map((m) => m.$id)).toEqual(['yaa'])
  })
})
