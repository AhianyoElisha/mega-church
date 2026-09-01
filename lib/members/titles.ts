// How the church addresses a member.
//
// Pure — no Appwrite, no `server-only`. The registration form, the validator,
// the SMS renderer and the template editor's preview all read this one file, so
// they cannot disagree about what "Pastor" renders as.
//
// ## Why a closed list and not free text
//
// The same reason `PLACEHOLDERS` is closed. Free text gets you "Pastor",
// "pastor", "Ps." and "Pst" for one office, entered by four different people
// over a year, and the congregation is the one who sees the inconsistency — in
// a message the church paid to send and cannot recall.
//
// The list is a CODE stored on the member and a separate display form, rather
// than storing the words. Storing "Lady Reverend" directly would mean a change
// of house style — an abbreviation, a comma, a full stop — is a data migration
// across every member instead of one line here.
//
// ## Extending it
//
// Add a row to `TITLES`. That is the whole procedure: the attribute is a plain
// string, so no Appwrite migration is involved, and `isMemberTitle` narrows
// from the same constant the form renders. Nothing else needs touching.

/** The stored code. Never shown to anyone — see `TITLES` for what is. */
export const MEMBER_TITLES = [
  'pastor',
  'reverend',
  'lady_reverend',
  'bishop',
  'apostle',
  'prophet',
  'evangelist',
  'dr',
  'mr',
  'mrs',
  'miss',
  'ms',
] as const

export type MemberTitle = (typeof MEMBER_TITLES)[number]

/**
 * What each code renders as in a message.
 *
 * Ministry offices are spelled OUT — "Reverend", not "Rev." A church that asked
 * for its leaders to be addressed by their position is not asking for the
 * position to be abbreviated, and four saved characters are not worth being the
 * thing somebody complains about next. Courtesy titles keep the stop that
 * ordinary writing gives them ("Mr.", "Dr.") because that is how they are
 * written everywhere else.
 *
 * These strings are a cost as well as a courtesy: they are prepended to a name
 * inside a message billed per 160-character part. "Lady Reverend" is 13
 * characters that "Mr." is not, so the same template can be one part for most
 * of the congregation and two for a handful of leaders. `longestTitle()` exists
 * so the editor can price the worst case instead of a sample.
 */
export const TITLES: Record<MemberTitle, { label: string; group: 'ministry' | 'courtesy' }> = {
  pastor: { label: 'Pastor', group: 'ministry' },
  reverend: { label: 'Reverend', group: 'ministry' },
  lady_reverend: { label: 'Lady Reverend', group: 'ministry' },
  bishop: { label: 'Bishop', group: 'ministry' },
  apostle: { label: 'Apostle', group: 'ministry' },
  prophet: { label: 'Prophet', group: 'ministry' },
  evangelist: { label: 'Evangelist', group: 'ministry' },
  dr: { label: 'Dr.', group: 'courtesy' },
  mr: { label: 'Mr.', group: 'courtesy' },
  mrs: { label: 'Mrs.', group: 'courtesy' },
  miss: { label: 'Miss', group: 'courtesy' },
  ms: { label: 'Ms.', group: 'courtesy' },
}

export function isMemberTitle(v: unknown): v is MemberTitle {
  return typeof v === 'string' && (MEMBER_TITLES as readonly string[]).includes(v)
}

/**
 * The words for a stored code, or `''` for a member with no title.
 *
 * Returns the empty string rather than null so callers can join without a
 * branch — but note that NOTHING in the SMS path renders this on its own. See
 * `salutation()` in `lib/sms/render.ts` for why a bare title is not a
 * placeholder anybody is allowed to use.
 */
export function titleLabel(title: string | null | undefined): string {
  return isMemberTitle(title) ? TITLES[title].label : ''
}

/**
 * The longest title, for pricing the worst case.
 *
 * The template editor previews against one sample member, so without this it
 * would quote the cost of "Ama Serwaa" and the church would be billed for
 * "Lady Reverend Serwaa". Over a whole-congregation broadcast that is the
 * difference between one part and two, discovered from the mNotify balance
 * rather than from the screen where it was still free to fix.
 */
export function longestTitle(): string {
  return MEMBER_TITLES.reduce(
    (longest, t) => (TITLES[t].label.length > longest.length ? TITLES[t].label : longest),
    '',
  )
}

/** For a <select>: ministry offices first, then courtesy, each in list order. */
export function titleOptions(): { value: MemberTitle; label: string; group: string }[] {
  return MEMBER_TITLES.map((value) => ({
    value,
    label: TITLES[value].label,
    group: TITLES[value].group === 'ministry' ? 'Ministry' : 'Courtesy',
  }))
}
