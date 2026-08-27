// Whether a VAPID subject is one a push service will actually accept.
//
// Pure and unit-tested, and separate from `server.ts` because the whole point
// is that it can be checked without a network, a key pair, or a device.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// The `sub` claim of a VAPID token is the address a push service contacts
// about a misbehaving sender (RFC 8292 §2.1). **Apple validates it. FCM does
// not.** So a placeholder subject produces a system that works perfectly on
// every Android phone and has never once delivered to an iPhone:
//
//     sub=mailto:admin@megachurch.local   Apple 403 BadJwtToken   FCM 201
//     sub=https://mega-church.vercel.app  Apple 201               FCM 201
//     sub=mailto:admin@<real domain>      Apple 201               FCM 201
//
// Measured against the church's own devices on 2026-08-27, same key pair, same
// ES256 header, same 12-hour `exp`, same payload — the subject was the only
// variable. `.local` is reserved by RFC 6762 and can never resolve to a
// mailbox, which is precisely why Apple refuses it.
//
// The failure is invisible from the Android side, and a 403 is not a 404/410,
// so the subscription is not even pruned: the iPhone looks like a live device
// that simply never hears anything.

/**
 * Top-level domains that can never reach a real person, so a subject under one
 * is a placeholder however well-formed it looks.
 *
 * RFC 2606 (`test`, `example`, `invalid`, `localhost`), RFC 6762 (`local`),
 * and `internal`, which ICANN reserved for private use in 2024.
 */
const RESERVED_TLDS = new Set(['local', 'localhost', 'test', 'invalid', 'example', 'internal'])

/** Whole domains reserved for documentation — RFC 2606 §3. */
const RESERVED_DOMAINS = new Set(['example.com', 'example.net', 'example.org', 'home.arpa'])

const FIX =
  'Set it to an address the push service could actually reach — the site itself ' +
  '(https://mega-church.vercel.app) or a mailto: on the church\'s real domain.'

/**
 * `null` when the subject is usable, otherwise the reason it is not.
 *
 * A reason rather than a boolean because this string is shown to whoever has to
 * fix it, and "push is not configured" without naming the variable is a message
 * that sends somebody reading source code.
 */
export function vapidSubjectProblem(raw: string | null | undefined): string | null {
  const subject = raw?.trim()
  if (!subject) {
    return (
      'VAPID_SUBJECT is not set. Apple Web Push refuses a token whose sub claim ' +
      `is not contactable, so iPhones would receive nothing. ${FIX}`
    )
  }

  let host: string
  if (subject.startsWith('mailto:')) {
    const address = subject.slice('mailto:'.length).trim()
    const at = address.lastIndexOf('@')
    if (at <= 0 || at === address.length - 1) {
      return `VAPID_SUBJECT "${subject}" is not a valid email address. ${FIX}`
    }
    host = address.slice(at + 1)
  } else if (subject.startsWith('https://')) {
    let parsed: URL
    try {
      parsed = new URL(subject)
    } catch {
      return `VAPID_SUBJECT "${subject}" is not a valid URL. ${FIX}`
    }
    host = parsed.hostname
  } else {
    // http:// is deliberately not accepted. RFC 8292 names mailto: and https:,
    // and a plaintext contact URL is not one a push service will trust.
    return (
      `VAPID_SUBJECT "${subject}" must be a mailto: or https: URI (RFC 8292 §2.1). ${FIX}`
    )
  }

  // A trailing dot is a legal fully-qualified host and must not change the verdict.
  host = host.toLowerCase().replace(/\.$/, '')
  if (!host) return `VAPID_SUBJECT "${subject}" has no host. ${FIX}`

  if (!host.includes('.')) {
    return (
      `VAPID_SUBJECT "${subject}" has no domain, so no push service can reach it. ${FIX}`
    )
  }

  if (RESERVED_DOMAINS.has(host)) {
    return (
      `VAPID_SUBJECT "${subject}" is on ${host}, which is reserved for documentation ` +
      `and reaches nobody. Apple answers 403 BadJwtToken. ${FIX}`
    )
  }

  const tld = host.slice(host.lastIndexOf('.') + 1)
  if (RESERVED_TLDS.has(tld)) {
    return (
      `VAPID_SUBJECT "${subject}" is under the reserved .${tld} domain, which can never ` +
      `resolve to a real contact. Apple answers 403 BadJwtToken and every iPhone ` +
      `silently receives nothing, while Android is unaffected. ${FIX}`
    )
  }

  return null
}
