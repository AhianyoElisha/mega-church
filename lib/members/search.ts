// How a member is looked up, by name or by member number.
//
// Pure, so the SAME rule runs in the browser and on the server. There are five
// search boxes in this app and two server paths, and before this they each had
// their own `fullName(m).toLowerCase().includes(q)` — which is how one of them
// ends up not searching a field the others do, and nobody notices because each
// looks fine on its own.

import { fullName, type Member } from './types'

/**
 * Is this search term a member NUMBER rather than a name?
 *
 * Digits only. `2026001` is a number; `Ama` is a name; `2026 Ama` is a name,
 * because a member number never contains a space.
 *
 * The two searches are deliberately EXCLUSIVE rather than merged. Merging them
 * means typing `2026` returns both every member registered this year and
 * anybody with 2026 in their name, which is a worse answer than either. And
 * nobody types digits hoping to match a name.
 */
export function looksLikeMemberNo(term: string): boolean {
  return /^\d+$/.test(term.trim())
}

/**
 * Does this member match what was typed?
 *
 * By NUMBER when the term is digits — as a PREFIX, so `2026` finds everyone
 * registered in 2026 and `202600` narrows to the first nine. By NAME otherwise,
 * case-insensitively, on the full name as rendered.
 *
 * `call_number` is matched too when the caller asks for it: several of the
 * pickers search "name or number" meaning a phone number, and that has to keep
 * working. A phone number is digits, so it would otherwise be swallowed by the
 * member-number branch — which is why the phone check runs there as well, and
 * why `+233…` still matches after the `+` is typed.
 */
export function matchesMemberSearch(
  member: Pick<Member, 'first_name' | 'last_name' | 'other_names' | 'member_no'> & {
    call_number?: string
  },
  rawTerm: string,
  opts: { phone?: boolean } = {},
): boolean {
  const term = rawTerm.trim()
  if (!term) return true

  if (looksLikeMemberNo(term)) {
    if ((member.member_no ?? '').startsWith(term)) return true
    // A phone number is digits too. Checked here rather than left to the name
    // branch, which the digits test has already ruled out.
    if (opts.phone && (member.call_number ?? '').includes(term)) return true
    return false
  }

  const q = term.toLowerCase()
  if (fullName(member).toLowerCase().includes(q)) return true
  // `+233…` and any other non-digit phone shape.
  if (opts.phone && (member.call_number ?? '').toLowerCase().includes(q)) return true
  return false
}
