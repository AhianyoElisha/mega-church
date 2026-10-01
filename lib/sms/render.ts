// Turning a template into the words a member actually receives.
//
// Pure — no Appwrite, no `server-only`. The editor previews with this exact
// function and the sender sends with it, so what an admin approved on screen
// is byte-for-byte what leaves the building.

import {
  CHURCH_NAME,
  SMS_CONCAT_PART_LENGTH,
  SMS_PART_LENGTH,
  type SmsCategory,
} from '@/lib/appwrite/config'
import { titleLabel } from '@/lib/members/titles'

/** The subset of a member a message can address. Structural, so both the
 *  server's `Member` and a trimmed client shape satisfy it. */
export type Addressee = {
  first_name: string
  last_name: string
  other_names?: string | null
  /**
   * The stored title CODE (`'pastor'`), not the words. Optional, so every
   * existing caller keeps compiling and an untitled member is the default
   * rather than a special case.
   */
  title?: string | null
}

/**
 * Every placeholder a template may use.
 *
 * A closed set on purpose. An open one — "substitute any member field" —
 * would let a template reference `call_number` and text somebody their own
 * phone number, or reference a field that later gets renamed and silently
 * start rendering blanks.
 */
export const PLACEHOLDERS = [
  'first_name',
  'last_name',
  'other_names',
  'full_name',
  'salutation',
  'title_first_name',
  'titled_full_name',
  'church',
] as const

export type Placeholder = (typeof PLACEHOLDERS)[number]

/**
 * Placeholders that exist in ONE category only.
 *
 * `{{services_attended}}` is the whole list. It is not a member field — it is
 * a fact about one Sunday, computed from the attendance rows at 14:00 — so it
 * cannot live in `PLACEHOLDERS`, which every category shares. A birthday
 * template carrying it would have nothing to render and would fall into the
 * `{{title}}` failure: an empty substitution mailed to the congregation.
 *
 * So it is an EXTRA, handed to `render()` per member by the one route that
 * knows the answer, and `unknownPlaceholders(body, extrasForCategory(c))`
 * refuses it everywhere else at save time. The empty case is impossible to
 * express rather than merely discouraged, which is the same posture the
 * composed title placeholders take.
 */
export const CATEGORY_EXTRAS: Partial<Record<SmsCategory, readonly string[]>> = {
  attendance_thanks: ['services_attended'],
}

export type ExtraPlaceholder = 'services_attended'

/** The extra placeholders a template of this category may use. Empty for
 *  most categories, which is the point. */
export function extrasForCategory(category: SmsCategory): readonly string[] {
  return CATEGORY_EXTRAS[category] ?? []
}

export const PLACEHOLDER_HINT: Record<Placeholder | ExtraPlaceholder, string> = {
  first_name: 'Ama',
  last_name: 'Serwaa',
  other_names: 'middle names, or blank',
  full_name: 'Ama Serwaa',
  salutation: 'Reverend Serwaa — or just "Ama" for a member with no title',
  title_first_name: 'Reverend Ama — or just "Ama" for a member with no title',
  titled_full_name: 'Reverend Ama Serwaa — or just "Ama Serwaa"',
  church: CHURCH_NAME,
  services_attended:
    '"First Service", "Second Service" or "both First and Second Service" — ' +
    'thank-you messages only, filled in from the day\'s attendance',
}

/** The statuses `{{services_attended}}` has words for. A row with any other
 *  status is not an adult attendee and is never a thank-you target. */
export type ServicesAttended = 'first' | 'second' | 'both'

/**
 * The words `{{services_attended}}` renders to.
 *
 * "both First and Second Service" rather than "First and Second Service" so
 * the sentence "thank you for joining us at …" reads naturally either way.
 * Three wordings, one template: the church writes the thank-you once and the
 * attendance rows decide which a member receives.
 */
export function servicesAttendedText(status: ServicesAttended): string {
  switch (status) {
    case 'first':
      return 'First Service'
    case 'second':
      return 'Second Service'
    case 'both':
      return 'both First and Second Service'
  }
}

