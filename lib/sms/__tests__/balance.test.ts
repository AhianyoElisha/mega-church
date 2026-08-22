import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOW_CREDIT_AT, MnotifyService, StubSmsService } from '@/lib/sms/mnotify'

const svc = () => new MnotifyService('test-key', 'CHURCH')

/** mNotify answering with `body`, as a 200 unless told otherwise. */
function respondWith(body: string, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MnotifyService.balance', () => {
  it('reads a numeric balance', async () => {
    respondWith(JSON.stringify({ status: 'success', balance: 250, bonus: 10 }))
    const b = await svc().balance()
    expect(b).toMatchObject({ kind: 'known', credits: 250, bonus: 10, low: false })
  })

  it('reads a balance mNotify sent as a decimal STRING', async () => {
    // Their API has returned this field both ways across versions, so the
    // string form is not an edge case, it is the other half of normal.
    respondWith(JSON.stringify({ status: 'success', balance: '120.00' }))
    const b = await svc().balance()
    expect(b).toMatchObject({ kind: 'known', credits: 120, bonus: null })
  })

  it('never puts the API key anywhere but the query string it must go in', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ balance: 1 })))
    vi.stubGlobal('fetch', spy)
    await svc().balance()
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('key=test-key')
    expect(JSON.stringify(init.headers ?? {})).not.toContain('test-key')
  })

  it('flags low strictly BELOW the threshold, not at it', async () => {
    // A boundary worth pinning: an account sitting exactly on the threshold is
    // not yet in trouble, and a warning that cries wolf at the boundary is one
    // the church learns to dismiss.
    respondWith(JSON.stringify({ balance: LOW_CREDIT_AT }))
    expect(await svc().balance()).toMatchObject({ low: false })

    respondWith(JSON.stringify({ balance: LOW_CREDIT_AT - 1 }))
    expect(await svc().balance()).toMatchObject({ low: true })
  })

  it('treats a balance of ZERO as a real, known balance', async () => {
    // The whole reason `toNumber` refuses to coerce junk to 0: an empty
    // account and an unreadable response must not look identical.
    respondWith(JSON.stringify({ status: 'success', balance: 0 }))
    expect(await svc().balance()).toMatchObject({ kind: 'known', credits: 0, low: true })
  })

  it('reports UNKNOWN — not zero — when a 200 carries no balance at all', async () => {
    // The failure being prevented: reporting 0 here sends somebody to top up
    // an account that is already funded, or worse, stops a send that would
    // have worked.
    respondWith(JSON.stringify({ status: 'success' }))
    const b = await svc().balance()
    expect(b.kind).toBe('unknown')
    if (b.kind === 'unknown') expect(b.reason).toContain('did not report a balance')
  })

  it('reports UNKNOWN when the field is present but not a number', async () => {
    respondWith(JSON.stringify({ balance: 'unavailable' }))
    expect((await svc().balance()).kind).toBe('unknown')
  })

  it('survives an HTML error page from something in front of the API', async () => {
    respondWith('<html>502 Bad Gateway</html>')
    const b = await svc().balance()
    expect(b.kind).toBe('unknown')
    if (b.kind === 'unknown') expect(b.reason).toContain('non-JSON')
  })

  it('reports UNKNOWN on a 4xx rather than throwing', async () => {
    respondWith(JSON.stringify({ code: '1004', message: 'Invalid API key' }), 401)
    const b = await svc().balance()
    expect(b.kind).toBe('unknown')
    if (b.kind === 'unknown') expect(b.reason).toContain('Invalid API key')
  })

  it('does not throw when the network is gone', async () => {
    // The load-bearing property: a balance lookup informs a decision, so a
    // provider outage must never become an error in front of a working send.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND api.mnotify.com')
      }),
    )
    const b = await svc().balance()
    expect(b.kind).toBe('unknown')
    if (b.kind === 'unknown') expect(b.reason).toContain('ENOTFOUND')
  })

  it('names a timeout as a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('timed out')
        err.name = 'TimeoutError'
        throw err
      }),
    )
    const b = await svc().balance()
    expect(b.kind).toBe('unknown')
    if (b.kind === 'unknown') expect(b.reason).toContain('did not answer')
  })
})

describe('StubSmsService.balance', () => {
  it('reports a comfortable balance so the smoke test never trips the warning', async () => {
    expect(await new StubSmsService().balance()).toMatchObject({ kind: 'known', low: false })
  })
})
