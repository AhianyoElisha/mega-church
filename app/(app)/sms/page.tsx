'use client'

// Bulk SMS — templates, sending, and what actually went out.
//
// Two audiences, one screen, because the mechanics are identical: a birthday
// message and a tithe thank-you are both "render a template per member and
// hand it to mNotify". What differs is WHO triggers them — birthdays go out
// automatically on the morning of, tithe is an admin ticking the people who
// paid — and that difference is in the copy, not in a second implementation.

import { useMemo, useState } from 'react'
import {
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import Input from '@/shared/Input'
import Select from '@/shared/Select'
import Avatar from '@/shared/Avatar'
import { Badge } from '@/shared/Badge'
import { Checkbox } from '@/shared/Checkbox'
import {
  Banner,
  Card,
  EmptyState,
  LoadingRow,
  PageHeader,
  PageWrap,
  TabBar,
} from '@/components/ui'
import TemplateEditor from '@/components/template-editor'
import { useDialog } from '@/components/dialog'
import {
  useCreateTemplate,
  useDeleteTemplate,
  useSendSms,
  useSmsBalance,
  useSmsLog,
  useSmsTemplates,
  useUpdateTemplate,
} from '@/lib/queries/sms'
import { useMembers } from '@/lib/queries/members'
import { memberPhotoUrl } from '@/lib/members/photo'
import { fullName, initials } from '@/lib/members/types'
import { countParts, render } from '@/lib/sms/render'
import { sendableCategories } from '@/lib/sms/permissions'
import { useAuth } from '@/components/auth'
import {
  CHURCH_TIMEZONE,
  SMS_CATEGORIES,
  SMS_CATEGORY_LABEL,
  type SmsCategory,
} from '@/lib/appwrite/config'
import type { SmsTemplate } from '@/lib/sms/types'

type Tab = 'send' | 'templates' | 'log'

/**
 * The categories this screen sends BY HAND.
 *
 * `birthday` is deliberately absent even for an admin: it goes out from the
 * nightly run, which is idempotent per member per day. Sending one from here
 * would write a `birthday:<member>:<today>` dedupe key and silently suppress
 * the real message that morning.
 */
const MANUAL_CATEGORIES: readonly SmsCategory[] = ['tithe', 'general']

const MANUAL_CATEGORY_LABEL: Record<SmsCategory, string> = {
  birthday: 'Birthday',
  tithe: 'Tithe — thank somebody who paid',
  general: 'General — anything else',
}

/**
 * "25 Aug 2026, 08:00" on the church's clock, from the stored ISO instant.
 *
 * `sent_at` is written as `new Date().toISOString()`, and this line used to
 * render that string verbatim: `2026-08-25T08:00:12.345Z`. That is a format for
 * a parser, on a screen an admin reads to answer "did this morning's birthday
 * texts actually go out?" — the milliseconds and the `Z` are noise they have to
 * read past to reach the one field that matters.
 *
 * The zone is pinned to `CHURCH_TIMEZONE` rather than left to the browser, for
 * the same reason every other timestamp in the app pins it: the answer must be
 * the church's wall clock whatever the machine reading it is set to. Accra is
 * GMT+0 all year, so today this agrees with the raw value — which is exactly
 * why leaving the zone implicit would go unnoticed until somebody opened the
 * log on a laptop still set to another country.
 *
 * Falls back to the raw string rather than a dash: an unreadable timestamp on a
 * log line still beats no timestamp.
 */
function sentAtLabel(iso: string): string {
  if (!iso) return 'unknown time'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: CHURCH_TIMEZONE,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export default function SmsPage() {
  const [tab, setTab] = useState<Tab>('send')
  const templates = useSmsTemplates()
  const config = templates.data?.ok ? templates.data.config : null
  const { user } = useAuth()
  // Writing a template is composing in the church's voice, and every template
  // route below GET is admin-only. Offering the tab to a treasurer would be
  // offering a screen whose every button answers 403.
  const canEditTemplates = user?.label === 'admin'

  return (
    <PageWrap>
      <PageHeader
        title="Messages"
        subtitle="Birthday wishes go out on their own. Tithe thank-yous are sent from here."
      />

      {/* Said once, at the top, and shown before any Send button is offered.
          The half-configured state is the dangerous one: mNotify ACCEPTS a
          message with an unapproved sender ID and then silently never delivers
          it, so "it said it sent" is not evidence of anything. */}
      {config && !config.configured && (
        <Banner tone="warning" className="mb-6">
          <p className="font-semibold">SMS is not set up yet.</p>
          <p className="mt-1">{config.reason}</p>
        </Banner>
      )}

      {config?.configured && <CreditBalance />}

      <TabBar
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'send' as Tab, label: 'Send a message' },
          ...(canEditTemplates ? [{ value: 'templates' as Tab, label: 'Templates' }] : []),
          { value: 'log' as Tab, label: 'Sent messages' },
        ]}
      />

      {tab === 'send' && <SendTab canSend={config?.configured ?? false} />}
      {tab === 'templates' && canEditTemplates && <TemplatesTab />}
      {tab === 'log' && <LogTab />}
    </PageWrap>
  )
}