/**
 * Plausible extras for a PREVIEW of a template in this category.
 *
 * The editor and the seed script render against these so a thank-you template
 * previews as words rather than as a refusal. The longest wording is chosen
 * deliberately: the part count on screen is a price, and quoting high is the
 * safe direction (the same rule `isUnicode` and the title pricing follow).
 */
export function sampleExtras(category: SmsCategory): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of extrasForCategory(category)) {
    if (key === 'services_attended') out[key] = servicesAttendedText('both')
  }
  return out
}

/**
 * ## Why there is no `{{title}}`
 *
 * Because most of the congregation has none, and a placeholder that renders
 * empty for most people is the bug this whole file is built to refuse.
 *
 *     "Dear {{title}} {{last_name}},"  ->  "Dear  Serwaa,"   survivable
 *     "Dear {{title}},"                ->  "Dear ,"          not survivable
 *
 * The second one goes to hundreds of people, costs money, and cannot be
 * recalled — the same failure as the `{{name}}` case documented on `render()`,
 * arriving through a field that legitimately exists.
 *
 * So the title is never offered on its own. Every placeholder below COMPOSES it
 * with a name and falls back to the bare name when there is no title, which
 * makes the empty case impossible to express rather than merely discouraged. A
 * template author cannot write the broken message.
 *
 *                       Reverend Ama Serwaa      Ama Serwaa
 *   salutation          Reverend Serwaa          Ama
 *   title_first_name    Reverend Ama             Ama
 *   titled_full_name    Reverend Ama Serwaa      Ama Serwaa
 *
 * `salutation` drops to the FIRST name when untitled rather than to "Serwaa",
 * because a surname on its own reads as a summons. The titled form is formal
 * and the untitled form is warm, which is exactly how the church addresses the
 * two groups out loud.
 *
 * The existing placeholders are deliberately unchanged and stay title-blind.
 * Making `{{first_name}}` quietly title-aware would rewrite the meaning of
 * every template already written, without anybody editing one.
 */

/** `{{ first_name }}` and `{{first_name}}` are the same token — an admin
 *  typing a space inside the braces has not made a mistake worth a refusal. */
const TOKEN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export function values(member: Addressee): Record<Placeholder, string> {
  const full = [member.first_name, member.other_names, member.last_name]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const first = member.first_name.trim()
  const last = member.last_name.trim()
  const title = titleLabel(member.title)

  // `join(' ')` over a filtered list, never string concatenation with a space:
  // an untitled member must yield "Ama", not " Ama" with a leading space that
  // survives into "Dear  Ama,".
  const compose = (...parts: string[]) => parts.filter(Boolean).join(' ')

  return {
    first_name: first,
    last_name: last,
    other_names: (member.other_names ?? '').trim(),
    full_name: full,
    // Titled: formal, by surname. Untitled: the first name, because a bare
    // surname reads as a summons rather than a greeting.
    salutation: title ? compose(title, last) : first,
    title_first_name: compose(title, first),
    titled_full_name: compose(title, full),
    church: CHURCH_NAME,
  }
}

/**
 * Placeholders used by a body that are not in `PLACEHOLDERS`, nor in
 * `allowedExtras`.
 *
 * Callers validating a template pass `extrasForCategory(category)`, so
 * `{{services_attended}}` is known inside a thank-you and unknown — refused by
 * name — inside a birthday message. Omitting the second argument means "no
 * extras", never "any extras": the default has to be the refusal.
 */
export function unknownPlaceholders(body: string, allowedExtras: readonly string[] = []): string[] {
  const known = new Set<string>([...PLACEHOLDERS, ...allowedExtras])
  const found = new Set<string>()
  for (const m of body.matchAll(TOKEN)) {
    if (!known.has(m[1])) found.add(m[1])
  }
  return [...found]
}

export type RenderResult =
  | { ok: true; text: string }
  | { ok: false; error: string }

