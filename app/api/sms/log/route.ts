import { NextResponse, type NextRequest } from 'next/server'
import { Query } from 'node-appwrite'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { COLLECTIONS, DATABASE_ID, SMS_CATEGORIES, type SmsCategory } from '@/lib/appwrite/config'
import { listSmsLog } from '@/lib/sms/server'
import { fullName } from '@/lib/members/types'
import { memberDocToMember } from '@/lib/attendance/server'
import type { ListSmsLogResponse } from '@/lib/sms/types'

function isCategory(v: unknown): v is SmsCategory {
  return typeof v === 'string' && (SMS_CATEGORIES as readonly string[]).includes(v)
}

/**
 * GET /api/sms/log — what went out, and every failure in mNotify's own words.
 *
 * Names are joined in memory. Appwrite has no joins (CLAUDE.md), so this reads
 * the page of messages first and then fetches exactly the members that page
 * mentions — not every member in the church.
 */
export async function GET(request: NextRequest) {
  // Their own sends are in here, and so is every failure. Withholding the log
  // from the account that does the sending leaves them unable to tell a
  // delivered message from a refused one.
  const auth = await requireRole(['admin', 'treasurer'])
  if ('error' in auth) return auth.error

  const params = request.nextUrl.searchParams
  const categoryRaw = params.get('category')
  if (categoryRaw !== null && !isCategory(categoryRaw)) {
    return NextResponse.json<ListSmsLogResponse>(
      { ok: false, error: `category must be one of: ${SMS_CATEGORIES.join(', ')}.` },
      { status: 400 },
    )
  }

  const { databases } = createAdminClient()
  const { messages, total } = await listSmsLog(databases, {
    category: categoryRaw ?? undefined,
    memberId: params.get('member_id') ?? undefined,
    limit: Number(params.get('limit')) || 50,
  })

  const ids = [...new Set(messages.map((m) => m.member_id))]
  const names = new Map<string, string>()
  if (ids.length > 0) {
    const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.members, [
      Query.equal('$id', ids),
      Query.limit(100),
    ])
    for (const d of res.documents) {
      names.set(d.$id, fullName(memberDocToMember(d as never)))
    }
  }

  return NextResponse.json<ListSmsLogResponse>(
    {
      ok: true,
      // A deleted member leaves their messages behind with a null name rather
      // than dropping the row: "we texted somebody who is no longer on the
      // register" is a fact worth being able to look up.
      messages: messages.map((m) => ({ ...m, member_name: names.get(m.member_id) ?? null })),
      total,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
