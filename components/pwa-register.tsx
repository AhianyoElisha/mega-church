'use client'

// Registers the service worker once, at the root of the app.
//
// Renders nothing. It lives in the root layout rather than on the birthdays
// page because a worker registered only when someone visits that page is a
// worker that is not running the rest of the time — and push delivery depends
// on the registration, not on any tab being open.

import { useEffect } from 'react'

export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    navigator.serviceWorker
      .register('/sw.js', {
        scope: '/',
        // Bypass the HTTP cache when checking for an updated worker. Belt and
        // braces with the no-store header in `next.config.ts`: between them, a
        // deployed fix to the push handler reaches a phone on next load rather
        // than whenever some cache decides to expire.
        updateViaCache: 'none',
      })
      .catch(() => {
        // Registration fails on http:// origins other than localhost, and in
        // private windows on some browsers. Neither is worth an error in front
        // of a user — the app works fine without a worker; it just cannot
        // receive push. `components/push-manager.tsx` is what explains that,
        // in the one place where it matters.
      })
  }, [])

  return null
}
