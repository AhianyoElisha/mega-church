'use client'

// Registration / edit form. Every field in PRD §1.1, built from PickLT's
// fieldset primitives so it matches the rest of the product exactly.

import { useMemo, useState } from 'react'
import { Button } from '@/shared/Button'
import { Checkbox, CheckboxField } from '@/shared/Checkbox'
import { Description, ErrorMessage, Field, FieldGroup, Fieldset, Label, Legend } from '@/shared/fieldset'
import Input from '@/shared/Input'
import Select from '@/shared/Select'
import Textarea from '@/shared/Textarea'
import { useBacentas, useBasontas, useConstituencies } from '@/lib/queries/groups'
import { useSmsTemplates } from '@/lib/queries/sms'
import { buildBasontaTree } from '@/lib/groups/tree'
import type { Member, MemberInput } from '@/lib/members/types'
import { MEMBER_TITLES, TITLES, isMemberTitle } from '@/lib/members/titles'

/**
 * The form a constituency HEAD fills in, expressed as what they are NOT asked.
 *
 * Not a second form and not a read-only copy — the same component, so a field
 * added for an admin cannot silently go missing for a head. What is withheld is
 * withheld because the head has no basis for the answer, and every one of these
 * is ALSO enforced in `POST /api/members`; hiding a control is not security
 * (PRD §2.5).
 *
 *   constituency  shown as a fact rather than a choice. They are registering
 *                 into the group whose page they came from, and offering the
 *                 full list would offer neighbours' constituencies they would
 *                 then be refused for picking.
 *   bacentas      only the ones they head, and the whole section disappears
 *                 when they head none — which is the common case, since most
 *                 constituency heads run no choir.
 *   status        an `inactive` member is invisible to the scanner. Not a
 *                 registration-desk decision.
 *   birthday      picks which text the church sends, in the church's voice and
 *                 at its cost. `/api/sms/*` refuses a leader outright.
 */
export type MemberFormRestriction = {
  constituency: { id: string; name: string }
  basontas: { $id: string; name: string; category_name: string | null }[]
  /**
   * This head runs the member's OWN constituency, so `status`, `bacenta_id`
   * and the birthday template are theirs to set after all.
   *
   * A restriction with a raised floor rather than a second component. The head
   * is still fixed to one constituency and still ticks only the basontas they
   * head — those never open — so the alternative was a near-copy of this form
   * differing in three controls, and two forms drift.
   *
   * It is a claim about the CALLER, so only a page that knows both the member's
   * constituency and the head's own groups may set it, and the server does not
   * take its word for anything: `headEditScope` re-derives the same fact from
   * `leaderScope` and refuses each field by name (PRD §2.5).
   */
  elevated?: boolean
}

