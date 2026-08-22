import 'server-only'

// Web Push: storing the devices that opted in, and sending to them.
//
// Push is the only mechanism that reaches a phone whose screen is off and
// whose browser is closed, which is what the birthday team actually needs —
// an in-app badge is only seen by someone who was already looking.

import { createHash } from 'node:crypto'
import { ID, Query, type Databases, type Models } from 'node-appwrite'
import webpush from 'web-push'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import type { PushPayload, PushSubscriptionInput, StoredSubscription } from './types'

type Doc = Models.Document & Record<string, unknown>

const PAGE = 100

/**
 * The endpoint URL identifies a device, but it is up to a kilobyte and MariaDB
 * cannot index that (the 3072-byte key limit). Its SHA-256 is 64 characters,
 * uniquely identifies the same endpoint, and is what the unique index is on.
 *
 * Without it, one phone re-subscribing after a browser update accumulates a
 * second row and the team member gets every notification twice.
 */
export function hashEndpoint(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex')
}

export function vapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null
}

/**
 * Configure web-push, or report why it cannot be.
 *
 * Returns a reason rather than throwing so a missing key surfaces as an
 * explanation on the birthdays page ("notifications are not configured") and
 * not as a 500 that looks like the feature is broken.
 */
function configureWebPush(): { ok: true } | { ok: false; error: string } {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    return {
      ok: false,
      error:
        'Push notifications are not configured. Generate a key pair with ' +
        '`npx web-push generate-vapid-keys` and set NEXT_PUBLIC_VAPID_PUBLIC_KEY ' +
        'and VAPID_PRIVATE_KEY.',
    }
  }
  // The subject must be a mailto: or https: URL the push service can contact
  // about a misbehaving sender. A placeholder is better than nothing, but the
  // church's real address belongs here.
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@megachurch.local'
  webpush.setVapidDetails(subject, publicKey, privateKey)
  return { ok: true }
}

export function subscriptionDocTo(d: Doc): StoredSubscription {
  return {
    $id: d.$id,
    user_id: String(d.user_id ?? ''),
    user_label: String(d.user_label ?? ''),
    endpoint: String(d.endpoint ?? ''),
    device_label: (d.device_label as string | null) || null,
    last_success_at: (d.last_success_at as string | null) || null,
    $createdAt: d.$createdAt,
  }
}

/**
 * Record a device, or refresh the row that already represents it.
 *
 * Upsert rather than insert: a browser hands back the same endpoint when it
 * re-subscribes, but its encryption keys are rotated. Inserting would violate
 * the unique index; ignoring the collision would leave the stale keys in place
 * and every send to that device would fail decryption forever.
 */
export async function saveSubscription(
  databases: Databases,
  sub: PushSubscriptionInput,
  user: { id: string; label: string },
): Promise<StoredSubscription> {
  const endpoint_hash = hashEndpoint(sub.endpoint)
  const fields = {
    user_id: user.id,
    user_label: user.label,
    endpoint: sub.endpoint.slice(0, 1024),
    endpoint_hash,
    p256dh: sub.keys.p256dh,
    auth_key: sub.keys.auth,
    device_label: sub.device_label?.slice(0, 128) || null,
    last_success_at: null,
  }

  const existing = await databases.listDocuments(DATABASE_ID, COLLECTIONS.push_subscriptions, [
    Query.equal('endpoint_hash', endpoint_hash),
    Query.limit(1),
  ])
  if (existing.documents.length > 0) {
    const doc = await databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.push_subscriptions,
      existing.documents[0].$id,
      fields,
    )
    return subscriptionDocTo(doc as Doc)
  }

  const doc = await databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.push_subscriptions,
    ID.unique(),
    fields,
  )
  return subscriptionDocTo(doc as Doc)
}

export async function removeSubscription(
  databases: Databases,
  endpoint: string,
  userId: string,
): Promise<number> {
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.push_subscriptions, [
    Query.equal('endpoint_hash', hashEndpoint(endpoint)),
    Query.limit(5),
  ])
  // Scoped to the caller: one account must not be able to silence another's
  // phone by posting its endpoint.
  const mine = res.documents.filter((d) => (d as Doc).user_id === userId)
  await Promise.all(
    mine.map((d) => databases.deleteDocument(DATABASE_ID, COLLECTIONS.push_subscriptions, d.$id)),
  )
  return mine.length
}

export async function listSubscriptionsForUser(
  databases: Databases,
  userId: string,
): Promise<StoredSubscription[]> {
  const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.push_subscriptions, [
    Query.equal('user_id', userId),
    Query.limit(PAGE),
  ])
  return res.documents.map((d) => subscriptionDocTo(d as Doc))
}

/** Every device belonging to an account carrying one of `labels`. */
export async function listSubscriptionsForLabels(
  databases: Databases,
  labels: string[],
): Promise<(StoredSubscription & { p256dh: string; auth_key: string })[]> {
  const out: (StoredSubscription & { p256dh: string; auth_key: string })[] = []
  let cursor: string | null = null
  for (;;) {
    const q = [Query.equal('user_label', labels), Query.limit(PAGE)]
    if (cursor) q.push(Query.cursorAfter(cursor))
    const res = await databases.listDocuments(DATABASE_ID, COLLECTIONS.push_subscriptions, q)
    for (const d of res.documents as Doc[]) {
      out.push({
        ...subscriptionDocTo(d),
        p256dh: String(d.p256dh ?? ''),
        auth_key: String(d.auth_key ?? ''),
      })
    }
    if (res.documents.length < PAGE) break
    cursor = res.documents[res.documents.length - 1].$id
  }
  return out
}

export type SendResult = { sent: number; failed: number; pruned: number }

