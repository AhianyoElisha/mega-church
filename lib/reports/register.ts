// A session's register: who was expected, who came, who did not.
//
// Pure — no Appwrite, no `server-only` — so the page can import the types and
// labels, and the rules below are testable without a database. The loader
// that feeds it lives in `./server.ts`.

import { isAdultServiceSlot } from '@/lib/appwrite/config'
import type { AttendanceMethod, AttendanceRecord } from '@/lib/attendance/types'
import type { Meeting, MeetingOccurrence } from '@/lib/meetings/types'
import { fullName, type Member } from '@/lib/members/types'

/**
 * Who a session expects. The ONE definition, shared with `expectedFor()` in
 * `lib/attendance/server.ts`, so the live monitor's "Expected" and this
 * register's cannot disagree about the same service.
 *
 *   roster     a restricted meeting: the people on its list, whatever their
 *              status — the list is the authority, not the registry.
 *   adults     First or Second Service: every active adult and student. A
 *              child who touches the scanner is marked at Save Church instead
 *              (PRD §2.11), so counting them here would make "still to come"
 *              never reach zero on a full house.
 *   children   Save Church: every active child.
 *   everyone   an open meeting with no roster: every active member.
 */
export type ExpectedBasis = 'roster' | 'adults' | 'children' | 'everyone'

export function expectedBasis(
  meeting: Pick<Meeting, 'restricted' | 'service_slot'>,
): ExpectedBasis {
  if (meeting.restricted) return 'roster'
  if (isAdultServiceSlot(meeting.service_slot)) return 'adults'
  if (meeting.service_slot === 'save') return 'children'
  return 'everyone'
}

/** In words, for the hint under the Expected card. */
export const BASIS_LABEL: Record<ExpectedBasis, string> = {
  roster: 'everyone on the meeting’s list',
  adults: 'every active adult and student',
  children: 'every active Save Church child',
  everyone: 'every active member',
}

/**
 * Whether a member from the registry is expected under a basis. `roster` is
 * decided by the list, not by the member, so it is never answered here — the
 * loader passes roster members straight through.
 */
export function isExpected(
  basis: Exclude<ExpectedBasis, 'roster'>,
  member: Pick<Member, 'member_type' | 'status'>,
): boolean {
  if (member.status !== 'active') return false
  if (basis === 'adults') return member.member_type !== 'child'
  if (basis === 'children') return member.member_type === 'child'
  return true
}

/** What the table shows per person. Not the whole member: the register is a
 *  roll, not a profile, and the row links to the profile anyway. */
export type RegisterMember = {
  $id: string
  full_name: string
  member_no: string | null
  call_number: string | null
  whatsapp_number: string | null
  photo_file_id: string | null
  member_type: Member['member_type']
  home_service: Member['home_service']
  constituency_id: string | null
  guardian_name: string | null
  status: Member['status']
  /** True for a mark whose member row no longer exists. */
  deleted: boolean
}

export function toRegisterMember(m: Member): RegisterMember {
  return {
    $id: m.$id,
    full_name: fullName(m),
    member_no: m.member_no,
    call_number: m.call_number,
    whatsapp_number: m.whatsapp_number,
    photo_file_id: m.photo_file_id,
    member_type: m.member_type,
    home_service: m.home_service,
    constituency_id: m.constituency_id,
    guardian_name: m.guardian_name,
    status: m.status,
    deleted: false,
  }
}

/**
 * A record whose member was deleted still belongs on the register — dropping
 * it would silently shrink a historical count (the same rule as the record
 * log). It is named as such rather than hidden.
 */
export function deletedMember(id: string): RegisterMember {
  return {
    $id: id,
    full_name: 'Deleted member',
    member_no: null,
    call_number: null,
    whatsapp_number: null,
    photo_file_id: null,
    member_type: 'adult',
    home_service: 'second',
    constituency_id: null,
    guardian_name: null,
    status: 'inactive',
    deleted: true,
  }
}

export type RegisterRow = {
  member: RegisterMember
  /** On the expected list for this session. */
  expected: boolean
  present: boolean
  marked_at: string | null
  method: AttendanceMethod | null
}

type Mark = Pick<AttendanceRecord, 'member_id' | 'marked_at' | 'method'>

/**
 * One row per expected member, present or not, plus one per mark for anybody
 * NOT on the expected list — inactive since the service, taken off a roster,
 * reclassified, or deleted. A mark is the church's record that somebody was
 * in the building; the register never drops one to make the list tidy, it
 * flags it.
 *
 * `extra` holds the member rows for those unexpected marks, looked up by the
 * caller; a mark with no row in `extra` is a deleted member.
 */
export function buildRegister(
  expected: Member[],
  records: Mark[],
  extra: Member[] = [],
): RegisterRow[] {
  // Earliest mark per member. A service re-opened after being closed can give
  // one member two marks; the first is when they actually arrived.
  const marks = new Map<string, { at: string; method: AttendanceMethod }>()
  for (const r of records) {
    const existing = marks.get(r.member_id)
    if (!existing || r.marked_at < existing.at) {
      marks.set(r.member_id, { at: r.marked_at, method: r.method })
    }
  }

  const rows: RegisterRow[] = []
  const seen = new Set<string>()
  for (const m of expected) {
    if (seen.has(m.$id)) continue
    seen.add(m.$id)
    const mark = marks.get(m.$id) ?? null
    rows.push({
      member: toRegisterMember(m),
      expected: true,
      present: mark !== null,
      marked_at: mark?.at ?? null,
      method: mark?.method ?? null,
    })
  }

  const extraById = new Map(extra.map((m) => [m.$id, m]))
  for (const [memberId, mark] of marks) {
    if (seen.has(memberId)) continue
    seen.add(memberId)
    const m = extraById.get(memberId)
    rows.push({
      member: m ? toRegisterMember(m) : deletedMember(memberId),
      expected: false,
      present: true,
      marked_at: mark.at,
      method: mark.method,
    })
  }

  // Alphabetical, like the sheet: a register is read down a column by someone
  // looking for a name, not in the order people arrived.
  rows.sort((a, b) => a.member.full_name.localeCompare(b.member.full_name))
  return rows
}

export type RegisterSummary = {
  present: number
  expected: number
  absent: number
  by_method: { biometric: number; manual: number }
}

export function registerSummary(rows: RegisterRow[]): RegisterSummary {
  let present = 0
  let expected = 0
  let absent = 0
  const by_method = { biometric: 0, manual: 0 }
  for (const r of rows) {
    if (r.expected) expected++
    if (r.present) {
      present++
      if (r.method === 'manual') by_method.manual++
      else by_method.biometric++
    } else if (r.expected) {
      absent++
    }
  }
  return { present, expected, absent, by_method }
}

/** What `GET /api/occurrences/[id]/register` answers. */
export type SessionRegister = {
  occurrence: MeetingOccurrence
  meeting: Meeting
  basis: ExpectedBasis
  rows: RegisterRow[]
  /** The Save Church session that ran alongside this one, when there was one. */
  companion: { occurrence: MeetingOccurrence; meeting: Meeting; present: number } | null
  /** The adult service this Save Church session ran alongside. */
  parent: { occurrence: MeetingOccurrence; meeting: Meeting } | null
  constituencies: { id: string; name: string }[]
}

export type SessionRegisterResponse =
  | ({ ok: true } & SessionRegister)
  | { ok: false; error: string }
