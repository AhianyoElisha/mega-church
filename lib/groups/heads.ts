import 'server-only'

// Appointing a head. The head of a group is an Appwrite ACCOUNT, not a member
// document — they sign in and see their people, so what is stored on the group
// is a user `$id`.

import { ID, Query, type Users } from 'node-appwrite'
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

// --- creating the account itself --------------------------------------------

/**
 * A password an admin can read down a phone line without ambiguity.
 *
 * No `l`/`1`/`I` or `O`/`0`, because this password IS handed over verbally or
 * on paper — there is no forgot-password flow in this app — and "was that a
 * one or an ell" is how a new head ends up locked out of the group they were
 * just given.
 */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint32Array(14)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export type CreateLeaderResult =
  | { ok: true; id: string; name: string; email: string; password: string }
  | { ok: false; error: string }

/**
 * Create an account that can be appointed head of a group.
 *
 * This exists because the Head dropdown had nothing in it for any church that
 * had never opened the Appwrite console — which made a feature that was fully
 * built look entirely absent. Appointing a head and giving that head a login
 * are one job to the person doing it, so they are one flow here.
 *
 * The label is set to EXACTLY `leader` and nothing else. RBAC is one label per
 * user (CLAUDE.md); an account carrying two would be routed by whichever
 * `pickLabel` found first in `proxy.ts`, which is not a thing to leave to
 * ordering.
 *
 * The password is returned ONCE and never stored. There is no password reset
 * in this app, so the dialog that shows it says so before it can be dismissed.
 */
export async function createLeaderAccount(
  users: Users,
  input: { name: string; email: string; password?: string | null },
): Promise<CreateLeaderResult> {
  const name = input.name.trim().replace(/\s+/g, ' ')
  const email = input.email.trim().toLowerCase()

  if (name.length < 2) return { ok: false, error: 'Give the head a name.' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: `"${input.email}" is not a valid email address.` }
  }
  const password = input.password?.trim() || generatePassword()
  // Appwrite's own minimum. Checked here so the refusal names the rule rather
  // than surfacing as a provider error an admin has to interpret.
  if (password.length < 8) {
    return { ok: false, error: 'A password must be at least 8 characters.' }
  }

  let account
  try {
    account = await users.create(ID.unique(), email, undefined, password, name)
  } catch (err) {
    const code = (err as { code?: number }).code
    if (code === 409) {
      return {
        ok: false,
        error:
          `An account already exists for ${email}. If that is the person you mean, they are ` +
          'already in the Head list — pick them there rather than creating a second account.',
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not create that account.',
    }
  }

  try {
    await users.updateLabels(account.$id, [USER_LABELS.leader])
  } catch (err) {
    // An account with no label is one `proxy.ts` bounces straight to /login,
    // which reads as a broken password rather than a half-finished setup. It
    // is also invisible in the Head list, so it would be created again and
    // again. Remove it and report honestly.
    await users.delete(account.$id).catch(() => {})
    return {
      ok: false,
      error:
        'The account was created but could not be marked as a leader, so it was removed. ' +
        (err instanceof Error ? err.message : 'Try again.'),
    }
  }

  return { ok: true, id: account.$id, name, email, password }
}

export type SetPasswordResult =
  | { ok: true; name: string; email: string; password: string }
  | { ok: false; error: string; status: 400 | 403 | 404 }

/**
 * Give an existing head a new password.
 *
 * This exists because there is no forgot-password flow in this app. Without
 * it, a head who loses the string they were shown once is locked out until
 * somebody opens the Appwrite console — which is exactly the "the feature must
 * be missing" experience that made head accounts look unimplemented in the
 * first place.
 *
 * Restricted to accounts carrying the `leader` label, and that restriction is
 * load-bearing rather than tidiness. This route runs with an admin API key, so
 * without the check an admin could rewrite the password of the OTHER admin, an
 * usher, or the kiosk appliance by pasting a different id into the request —
 * from a screen whose entire visible purpose is managing group heads. Blast
 * radius should match what the screen says it does.
 */
export async function setLeaderPassword(
  users: Users,
  userId: string,
  password: string | null,
): Promise<SetPasswordResult> {
  let account
  try {
    account = await users.get(userId)
  } catch {
    return { ok: false, error: 'That account no longer exists.', status: 404 }
  }

  if (!(account.labels ?? []).includes(USER_LABELS.leader)) {
    return {
      ok: false,
      error:
        `${account.name || account.email} is not a leader account. ` +
        'Only group head passwords can be changed here.',
      status: 403,
    }
  }

  const next = password?.trim() || generatePassword()
  // Appwrite's own minimum. Checked here so the refusal names the rule instead
  // of surfacing a provider error an admin has to interpret.
  if (next.length < 8) {
    return { ok: false, error: 'A password must be at least 8 characters.', status: 400 }
  }

  try {
    await users.updatePassword(userId, next)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not change that password.',
      status: 400,
    }
  }

  return {
    ok: true,
    name: account.name || account.email,
    email: account.email,
    // Returned ONCE, exactly like creation. Never stored, and the dialog that
    // shows it says so before it will close.
    password: next,
  }
}
