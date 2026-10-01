// Who a broadcast is FOR, narrowed from who was picked.
//
// Pure — no Appwrite, no request — so the send route and the `/sms` picker
// read the same rule and cannot disagree about who is offered and who is
// dropped. The route is the enforcement; the picker is the courtesy that stops
// anybody being offered a doomed choice.

import { SMS_AUDIENCES, type MemberType, type SmsAudience } from '@/lib/appwrite/config'

export function isSmsAudience(v: unknown): v is SmsAudience {
  return typeof v === 'string' && (SMS_AUDIENCES as readonly string[]).includes(v)
}

/**
 * The reason a child is dropped, in the words the screen shows.
 *
 * One string, exported, so the send route, the cron runner and the picker all
 * say the same thing. Children are never texted — the number on a child's row
 * is a parent's, and a church texting a parent "happy birthday" or "thank you
 * for joining us at Second Service" about their nine-year-old is a church that
 * has to explain itself.
 */
export const CHILDREN_NEVER_TEXTED = 'Save Church children are never texted'

export type AudienceNarrowing<M> = {
  kept: M[]
  /** Everyone dropped, children included. */
  excluded: number
  /** The children among `excluded`. Always dropped, whatever the audience. */
  children: number
  /** Adults or students outside the audience asked for. */
  outside_audience: number
  /** Why, in words, when anything was dropped. Null when nothing was. */
  reason: string | null
}

/**
 * Narrow `members` to `audience`.
 *
 *   all           adults and students
 *   students      students only
 *   non_students  adults only
 *
 * A CHILD is excluded from every audience, `all` included. "All" means "all of
 * the people the church texts", and that set has never contained a child —
 * there is no audience value that reaches one, so a caller cannot ask for it
 * by accident. `sendToMembers` drops children again at the chokepoint; this
 * narrowing is what lets the count reach the screen with a reason attached.
 */
export function narrowAudience<M extends { member_type: MemberType }>(
  members: readonly M[],
  audience: SmsAudience,
): AudienceNarrowing<M> {
  const kept: M[] = []
  let children = 0
  let outside = 0

  for (const m of members) {
    if (m.member_type === 'child') {
      children++
      continue
    }
    const wanted =
      audience === 'all' ||
      (audience === 'students' && m.member_type === 'student') ||
      (audience === 'non_students' && m.member_type === 'adult')
    if (wanted) kept.push(m)
    else outside++
  }

  const parts: string[] = []
  if (outside > 0) {
    parts.push(
      audience === 'students'
        ? `${outside} ${outside === 1 ? 'is' : 'are'} not ${outside === 1 ? 'a student' : 'students'}`
        : `${outside} ${outside === 1 ? 'is a student' : 'are students'}, and this message is for non-students`,
    )
  }
  if (children > 0) {
    parts.push(
      `${children} ${children === 1 ? 'is a Save Church child' : 'are Save Church children'} — ${CHILDREN_NEVER_TEXTED}`,
    )
  }

  return {
    kept,
    excluded: children + outside,
    children,
    outside_audience: outside,
    reason: parts.length > 0 ? parts.join('; ') : null,
  }
}
