'use client'

// Realtime adapter for attendance rows. Ported from SEMP.
//
// This is the ONLY place outside lib/appwrite/client.ts that talks to the
// browser SDK directly; every other browser→data read goes through a Route
// Handler.
//
// Auth model: the browser holds an Appwrite session cookie for the app domain,
// which the Realtime websocket cannot use. So the page asks the server to mint
// a short-lived JWT bound to the current user, and `setJWT` it before the first
// subscribe. Collection permissions still apply server-side — this adds no new
// authorisation surface.

import { Client } from 'appwrite'
import { COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'
import type { AttendanceRecord } from '@/lib/attendance/types'

const JWT_DURATION_MS = 15 * 60_000 // Appwrite's default
const JWT_REFRESH_AHEAD_MS = 60_000

let cachedJwt: { token: string; expiresAt: number } | null = null
let cachedClient: Client | null = null

async function mintJwt(): Promise<string> {
  const res = await fetch('/api/auth/realtime-jwt', { method: 'POST', credentials: 'same-origin' })
  if (!res.ok) throw new Error(`Realtime token request failed (${res.status})`)
  const data = (await res.json()) as { jwt: string }
  cachedJwt = {
    token: data.jwt,
    expiresAt: Date.now() + JWT_DURATION_MS - JWT_REFRESH_AHEAD_MS,
  }
  return data.jwt
}

async function getAuthedClient(): Promise<Client> {
  const jwt = cachedJwt && cachedJwt.expiresAt > Date.now() ? cachedJwt.token : await mintJwt()
  if (!cachedClient) {
    cachedClient = new Client()
      .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
      .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  }
  cachedClient.setJWT(jwt)
  return cachedClient
}

/**
 * Subscribe to new attendance rows for one occurrence.
 *
 * Appwrite's Realtime channel surface is "documents in a collection" — there is
 * no server-side filter — so everything from the collection arrives and the
 * occurrence filter happens in the listener. During a service that is a
 * handful of messages a second at most.
 *
 * Returns a teardown function. The caller MUST call it on unmount, or a page
 * left open all morning accumulates timers and sockets.
 */
export async function subscribeToOccurrence(
  occurrenceId: string,
  onRecord: (record: AttendanceRecord) => void,
): Promise<() => void> {
  const client = await getAuthedClient()
  const channel = `databases.${DATABASE_ID}.collections.${COLLECTIONS.attendance_records}.documents`

  type Doc = AttendanceRecord

  const unsubscribe = client.subscribe<Doc>(channel, (payload) => {
    // Only creates — an attendance row is never mutated after it is written.
    if (!payload.events.some((e) => e.endsWith('.create'))) return
    if (payload.payload.occurrence_id !== occurrenceId) return
    onRecord(payload.payload)
  })

  // Re-mint while the page stays open. `setJWT` mutates the client without
  // tearing down the socket.
  const refreshTimer = setInterval(() => {
    void mintJwt()
      .then((jwt) => cachedClient?.setJWT(jwt))
      .catch(() => {
        // A failed refresh is not fatal — the poll in useLiveStats is the
        // backstop, and the next mount will try again.
      })
  }, JWT_DURATION_MS - JWT_REFRESH_AHEAD_MS)

  return () => {
    clearInterval(refreshTimer)
    unsubscribe()
  }
}