/**
 * What is left in the mNotify account.
 *
 * Shown at all times rather than only when low, because a number that appears
 * only in an emergency is a number nobody has learned to read. When it drops
 * below the threshold it escalates to the same warning Banner the
 * misconfiguration uses — the church has one visual language for "this will
 * stop working soon".
 *
 * A failed lookup says so plainly and does not hide the Send button: not
 * knowing the balance is not a reason to stop sending.
 */
function CreditBalance() {
  const { data, isLoading } = useSmsBalance()
  if (isLoading || !data?.ok) return null

  const { balance, low_at } = data
  if (balance.kind === 'not_configured') return null

  if (balance.kind === 'unknown') {
    return (
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        Credit balance unavailable — {balance.reason}
      </p>
    )
  }

  const figure = (
    <>
      <strong>{balance.credits.toLocaleString()}</strong> credits
      {balance.bonus ? ` (plus ${balance.bonus.toLocaleString()} bonus)` : ''}
    </>
  )

  if (balance.low) {
    return (
      <Banner tone="warning" className="mb-6">
        <p className="font-semibold">The mNotify account is running low.</p>
        <p className="mt-1">
          {figure} left, below the {low_at} this app warns at. Top up before the next
          bulk send — a send that runs out part-way delivers to some members and
          not others, and there is no way to tell which from here.
        </p>
      </Banner>
    )
  }

  return (
    <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
      mNotify balance: {figure}.
    </p>
  )
}

// --- send -------------------------------------------------------------------

