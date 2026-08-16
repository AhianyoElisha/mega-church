import 'server-only'

// Appointing a head. The head of a group is an Appwrite ACCOUNT, not a member
// document — they sign in and see their people, so what is stored on the group
// is a user `$id`.

import { Query, type Users } from 'node-appwrite'
import { USER_LABELS } from '@/lib/appwrite/config'
import type { LeaderAccount } from './types'

export type ResolvedHead =
  | { ok: true; user: { id: string; name: string } | null }
  | { ok: false; error: string }

/**
 * Turn a submitted `head_user_id` into a real account, or refuse.
 *
 * Two refusals, and the second is the one that matters. An id that names no
 * account would store a head nobody can sign in as. An id that names an
 * account WITHOUT the `leader` label would store a head who can sign in and
 * then be bounced straight back out by `proxy.ts` — a group that looks
 * supervised and is not. Both are caught here rather than discovered by the
 * person trying to use the login.
 *
 * `null`/absent is allowed and means "no head yet", which is a normal state
 * for a constituency created before the appointment is made.
 */
export async function resolveHead(users: Users, raw: unknown): Promise<ResolvedHead> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, user: null }
  if (typeof raw !== 'string') return { ok: false, error: 'That head account is not valid.' }

  let account
  try {
    account = await users.get(raw)
  } catch {
    return { ok: false, error: 'That account no longer exists. Pick another head.' }
  }

  const labels = account.labels ?? []
  if (!labels.includes(USER_LABELS.leader)) {
    return {
      ok: false,
      error:
        `${account.name || account.email} is not a leader account. ` +
        'Create or re-label the account as a leader first, or it will be signed out ' +
        'the moment it tries to open the group.',
    }
  }

  return { ok: true, user: { id: account.$id, name: account.name || account.email } }
}

/**
 * Every account that may be appointed head, with what each already heads.
 *
 * The load is shown because heading a constituency AND a bacenta is normal and
 * supported — one login, two views — but heading six things usually means an
 * admin picked the wrong name from a dropdown twice.
 */
export async function listLeaderAccounts(
  users: Users,
  heldBy: Map<string, { kind: 'constituency' | 'bacenta'; name: string }[]>,
): Promise<LeaderAccount[]> {
  const found: LeaderAccount[] = []
  let offset = 0
  const PAGE = 100
  for (;;) {
    const res = await users.list([Query.limit(PAGE), Query.offset(offset)])
    for (const u of res.users) {
      if (!(u.labels ?? []).includes(USER_LABELS.leader)) continue
      found.push({
        id: u.$id,
        name: u.name || u.email,
        email: u.email,
        heads: heldBy.get(u.$id) ?? [],
      })
    }
    if (res.users.length < PAGE) break
    offset += PAGE
  }
  return found.sort((a, b) => a.name.localeCompare(b.name, 'en'))
}
