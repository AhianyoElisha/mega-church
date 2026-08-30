import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/appwrite/server'
import { LOW_CREDIT_AT, createSmsService } from '@/lib/sms/mnotify'
import type { SmsBalanceResponse } from '@/lib/sms/types'

/**
 * GET /api/sms/balance — what mNotify says is left.
 *
 * Admin only, and that is not incidental. The balance is a fact about the
 * church's account with a paid provider, and the key that reads it is the same
 * key that spends it; an usher has no reason to hold either.
 *
 * ── Why this always answers 200 ─────────────────────────────────────────────
 *
 * A failed lookup is reported as `kind: 'unknown'` inside a successful
 * response rather than as an error status. The distinction is the whole point
 * of the endpoint: this number decorates a screen and colours a warning, so a
 * provider outage must degrade to "we could not check" beside a working Send
 * button, never to an error that implies sending is broken when it is not.
 *
 * `ok: false` is therefore reserved for the caller being wrong — which, past
 * the role check, they cannot be.
 *
 * Not cached, by omission of any revalidate: a balance is only useful fresh,
 * and a cached one would keep reporting credit that has already been spent.
 */
export async function GET() {
  // The treasurer spends this credit, so they see what is left of it. A
  // sender who cannot see the balance finds out it ran dry from the
  // congregation.
  const auth = await requireRole(['admin', 'treasurer'])
  if ('error' in auth) return auth.error

  const balance = await createSmsService().balance()

  return NextResponse.json<SmsBalanceResponse>({
    ok: true,
    balance,
    // Sent alongside so the screen can say "below 50" without hard-coding a
    // number that lives in `lib/sms/mnotify.ts`. Two places holding the same
    // threshold is two places that disagree after somebody raises one.
    low_at: LOW_CREDIT_AT,
  })
}