/**
 * Render `body` for `member`.
 *
 * An unknown placeholder REFUSES rather than substituting an empty string.
 * The failure mode being avoided is concrete: a template written as
 * "Happy birthday {{name}}!" — a plausible guess, and not one of ours —
 * silently sending "Happy birthday !" to the entire congregation, at cost,
 * with no way to recall it. Refusing names the token so it can be fixed in the
 * editor, where it is still free.
 *
 * `extras` are placeholders valid for THIS render only — `services_attended`
 * for one member's thank-you — and are unknown to every other render. They are
 * supplied by the caller that computed them; nothing here guesses one.
 */
export function render(
  body: string,
  member: Addressee,
  extras: Record<string, string> = {},
): RenderResult {
  const unknown = unknownPlaceholders(body, Object.keys(extras))
  if (unknown.length > 0) {
    const offered = [...PLACEHOLDERS, ...Object.keys(extras)]
    return {
      ok: false,
      error:
        `This message uses ${unknown.map((u) => `{{${u}}}`).join(', ')}, which ` +
        `${unknown.length === 1 ? 'is not a placeholder' : 'are not placeholders'} the system knows. ` +
        `Use one of: ${offered.map((p) => `{{${p}}}`).join(', ')}.`,
    }
  }
  const v = values(member)
  const text = body
    .replace(TOKEN, (_, key: string) =>
      // A member field first, then the per-render extra. An extra cannot shadow
      // a member field: `{{first_name}}` means the same thing in every category.
      key in v ? v[key as Placeholder] : extras[key],
    )
    // A blank {{other_names}} mid-sentence leaves a double space. Cosmetic,
    // but it is the kind of thing a congregation notices and the church does
    // not want to have explained to them.
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return { ok: true, text }
}

/**
 * Characters GSM-7 cannot carry, which force the whole message into UCS-2 at
 * 70 characters a part instead of 160.
 *
 * Not exhaustive — the full GSM-7 table is long — but it catches what actually
 * appears in these messages: curly quotes and dashes pasted in from Word, and
 * emoji. Anything outside plain Latin-1 is treated as UCS-2, which errs toward
 * over-estimating the cost. Quoting a higher price than you charge is the safe
 * direction to be wrong in.
 */
function isUnicode(text: string): boolean {
  return /[^\x00-ÿ]/.test(text) || /[‘’“”–—]/.test(text)
}

export type PartCount = {
  characters: number
  parts: number
  unicode: boolean
  /** Characters left in the current part before it spills into another. */
  remaining: number
}

/**
 * How many SMS parts `text` costs.
 *
 * The church is billed per PART, not per message. A birthday template that
 * grew past 160 characters costs twice what the one before it did, and nobody
 * finds out until the mNotify balance runs down mid-Sunday — so the editor
 * shows this live.
 */
export function countParts(text: string): PartCount {
  const unicode = isUnicode(text)
  const single = unicode ? 70 : SMS_PART_LENGTH
  const concat = unicode ? 67 : SMS_CONCAT_PART_LENGTH
  const characters = text.length

  if (characters === 0) return { characters: 0, parts: 0, unicode, remaining: single }
  if (characters <= single) {
    return { characters, parts: 1, unicode, remaining: single - characters }
  }
  const parts = Math.ceil(characters / concat)
  return { characters, parts, unicode, remaining: parts * concat - characters }
}

/**
 * mNotify wants bare digits: `233241234567`.
 *
 * `normalisePhone()` in `lib/members/server.ts` stores the `+233…` form, which
 * is right for storage and display and wrong on this wire — the provider's own
 * published validator accepts 9 to 12 characters, and a leading `+` puts a
 * correct Ghanaian number at 13. Sending it anyway does not error; the number
 * is simply rejected, one row at a time, in a batch that otherwise succeeded.
 */
export function toProviderNumber(stored: string): string | null {
  const digits = stored.replace(/[^\d]/g, '')
  if (digits.length < 9 || digits.length > 12) return null
  return digits
}
