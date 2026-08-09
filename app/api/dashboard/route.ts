import { NextResponse } from 'next/server'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import { listMembers } from '@/lib/members/server'
import { enrolmentByMember } from '@/lib/biometrics/server'
import { listMeetings } from '@/lib/meetings/server'
import { occurrenceDocToOccurrence, resolveActiveSession } from '@/lib/attendance/server'
import { todayInAccra } from '@/lib/attendance/occurrenceResolver'
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
  /** Members whose birthday falls today, in Accra. A small kindness. */
  birthdays: { $id: string; full_name: string; photo_file_id: string | null }[]
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
  const [, monthStr, dayStr] = today.split('-')
  const month = Number(monthStr)
  const day = Number(dayStr)

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
      birthdays: members
        .filter((m) => m.status === 'active' && m.birth_month === month && m.birth_day === day)
        .map((m) => ({
          $id: m.$id,
          full_name: [m.first_name, m.other_names, m.last_name].filter(Boolean).join(' '),
          photo_file_id: m.photo_file_id,
        })),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
