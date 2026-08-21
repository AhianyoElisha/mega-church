import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import {
  deleteTemplate,
  getTemplate,
  templateNameTaken,
  updateTemplate,
} from '@/lib/sms/server'
import { PLACEHOLDERS, unknownPlaceholders } from '@/lib/sms/render'
import type { TemplateResponse } from '@/lib/sms/types'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  let body: { name?: unknown; body?: unknown; is_default?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return bad('Send a JSON body.')
  }

  const { databases } = createAdminClient()
  const existing = await getTemplate(databases, id)
  if (!existing) return bad('No such template.', 404)

  const fields: { name?: string; body?: string; is_default?: boolean } = {}

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length < 2) {
      return bad('Give the template a name.')
    }
    const clash = await templateNameTaken(databases, existing.category, body.name, id)
    if (clash) {
      return bad(`There is already a ${existing.category} template called "${clash.name}".`)
    }
    fields.name = body.name
  }

  if (body.body !== undefined) {
    if (typeof body.body !== 'string' || body.body.trim().length === 0) {
      return bad('A template needs a message.')
    }
    if (body.body.length > 1024) return bad('That message is longer than 1024 characters.')
    const unknown = unknownPlaceholders(body.body)
    if (unknown.length > 0) {
      return bad(
        `${unknown.map((u) => `{{${u}}}`).join(', ')} is not a placeholder the system knows. ` +
          `Use one of: ${PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}.`,
      )
    }
    fields.body = body.body
  }

  if (body.is_default !== undefined) {
    if (body.is_default !== true) {
      // Un-ticking the default would leave the category with none, and the
      // automatic birthday run would then have nothing to reach for on a
      // morning nobody is watching. Making a DIFFERENT template the default is
      // the supported way to change it.
      return bad(
        'A category always has a default. Make another template the default instead of ' +
          'clearing this one.',
      )
    }
    fields.is_default = true
  }

  if (Object.keys(fields).length === 0) return bad('Nothing to change.')

  const template = await updateTemplate(databases, id, fields)
  return NextResponse.json<TemplateResponse>({ ok: true, template })
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const { id } = await params
  const { databases } = createAdminClient()
  const existing = await getTemplate(databases, id)
  if (!existing) return bad('No such template.', 404)

  await deleteTemplate(databases, id)
  return NextResponse.json({ ok: true })
}

function bad(error: string, status = 400) {
  return NextResponse.json<TemplateResponse>({ ok: false, error }, { status })
}
