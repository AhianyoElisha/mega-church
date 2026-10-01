import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendToMembers, type SendTarget } from '@/lib/sms/server'
import { StubSmsService } from '@/lib/sms/mnotify'
import type { SmsTemplate } from '@/lib/sms/types'
import type { Member } from '@/lib/members/types'

/*
 * The CHOKEPOINT test.
 *
 * Every send in the app passes through `sendToMembers`, so this is the one
 * place a child can be guaranteed never to be texted whatever a route forgot.
 * The Databases double records what was CLAIMED — a row in `sms_messages` is
 * the claim, and a child must never have one.
 */

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
    call_number: '+233241234567',
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
    status: 'active',
    benmp_partner: false,
    created_by: null,
    sms_template_id: null,
    $createdAt: '',
    $updatedAt: '',
    ...over,
  } as Member
}

const template: SmsTemplate = {
  $id: 't1',
  name: 'Thanks',
  category: 'attendance_thanks',
  body: 'Thank you {{first_name}} for {{services_attended}}.',
  is_default: true,
  sort_order: 0,
  created_by: null,
  $createdAt: '',
  $updatedAt: '',
}

function fakeDb() {
  const claimed: Record<string, unknown>[] = []
  const db = {
    createDocument: vi.fn(async (_d: string, _c: string, _i: string, data: Record<string, unknown>) => {
      claimed.push(data)
      return { $id: `doc${claimed.length}` }
    }),
    updateDocument: vi.fn(async (_d: string, _c: string, id: string) => ({ $id: id })),
  }
  return { db: db as never, claimed }
}

const opts = {
  category: 'attendance_thanks' as const,
  sentBy: 'test',
  runDate: '2026-09-27',
  automatic: true,
}

describe('sendToMembers', () => {
  beforeEach(() => {
    StubSmsService.sent.length = 0
  })

  it('never claims, and never sends, for a child — whatever the route passed', async () => {
    const { db, claimed } = fakeDb()
    const targets: SendTarget[] = [
      { member: member({ $id: 'adult' }), template, extras: { services_attended: 'First Service' } },
      {
        member: member({ $id: 'kid', member_type: 'child', first_name: 'Kofi' }),
        template,
        extras: { services_attended: 'First Service' },
      },
      { member: member({ $id: 'student', member_type: 'student' }), template, extras: { services_attended: 'both First and Second Service' } },
    ]
    const report = await sendToMembers(db, new StubSmsService(), targets, opts)

    expect(report.excluded_children).toBe(1)
    expect(report.sent).toBe(2)
    expect(claimed.map((c) => c.member_id)).toEqual(['adult', 'student'])
    // The provider never saw the child's (parent's) number.
    const recipients = StubSmsService.sent.flatMap((s) => s.recipients)
    expect(recipients).toHaveLength(2)
  })

  it('reports only children when every target is one, and touches nothing', async () => {
    const { db, claimed } = fakeDb()
    const report = await sendToMembers(
      db,
      new StubSmsService(),
      [{ member: member({ $id: 'kid', member_type: 'child' }), template }],
      opts,
    )
    expect(report).toMatchObject({ excluded_children: 1, sent: 0, failed: 0, skipped: 0 })
    expect(claimed).toHaveLength(0)
    expect(StubSmsService.sent).toHaveLength(0)
  })

  it('renders each target with its OWN extras', async () => {
    const { db, claimed } = fakeDb()
    await sendToMembers(
      db,
      new StubSmsService(),
      [
        { member: member({ $id: 'a' }), template, extras: { services_attended: 'First Service' } },
        { member: member({ $id: 'b' }), template, extras: { services_attended: 'Second Service' } },
      ],
      opts,
    )
    expect(claimed.map((c) => c.body)).toEqual([
      'Thank you Ama for First Service.',
      'Thank you Ama for Second Service.',
    ])
    // Two wordings, two provider calls — identical text is grouped, different
    // text is not.
    expect(StubSmsService.sent).toHaveLength(2)
  })

  it('throws BEFORE claiming when a target has no value for the extra', async () => {
    // A thank-you template sent by a route that forgot the extras must fail
    // whole, not mail "Thank you Ama for ." to half the congregation.
    const { db, claimed } = fakeDb()
    await expect(
      sendToMembers(db, new StubSmsService(), [{ member: member({ $id: 'a' }), template }], opts),
    ).rejects.toThrow(/services_attended/)
    expect(claimed).toHaveLength(0)
  })

  it('treats a null call_number as no phone, not as a crash', async () => {
    const { db } = fakeDb()
    const report = await sendToMembers(
      db,
      new StubSmsService(),
      [
        {
          member: member({ $id: 'a', call_number: null, whatsapp_number: null }),
          template,
          extras: { services_attended: 'First Service' },
        },
      ],
      opts,
    )
    expect(report.no_phone).toEqual(['Ama Serwaa'])
    expect(report.sent).toBe(0)
  })
})
