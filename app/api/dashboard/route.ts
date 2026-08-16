import { NextResponse } from 'next/server'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import { listMembers } from '@/lib/members/server'
import { enrolmentByMember } from '@/lib/biometrics/server'
import { listMeetings } from '@/lib/meetings/server'
import { occurrenceDocToOccurrence, resolveActiveSession } from '@/lib/attendance/server'
import { todayInAccra } from '@/lib/attendance/occurrenceResolver'
import { addDaysISO, celebrantsForNotification } from '@/lib/birthdays/upcoming'
import { BIRTHDAY_LEAD_DAYS } from '@/lib/appwrite/config'
import type { ActiveSession } from '@/lib/meetings/types'

export type DashboardResponse = {
  ok: true
  members: {
    total: number
    active: number
    fully_enrolled: number
    needs_enrolment: number
  }
  session: ActiveSession | null
  /** Most recent closed sessions, newest first. */
  recent: {
    $id: string
    meeting_name: string
    occurrence_date: string
    present_count: number
  }[]
  /**
   * Members celebrating TOMORROW, in Accra — not today.
   *
   * The card used to show today's birthdays, which is too late to be useful:
   * the flyer and the shoutout have to be made before the day. Moving it a day
   * earlier is the whole point of `BIRTHDAY_LEAD_DAYS`, and this list is
   * computed by the same `celebrantsForNotification` the push notification
   * uses, so the dashboard and the phones can never name different people.
   */
  birthdays: { $id: string; full_name: string; photo_file_id: string | null }[]
  /** YYYY-MM-DD the `birthdays` list is FOR, so the card can label itself. */
  birthdays_for: string
  /** How many days ahead that is. 1 = tomorrow. */
  birthday_lead_days: number
}

export async function GET() {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()

  // Independent reads — Appwrite has no joins, so the cost is round-trips and
  // the fix is doing them at the same time.
  const [members, enrolment, meetings, recentRes, session] = await Promise.all([
    listMembers(databases),
    enrolmentByMember(databases),
    listMeetings(databases),
    databases.listDocuments(DATABASE_ID, COLLECTIONS.meeting_occurrences, [
      Query.equal('status', 'closed'),
      Query.orderDesc('opened_at'),
      Query.limit(8),
    ]),
    resolveActiveSession(databases).catch(() => null),
  ])

  const names = new Map(meetings.map((m) => [m.$id, m.name]))

  let active = 0
  let fully_enrolled = 0
  // Counted separately from `active - fully_enrolled`, because an INACTIVE
  // member who is fully enrolled would otherwise make this number lie.
  let needs_enrolment = 0
  for (const m of members) {
    const complete = enrolment.get(m.$id)?.complete === true
    if (complete) fully_enrolled++
    if (m.status === 'active') {
      active++
      if (!complete) needs_enrolment++
    }
  }

  const today = todayInAccra()
  // Note what is NOT here any more: a hand-rolled `month === birth_month &&
  // day === birth_day` comparison against today. That version could not
  // express "tomorrow" without also getting the December wrap and 29 February
  // right, so the arithmetic moved into `lib/birthdays/upcoming.ts` where it is
  // unit-tested against both.
  const celebrants = celebrantsForNotification(members, today)

  return NextResponse.json<DashboardResponse>(
    {
      ok: true,
      members: {
        total: members.length,
        active,
        fully_enrolled,
        // The number worth acting on: an active member who is not fully
        // enrolled will be turned away by a scanner.
        needs_enrolment,
      },
      session,
      recent: recentRes.documents
        .map((d) => occurrenceDocToOccurrence(d as Models.Document & Record<string, unknown>))
        .map((o) => ({
          $id: o.$id,
          meeting_name: names.get(o.meeting_id) ?? 'Deleted meeting',
          occurrence_date: o.occurrence_date,
          present_count: o.present_count,
        })),
      birthdays: celebrants.map((c) => ({
        $id: c.$id,
        full_name: c.full_name,
        photo_file_id: c.photo_file_id,
      })),
      // Computed from today rather than read off the first celebrant, so the
      // card can still say WHICH day it means when nobody is celebrating.
      birthdays_for: addDaysISO(today, BIRTHDAY_LEAD_DAYS),
      birthday_lead_days: BIRTHDAY_LEAD_DAYS,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