function SendTab({ canSend }: { canSend: boolean }) {
  const { user } = useAuth()
  /**
   * What this account may actually send, intersected with what the manual
   * screen offers at all — `birthday` is sent by the nightly run, never by
   * hand, so it is not in the second list even for an admin.
   *
   * Read from the same map the SERVER checks (`canSendSmsCategory`), so a
   * choice on screen and a choice the route accepts cannot drift apart. The
   * failure that prevents is a Send button that 403s after it is pressed.
   */
  const offered = MANUAL_CATEGORIES.filter((c) => sendableCategories(user?.label).includes(c))
  // Tithe first: it is the reason this tab exists. Birthday is absent from the
  // picker on purpose — those send themselves, and offering a manual birthday
  // blast beside them invites somebody to send the same wishes twice.
  const [category, setCategory] = useState<SmsCategory>('tithe')
  const [templateId, setTemplateId] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const templates = useSmsTemplates(category)
  const members = useMembers({ status: 'active' })
  const send = useSendSms()
  const balance = useSmsBalance()
  const { confirm } = useDialog()

  const available = templates.data?.ok ? templates.data.templates : []
  const template =
    available.find((t) => t.$id === templateId) ?? available.find((t) => t.is_default) ?? null

  const all = useMemo(() => (members.data?.ok ? members.data.members : []), [members.data])
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (m) => fullName(m).toLowerCase().includes(q) || m.call_number.includes(q),
    )
  }, [all, search])

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // The cost, before the send, in credits rather than in members — those are
  // different numbers the moment a template runs past one part.
  const cost = useMemo(() => {
    if (!template) return null
    const sample = all.find((m) => picked.has(m.$id))
    if (!sample) return null
    const rendered = render(template.body, sample)
    if (!rendered.ok) return null
    const parts = countParts(rendered.text).parts
    return { parts, credits: parts * picked.size, preview: rendered.text }
  }, [template, all, picked])

  /**
   * Whether this specific send would outrun the balance.
   *
   * This is the moment the warning is actually worth something: the cost is
   * known, the balance is known, and nothing has been spent yet. A banner at
   * the top of the page says the account is low; this says THIS send will not
   * complete, which is a different and more useful sentence.
   *
   * Null whenever either number is unknown — an unavailable balance must not
   * manufacture a shortfall that stops a send from going out.
   */
  const shortfall = useMemo(() => {
    const b = balance.data?.ok ? balance.data.balance : null
    if (!b || b.kind !== 'known' || !cost) return null
    if (cost.credits <= b.credits) return null
    return { have: b.credits }
  }, [balance.data, cost])

  const submit = async () => {
    if (!template || picked.size === 0) return
    setError(null)
    setResult(null)

    const ok = await confirm({
      title: `Send to ${picked.size} member${picked.size === 1 ? '' : 's'}?`,
      message: (
        <>
          Using <strong>{template.name}</strong>.
          {cost && (
            <>
              {' '}
              At {cost.parts} part{cost.parts === 1 ? '' : 's'} each that is{' '}
              <strong>{cost.credits} SMS credits</strong>.
            </>
          )}{' '}
          {shortfall && (
            <>
              <strong>
                That is more than the {shortfall.have.toLocaleString()} credits left in the
                mNotify account.
              </strong>{' '}
              Some of these members will not receive anything, and the log cannot
              say in advance which. Top up first.{' '}
            </>
          )}
          Messages cannot be recalled once sent.
        </>
      ),
      confirmText: 'Send now',
    })
    if (!ok) return

    const res = await send.mutateAsync({
      member_ids: [...picked],
      template_id: template.$id,
      category,
    })
    if (!res.ok) {
      setError(res.error)
      return
    }
    const bits = [`${res.sent} sent`]
    if (res.failed) bits.push(`${res.failed} failed`)
    if (res.skipped) bits.push(`${res.skipped} already had one today`)
    if (res.no_phone.length) bits.push(`no usable number for ${res.no_phone.join(', ')}`)
    // mNotify's own figure, from the send response itself — the most current
    // reading there is, and it cost nothing to obtain.
    if (res.credit_left !== null) bits.push(`${res.credit_left.toLocaleString()} credits left`)
    setResult(bits.join(' · '))
    setPicked(new Set())
  }

  return (
    /*
      `grid-cols-1` rather than a bare `grid`, on every wrapper on this page.

      An implicit column is sized `minmax(min-content, auto)`, so the widest
      card sets a floor the column cannot go below. On a phone that floor was a
      member row — a full name beside a `+233…` number — 407px of min-content
      inside a 343px container. The card could not shrink to fit, so the whole
      PAGE scrolled sideways by 33px, on the one tab an admin uses to choose
      who gets texted.

      Tailwind's `grid-cols-1` is `repeat(1, minmax(0, 1fr))`, and the `0` is
      the entire fix: the track is allowed to be narrower than its content,
      which is what lets the `truncate` already on those rows do its job. Above
      `sm` nothing changes, because there was room all along — which is exactly
      why this was invisible on the screen it was built on.
    */
    <div className="grid grid-cols-1 gap-6">
      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Kind of message
            </label>
            {offered.length > 1 ? (
              <Select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as SmsCategory)
                  setTemplateId('')
                }}
              >
                {offered.map((c) => (
                  <option key={c} value={c}>
                    {MANUAL_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            ) : (
              // A statement, not a disabled <Select> — the same choice the
              // head's constituency field makes. A greyed-out dropdown reads as
              // "this is broken"; a sentence reads as "this is settled".
              <div className="rounded-xl bg-neutral-50 px-4 py-3 ring-1 ring-neutral-900/5 dark:bg-neutral-900/40 dark:ring-white/10">
                <p className="text-sm font-medium text-neutral-950 dark:text-white">
                  {MANUAL_CATEGORY_LABEL[offered[0] ?? 'tithe']}
                </p>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                  This account sends tithe messages. Everything else is an
                  administrator&rsquo;s to send.
                </p>
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Message
            </label>
            <Select
              value={template?.$id ?? ''}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={available.length === 0}
            >
              {available.length === 0 && <option value="">No {category} templates yet</option>}
              {available.map((t) => (
                <option key={t.$id} value={t.$id}>
                  {t.name}
                  {t.is_default && ' — standard'}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {available.length === 0 && (
          <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
            Write one on the <strong>Templates</strong> tab first — a message has to exist before
            it can be sent.
          </p>
        )}

        {template && (
          <div className="mt-4 rounded-xl bg-neutral-50 p-4 dark:bg-neutral-900/40">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {cost ? 'What the first person you ticked receives' : 'Preview'}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm text-neutral-950 dark:text-white">
              {cost?.preview ?? render(template.body, { first_name: 'Ama', last_name: 'Serwaa' }).ok
                ? cost?.preview ??
                  (render(template.body, { first_name: 'Ama', last_name: 'Serwaa' }) as { text: string })
                    .text
                : template.body}
            </p>
          </div>
        )}
      </Card>

      <Card padded={false}>
        {/*
          Stacks on a phone.

          The search box was a fixed `w-64` inside a row with no `flex-wrap`,
          next to two buttons. 256px of input plus "Select these (99)" plus
          "Clear" does not fit in the ~296px a 360px screen leaves after the
          page and card padding, and an unwrappable flex row does not fold —
          it overflows, taking the whole page into a horizontal scroll. The
          outer row wrapped, which is why this looked fine on the tab that was
          being tested and not on the one that mattered.

          It was one of two causes, and fixing it alone left the page still
          scrolling: the other is the grid track above.
        */}
        <div className="flex flex-col gap-3 border-b border-neutral-200 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between dark:border-neutral-800">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search by name or number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-64"
            />
            <Button plain onClick={() => setPicked(new Set(visible.map((m) => m.$id)))}>
              Select these ({visible.length})
            </Button>
            {picked.size > 0 && (
              <Button plain onClick={() => setPicked(new Set())}>
                Clear
              </Button>
            )}
          </div>
          <Button
            color="primary"
            className="w-full sm:w-auto"
            onClick={submit}
            disabled={!canSend || !template || picked.size === 0 || send.isPending}
          >
            <PaperAirplaneIcon data-slot="icon" />
            {send.isPending
              ? 'Sending…'
              : `Send to ${picked.size} member${picked.size === 1 ? '' : 's'}`}
          </Button>
        </div>

        {error && (
          <div className="p-4">
            <Banner tone="error">{error}</Banner>
          </div>
        )}
        {result && (
          <div className="p-4">
            <Banner tone="success" onDismiss={() => setResult(null)}>
              {result}
            </Banner>
          </div>
        )}

        {members.isLoading ? (
          <LoadingRow />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={ChatBubbleLeftRightIcon}
            title="Nobody matches"
            message="Try a different name or number."
          />
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {visible.map((m) => (
              <li key={m.$id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900/40">
                  <Checkbox checked={picked.has(m.$id)} onChange={() => toggle(m.$id)} />
                  <Avatar
                    src={memberPhotoUrl(m.photo_file_id)}
                    initials={initials(m)}
                    className="size-9"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-neutral-950 dark:text-white">
                      {fullName(m)}
                    </span>
                    <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {m.whatsapp_number || m.call_number}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// --- templates --------------------------------------------------------------

function TemplatesTab() {
  const [category, setCategory] = useState<SmsCategory>('birthday')
  const [editing, setEditing] = useState<SmsTemplate | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const templates = useSmsTemplates(category)
  const create = useCreateTemplate()
  const update = useUpdateTemplate()
  const remove = useDeleteTemplate()
  const { confirm } = useDialog()

  const list = templates.data?.ok ? templates.data.templates : []

  const handleDelete = async (t: SmsTemplate) => {
    const ok = await confirm({
      title: `Delete "${t.name}"?`,
      message: t.is_default ? (
        <>
          This is the standard {t.category} message. Another template will be promoted to take its
          place — a category with no standard message is one the automatic birthday run cannot
          send from.
        </>
      ) : (
        <>Messages already sent with it are kept, with their wording, in Sent messages.</>
      ),
      confirmText: 'Delete template',
      tone: 'danger',
    })
    if (!ok) return
    const res = await remove.mutateAsync({ id: t.$id })
    if (!res.ok) setError(res.error ?? 'Could not delete that template.')
  }

  return (
    // `grid-cols-1`, not `grid` — see the note in SendTab.
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabBar
          value={category}
          onChange={(c) => {
            setCategory(c)
            setEditing(null)
            setAdding(false)
          }}
          tabs={SMS_CATEGORIES.map((c) => ({ value: c, label: SMS_CATEGORY_LABEL[c] }))}
        />
        {!adding && !editing && (
          <Button color="primary" onClick={() => setAdding(true)}>
            <PlusIcon data-slot="icon" />
            New {SMS_CATEGORY_LABEL[category].toLowerCase()} template
          </Button>
        )}
      </div>

      {category === 'birthday' && (
        <Banner tone="info">
          These send themselves. Every morning the system texts anyone whose birthday is that day —
          each member gets their own message if one is set on their profile, otherwise the standard
          one. The <strong>celebrations team</strong> is told separately, by notification, the day
          before, so there is still time to make a flyer.
        </Banner>
      )}

      {error && <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner>}

      {(adding || editing) && (
        <Card>
          <h2 className="mb-4 text-base font-semibold text-neutral-950 dark:text-white">
            {editing ? `Edit "${editing.name}"` : `New ${category} template`}
          </h2>
          <TemplateEditor
            category={category}
            existing={editing ?? undefined}
            busy={create.isPending || update.isPending}
            onCancel={() => {
              setAdding(false)
              setEditing(null)
            }}
            onSave={async (values) => {
              const res = editing
                ? await update.mutateAsync({ id: editing.$id, ...values })
                : await create.mutateAsync({ ...values, category })
              if (!res.ok) throw new Error(res.error)
              setAdding(false)
              setEditing(null)
            }}
          />
        </Card>
      )}

      {templates.isLoading ? (
        <Card padded={false}>
          <LoadingRow />
        </Card>
      ) : list.length === 0 ? (
        <EmptyState
          icon={ChatBubbleLeftRightIcon}
          title={`No ${SMS_CATEGORY_LABEL[category].toLowerCase()} templates yet`}
          message="Write one so the same message does not have to be typed out every time."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {list.map((t) => {
            const preview = render(t.body, { first_name: 'Ama', last_name: 'Serwaa' })
            const parts = countParts(preview.ok ? preview.text : t.body)
            return (
              <Card key={t.$id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* Wraps: the name is free text, and "Standard" and the
                        part count sit beside it. A long name pushed both
                        badges off the card on a phone. */}
                    <h3 className="flex flex-wrap items-center gap-2 wrap-anywhere text-sm font-semibold text-neutral-950 dark:text-white">
                      {t.name}
                      {t.is_default && <Badge color="lime">Standard</Badge>}
                      <Badge color={parts.parts > 1 ? 'amber' : 'zinc'}>
                        {parts.parts} part{parts.parts === 1 ? '' : 's'}
                      </Badge>
                    </h3>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-600 dark:text-neutral-400">
                      {preview.ok ? preview.text : t.body}
                    </p>
                  </div>
                  {/* `shrink-0` with no wrap meant three buttons that would
                      not fold and would not shrink. They wrap now. */}
                  <div className="flex flex-wrap gap-2">
                    {!t.is_default && (
                      <Button
                        plain
                        onClick={() => update.mutate({ id: t.$id, is_default: true })}
                        disabled={update.isPending}
                      >
                        Make standard
                      </Button>
                    )}
                    <Button plain onClick={() => setEditing(t)}>
                      Edit
                    </Button>
                    <Button plain onClick={() => handleDelete(t)} disabled={remove.isPending}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- log --------------------------------------------------------------------

function LogTab() {
  const [category, setCategory] = useState<SmsCategory | ''>('')
  const log = useSmsLog(category || undefined)
  const messages = log.data?.ok ? log.data.messages : []

  return (
    // `grid-cols-1`, not `grid` — see the note in SendTab.
    <div className="grid grid-cols-1 gap-6">
      <div className="max-w-xs">
        <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Show
        </label>
        <Select value={category} onChange={(e) => setCategory(e.target.value as SmsCategory | '')}>
          <option value="">Everything</option>
          {SMS_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {SMS_CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
      </div>

      {log.isLoading ? (
        <Card padded={false}>
          <LoadingRow />
        </Card>
      ) : messages.length === 0 ? (
        <EmptyState
          icon={ChatBubbleLeftRightIcon}
          title="Nothing sent yet"
          message="Messages appear here as soon as any go out, successful or not."
        />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {messages.map((m) => (
              <li key={m.$id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-neutral-950 dark:text-white">
                    {m.member_name ?? 'A member who has since been removed'}
                    <span className="ml-2 font-normal text-neutral-500 dark:text-neutral-400">
                      {m.phone}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge color="zinc">{SMS_CATEGORY_LABEL[m.category]}</Badge>
                    <Badge color={m.status === 'sent' ? 'lime' : 'red'}>
                      {m.status === 'sent' ? 'Sent' : 'Failed'}
                    </Badge>
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-600 dark:text-neutral-400">
                  {m.body}
                </p>
                <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                  {sentAtLabel(m.sent_at)} · {m.sent_by ?? 'unknown'}
                  {/* mNotify's own words, kept verbatim — a paraphrase is what
                      makes a support conversation with the provider impossible. */}
                  {m.status === 'failed' && m.provider_message && ` · ${m.provider_message}`}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
