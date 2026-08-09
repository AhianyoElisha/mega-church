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

/**
 * GET /api/reports/export?occurrence_id=… — attendance register as .xlsx.
 *
 * Streamed straight out of the handler; no temp files.
 *
 * The sheet lists EVERY member who could have attended, present or not, with a
 * Yes/No column — a register, not a list of arrivals. A church secretary is
 * usually looking for who was missing.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const occurrenceId = request.nextUrl.searchParams.get('occurrence_id')?.trim()
  if (!occurrenceId) {
    return Response.json(
      { ok: false, error: 'occurrence_id query parameter is required.' },
      { status: 400 },
    )
  }

  const { databases } = createAdminClient()

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

  // Every record for the occurrence, paged out in full.
  const present = new Map<string, { marked_at: string; method: string }>()
  let cursor: string | null = null
  for (;;) {
    const page = await loadOccurrenceRecords(databases, occurrenceId, { cursor, limit: 200 })
    for (const r of page.records) present.set(r.member_id, { marked_at: r.marked_at, method: r.method })
    if (!page.cursor) break
    cursor = page.cursor
  }

  const members = await listMembers(databases)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Mega Church Attendance'
  wb.created = new Date()
  const ws = wb.addWorksheet(meeting.name.slice(0, 28) || 'Attendance')

  ws.mergeCells('A1:F1')
  const title = ws.getCell('A1')
  title.value = `${meeting.name} — ${occurrence.occurrence_date}`
  title.font = { size: 14, bold: true }
  ws.mergeCells('A2:F2')
  ws.getCell('A2').value =
    `${present.size} present · opened ${occurrence.opened_at}` +
    (occurrence.closed_at ? ` · closed ${occurrence.closed_at}` : ' · still open')
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF666666' } }

  ws.addRow([])
  const header = ws.addRow(['Name', 'Call number', 'WhatsApp', 'Present', 'Marked at', 'Method'])
  header.font = { bold: true }
  header.eachCell((c) => {
    // The brand yellow, so a printed register looks like it belongs here.
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5B301' } }
  })

  ws.columns = [
    { width: 32 },
    { width: 18 },
    { width: 18 },
    { width: 10 },
    { width: 22 },
    { width: 12 },
  ]

  for (const m of members) {
    if (m.status !== 'active') continue
    const hit = present.get(m.$id)
    ws.addRow([
      fullName(m),
      m.call_number,
      m.whatsapp_number ?? '',
      hit ? 'Yes' : 'No',
      hit?.marked_at ?? '',
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
