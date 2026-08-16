'use client'

// "Turn on notifications for this device" — the control the birthday team uses.
//
// Push is per-DEVICE, not per-account: the same person has to enable it on
// their phone and again on the office desktop, because each browser holds its
// own subscription. The copy says so, because otherwise enabling it once and
// then hearing nothing on the other device reads as a broken feature.

import { useCallback, useEffect, useState } from 'react'
import { BellAlertIcon, BellSlashIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Banner, Card } from '@/components/ui'
import { apiFetch } from '@/lib/queries/fetcher'
import type { PushStatusResponse, SubscribeResponse } from '@/lib/notifications/types'

/**
 * The VAPID public key travels as URL-safe base64 and the Push API wants raw
 * bytes. Standard conversion, kept verbatim from the Next PWA guide.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  // Backed by an explicit ArrayBuffer: `new Uint8Array(n)` widens to
  // `ArrayBufferLike`, which includes SharedArrayBuffer and so is not a valid
  // `BufferSource` for `applicationServerKey`.
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

type State =
  | { kind: 'checking' }
  /** No service worker or no PushManager — an old browser, or plain http://. */
  | { kind: 'unsupported' }
  /** The server has no VAPID keys. A configuration gap, not a user problem. */
  | { kind: 'unconfigured' }
  /** The user previously chose "Block". Only they can undo it, in site settings. */
  | { kind: 'denied' }
  | { kind: 'off'; vapidKey: string }
  | { kind: 'on'; vapidKey: string }

export default function PushManager() {
  const [state, setState] = useState<State>({ kind: 'checking' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSubscribed, setJustSubscribed] = useState(false)

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState({ kind: 'unsupported' })
      return
    }

    let status: PushStatusResponse
    try {
      status = await apiFetch<PushStatusResponse>('/api/push')
    } catch {
      setState({ kind: 'unsupported' })
      return
    }
    if (!status.vapid_public_key) {
      setState({ kind: 'unconfigured' })
      return
    }
    if (Notification.permission === 'denied') {
      setState({ kind: 'denied' })
      return
    }

    // The browser's own subscription is the source of truth for THIS device,
    // not the server's device list: the list can hold a phone that has since
    // cleared its site data, and showing "on" there would be a lie.
    const registration = await navigator.serviceWorker.ready.catch(() => null)
    const existing = await registration?.pushManager.getSubscription().catch(() => null)
    setState({
      kind: existing ? 'on' : 'off',
      vapidKey: status.vapid_public_key,
    })
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const enable = async () => {
    if (state.kind !== 'off') return
    setBusy(true)
    setError(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? { kind: 'denied' } : state)
        return
      }

      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.subscribe({
        // Required by every browser: a push must always show something. The
        // service worker's fallback notification honours this even when the
        // payload fails to parse.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.vapidKey),
      })

      // `toJSON()` rather than reading `.endpoint` and `.getKey()` by hand: the
      // keys come back as ArrayBuffers otherwise and have to be base64-encoded
      // manually, which is one more place to get the URL-safe alphabet wrong.
      const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> }
      const res = await apiFetch<SubscribeResponse>('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          device_label: deviceLabel(),
        }),
      })
      if (!res.ok) {
        // The browser accepted it but the server did not store it, so undo the
        // browser side — otherwise this device is subscribed to a push service
        // that nothing will ever send to, and the UI would say "on".
        await sub.unsubscribe().catch(() => {})
        setError(res.error)
        return
      }
      setJustSubscribed(true)
      setState({ kind: 'on', vapidKey: state.vapidKey })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn notifications on.')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    setError(null)
    try {
      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.getSubscription()
      if (sub) {
        // Server first: if the browser unsubscribes and the server call then
        // fails, the row is left behind and every future run wastes a send on
        // an endpoint that has gone.
        await apiFetch('/api/push/unsubscribe', {
          method: 'POST',
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe()
      }
      setJustSubscribed(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn notifications off.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-950 dark:text-white">
            {state.kind === 'on' ? (
              <BellAlertIcon className="size-5 text-primary-600" />
            ) : (
              <BellSlashIcon className="size-5 text-neutral-400" />
            )}
            Notifications on this device
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {copyFor(state)}
          </p>
        </div>

        {state.kind === 'off' && (
          <Button color="primary" onClick={enable} disabled={busy}>
            {busy ? 'Turning on…' : 'Turn on'}
          </Button>
        )}
        {state.kind === 'on' && (
          <Button plain onClick={disable} disabled={busy}>
            {busy ? 'Turning off…' : 'Turn off'}
          </Button>
        )}
      </div>

      {error && (
        <Banner tone="error" className="mt-4" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {justSubscribed && (
        <Banner tone="success" className="mt-4">
          This device will now be alerted the day before every birthday.
        </Banner>
      )}

      {/*
        iOS is the case that catches people out: Safari delivers Web Push only
        to a PWA that has been added to the home screen. Someone tapping "Turn
        on" in a normal Safari tab gets no prompt and no error — so say it
        before they try, not after.
      */}
      {isIOSSafariTab() && state.kind !== 'on' && (
        <Banner tone="info" className="mt-4">
          On iPhone and iPad you must first add this app to the Home Screen — tap Share, then
          &ldquo;Add to Home Screen&rdquo; — and open it from there. Safari does not deliver
          notifications to an ordinary tab.
        </Banner>
      )}
    </Card>
  )
}

function copyFor(state: State): string {
  switch (state.kind) {
    case 'checking':
      return 'Checking…'
    case 'unsupported':
      return 'This browser cannot receive notifications. Try Chrome, Edge, Firefox, or an installed app on iPhone.'
    case 'unconfigured':
      return 'Notifications are not set up on the server yet. An administrator needs to generate the VAPID keys — see the README.'
    case 'denied':
      return 'Notifications are blocked for this site. Allow them in your browser’s site settings, then reload this page.'
    case 'off':
      return 'Off. Turn them on and this device will buzz the day before every birthday, even when the app is closed. Each phone and computer has to be turned on separately.'
    case 'on':
      return 'On. You will be alerted the day before every birthday. This setting only covers the device you are reading this on.'
  }
}

/** Something recognisable in the device list. Best-effort, never precise. */
function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Unknown device'
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android phone'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  return 'This device'
}

function isIOSSafariTab(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  if (!isIOS) return false
  // `display-mode: standalone` is true only once it has been installed.
  return !window.matchMedia('(display-mode: standalone)').matches
}
