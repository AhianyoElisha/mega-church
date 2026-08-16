import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  deleteCategory,
  listCategories,
  updateCategory,
  validateGroupName,
} from '@/lib/groups/server'
import type { BacentaCategoryResponse } from '@/lib/groups/types'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  let body: { name?: unknown; description?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return bad('Invalid request body.')
  }

  const { databases } = createAdminClient()
  const fields: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const others = (await listCategories(databases)).filter((c) => c.$id !== id)
    const name = validateGroupName(body.name, {
      taken: others.map((c) => c.name),
      noun: 'category',
    })
    if (!name.ok) return bad(name.error)
    fields.name = name.value
  }
  if (body.description !== undefined) {
    fields.description =
      typeof body.description === 'string' ? body.description.trim().slice(0, 512) || null : null
  }
  if (Object.keys(fields).length === 0) return bad('Nothing to update.')

  try {
    const category = await updateCategory(databases, id, fields)
    return NextResponse.json<BacentaCategoryResponse>({ ok: true, category })
  } catch {
    return bad('No such category.', 404)
  }
}

/**
 * DELETE — refused while the category still holds bacentas.
 *
 * See `deleteCategory`: orphaning them would leave real groups full of real
 * people rendering as "category missing", and only the admin knows where those
 * bacentas ought to go instead.
 */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()
  const res = await deleteCategory(databases, id)
  if (!res.ok) return NextResponse.json(res, { status: 409 })
  return NextResponse.json({ ok: true })
}

function bad(error: string, status = 400) {
  return NextResponse.json<BacentaCategoryResponse>({ ok: false, error }, { status })
}
