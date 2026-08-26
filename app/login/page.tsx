'use client'

// Sign-in. Same construction as PickLT's `(auth)/login/page.tsx` — centred
// logo, `max-w-md` stack, rounded-xl fields with a hugeicon in the reveal
// button — trimmed to one method, because this is a staff tool and there is no
// self-service sign-up.

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { ArrowRight01Icon, ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import Logo from '@/shared/Logo'
import { useAuth } from '@/components/auth'
import type { UserLabel } from '@/lib/auth/types'

// Must agree with LABEL_HOMES in `proxy.ts`. Disagreeing sends a role to a page
// the proxy immediately redirects away from, which reads as a login that
// "flickers" and lands somewhere unexpected.
const HOME_FOR: Record<UserLabel, string> = {
  admin: '/',
  usher: '/monitor',
  kiosk: '/kiosk',
  leader: '/my-groups',
  celebrations: '/birthdays',
  shepherd: '/members',
}

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, ready, login } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const redirect = searchParams.get('redirect')

  // Already signed in — send them where they belong rather than showing a form
  // they will only be bounced away from.
  useEffect(() => {
    if (ready && user) router.replace(redirect || HOME_FOR[user.label])
  }, [ready, user, redirect, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)
    const res = await login(email.trim(), password)
    setIsSubmitting(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.replace(redirect || HOME_FOR[res.user.label])
  }

  return (
    <div className="container pb-16">
      <div className="my-16 flex justify-center">
        <Logo markClassName="size-20" href="/login" />
      </div>

      <div className="mx-auto max-w-md space-y-6">
        <h1 className="text-center text-xl font-semibold text-neutral-900 dark:text-white">
          Sign in
        </h1>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-center dark:border-red-800 dark:bg-red-900/20"
          >
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              autoFocus
              placeholder="you@church.org"
              className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 placeholder-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder-neutral-500"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 pr-12 text-sm text-neutral-900 placeholder-neutral-400 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder-neutral-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                <HugeiconsIcon icon={showPassword ? ViewOffIcon : ViewIcon} size={18} strokeWidth={1.5} />
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-primary-600 disabled:opacity-50"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
            {!isSubmitting && <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.5} />}
          </button>
        </form>

        <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
          Accounts are created by a church administrator.
        </p>
      </div>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense
      fallback={<div className="flex min-h-[50vh] items-center justify-center">Loading…</div>}
    >
      <LoginContent />
    </Suspense>
  )
}
