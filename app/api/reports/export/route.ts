import { type NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { type Models } from 'node-appwrite'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import {
  loadOccurrenceRecords,
  meetingDocToMeeting,
  occurrenceDocToOccurrence,
} from '@/lib/attendance/server'
import { listMembers } from '@/lib/members/server'
import { fullName } from '@/lib/members/types'
import {
  buildDayReport,
  isDayScope,
  rowsForConstituency,
  rowsForScope,
  safeSheetName,
  NO_CONSTITUENCY,
  type DayReport,
  type DayRow,
  type DayScope,
} from '@/lib/reports/day'
import { canReadGroup } from '@/lib/groups/server'

/**
 * Attendance as .xlsx, streamed straight out of the handler — no temp files.
 *
 * Two modes:
 *
 *   ?date=YYYY-MM-DD&scope=first|second|absent|all
 *       The Sunday view. A day can hold both services, so the unit people
 *       actually ask for is the DAY, not one session.
 *
 *   ?occurrence_id=…
 *       One specific session, including a meeting. Used by the live monitor
 *       and the per-session rows in Reports.
 *
 * Every sheet carries the call number. These lists exist to be worked down by
 * someone with a phone — a register without numbers just moves the problem.
 */

const BRAND = 'FFF5B301'

function header(ws: ExcelJS.Worksheet, cells: string[]) {
  const row = ws.addRow(cells)
  row.font = { bold: true }
  row.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
  })
  return row
}

