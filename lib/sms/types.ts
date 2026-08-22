// SMS contracts. Pure types and pure functions only — no Appwrite, no
// `server-only` — so the template editor can import the same part-count and
// placeholder logic the server enforces with. A client that counts parts
// differently from the server is a client that promises one price and bills
// another.

import type { SmsCategory } from '@/lib/appwrite/config'

export type SmsTemplate = {
  $id: string
  name: string
  category: SmsCategory
  body: string
  /** The one used when nothing more specific is chosen. Exactly one per
   *  category — the invariant is enforced on write, not hoped for. */
  is_default: boolean
  sort_order: number
  created_by: string | null
  $createdAt: string
  $updatedAt: string
}

export type SmsTemplateInput = {
  name: string
  category: SmsCategory
  body: string
  is_default?: boolean
}

export type SmsMessageStatus = 'sent' | 'failed'

export type SmsMessage = {
  $id: string
  member_id: string
  phone: string
  /** What was ACTUALLY sent, already rendered. Not the template. */
  body: string
  category: SmsCategory
  template_id: string | null
  status: SmsMessageStatus
  /** mNotify's own words, verbatim. */
  provider_message: string | null
  sent_at: string
  run_date: string
  sent_by: string | null
  $createdAt: string
}

/**
 * The outcome of handing one batch to the provider.
 *
 * `not_configured` is a distinct kind, not an error string, for the same
 * reason `MatcherUnavailableError` is distinct from a `null` match: "we cannot
 * send" and "the network refused this number" need different screens and
 * different fixes, and collapsing them means the church chases a phone problem
 * that is really a missing environment variable.
 */
export type SmsSendOutcome =
  | { kind: 'sent'; accepted: string[]; rejected: string[]; provider_message: string; credit_used: number | null; credit_left: number | null }
  | { kind: 'rejected'; provider_message: string }
  | { kind: 'unavailable'; provider_message: string }
  | { kind: 'not_configured'; provider_message: string }

export type SmsConfigStatus = {
  configured: boolean
  /** True when the key is present but the sender ID is not — worth saying out
   *  loud, because it is the half-finished state that looks like it works. */
  has_key: boolean
  has_sender: boolean
  sender_id: string | null
  reason: string | null
}

// --- API responses ----------------------------------------------------------

export type ListTemplatesResponse =
  | { ok: true; templates: SmsTemplate[]; config: SmsConfigStatus }
  | { ok: false; error: string }

export type TemplateResponse =
  | { ok: true; template: SmsTemplate }
  | { ok: false; error: string }

export type SendSmsResponse =
  | {
      ok: true
      /** Attempted, not necessarily delivered. A provider accepts before it
       *  delivers, and this app never claims more than it knows. */
      sent: number
      failed: number
      /** Members skipped because they were already texted for this category
       *  today — the dedupe index doing its job, reported rather than hidden. */
      skipped: number
      /** Members with no usable phone number. Named, so they can be fixed. */
      no_phone: string[]
      provider_message: string | null
      /** What mNotify said was left AFTER this send, when it said anything.
       *  Free: it rides back on the send response, so reporting it costs no
       *  extra call. Null when the provider omitted it or the send never
       *  reached them — never 0, which would read as "out of credit". */
      credit_left: number | null
    }
  | { ok: false; error: string }

export type ListSmsLogResponse =
  | { ok: true; messages: (SmsMessage & { member_name: string | null })[]; total: number }
  | { ok: false; error: string }

export type BirthdaySmsResponse =
  | {
      ok: true
      status: 'sent' | 'nobody_celebrating' | 'no_template' | 'not_configured'
      run_date: string
      celebrant_count: number
      sent: number
      failed: number
      skipped: number
      /** As on a manual send. Worth returning even though no human is watching
       *  a cron: this is the one send nobody sees fail, so the number belongs
       *  in whatever the scheduler logs. */
      credit_left: number | null
    }
  | { ok: false; error: string }

// --- credit balance ---------------------------------------------------------

/**
 * What the provider says is left in the account.
 *
 * `unknown` is a distinct kind rather than a null number, for the same reason
 * `not_configured` is distinct from `rejected` above: "mNotify would not tell
 * us" and "you have nothing left" call for opposite reactions, and a screen
 * that renders both as a blank figure will eventually talk somebody out of a
 * send on the strength of a lookup that simply timed out.
 *
 * `low` is computed on the server from `LOW_CREDIT_AT` rather than compared in
 * the page, so the dashboard, the send screen and any future warning cannot
 * disagree about what "low" means.
 */
export type SmsBalance =
  | {
      kind: 'known'
      /** mNotify's own figure, in whatever unit their account is denominated
       *  in. Reported, never converted — see `MnotifyService.balance()`. */
      credits: number
      /** Promotional credit, when the account has any. Kept separate because
       *  it is not always spendable on the same routes. */
      bonus: number | null
      low: boolean
      checked_at: string
    }
  | { kind: 'unknown'; reason: string }
  | { kind: 'not_configured'; reason: string }

export type SmsBalanceResponse =
  | { ok: true; balance: SmsBalance; low_at: number }
  | { ok: false; error: string }