/**
 * Push `payload` to every device in `targets`.
 *
 * 404 and 410 mean the subscription is permanently gone — the browser was
 * uninstalled, the user cleared their site data, the push service expired it.
 * Those rows are DELETED rather than retried: keeping them means every future
 * run spends time failing against a device that will never come back, and the
 * failure count slowly becomes noise nobody reads.
 *
 * Any other error is left alone. A 500 from the push service is transient and
 * deleting the row would silently unsubscribe a real person.
 */
export async function sendToAll(
  databases: Databases,
  targets: (StoredSubscription & { p256dh: string; auth_key: string })[],
  payload: PushPayload,
): Promise<SendResult | { error: string }> {
  const configured = configureWebPush()
  if (!configured.ok) return { error: configured.error }

  const body = JSON.stringify(payload)
  const now = new Date().toISOString()
  let sent = 0
  let failed = 0
  const dead: string[] = []

  // Sequential rather than Promise.all: a congregation's worth of devices
  // fired at once is a burst the push services rate-limit, and the run has no
  // deadline worth optimising for.
  for (const t of targets) {
    try {
      await webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth_key } },
        body,
      )
      sent++
      await databases
        .updateDocument(DATABASE_ID, COLLECTIONS.push_subscriptions, t.$id, {
          last_success_at: now,
        })
        .catch(() => {
          // Bookkeeping only. A failure to stamp the row must not turn a
          // delivered notification into a reported failure.
        })
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) dead.push(t.$id)
      else failed++
    }
  }

  await Promise.all(
    dead.map((id) =>
      databases.deleteDocument(DATABASE_ID, COLLECTIONS.push_subscriptions, id).catch(() => {}),
    ),
  )

  return { sent, failed, pruned: dead.length }
}

/**
 * Claim today's run, or report that somebody already did.
 *
 * The unique index on `(run_date, kind)` is the actual guarantee. This tries to
 * INSERT first and treats the 409 as "already sent" — a check-then-insert would
 * leave a window in which two overlapping cron firings both read "not yet" and
 * both notify the team.
 */
export async function claimRun(
  databases: Databases,
  runDate: string,
  kind: string,
  triggeredBy: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: 'already_ran' }> {
  try {
    const doc = await databases.createDocument(
      DATABASE_ID,
      COLLECTIONS.notification_runs,
      ID.unique(),
      {
        run_date: runDate,
        kind,
        celebrant_count: 0,
        sent: 0,
        failed: 0,
        ran_at: new Date().toISOString(),
        triggered_by: triggeredBy,
      },
    )
    return { ok: true, id: doc.$id }
  } catch (err) {
    const code = (err as { code?: number }).code
    if (code === 409) return { ok: false, reason: 'already_ran' }
    throw err
  }
}

/**
 * Write down that a job RAN. Never refuses, never gates anything.
 *
 * ── Why this is not `claimRun` ─────────────────────────────────────────────
 *
 * `claimRun` exists to make a second firing do nothing: it inserts, and a 409
 * on the (run_date, kind) unique index means "somebody already sent this".
 * That is right for the push, where the whole payload goes out in one shot and
 * a repeat means the team's phones buzz twice.
 *
 * It would be exactly WRONG for the SMS job. That one is idempotent per
 * MEMBER, on `sms_messages.dedupe_key`, precisely so a run that dies at member
 * forty of sixty can be re-run to text the remaining twenty and none of the
 * first forty. Give it a per-day claim and one of two things breaks: the retry
 * is refused and twenty people never hear from the church, or the claim is
 * released and forty people are texted twice.
 *
 * So this UPSERTS. A 409 means today's row already exists — the normal state
 * on the second call of the day — and the answer is to update it, never to
 * tell the caller to stop.
 *
 * Failures are swallowed, for the same reason `finishRun` swallows its own: an
 * audit row that cannot be written must not turn a successful send into a
 * reported failure. Observability is worth a great deal, but never more than
 * the thing it observes.
 */
export async function recordRun(
  databases: Databases,
  runDate: string,
  kind: string,
  triggeredBy: string,
  outcome: {
    status: string
    celebrant_count: number
    sent: number
    failed: number
    skipped: number
  },
): Promise<void> {
  const row = {
    run_date: runDate,
    kind,
    ran_at: new Date().toISOString(),
    triggered_by: triggeredBy,
    ...outcome,
  }

  try {
    await databases.createDocument(DATABASE_ID, COLLECTIONS.notification_runs, ID.unique(), row)
    return
  } catch (err) {
    if ((err as { code?: number }).code !== 409) return
  }

  // Today's row exists. Overwrite it with the latest outcome — the most recent
  // call is the most recent truth, and a run that finally texted the remaining
  // twenty should not be remembered by the attempt that stalled at forty.
  try {
    const existing = await databases.listDocuments(DATABASE_ID, COLLECTIONS.notification_runs, [
      Query.equal('run_date', runDate),
      Query.equal('kind', kind),
      Query.limit(1),
    ])
    const id = existing.documents[0]?.$id
    if (!id) return
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.notification_runs, id, row)
  } catch {
    // See above: never fail a send over its own audit trail.
  }
}

export async function finishRun(
  databases: Databases,
  id: string,
  tally: { celebrant_count: number; sent: number; failed: number; status?: string },
): Promise<void> {
  await databases
    .updateDocument(DATABASE_ID, COLLECTIONS.notification_runs, id, tally)
    .catch(() => {
      // The claim row already did its job — preventing a second send. Failing
      // to write the tally onto it is not worth failing the request over.
    })
}

/** Release a claim whose send never happened, so a retry can try again. */
export async function releaseRun(databases: Databases, id: string): Promise<void> {
  await databases.deleteDocument(DATABASE_ID, COLLECTIONS.notification_runs, id).catch(() => {})
}
