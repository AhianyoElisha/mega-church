'use client'

// The one thing an otherwise complete PWA cannot do for itself: invite you to
// install it.
//
// Everything installation NEEDS has been in place since Plan 2 — the manifest,
// the service worker, the maskable icons, the iOS meta tags. What was missing
// is that nothing ever SAID so. On Android the invitation is buried in
// Chrome's ⋮ menu; on iOS Safari there is no prompt at all, ever, and the only
// place this app explained "Share → Add to Home Screen" was the push banner on
// /birthdays — which a person sees only if they already went looking for
// notifications. Installability nobody is told about is indistinguishable from
// no installability, which is exactly how it was reported.
//
// Two platforms, two mechanisms, one banner:
//
//   Chromium (Android, desktop)  fires `beforeinstallprompt`. It is captured
//                                before hydration (see `app/layout.tsx`),
//                                deferred, and replayed when the person taps
//                                Install.
//   iOS Safari                   fires nothing and exposes no API whatsoever.
//                                The instruction is all there is to offer.
//
// Anything else — desktop Firefox, an in-app webview — gets NOTHING rather
// than instructions for a menu item it does not have. A banner describing a
// button that is not there is worse than silence.

import { useCallback, useEffect, useState } from 'react'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { Banner } from '@/components/ui'
import { Button } from '@/shared/Button'

/**
 * Chromium's install event. Deliberately hand-written: `beforeinstallprompt`
 * is not a standard, so it is absent from `lib.dom` and will stay absent.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface Window {
    /** Stashed by the capture script in the root layout. */
    __mcInstallEvent?: BeforeInstallPromptEvent | null
  }
}

/** Fired by that same script, so React can react to a late arrival. */
export const INSTALLABLE_EVENT = 'mc:installable'

const DISMISSED_KEY = 'megachurch.install-dismissed'

/**
 * Already installed?
 *
 * `display-mode: standalone` is the cross-platform answer; `navigator.standalone`
 * is the older iOS one and is still what an iPhone reports. An installed app
 * nagging somebody to install it is the fastest way to teach them to ignore
 * every banner this app will ever show them.
 */
function isInstalled(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/**
 * An iOS browser in an ordinary tab.
 *
 * iPadOS 13+ reports itself as a Macintosh, so the user-agent alone says
 * "desktop Safari" for a device whose only install route is the Share sheet.
 * A touch-capable Mac is that iPad.
 */
function isIOSTab(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  return ios && !isInstalled()
}

/**
 * Storage access THROWS in a private window on some browsers rather than
 * returning null, so both directions are guarded. A device that cannot
 * remember the dismissal shows the banner again, which is a far smaller
 * problem than a page that will not render.
 */
function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Nothing to do, and nothing worth saying to the person reading the page.
  }
}

export default function InstallPrompt() {
  // `null` means "not decided yet" — nothing renders during the first paint,
  // because the alternative is a banner that flashes onto the screen of
  // somebody who installed the app weeks ago.
  const [kind, setKind] = useState<'chromium' | 'ios' | null>(null)

  useEffect(() => {
    if (isInstalled() || wasDismissed()) return

    // The event may have arrived before this component ever mounted; the
    // capture script keeps it, so read the stash first and subscribe second.
    if (window.__mcInstallEvent) setKind('chromium')
    else if (isIOSTab()) setKind('ios')

    const onInstallable = () => setKind('chromium')
    const onInstalled = () => {
      // Installed from our button or from the browser's own menu — either way
      // the invitation is spent, and it must not return on the next page.
      rememberDismissal()
      setKind(null)
    }

    window.addEventListener(INSTALLABLE_EVENT, onInstallable)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener(INSTALLABLE_EVENT, onInstallable)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const dismiss = useCallback(() => {
    rememberDismissal()
    setKind(null)
  }, [])

  const install = useCallback(async () => {
    const event = window.__mcInstallEvent
    if (!event) return
    // A deferred prompt is single-use: the browser will reject a second
    // `prompt()` on the same event. Drop it whatever the person chooses, and
    // take the banner with it — re-offering an event that can no longer be
    // shown is a button that does nothing.
    window.__mcInstallEvent = null
    setKind(null)
    try {
      await event.prompt()
      const { outcome } = await event.userChoice
      if (outcome === 'dismissed') {
        // They said not now, not never. `appinstalled` never fires, so the
        // banner is simply gone for this visit and returns on the next one.
        return
      }
      rememberDismissal()
    } catch {
      // Some Chromium builds reject if the prompt is called outside a user
      // gesture they recognise. The browser's own menu still works, and an
      // error dialog about an install banner helps nobody.
    }
  }, [])

  if (!kind) return null

  return (
    <Banner tone="info" onDismiss={dismiss} className="mb-6">
      {kind === 'chromium' ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong className="font-medium">Install this app</strong> — it opens full screen from
            your home screen, and it is how this device receives birthday alerts.
          </span>
          <Button color="primary" onClick={install}>
            <ArrowDownTrayIcon data-slot="icon" />
            Install
          </Button>
        </div>
      ) : (
        <span>
          <strong className="font-medium">Add this app to your Home Screen</strong> — tap Share,
          then &ldquo;Add to Home Screen&rdquo;, and open it from there. On iPhone and iPad that is
          also the only way this device can receive birthday alerts.
        </span>
      )}
    </Banner>
  )
}
