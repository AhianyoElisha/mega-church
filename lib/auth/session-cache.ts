// In-memory cache for `account.get()`, keyed by session cookie. Ported from
// SEMP (lib/auth/session-cache.ts), where it was introduced after profiling
// showed `account.get()` costs ~600-800ms against a self-hosted Appwrite —
// paid once by `proxy.ts` on every page nav and AGAIN by `requireRole()` on
// every API call.
//
// Both readers go through this, so the cost is at most one round-trip per
// session per TTL window.
//
// Trade: the cache lives in this Node process. After a redeploy it is cold,
// and entries are per-process if this is ever scaled horizontally. Fine for a
// church's admin workload; the alternative is the per-request tax it replaces.
//
// Eviction:
//   * TTL      — entries past `expiresAt` are dropped on next access.
//   * Capacity — bounded by MAX_ENTRIES; oldest by insertion order goes first.
//   * Manual   — `evictSession()` from /api/auth/logout, so a signed-out
//                cookie stops authenticating immediately rather than at TTL.

/** Long enough to cover a normal click-around, short enough that a demoted
 *  label takes effect within a window. */
const SESSION_TTL_MS = 30_000

const MAX_ENTRIES = 1000

export type CachedSessionUser = {
  $id: string
  email: string
  name: string
  labels: string[]
  prefs: Record<string, unknown>
}

type Entry = {
  user: CachedSessionUser
  expiresAt: number
}

const cache = new Map<string, Entry>()

/**
 * Read-through cache. A cached, non-expired entry returns immediately;
 * otherwise the fetcher runs and its result is cached. Throws propagate
 * WITHOUT being cached, so a transient Appwrite blip does not lock a user out
 * for the whole TTL.
 */
export async function getCachedSessionUser(
  session: string,
  fetcher: () => Promise<{
    $id: string
    email: string
    name?: string
    labels?: string[]
    prefs?: Record<string, unknown>
  }>,
): Promise<CachedSessionUser> {
  const now = Date.now()
  const hit = cache.get(session)
  if (hit && hit.expiresAt > now) return hit.user
  if (hit) cache.delete(session)

  const raw = await fetcher()
  const user: CachedSessionUser = {
    $id: raw.$id,
    email: raw.email,
    name: raw.name ?? '',
    labels: raw.labels ?? [],
    prefs: (raw.prefs ?? {}) as Record<string, unknown>,
  }

  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(session, { user, expiresAt: now + SESSION_TTL_MS })
  return user
}

/** `proxy.ts` only needs the labels. */
export async function getCachedUserLabels(
  session: string,
  fetcher: () => Promise<{
    $id: string
    email: string
    name?: string
    labels?: string[]
    prefs?: Record<string, unknown>
  }>,
): Promise<string[]> {
  const user = await getCachedSessionUser(session, fetcher)
  return user.labels
}

export function evictSession(session: string): void {
  cache.delete(session)
}

/** Diagnostics only. */
export function _sessionCacheSize(): number {
  return cache.size
}
