import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { listMembers } from '@/lib/members/server'
import { todayInAccra } from '@/lib/attendance/occurrenceResolver'
import {
  celebrantsForNotification,
  upcomingCelebrants,
  type Celebrant,
} from '@/lib/birthdays/upcoming'
import { BIRTHDAY_HORIZON_DAYS, BIRTHDAY_LEAD_DAYS } from '@/lib/appwrite/config'

export type BirthdaysResponse = {
  ok: true
  /** Today in Accra, so the client never has to guess the church's timezone. */
  today: string
  /** How many days ahead the church is told. 1 = the day before. */
  lead_days: number
  /**
   * The people this morning's notification is about — celebrating exactly
   * `lead_days` from now. This is the list the flyers get made from.
   */
  to_prepare: Celebrant[]
  /** Celebrating TODAY. Shown for context; the work on these is already done. */
  today_celebrants: Celebrant[]
  /** Everyone in the next `BIRTHDAY_HORIZON_DAYS`, soonest first. */
  upcoming: Celebrant[]
}

/**
 * GET /api/birthdays — the celebrant lists, computed in Accra time.
 *
 * The church used to see birthdays only on the day itself, which is too late
 * for anyone who has to design a flyer and schedule a post. `to_prepare` is
 * therefore the day BEFORE, and it is the same list
 * `/api/notifications/birthday-run` pushes to the team's phones — both call
 * `celebrantsForNotification`, so the page and the notification can never
 * disagree about who is celebrating.
 *
 * Open to admin and the `celebrations` team. Not to ushers: a full roster of
 * names and phone numbers is more than the door needs.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'celebrations', 'shepherd'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  const members = await listMembers(databases)

  const today = todayInAccra()
  const horizonParam = Number(request.nextUrl.searchParams.get('days'))
  const horizon =
    Number.isFinite(horizonParam) && horizonParam > 0 && horizonParam <= 365
      ? Math.floor(horizonParam)
      : BIRTHDAY_HORIZON_DAYS

  const upcoming = upcomingCelebrants(members, today, horizon)

  return NextResponse.json<BirthdaysResponse>(
    {
      ok: true,
      today,
      lead_days: BIRTHDAY_LEAD_DAYS,
      to_prepare: celebrantsForNotification(members, today),
      // Derived from the same sorted list rather than recomputed, so a member
      // cannot appear in one bucket and be missing from the other.
      today_celebrants: upcoming.filter((c) => c.days_away === 0),
      upcoming,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
