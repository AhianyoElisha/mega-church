// Shared fetch helper for every client-side query hook: one place for
// credentials, error parsing, and the 401 bounce.

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body && typeof init.body === 'string'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    // An expired session surfaces as a JSON 401 from proxy.ts (never an HTML
    // redirect, so we are not here parsing a login page as JSON). Bounce to
    // /login rather than leaving the user staring at a failed query.
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login'
    }
    // Prefer the API's own `error` string over the raw body.
    const text = await res.text().catch(() => '')
    let message = text || `${res.status} ${res.statusText}`
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (parsed?.error) message = parsed.error
    } catch {
      // not JSON — keep the raw text
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as unknown as T
  return (await res.json()) as T
}