/** Africa/Accra wall clock, or blank. Sheets are read by people, not parsers. */
function time(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Africa/Accra',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

function titleBlock(ws: ExcelJS.Worksheet, span: string, title: string, subtitle: string) {
  ws.mergeCells(`A1:${span}1`)
  const t = ws.getCell('A1')
  t.value = title
  t.font = { size: 14, bold: true }
  ws.mergeCells(`A2:${span}2`)
  const s = ws.getCell('A2')
  s.value = subtitle
  s.font = { size: 10, color: { argb: 'FF666666' } }
  ws.addRow([])
}

const SCOPE_TITLE: Record<Exclude<DayScope, 'all'>, string> = {
  first: 'First Service attendance',
  second: 'Second Service attendance',
  absent: 'Absent members',
}

const SHEET_NAME: Record<Exclude<DayScope, 'all'>, string> = {
  first: 'First Service',
  second: 'Second Service',
  absent: 'Absent',
}

/**
 * One tab. `all` is not a tab — it is the three of these in one workbook.
 *
 * `group` narrows the sheet to one constituency. It is passed rather than
 * filtered by the caller so that "absent, in Ahodwo" is defined once, in
 * `rowsForConstituency`, and the head's sheet cannot disagree with the
 * admin's headcount for the same Sunday.
 */
function buildDaySheet(
  wb: ExcelJS.Workbook,
  report: DayReport,
  scope: Exclude<DayScope, 'all'>,
  group: { id: string; name: string } | null,
  used: Set<string>,
) {
  const rows: DayRow[] = group
    ? rowsForConstituency(report, group.id, scope)
    : rowsForScope(report, scope)
  const ws = wb.addWorksheet(
    safeSheetName(group ? `${SHEET_NAME[scope]} — ${group.name}` : SHEET_NAME[scope], used),
  )

  // The "nobody opened a service" case. Without saying so, a day with no
  // service looks exactly like a day the whole congregation missed, and the
  // absent list would name everyone.
  const notHeld: string[] = []
  if (!report.held.first && scope !== 'second') notHeld.push('First Service')
  if (!report.held.second && scope !== 'first') notHeld.push('Second Service')
  const caveat =
    notHeld.length > 0 ? `  ·  NOT HELD on this date: ${notHeld.join(', ')}` : ''

  if (scope === 'absent') {
    titleBlock(
      ws,
      'D',
      `${SCOPE_TITLE.absent} — ${report.date}${group ? ` — ${group.name}` : ''}`,
      `${rows.length}${group ? '' : ` of ${report.totals.active} active members`} were at neither service` + caveat,
    )
    header(ws, ['Name', 'Call number', 'WhatsApp', 'Usual service'])
    ws.columns = [{ width: 30 }, { width: 18 }, { width: 18 }, { width: 18 }]
    for (const r of rows) {
      ws.addRow([
        fullName(r.member),
        r.member.call_number,
        r.member.whatsapp_number ?? '',
        r.member.home_service === 'first' ? 'First Service' : 'Second Service',
      ])
    }
    return ws
  }

  // A single service.
  const isFirst = scope === 'first'
  titleBlock(
    ws,
    'E',
    `${SCOPE_TITLE[scope]} — ${report.date}${group ? ` — ${group.name}` : ''}`,
    `${rows.length} present${group ? '' : ` of ${report.totals.active} active members`}` + caveat,
  )
  header(ws, ['Name', 'Call number', 'WhatsApp', 'Marked at', 'Also at other service'])
  ws.columns = [{ width: 30 }, { width: 18 }, { width: 18 }, { width: 12 }, { width: 20 }]
  for (const r of rows) {
    ws.addRow([
      fullName(r.member),
      r.member.call_number,
      r.member.whatsapp_number ?? '',
      time(isFirst ? r.first_marked_at : r.second_marked_at),
      r.status === 'both' ? 'Yes' : '',
    ])
  }
  return ws
}

export async function GET(request: NextRequest) {
  /**
   * A `leader` reaches this route, and it is the only admin report they do.
   *
   * That is not a hole in the read-only rule (PRD §5.2) — a download IS a
   * read, and a head being able to pull their own constituency's attendance is
   * the entire point of the feature. What keeps it safe is below: the group id
   * is checked against `canReadGroup` before a single row is loaded, and a
   * head who omits the parameter is refused rather than defaulted to
   * everybody.
   */
  const auth = await requireRole(['admin', 'leader'])
  if ('error' in auth) return auth.error
  const isAdmin = auth.user.label === 'admin'

  const params = request.nextUrl.searchParams
  const date = params.get('date')?.trim()
  const occurrenceId = params.get('occurrence_id')?.trim()
  const constituencyId = params.get('constituency_id')?.trim() || null
  const byConstituency = params.get('by') === 'constituency'

  const { databases } = createAdminClient()

  // Everything a leader may do requires naming ONE constituency they head.
  // The two refusals below are separate on purpose: "you did not say which"
  // and "not that one" are different mistakes with different fixes, and
  // collapsing them into a single 403 makes the first look like the second.
  if (!isAdmin) {
    if (occurrenceId || byConstituency || !constituencyId) {
      return Response.json(
        {
          ok: false,
          error:
            'A group head can download their own constituency only. ' +
            'Add constituency_id to the request.',
        },
        { status: 403 },
      )
    }
    const allowed = await canReadGroup(
      databases,
      { id: auth.user.id, label: auth.user.label },
      'constituency',
      constituencyId,
    )
    if (!allowed) {
      return Response.json(
        { ok: false, error: 'You do not head that constituency.' },
        { status: 403 },
      )
    }
  }

  // --- day mode -------------------------------------------------------------
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ ok: false, error: 'date must be YYYY-MM-DD.' }, { status: 400 })
    }
    const scopeRaw = params.get('scope') ?? 'all'
    if (!isDayScope(scopeRaw)) {
      return Response.json(
        { ok: false, error: 'scope must be first, second, absent or all.' },
        { status: 400 },
      )
    }

    const report = await buildDayReport(databases, date)

    // A named constituency has to exist, or a typo in the URL silently
    // produces an empty workbook that reads as "nobody came".
    let group: { id: string; name: string } | null = null
    if (constituencyId) {
      group = report.constituencies.find((c) => c.id === constituencyId) ?? null
      if (!group) {
        return Response.json(
          { ok: false, error: 'No such constituency.' },
          { status: 404 },
        )
      }
    }

    const wb = new ExcelJS.Workbook()
    wb.creator = 'The Mega Church Attendance'
    wb.created = new Date()
    // Excel caps sheet names at 31 characters, so two long constituency names
    // can truncate to the same string. `used` is what stops ExcelJS throwing
    // on the collision.
    const used = new Set<string>()

    const scopes: Exclude<DayScope, 'all'>[] =
      scopeRaw === 'all' ? ['first', 'second', 'absent'] : [scopeRaw]

    if (byConstituency) {
      // One workbook the admin can split up and hand out: every constituency,
      // every requested scope. Constituency-major so each head's tabs sit
      // together rather than being interleaved with everyone else's.
      for (const c of report.constituencies) {
        for (const scope of scopes) buildDaySheet(wb, report, scope, c, used)
      }
    } else {
      // One workbook, tabs in the order a Sunday happens. A member at BOTH
      // services appears on the first two tabs — the same as downloading them
      // separately, so the tabs cannot disagree with the single-scope sheets.
      for (const scope of scopes) buildDaySheet(wb, report, scope, group, used)
    }

    const buffer = await wb.xlsx.writeBuffer()
    const slug = (v: string) => v.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')
    const suffix = byConstituency
      ? '-by-constituency'
      : group
        ? `-${slug(group.name)}`
        : ''
    const filename =
      scopeRaw === 'all'
        ? `attendance-${date}${suffix}.xlsx`
        : `attendance-${scopeRaw}-${date}${suffix}.xlsx`
    return new Response(buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }

  // --- single-session mode --------------------------------------------------
  if (!occurrenceId) {
    return Response.json(
      { ok: false, error: 'Pass either date=YYYY-MM-DD or occurrence_id.' },
      { status: 400 },
    )
  }

  let occurrence
  let meeting
  try {
    occurrence = occurrenceDocToOccurrence(
      (await databases.getDocument(
        DATABASE_ID,
        COLLECTIONS.meeting_occurrences,
        occurrenceId,
      )) as Models.Document & Record<string, unknown>,
    )
    meeting = meetingDocToMeeting(
      (await databases.getDocument(
        DATABASE_ID,
        COLLECTIONS.meetings,
        occurrence.meeting_id,
      )) as Models.Document & Record<string, unknown>,
    )
  } catch {
    return Response.json({ ok: false, error: 'No such session.' }, { status: 404 })
  }

  const present = new Map<string, { marked_at: string; method: string }>()
  let cursor: string | null = null
  for (;;) {
    const page = await loadOccurrenceRecords(databases, occurrenceId, { cursor, limit: 200 })
    for (const r of page.records) {
      present.set(r.member_id, { marked_at: r.marked_at, method: r.method })
    }
    if (!page.cursor) break
    cursor = page.cursor
  }

  const members = await listMembers(databases, { status: 'active' })

  const wb = new ExcelJS.Workbook()
  wb.creator = 'The Mega Church Attendance'
  wb.created = new Date()
  const ws = wb.addWorksheet(meeting.name.slice(0, 28) || 'Attendance')

  titleBlock(
    ws,
    'F',
    `${meeting.name} — ${occurrence.occurrence_date}`,
    `${present.size} present · opened ${occurrence.opened_at}` +
      (occurrence.closed_at ? ` · closed ${occurrence.closed_at}` : ' · still open'),
  )
  header(ws, ['Name', 'Call number', 'WhatsApp', 'Present', 'Marked at', 'Method'])
  ws.columns = [{ width: 30 }, { width: 18 }, { width: 18 }, { width: 10 }, { width: 12 }, { width: 12 }]

  for (const m of members) {
    const hit = present.get(m.$id)
    ws.addRow([
      fullName(m),
      m.call_number,
      m.whatsapp_number ?? '',
      hit ? 'Yes' : 'No',
      time(hit?.marked_at ?? null),
      hit?.method ?? '',
    ])
  }

  const buffer = await wb.xlsx.writeBuffer()
  const filename = `attendance-${meeting.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${occurrence.occurrence_date}.xlsx`
  return new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
