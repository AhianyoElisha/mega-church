import 'server-only'

// The mNotify seam.
//
// Modelled on `lib/services/biometricService.ts`: one interface, a real
// implementation, and a stub — so `npm run e2e` can prove the whole SMS path
// end to end without spending the church's credit or texting a congregation
// that did not ask to be a test fixture.

import type { SmsBalance, SmsConfigStatus, SmsSendOutcome } from './types'

/** `POST …/quick?key=` with a JSON body. Confirmed against mNotify's own
 *  published contract; the response CODES are treated as advisory (see
 *  `describe()`) because the provider has changed them across versions. */
const QUICK_SMS_URL = 'https://api.mnotify.com/api/sms/quick'

/** `GET …/balance/sms?key=` — the only way to learn the balance WITHOUT
 *  spending any of it. Every send also reports what is left afterwards, but
 *  "afterwards" is too late to decide not to send. */
const BALANCE_URL = 'https://api.mnotify.com/api/balance/sms'

/**
 * Below this, the screens start saying so.
 *
 * Calibrated against what one BULK send costs, not against a day of birthdays.
 * The congregation is small enough that the automatic birthday run spends a
 * handful of credits a day, so a threshold tuned to that would trip only after
 * a tithe send to two hundred people had already failed halfway through — the
 * exact failure this is meant to pre-empt. A church with a larger roll should
 * raise it; the number is a starting point that wants the church's own
 * numbers, in the same spirit as the biometric threshold in
 * `lib/biometrics/matching.ts`.
 */
export const LOW_CREDIT_AT = 50

/** A hung provider must not hold a Route Handler open until the platform kills
 *  it. Long enough for a slow batch, short enough that a Sunday-morning send
 *  fails visibly rather than spinning. */
const TIMEOUT_MS = 20_000

export interface SmsService {
  send(recipients: string[], message: string): Promise<SmsSendOutcome>
  status(): SmsConfigStatus
  /** Never throws. A balance lookup exists to inform a decision, and one that
   *  fails must not become an error page in front of a send that would have
   *  worked. */
  balance(): Promise<SmsBalance>
}

// --- configuration ----------------------------------------------------------

export function smsConfig(): SmsConfigStatus {
  const key = process.env.MNOTIFY_API_KEY?.trim() || ''
  const sender = process.env.MNOTIFY_SENDER_ID?.trim() || ''

  if (!key && !sender) {
    return {
      configured: false,
      has_key: false,
      has_sender: false,
      sender_id: null,
      reason:
        'SMS is not set up. Add MNOTIFY_API_KEY and MNOTIFY_SENDER_ID to .env.local — ' +
        'the key comes from the Developer section of the mNotify dashboard, and the ' +
        'sender ID has to be requested there and approved before it will deliver.',
    }
  }
  if (!key) {
    return {
      configured: false,
      has_key: false,
      has_sender: true,
      sender_id: sender,
      reason: 'MNOTIFY_API_KEY is missing. Generate one under Developer in the mNotify dashboard.',
    }
  }
  if (!sender) {
    // The half-configured state, and the one worth being loud about: mNotify
    // ACCEPTS a send with a sender ID it has not approved and then never
    // delivers it. A blank sender is therefore treated as "not configured"
    // rather than filled in with a plausible default — a message that reports
    // success and never arrives is worse than one that refuses to leave.
    return {
      configured: false,
      has_key: true,
      has_sender: false,
      sender_id: null,
      reason:
        'MNOTIFY_SENDER_ID is missing. Request a sender ID (11 characters or fewer) in the ' +
        'mNotify dashboard and wait for approval — an unapproved sender is accepted by the ' +
        'API and then silently never delivered.',
    }
  }
  if (sender.length > 11) {
    return {
      configured: false,
      has_key: true,
      has_sender: true,
      sender_id: sender,
      reason: `The sender ID "${sender}" is ${sender.length} characters. The limit is 11.`,
    }
  }
  return { configured: true, has_key: true, has_sender: true, sender_id: sender, reason: null }
}

// --- the real client --------------------------------------------------------

type QuickResponse = {
  status?: string
  code?: string | number
  message?: string
  summary?: {
    total_sent?: number
    total_rejected?: number
    numbers_sent?: string[]
    credit_used?: number
    credit_left?: number
  }
}

/**
 * mNotify's documented codes, as far as they can be relied on.
 *
 * The lookup is a COURTESY, not the decision: `send()` keys off
 * `status === 'success'` and falls back to the provider's own `message` for
 * anything it does not recognise. The provider has renumbered these between
 * API versions, and a client that hard-codes them starts reporting
 * "insufficient balance" for something else entirely after an upgrade nobody
 * here was told about.
 */
