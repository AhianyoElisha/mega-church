// Web Push contracts. Pure types — safe in a browser bundle.

/** The three fields a browser's PushSubscription actually carries. */
export type PushSubscriptionInput = {
  endpoint: string
  keys: { p256dh: string; auth: string }
  /** Optional free text so a user can tell "my phone" from "the office iPad". */
  device_label?: string | null
}

export type StoredSubscription = {
  $id: string
  user_id: string
  user_label: string
  endpoint: string
  device_label: string | null
  last_success_at: string | null
  $createdAt: string
}

export type PushStatusResponse = {
  ok: true
  /**
   * Null when the server has no VAPID keys configured. The UI must show a
   * setup message rather than a broken "Enable notifications" button that
   * fails on click — a button that does nothing is indistinguishable from a
   * bug, and this is a configuration gap somebody can fix.
   */
  vapid_public_key: string | null
  /** Devices this account has registered. */
  devices: StoredSubscription[]
}

export type SubscribeResponse =
  | { ok: true; device: StoredSubscription }
  | { ok: false; error: string }

export type UnsubscribeResponse = { ok: true; removed: number } | { ok: false; error: string }

/** What lands in the service worker's `push` event. */
export type PushPayload = {
  title: string
  body: string
  /** Where clicking the notification should take the user. */
  url: string
  tag?: string
}

export type BirthdayRunResponse =
  | {
      ok: true
      /** `sent` on the run that did the work; `already_sent` on a repeat. */
      status: 'sent' | 'already_sent' | 'nobody_celebrating' | 'no_subscribers'
      run_date: string
      celebrant_count: number
      sent: number
      failed: number
      /** Devices dropped because the push service said they are gone. */
      pruned: number
    }
  | { ok: false; error: string }