type BasontaSection = {
  key: string
  /** Null renders the ticks with no heading above them. */
  heading: string | null
  items: { id: string; name: string }[]
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** 29 February is a real birthday — there is no year here to invalidate it. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export type MemberFormValues = MemberInput

export default function MemberForm({
  initial,
  initialBasontaIds,
  restrict,
  submitLabel,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Member
  /** Which bacentas this member already serves in, when editing. */
  initialBasontaIds?: string[]
  /** Set when a group head is filling this in. Omitted ⇒ the admin form. */
  restrict?: MemberFormRestriction
  submitLabel: string
  submitting?: boolean
  error?: string | null
  onSubmit: (values: MemberFormValues) => void
  onCancel?: () => void
}) {
  const [title, setTitle] = useState<string>(initial?.title ?? '')
  const [first, setFirst] = useState(initial?.first_name ?? '')
  const [last, setLast] = useState(initial?.last_name ?? '')
  const [other, setOther] = useState(initial?.other_names ?? '')
  const [month, setMonth] = useState(initial?.birth_month ? String(initial.birth_month) : '')
  const [day, setDay] = useState(initial?.birth_day ? String(initial.birth_day) : '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [call, setCall] = useState(initial?.call_number ?? '')
  const [whatsapp, setWhatsapp] = useState(initial?.whatsapp_number ?? '')
  const [homeService, setHomeService] = useState(initial?.home_service ?? 'second')
  const [status, setStatus] = useState(initial?.status ?? 'active')
  const [constituency, setConstituency] = useState(
    restrict?.constituency.id ?? initial?.constituency_id ?? '',
  )
  const [smsTemplate, setSmsTemplate] = useState(initial?.sms_template_id ?? '')
  const [benmpPartner, setBenmpPartner] = useState(initial?.benmp_partner ?? false)
  const [bacenta, setBacenta] = useState(initial?.bacenta_id ?? '')
  const [basontas, setBasontas] = useState<Set<string>>(new Set(initialBasontaIds ?? []))
  const [localError, setLocalError] = useState<string | null>(null)

  // All three of these are admin-only endpoints. A head must not fire any of
  // them: the 403 would cache as an error and put a failure on their screen
  // that has nothing to do with anything they did.
  const restricted = !!restrict
  /**
   * A head editing somebody in a constituency they run.
   *
   * `restricted && elevated` is a real combination and the interesting one: the
   * constituency stays a fact and the basonta ticks stay narrowed, while the
   * three formerly admin-only controls appear.
   */
  const elevated = !!restrict?.elevated
  const constituencyQuery = useConstituencies({ enabled: !restricted })
  // Both of these now serve a leader too — `/api/sms/templates` GET and
  // `/api/bacentas` GET admit one, the latter narrowed server-side to the
  // places inside constituencies they head. Still not fired for a head who is
  // NOT elevated: the 403 would cache as an error and put a failure on their
  // screen that has nothing to do with anything they did.
  const birthdayTemplates = useSmsTemplates('birthday', { enabled: !restricted || elevated })
  const basontaQuery = useBasontas({ enabled: !restricted })
  const bacentaQuery = useBacentas({ enabled: !restricted || elevated })

  const constituencies = constituencyQuery.data?.ok
    ? constituencyQuery.data.constituencies
    : []

  /**
   * The tick-list, from whichever source this form has.
   *
   * For an admin it is the same tree the bacentas page renders, so the choices
   * are grouped exactly as they arranged them: choirs under Choir, Technical
   * Team on its own. Orphans are included rather than hidden — a bacenta with
   * real members in it must remain pickable even if its category was deleted.
   *
   * For a head it is just the bacentas they run, grouped by the category name
   * that came with them. One shape either way, so the markup below does not
   * fork on who is looking at it.
   */
  const basontaSections = useMemo<BasontaSection[] | null>(() => {
    if (restrict) {
      const byHeading = new Map<string, BasontaSection>()
      for (const b of restrict.basontas) {
        const heading = b.category_name ?? 'Other'
        const section = byHeading.get(heading)
        const item = { id: b.$id, name: b.name }
        if (section) section.items.push(item)
        else byHeading.set(heading, { key: heading, heading, items: [item] })
      }
      return [...byHeading.values()]
    }

    if (!basontaQuery.data?.ok) return null
    const tree = buildBasontaTree(basontaQuery.data.categories, basontaQuery.data.basontas)
    const sections: BasontaSection[] = tree.categories
      // An empty category is worth keeping on the basontas page (it is about to
      // be filled) but not here, where it would be a heading with nothing to
      // tick under it.
      .filter((group) => group.basontas.length > 0)
      .map((group) => ({
        key: group.category.$id,
        heading: group.category.name,
        items: group.basontas.map((b) => ({ id: b.$id, name: b.name })),
      }))
    if (tree.standalone.length > 0) {
      sections.push({
        key: 'standalone',
        heading: 'Other',
        items: tree.standalone.map((b) => ({ id: b.$id, name: b.name })),
      })
    }
    if (tree.orphans.length > 0) {
      sections.push({
        key: 'orphans',
        heading: null,
        items: tree.orphans.map((b) => ({ id: b.$id, name: `${b.name} (category missing)` })),
      })
    }
    return sections
  }, [restrict, basontaQuery.data])

  const toggleBasonta = (id: string) => {
    setBasontas((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const maxDay = month ? DAYS_IN_MONTH[Number(month) - 1] : 31

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (!first.trim() || !last.trim()) {
      setLocalError('First and last name are both required.')
      return
    }
    if (!call.trim()) {
      setLocalError('A call number is required.')
      return
    }
    // Half a birthday is not useful and would render as a broken date.
    if ((month && !day) || (!month && day)) {
      setLocalError('Choose both the birth month and the day, or leave both blank.')
      return
    }

    onSubmit({
      first_name: first.trim(),
      last_name: last.trim(),
      other_names: other.trim() || null,
      birth_month: month ? Number(month) : null,
      birth_day: day ? Number(day) : null,
      address: address.trim() || null,
      call_number: call.trim(),
      whatsapp_number: whatsapp.trim() || null,
      home_service: homeService,
      // '' is the "—" option, which means "not recorded", not a group id.
      constituency_id: constituency || null,
      // Always sent, including as `[]`. The route treats an absent key as
      // "leave bacentas alone" and an empty array as "clear them" — and this
      // form always knows the complete answer for this person, so it says so.
      basonta_ids: [...basontas],
      // Always sent, by a head as well as an admin: this form shows the tick
      // box to both, so it always knows the complete answer.
      benmp_partner: benmpPartner,
      // The two fields a head is not asked for are OMITTED rather than sent
      // with a made-up value. On create the server supplies `active` and the
      // standard birthday message; sending them from a form that never showed
      // them would be this component asserting an answer it does not have.
      // `bacenta_id` rides with the admin-only fields for the same reason
      // `constituency_id` is fixed for a head: where somebody LIVES is not a
      // registration-desk decision, and `headEditScope` refuses it by name.
      // Title rides with the elevated fields, not with the ordinary ones. A
      // head who cannot set it must not SEND it either: `headEditScope` refuses
      // the key's presence, so posting it unchanged would 403 an edit that only
      // touched a phone number.
      ...(restricted && !elevated
        ? {}
        : {
            // Narrowed at the boundary rather than cast. The <select> can only
            // produce valid codes, but the state is a string and the server
            // refuses an unknown one — so agree with it here.
            title: isMemberTitle(title) ? title : null,
            sms_template_id: smsTemplate || null,
            status,
            bacenta_id: bacenta || null,
          }),
    })
  }

  const shown = error ?? localError

  return (
    <form onSubmit={handleSubmit}>
      <Fieldset>
        <FieldGroup>
          <Legend>Name</Legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label>First name</Label>
              <Input value={first} onChange={(e) => setFirst(e.target.value)} autoFocus required />
            </Field>
            <Field>
              <Label>Last name</Label>
              <Input value={last} onChange={(e) => setLast(e.target.value)} required />
            </Field>
          </div>
          <Field>
            <Label>Other names</Label>
            <Input value={other} onChange={(e) => setOther(e.target.value)} />
            <Description>Middle or additional names, if any.</Description>
          </Field>
        </FieldGroup>

        <FieldGroup>
          <Legend>Contact</Legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label>Call number</Label>
              <Input
                type="tel"
                value={call}
                onChange={(e) => setCall(e.target.value)}
                placeholder="024 123 4567"
                required
              />
              <Description>Required. Stored as +233… so lookups work either way.</Description>
            </Field>
            <Field>
              <Label>WhatsApp number</Label>
              <Input
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="Leave blank if the same"
              />
              <Description>
                Optional, and kept separate from the call number on purpose — plenty of members
                use one number for both, but not everyone does.
              </Description>
            </Field>
          </div>
          <Field>
            <Label>Address</Label>
            <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </FieldGroup>

        <FieldGroup>
          <Legend>Birthday</Legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label>Month</Label>
              <Select
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value)
                  // Switching from March to February with 30 selected would
                  // otherwise leave an impossible day sitting in the field.
                  const limit = e.target.value ? DAYS_IN_MONTH[Number(e.target.value) - 1] : 31
                  if (day && Number(day) > limit) setDay('')
                }}
              >
                <option value="">—</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>Day</Label>
              <Select value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="">—</option>
                {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            The year is deliberately not collected.
          </p>
        </FieldGroup>

        <FieldGroup>
          <Legend>Membership</Legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label>Usual service</Label>
              <Select
                value={homeService}
                onChange={(e) => setHomeService(e.target.value as 'first' | 'second')}
              >
                <option value="first">First Service (Psalms Chapel)</option>
                <option value="second">Second Service</option>
              </Select>
              <Description>
                For your records only. Attendance is never restricted by this — anyone may be
                marked present at either service.
              </Description>
            </Field>
            {(!restricted || elevated) && (
              <Field>
                <Label>How they are addressed</Label>
                <Select value={title} onChange={(e) => setTitle(e.target.value)}>
                  <option value="">No title — addressed by first name</option>
                  <optgroup label="Ministry">
                    {MEMBER_TITLES.filter((t) => TITLES[t].group === 'ministry').map((t) => (
                      <option key={t} value={t}>
                        {TITLES[t].label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Courtesy">
                    {MEMBER_TITLES.filter((t) => TITLES[t].group === 'courtesy').map((t) => (
                      <option key={t} value={t}>
                        {TITLES[t].label}
                      </option>
                    ))}
                  </optgroup>
                </Select>
                <Description>
                  Used in bulk SMS, so a leader is addressed by their position and everybody
                  else by their first name. It never affects attendance, search or rosters.
                </Description>
              </Field>
            )}
            {(!restricted || elevated) && (
              <Field>
                <Label>Status</Label>
                <Select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
                <Description>An inactive member cannot be matched by a scanner.</Description>
              </Field>
            )}
          </div>

          {/*
            Shown to a head as well as an admin, unlike Status and the birthday
            message beside it. This records something the MEMBER said — that
            they partner with the campaign — and the head at the desk is the
            person they said it to. See the note in `headEditScope`.
          */}
          {/* `CheckboxField`, not a bare <label> around the control. A Headless
              UI checkbox renders a span with role="checkbox", so wrapping it in
              a plain label does NOT make the text toggle it — the tick box
              itself would be the only target, which on a phone is a 24px one.
              `Field` does the aria association properly. */}
          <CheckboxField className="mt-4">
            <Checkbox
              checked={benmpPartner}
              onChange={(v: boolean) => setBenmpPartner(v)}
              color="amber"
            />
            <Label>BENMP Partner</Label>
            <Description>
              Contributes monthly to the Global Healing Jesus Campaign, and is sent a reminder
              to renew. Tick only if they have actually signed up — this is what decides who
              the church texts.
            </Description>
          </CheckboxField>
        </FieldGroup>

        <FieldGroup>
          <Legend>Constituency</Legend>
          {restrict ? (
            <>
            {/* A statement, not a disabled <Select>. A greyed-out dropdown reads
                as "this is broken"; a sentence reads as "this is settled", which
                is what it is — they came here from that constituency's own page.
                The constituency stays a statement even when elevated: moving
                somebody OUT is refused to every head, elevated or not. */}
            <div className="rounded-xl bg-neutral-50 px-4 py-3 ring-1 ring-neutral-900/5 dark:bg-neutral-900/40 dark:ring-white/10">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Where they live</p>
              <p className="font-semibold text-neutral-950 dark:text-white">
                {restrict.constituency.name}
              </p>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                {initial
                  ? 'Moving a member to a different constituency is an administrator’s job. Everything else on this form you can change yourself.'
                  : 'You are registering into the constituency you head. To file somebody into a different one, ask an administrator.'}
              </p>
            </div>
            {elevated && (
              <Field className="mt-4">
                <Label>Bacenta</Label>
                <Select
                  value={bacenta}
                  onChange={(e) => setBacenta(e.target.value)}
                  disabled={bacentaQuery.isLoading}
                >
                  <option value="">— not in one yet —</option>
                  {(bacentaQuery.data?.ok ? bacentaQuery.data.bacentas : []).map((b) => (
                    <option key={b.$id} value={b.$id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
                <Description>
                  The place inside your constituency where they live. Only your own places are
                  listed. Moving somebody here TAKES THEM OUT of wherever they were — a member
                  lives in exactly one — and it releases whoever was looking after them.
                </Description>
              </Field>
            )}
            </>
          ) : (
            <>
              <Field>
                <Label>Where they live</Label>
                <Select
                  value={constituency}
                  onChange={(e) => setConstituency(e.target.value)}
                  disabled={constituencyQuery.isLoading}
                >
                  <option value="">— not recorded —</option>
                  {constituencies.map((c) => (
                    <option key={c.$id} value={c.$id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Description>
                  A member belongs to exactly one constituency. It can be left blank now and filled
                  in later from the constituency page, which assigns many members at once.
                </Description>
              </Field>
              {constituencies.length === 0 && !constituencyQuery.isLoading && (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  No constituencies have been created yet.
                </p>
              )}
              <Field>
                <Label>Bacenta</Label>
                <Select
                  value={bacenta}
                  onChange={(e) => setBacenta(e.target.value)}
                  disabled={bacentaQuery.isLoading}
                >
                  <option value="">— not in one yet —</option>
                  {(bacentaQuery.data?.ok ? bacentaQuery.data.bacentas : []).map((b) => (
                    <option key={b.$id} value={b.$id}>
                      {b.constituency_name ? `${b.name} · ${b.constituency_name}` : b.name}
                    </option>
                  ))}
                </Select>
                <Description>
                  The place inside their constituency. One bacenta per member, like the
                  constituency above — and like it, this never affects attendance. Who looks
                  after them is recorded on the bacenta&rsquo;s own page.
                </Description>
              </Field>
            </>
          )}
        </FieldGroup>

        {(!restricted || elevated) && (
          <FieldGroup>
            <Legend>Birthday message</Legend>
            <Field>
              <Label>What they are sent on their birthday</Label>
              <Select
                value={smsTemplate}
                onChange={(e) => setSmsTemplate(e.target.value)}
                disabled={birthdayTemplates.isLoading}
              >
                <option value="">The standard birthday message</option>
                {(birthdayTemplates.data?.ok ? birthdayTemplates.data.templates : [])
                  .filter((t) => !t.is_default)
                  .map((t) => (
                    <option key={t.$id} value={t.$id}>
                      {t.name}
                    </option>
                  ))}
              </Select>
              <Description>
                Not everybody is addressed the same way, so a member can be given their own
                wording. Leave this alone for almost everyone — the standard message is what they
                will get, and it is never &ldquo;send nothing&rdquo;.
              </Description>
            </Field>
          </FieldGroup>
        )}

        <FieldGroup>
          <Legend>Bacentas</Legend>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {restrict
              ? "The bacentas you head. Tick any this member also serves in — somebody can sing in two choirs and run the sound desk at the same time."
              : "The work groups this member serves in. Tick as many as apply — someone can sing in two choirs and run the sound desk at the same time."}
          </p>
          {restrict && initial && (
            // Said plainly, because the alternative reading of an unticked list
            // is "this member is in no other bacenta", and a head who believes
            // that will report the choir membership as missing.
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Only the bacentas you head are shown. If this member also serves in one you do
              not head, it stays exactly as it is — saving this form cannot remove them
              from it.
            </p>
          )}

          {basontaQuery.isLoading ? (
            <p className="text-sm text-neutral-400">Loading bacentas…</p>
          ) : !basontaSections || basontaSections.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {restrict
                ? "You do not head a bacenta, so there is none to put this member into. An administrator, or the head of the bacenta, can add them afterwards."
                : "No bacentas have been created yet."}
            </p>
          ) : (
            <div className="max-h-72 space-y-4 overflow-y-auto rounded-xl bg-neutral-50 p-4 ring-1 ring-neutral-900/5 dark:bg-neutral-900/40 dark:ring-white/10">
              {basontaSections.map((section) => (
                <div key={section.key}>
                  {section.heading && (
                    <p className="mb-1.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                      {section.heading}
                    </p>
                  )}
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {section.items.map((b) => (
                      <BacentaTick
                        key={b.id}
                        id={b.id}
                        name={b.name}
                        checked={basontas.has(b.id)}
                        onToggle={toggleBasonta}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </FieldGroup>

        {shown && (
          <div className="mt-6">
            <ErrorMessage>{shown}</ErrorMessage>
          </div>
        )}

        <div className="mt-8 flex gap-3">
          <Button type="submit" color="primary" disabled={submitting}>
            {submitting ? 'Saving…' : submitLabel}
          </Button>
          {onCancel && (
            <Button type="button" plain onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          )}
        </div>
      </Fieldset>
    </form>
  )
}

function BacentaTick({
  id,
  name,
  checked,
  onToggle,
}: {
  id: string
  name: string
  checked: boolean
  onToggle: (id: string) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white dark:hover:bg-neutral-800">
      <Checkbox checked={checked} onChange={() => onToggle(id)} color="amber" />
      <span className="truncate text-sm text-neutral-800 dark:text-neutral-200">{name}</span>
    </label>
  )
}
