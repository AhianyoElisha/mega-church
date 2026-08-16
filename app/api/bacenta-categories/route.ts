import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { createCategory, listCategories, validateGroupName } from '@/lib/groups/server'
import type { BacentaCategoryResponse } from '@/lib/groups/types'

/**
 * Bacenta categories — the FAMILY a group of bacentas belongs to: "Choir" over
 * Biazo, Living Waters and Fresh Oil.
 *
 * Creating a category is optional. A bacenta with no category is the
 * standalone case ("Technical Team") and is created straight through
 * `/api/bacentas` without ever touching this route.
 */
export async function GET() {
  const auth = await requireRole(['admin', 'usher'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  const categories = await listCategories(databases)
  return NextResponse.json(
    { ok: true, categories },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function POST(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  let body: { name?: unknown; description?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return bad('Invalid request body.')
  }

  const { databases } = createAdminClient()
  const existing = await listCategories(databases)
  const name = validateGroupName(body.name, {
    taken: existing.map((c) => c.name),
    noun: 'category',
  })
  if (!name.ok) return bad(name.error)

  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 512) || null : null

  const category = await createCategory(databases, { name: name.value, description }, auth.user.email)
  return NextResponse.json<BacentaCategoryResponse>({ ok: true, category }, { status: 201 })
}

function bad(error: string, status = 400) {
  return NextResponse.json<BacentaCategoryResponse>({ ok: false, error }, { status })
}
