'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AuthUser, LoginResponse, MeResponse, UserLabel } from '@/lib/auth/types'

type AuthCtx = {
  user: AuthUser | null
  ready: boolean
  login: (
    email: string,
    password: string,
  ) => Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' })
        if (!cancelled && res.ok) {
          const data = (await res.json()) as MeResponse
          setUser(data.user)
        }
      } catch {
        // Network errors leave `user` null; `ready` still flips so the UI can
        // show the login screen rather than hanging on a spinner forever.
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const login: AuthCtx['login'] = useCallback(async (email, password) => {
    let res: Response
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
    } catch {
      return { ok: false, error: 'Network error. Please try again.' }
    }
    const data = (await res.json().catch(() => null)) as LoginResponse | null
    if (!data || !data.ok) {
      return { ok: false, error: data?.ok === false ? data.error : 'Sign in failed' }
    }
    setUser(data.user)
    return { ok: true, user: data.user }
  }, [])

  const logout: AuthCtx['logout'] = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // Clear local state regardless — a failed logout call must not strand
      // the user in a signed-in-looking UI.
    }
    setUser(null)
    router.replace('/login')
  }, [router])

  return <Ctx.Provider value={{ user, ready, login, logout }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}

export function useRequireAuth(role?: UserLabel | UserLabel[]) {
  const { user, ready } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (!ready) return
    if (!user) {
      router.replace('/login')
      return
    }
    if (role) {
      const allowed = Array.isArray(role) ? role : [role]
      if (!allowed.includes(user.label)) router.replace('/login')
    }
  }, [ready, user, role, router])
  return { user, ready }
}
