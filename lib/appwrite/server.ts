import { Account, Client, Databases, Storage, Users } from 'node-appwrite'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getCachedSessionUser } from '@/lib/auth/session-cache'
import type { AuthUser, UserLabel } from '@/lib/auth/types'

export const sessionCookieName = () => `a_session_${process.env.APPWRITE_PROJECT_ID}`

/** Server SDK with the API key. Route Handlers and scripts only — the key
 *  must never reach a client bundle. */
export function createAdminClient() {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!)

  return {
    client,
    account: new Account(client),
    databases: new Databases(client),
    storage: new Storage(client),
    users: new Users(client),
  }
}

export function createSessionClientFromSecret(secret: string) {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)
    .setSession(secret)

  return {
    client,
    account: new Account(client),
    databases: new Databases(client),
    storage: new Storage(client),
  }
}

export async function createSessionClient() {
  const store = await cookies()
  const session = store.get(sessionCookieName())?.value
  if (!session) return null
  return createSessionClientFromSecret(session)
}

export type RawAuthUser = {
  $id: string
  email: string
  name: string
  labels: string[]
  prefs: Record<string, unknown>
}

export async function getAuthUser(): Promise<RawAuthUser | null> {
  const store = await cookies()
  const session = store.get(sessionCookieName())?.value
  if (!session) return null
  try {
    // Read through the same 30s cache `proxy.ts` uses — see
    // lib/auth/session-cache.ts for why this is not a direct account.get().
    return await getCachedSessionUser(session, async () => {
      const client = createSessionClientFromSecret(session)
      const user = await client.account.get()
      return {
        $id: user.$id,
        email: user.email,
        name: user.name ?? '',
        labels: user.labels ?? [],
        prefs: (user.prefs ?? {}) as Record<string, unknown>,
      }
    })
  } catch {
    return null
  }
}

const RECOGNISED_LABELS: readonly UserLabel[] = [
  'admin',
  'usher',
  'kiosk',
  'leader',
  'celebrations',
  'shepherd',
]

export function toAuthUser(raw: RawAuthUser): AuthUser | null {
  const label = RECOGNISED_LABELS.find((l) => raw.labels.includes(l))
  if (!label) return null
  const stationRaw = raw.prefs['station']
  const station = typeof stationRaw === 'string' && stationRaw.length > 0 ? stationRaw : null
  return { id: raw.$id, email: raw.email, name: raw.name, label, station }
}

/**
 * Role gate for a Route Handler. Returns the user or a ready-made response.
 *
 * Every mutating route calls this. The UI hiding a control is not security
 * (PRD §2.5).
 */
export async function requireRole(
  allowed: UserLabel | UserLabel[],
): Promise<{ user: AuthUser } | { error: NextResponse }> {
  const raw = await getAuthUser()
  if (!raw) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const user = toAuthUser(raw)
  if (!user) {
    // Authenticated but carrying no recognised label — an account that was
    // created without one. Treat as unauthenticated rather than crashing.
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const allowedList = Array.isArray(allowed) ? allowed : [allowed]
  if (!allowedList.includes(user.label)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { user }
}
