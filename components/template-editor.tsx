'use client'

// Writing and editing an SMS template.
//
// The live part count is the point of this screen. The church is billed per
// PART, not per message: a birthday template that drifts past 160 characters
// costs twice what the one before it did, and nobody finds out until the
// mNotify balance runs down mid-Sunday. It counts with the same function the
// server sends with, so what is approved here is what is charged.

import { useMemo, useState } from 'react'
import { Button } from '@/shared/Button'
import Input from '@/shared/Input'
import Textarea from '@/shared/Textarea'
import { Description, Field, Label } from '@/shared/fieldset'
import { Badge } from '@/shared/Badge'
import { Banner } from '@/components/ui'
import { PLACEHOLDERS, PLACEHOLDER_HINT, countParts, render } from '@/lib/sms/render'
import type { SmsCategory } from '@/lib/appwrite/config'
import type { SmsTemplate } from '@/lib/sms/types'
import { MEMBER_TITLES, TITLES } from '@/lib/members/titles'

/** Previewed against a plausible member, not a blank one. "Happy birthday
 *  {{first_name}}" reads fine as a template and only shows its length once a
 *  real name is in it. */
/*
 * The preview member.
 *
 * Given a TITLE on purpose, so an author writing "Dear {{salutation}}," sees
 * what a leader receives rather than what an untitled member does. The
 * untitled rendering is the one that needs no checking — it is just the first
 * name — while the titled one is where the extra words and the extra cost are.
 */
/** The CODE of the longest title, for pricing. */
function longestTitleCode(): string {
  return MEMBER_TITLES.reduce((a, b) => (TITLES[b].label.length > TITLES[a].label.length ? b : a))
}

const SAMPLE = {
  first_name: 'Ama',
  last_name: 'Serwaa',
  other_names: null,
  title: 'reverend' as const,
}

/**
 * The same member wearing the LONGEST title the church has.
 *
 * The church is billed per 160-character part, and a title is prepended to a
 * name inside that budget. A template sitting at 150 characters is one part for
 * most of the congregation and two for anybody addressed "Lady Reverend" — the
 * same message, a different bill, discovered from the mNotify balance rather
 * than from this screen where it is still free to shorten.
 *
 * So the cost shown is the WORST case, not the sample's. Quoting a higher price
 * than you are charged is the safe direction to be wrong in, which is the rule
 * `isUnicode` already follows in the same file it comes from.
 */
const WORST_CASE = { ...SAMPLE, title: longestTitleCode() }

export default function TemplateEditor({
  category,
  existing,
  busy,
  onSave,
  onCancel,
}: {
  category: SmsCategory
  existing?: SmsTemplate
  busy?: boolean
  onSave: (values: { name: string; body: string; is_default: boolean }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [body, setBody] = useState(existing?.body ?? '')
  const [isDefault, setIsDefault] = useState(existing?.is_default ?? false)
  const [error, setError] = useState<string | null>(null)

  const preview = useMemo(() => render(body, SAMPLE), [body])
  // Priced against the longest title, not the previewed one — see WORST_CASE.
  const worst = useMemo(() => render(body, WORST_CASE), [body])
  const parts = useMemo(
    () => countParts(worst.ok ? worst.text : preview.ok ? preview.text : body),
    [worst, preview, body],
  )

  const insert = (token: string) => setBody((b) => `${b}{{${token}}}`)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!preview.ok) {
      setError(preview.error)
      return
    }
    try {
      await onSave({ name: name.trim(), body, is_default: isDefault })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that template.')
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <Field>
        <Label>Template name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Warm birthday"
          required
        />
        <Description>
          For the church, not the member — it never appears in the message. Two {category}{' '}
          templates cannot share a name, but the same name may be reused in another category.
        </Description>
      </Field>

      <Field>
        <Label>Message</Label>
        <Textarea
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Happy birthday {{first_name}}! The whole church is celebrating with you today. — {{church}}"
          required
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500 dark:text-neutral-400">Insert:</span>
          {PLACEHOLDERS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => insert(p)}
              title={PLACEHOLDER_HINT[p]}
              className="cursor-pointer rounded-lg border border-neutral-300 px-2 py-1 font-mono text-xs text-neutral-700 hover:border-primary-500 hover:text-primary-700 dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-primary-300"
            >
              {`{{${p}}}`}
            </button>
          ))}
        </div>
      </Field>

      {/* The preview and the cost, together. Separating them lets somebody
          approve wording without noticing it became a three-part message. */}
      <div className="rounded-xl bg-neutral-50 p-4 dark:bg-neutral-900/40">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            What Ama receives
          </span>
          <span className="flex items-center gap-2">
            <Badge color={parts.parts > 1 ? 'amber' : 'lime'}>
              {parts.parts} part{parts.parts === 1 ? '' : 's'}
            </Badge>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {parts.characters} characters
              {parts.unicode && ' · unicode, so 70 per part'}
            </span>
          </span>
        </div>
        <p className="whitespace-pre-wrap text-sm text-neutral-950 dark:text-white">
          {preview.ok ? preview.text || '—' : <span className="text-red-600">{preview.error}</span>}
        </p>
        {parts.parts > 1 && (
          <p className="mt-2 text-xs text-primary-700 dark:text-primary-300">
            Over one part, so each member costs {parts.parts} credits instead of one. That is a
            decision, not a mistake — just make it deliberately.
          </p>
        )}
      </div>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="mt-1 size-4 cursor-pointer accent-primary-500"
        />
        <span className="text-sm text-neutral-700 dark:text-neutral-300">
          Use this as the standard {category} message
          <span className="block text-xs text-neutral-500 dark:text-neutral-400">
            {category === 'birthday'
              ? 'The automatic birthday run sends this to anyone without their own message set.'
              : 'Pre-selected when sending, and used when nothing else is chosen.'}
          </span>
        </span>
      </label>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="flex gap-3">
        <Button type="submit" color="primary" disabled={busy || !preview.ok}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Create template'}
        </Button>
        <Button type="button" plain onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
