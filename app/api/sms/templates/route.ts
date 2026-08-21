import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, requireRole } from '@/lib/appwrite/server'
import { SMS_CATEGORIES, type SmsCategory } from '@/lib/appwrite/config'
import { createSmsService } from '@/lib/sms/mnotify'
import { createTemplate, listTemplates, templateNameTaken } from '@/lib/sms/server'
import { unknownPlaceholders, PLACEHOLDERS } from '@/lib/sms/render'
import type { ListTemplatesResponse, TemplateResponse } from '@/lib/sms/types'

function isCategory(v: unknown): v is SmsCategory {
  return typeof v === 'string' && (SMS_CATEGORIES as readonly string[]).includes(v)
}

/**
 * GET /api/sms/templates — every template, plus whether SMS can send at all.
 *
 * The config status rides along with the list so the page can say "SMS is not
 * set up" in the same render that draws the templates, rather than offering a
 * Send button that only fails once pressed. Same shape as the VAPID handling
 * on the birthdays page.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  const categoryRaw = request.nextUrl.searchParams.get('category')
  if (categoryRaw !== null && !isCategory(categoryRaw)) {
    return NextResponse.json<ListTemplatesResponse>(
      { ok: false, error: `category must be one of: ${SMS_CATEGORIES.join(', ')}.` },
      { status: 400 },
    )
  }

  const { databases } = createAdminClient()
  const templates = await listTemplates(databases, categoryRaw ?? undefined)
  return NextResponse.json<ListTemplatesResponse>(
    { ok: true, templates, config: createSmsService().status() },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function POST(request: NextRequest) {
  const auth = await requireRole('admin')
  if ('error' in auth) return auth.error

  let body: { name?: unknown; category?: unknown; body?: unknown; is_default?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return bad('Send a JSON body.')
  }

  if (typeof body.name !== 'string' || body.name.trim().length < 2) {
    return bad('Give the template a name.')
  }
  if (!isCategory(body.category)) {
    return bad(`category must be one of: ${SMS_CATEGORIES.join(', ')}.`)
  }
  if (typeof body.body !== 'string' || body.body.trim().length === 0) {
    return bad('A template needs a message.')
  }
  if (body.body.length > 1024) {
    return bad('That message is longer than 1024 characters.')
  }

  // Caught HERE rather than at send time. A template saved with `{{name}}` in
  // it looks fine in the list and then refuses on the celebrant's birthday
  // morning, which is the one moment nobody is watching the screen.
  const unknown = unknownPlaceholders(body.body)
  if (unknown.length > 0) {
    return bad(
      `${unknown.map((u) => `{{${u}}}`).join(', ')} is not a placeholder the system knows. ` +
        `Use one of: ${PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}.`,
    )
  }

  const { databases } = createAdminClient()
  const clash = await templateNameTaken(databases, body.category, body.name)
  if (clash) {
    return bad(`There is already a ${body.category} template called "${clash.name}".`)
  }

  const template = await createTemplate(
    databases,
    {
      name: body.name,
      category: body.category,
      body: body.body,
      is_default: body.is_default === true,
    },
    auth.user.email,
  )
  return NextResponse.json<TemplateResponse>({ ok: true, template }, { status: 201 })
}

function bad(error: string) {
  return NextResponse.json<TemplateResponse>({ ok: false, error }, { status: 400 })
}
