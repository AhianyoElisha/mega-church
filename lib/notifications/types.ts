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

/**
 * What the three scheduled service texts answer with — `sunday-reminder`,
 * `midweek-reminder` and `attendance-thanks` share one shape because they are
 * one job with three recipient rules (`lib/notifications/serviceSms.ts`).
 *
 * `nobody` is a real outcome, not an error: a Sunday with no attendance rows
 * is a Sunday the kiosk was never opened, and the run must say so rather than
 * look like a scheduler that never fired. Every `ok: true` exit is RECORDED in
 * `notification_runs` for the same reason.
 */
export type ServiceSmsResponse =
  | {
      ok: true
      status: 'sent' | 'nobody' | 'no_template' | 'not_configured'
      /** Which of the three, so a scheduler log line is self-describing. */
      kind: string
      run_date: string
      /** Non-child recipients the job resolved, before claims and phones. */
      recipient_count: number
      /** Save Church children dropped BEFORE the send. Never zero by silence:
       *  a child in the attendance rows is reported, not texted. */
      excluded_children: number
      sent: number
      failed: number
      /** Already texted for this category today — the dedupe index on a
       *  second call. `sent` 0 with `skipped` N is what "it did not send
       *  twice" looks like from a scheduler log. */
      skipped: number
      /** Recipients with no usable number. Named, so they can be fixed. */
      no_phone: string[]
      credit_left: number | null
    }
  | { ok: false; error: string }

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