const CODE_HINT: Record<string, string> = {
  '1002': 'The message was rejected by mNotify.',
  '1003': 'The mNotify account is out of credit. Top it up and send again.',
  '1004': 'mNotify rejected the API key. Check MNOTIFY_API_KEY.',
  '1005': 'mNotify rejected the phone number.',
  '1006': 'mNotify rejected the sender ID — it is most likely not approved yet.',
  '1008': 'The message body was empty.',
}

function describe(payload: QuickResponse, fallback: string): string {
  const code = payload.code === undefined ? '' : String(payload.code)
  const own = (payload.message ?? '').trim()
  const hint = CODE_HINT[code]
  if (own && hint) return `${hint} (mNotify said: ${own})`
  if (own) return own
  if (hint) return hint
  return fallback
}

type BalanceResponse = {
  status?: string
  code?: string | number
  message?: string
  /** mNotify has returned this as both a number and a decimal string across
   *  versions, which is why it is never read directly. */
  balance?: number | string
  bonus?: number | string
}

/** Accepts 12, "12", "12.00" and rejects "", null and "abc" — the last of
 *  which must NOT become 0, because 0 is a meaningful balance. */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export class MnotifyService implements SmsService {
  constructor(
    private readonly apiKey: string,
    private readonly senderId: string,
  ) {}

  status(): SmsConfigStatus {
    return smsConfig()
  }

  /**
   * Ask mNotify what is left, without spending any of it.
   *
   * Everything here is defensive on purpose. The balance is ADVISORY — it
   * decorates a screen and colours a warning — so every way this can go wrong
   * resolves to `unknown` carrying the reason, and none of them throws. A
   * provider outage must not be able to stop the church sending a message that
   * would have gone out fine.
   *
   * The figure is reported, never converted. mNotify denominates an account in
   * its own units and this code has no reliable way to tell credits from cedis
   * for a given account, so inventing a currency symbol here would put a
   * confident wrong label on the one number an admin uses to decide whether to
   * top up. It is shown as the provider's own figure and named as such.
   */
  async balance(): Promise<SmsBalance> {
    let res: Response
    try {
      res = await fetch(`${BALANCE_URL}?key=${encodeURIComponent(this.apiKey)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // A balance that is minutes stale is worse than useless for deciding
        // whether a bulk send will complete.
        cache: 'no-store',
      })
    } catch (err) {
      const reason =
        err instanceof Error && err.name === 'TimeoutError'
          ? `mNotify did not answer within ${TIMEOUT_MS / 1000} seconds.`
          : err instanceof Error
            ? err.message
            : 'The balance request failed.'
      return { kind: 'unknown', reason }
    }

    const raw = await res.text()
    let payload: BalanceResponse = {}
    try {
      payload = raw ? (JSON.parse(raw) as BalanceResponse) : {}
    } catch {
      return {
        kind: 'unknown',
        reason: `mNotify returned a non-JSON balance (HTTP ${res.status}): ${raw.slice(0, 120)}`,
      }
    }

    if (!res.ok) {
      return {
        kind: 'unknown',
        reason: describe(payload as QuickResponse, `mNotify returned HTTP ${res.status}.`),
      }
    }

    const credits = toNumber(payload.balance)
    if (credits === null) {
      // Reached mNotify, got a 200, and still cannot find a number. Saying so
      // beats reporting zero — which would look exactly like an empty account
      // and send somebody to top up an account that is already funded.
      return {
        kind: 'unknown',
        reason: `mNotify did not report a balance. It said: ${raw.slice(0, 120)}`,
      }
    }

    return {
      kind: 'known',
      credits,
      bonus: toNumber(payload.bonus),
      low: credits < LOW_CREDIT_AT,
      checked_at: new Date().toISOString(),
    }
  }

  async send(recipients: string[], message: string): Promise<SmsSendOutcome> {
    if (recipients.length === 0) {
      return { kind: 'sent', accepted: [], rejected: [], provider_message: 'Nothing to send.', credit_used: 0, credit_left: null }
    }

    let res: Response
    try {
      res = await fetch(`${QUICK_SMS_URL}?key=${encodeURIComponent(this.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          recipient: recipients,
          sender: this.senderId,
          message,
          is_schedule: false,
          schedule_date: '',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // A send is never cached, and a proxy that decided otherwise would be
        // a very quiet way to text somebody yesterday's message.
        cache: 'no-store',
      })
    } catch (err) {
      // Transport, not rejection. The distinction matters: this is worth
      // retrying and the numbers are probably fine, which is the opposite of
      // what a `rejected` outcome means.
      const reason = err instanceof Error && err.name === 'TimeoutError'
        ? `mNotify did not respond within ${TIMEOUT_MS / 1000} seconds.`
        : err instanceof Error
          ? err.message
          : 'The request to mNotify failed.'
      return { kind: 'unavailable', provider_message: reason }
    }

    let payload: QuickResponse = {}
    const raw = await res.text()
    try {
      payload = raw ? (JSON.parse(raw) as QuickResponse) : {}
    } catch {
      // A non-JSON body from a 200 usually means an HTML error page from
      // something in front of the API. Keep a slice of it — it is the only
      // evidence of what actually answered.
      return {
        kind: 'unavailable',
        provider_message: `mNotify returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 200)}`,
      }
    }

    if (!res.ok) {
      // 5xx is theirs and transient; 4xx is ours and final.
      const kind = res.status >= 500 ? 'unavailable' : 'rejected'
      return { kind, provider_message: describe(payload, `mNotify returned HTTP ${res.status}.`) }
    }

    const ok = String(payload.status ?? '').toLowerCase() === 'success' || String(payload.code ?? '') === '2000'
    if (!ok) {
      return { kind: 'rejected', provider_message: describe(payload, 'mNotify refused the message.') }
    }

    const accepted = payload.summary?.numbers_sent ?? recipients
    const rejected = recipients.filter((r) => !accepted.includes(r))
    return {
      kind: 'sent',
      accepted,
      rejected,
      provider_message: describe(payload, 'Accepted by mNotify.'),
      credit_used: payload.summary?.credit_used ?? null,
      credit_left: payload.summary?.credit_left ?? null,
    }
  }
}

// --- the stub ---------------------------------------------------------------

/**
 * Accepts everything and sends nothing.
 *
 * Selected by `SMS_STUB=1`. This is what `npm run e2e` runs against: the smoke
 * test drives the real routes, the real templates, the real dedupe index and
 * the real log, and the only thing it does not do is hand a message to a
 * carrier. Without it, proving the SMS path works would mean texting real
 * members every time anybody ran the suite.
 */
export class StubSmsService implements SmsService {
  static readonly sent: { recipients: string[]; message: string }[] = []

  status(): SmsConfigStatus {
    return {
      configured: true,
      has_key: true,
      has_sender: true,
      sender_id: 'STUB',
      reason: null,
    }
  }

  async balance(): Promise<SmsBalance> {
    // Deliberately comfortable. The stub exists so `npm run e2e` can drive the
    // real routes, and a stub that reported a low balance would have the smoke
    // test asserting on a warning banner that says nothing about the code.
    return {
      kind: 'known',
      credits: 1000,
      bonus: null,
      low: false,
      checked_at: new Date().toISOString(),
    }
  }

  async send(recipients: string[], message: string): Promise<SmsSendOutcome> {
    StubSmsService.sent.push({ recipients, message })
    return {
      kind: 'sent',
      accepted: recipients,
      rejected: [],
      provider_message: `Stub: pretended to send to ${recipients.length}.`,
      credit_used: recipients.length,
      credit_left: null,
    }
  }
}

/** Refuses everything, with the reason. Never throws — an unconfigured
 *  provider is a state the screens explain, not a 500 they inherit. */
class UnconfiguredSmsService implements SmsService {
  constructor(private readonly config: SmsConfigStatus) {}
  status(): SmsConfigStatus {
    return this.config
  }
  async send(): Promise<SmsSendOutcome> {
    return { kind: 'not_configured', provider_message: this.config.reason ?? 'SMS is not set up.' }
  }
  async balance(): Promise<SmsBalance> {
    // Distinct from `unknown`: there is nothing wrong with mNotify, there is
    // no key to ask them with. The screen already explains that above, and a
    // "could not reach the provider" here would contradict it.
    return { kind: 'not_configured', reason: this.config.reason ?? 'SMS is not set up.' }
  }
}

export function createSmsService(): SmsService {
  if (process.env.SMS_STUB === '1') return new StubSmsService()
  const config = smsConfig()
  if (!config.configured) return new UnconfiguredSmsService(config)
  return new MnotifyService(process.env.MNOTIFY_API_KEY!.trim(), config.sender_id!)
}
