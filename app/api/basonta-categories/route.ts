import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  createBasontaCategory,
  listBasontaCategories,
  validateGroupName,
} from '@/lib/groups/server'
import type { BasontaCategoryResponse } from '@/lib/groups/types'

/**
 * Basonta categories — the FAMILY a group of basontas belongs to: "Choir" over
 * Biazo, Living Waters and Fresh Oil.
 *
 * Creating a category is optional. A basonta with no category is the
 * standalone case ("Technical Team") and is created straight through
 * `/api/basontas` without ever touching this route.
 */
export async function GET() {
  const auth = await requireRole(['admin', 'usher', 'shepherd', 'treasurer'])
  if ('error' in auth) return auth.error

  const { databases } = createAdminClient()
  const categories = await listBasontaCategories(databases)
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
  const existing = await listBasontaCategories(databases)
  const name = validateGroupName(body.name, {
    taken: existing.map((c) => c.name),
    noun: 'category',
  })
  if (!name.ok) return bad(name.error)

  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 512) || null : null

  const category = await createBasontaCategory(
    databases,
    { name: name.value, description },
    auth.user.email,
  )
  return NextResponse.json<BasontaCategoryResponse>({ ok: true, category }, { status: 201 })
}

function bad(error: string, status = 400) {
  return NextResponse.json<BasontaCategoryResponse>({ ok: false, error }, { status })
}
