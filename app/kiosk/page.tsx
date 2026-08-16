'use client'

// The check-in screen. Ported from SEMP's kiosk, re-pointed at the church
// domain and re-skinned in white/yellow/black.
//
// What came across, and why each piece exists:
//
//   * TWO health probes, not one. The bridge probe runs in the browser and
//     only proves a scanner is attached to THIS machine. The matcher probe
//     asks the server whether it can identify anything at all. Conflating
//     them cost SEMP a full session: every scan came back "not recognised",
//     which looked biometric and was configuration.
//   * TWO capture sources behind one loop — the local bridge on a PC, WebUSB
//     on a tablet. Both yield the same `xyt:` template; nothing below the
//     capture call knows which ran.
//   * An offline queue in localStorage, because a church hall's wifi is a
//     church hall's wifi and a dropped scan is a person marked absent.
//   * A manual fallback with a photo confirmation step, for the member whose
//     finger will not read.
//   * Fullscreen, because a kiosk on a table should not show a URL bar.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  FingerPrintIcon,
} from '@heroicons/react/24/outline'
import Logo from '@/shared/Logo'
import { useAuth } from '@/components/auth'
import { useDialog } from '@/components/dialog'
import { BRIDGE_URL, bridgeScan } from '@/lib/queries/biometrics'
import { Fs81Device, isWebUsbSupported } from '@/lib/biometrics/webusb'
import { extractTemplate } from '@/lib/biometrics/nbis-wasm'
import { memberPhotoUrl } from '@/lib/members/photo'
import type { ScanResponse, ScanResult } from '@/lib/attendance/types'
import type { ActiveSessionResponse, ActiveSession } from '@/lib/meetings/types'

type Phase =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'result'; result: ScanResult }
  | { kind: 'manual' }
  | { kind: 'manual_pending' }
  // Two-step manual flow: after a dry-run lookup we land here with the
  // resolved member so an usher can check the photo against the person in
  // front of them before the check-in is committed.
  | { kind: 'manual_confirm' | 'manual_committing'; result: ScanResult }

type QueuedScan = { ts: number; payload: { fingerprint_data: string } }

const RESULT_AUTO_RESET_MS = 5_000
const ACTIVE_POLL_MS = 20_000
const QUEUE_RETRY_MS = 30_000
const QUEUE_STORAGE_KEY = 'church.kiosk.pending'
const BRIDGE_HEALTH_POLL_MS = 10_000
// Slower than the bridge poll: this answer crosses the network and changes on
// deploys, not on presses.
const MATCHER_HEALTH_POLL_MS = 30_000
const SCAN_TIMEOUT_S = 25
const BRIDGE_BUSY_RETRY_MS = 1_000

export default function KioskPage() {
  const { user, ready, logout } = useAuth()
  const dialog = useDialog()

  const [session, setSession] = useState<ActiveSession | null>(null)
  const [now, setNow] = useState<Date>(() => new Date())
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [pending, setPending] = useState<QueuedScan[]>([])
  const [offline, setOffline] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Wall clock.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  // --- active session heartbeat -------------------------------------------

  const refreshActive = useCallback(async () => {
    try {
      const res = await fetch('/api/attendance/active', { cache: 'no-store' })
      if (res.status === 401) {
        await logout()
        return
      }
      const data = (await res.json()) as ActiveSessionResponse
      setSession(data.ok ? data.session : null)
    } catch {
      // Network errors do NOT clear the cached session — a flaky connection
      // must not blank the screen mid-service.
    }
  }, [logout])

  useEffect(() => {
    if (!ready || !user) return
    refreshActive()
    const id = window.setInterval(refreshActive, ACTIVE_POLL_MS)
    return () => window.clearInterval(id)
  }, [ready, user, refreshActive])

  // --- offline queue -------------------------------------------------------

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY)
      if (raw) setPending(JSON.parse(raw) as QueuedScan[])
    } catch {
      // Corrupt storage — start empty rather than crash the kiosk.
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(pending))
    } catch {
      // Storage full or private mode — carry on in memory.
    }
  }, [pending])

  useEffect(() => {
    const onOnline = () => setOffline(false)
    const onOffline = () => setOffline(true)
    setOffline(!navigator.onLine)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const drainingRef = useRef(false)
  const drainQueue = useCallback(async () => {
    if (drainingRef.current || pending.length === 0) return
    drainingRef.current = true
    try {
      const remaining: QueuedScan[] = []
      for (const item of pending) {
        try {
          const res = await fetch('/api/attendance/scan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(item.payload),
          })
          // 423 means the session closed while this sat in the queue — the
          // scan can no longer land anywhere meaningful, so drop it rather
          // than retrying forever.
          if (!res.ok && res.status !== 423) remaining.push(item)
        } catch {
          remaining.push(item)
        }
      }
      setPending(remaining)
    } finally {
      drainingRef.current = false
    }
  }, [pending])

  useEffect(() => {
    if (pending.length === 0) return
    const id = window.setInterval(drainQueue, QUEUE_RETRY_MS)
    return () => window.clearInterval(id)
  }, [pending.length, drainQueue])

  useEffect(() => {
    if (!offline && pending.length > 0) drainQueue()
  }, [offline, pending.length, drainQueue])

  // --- submit --------------------------------------------------------------

  const submitScan = useCallback(
    async (fingerprint_data: string) => {
      setPhase({ kind: 'scanning' })
      const payload = { fingerprint_data }
      try {
        const res = await fetch('/api/attendance/scan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.status === 401) {
          // The session died (a rotated kiosk password, say). Say so by
          // returning to the login screen — masquerading as "not recognised"
          // sends people chasing a biometric ghost.
          await logout()
          return
        }
        if (res.status === 423) {
          setSession(null)
          setPhase({ kind: 'idle' })
          return
        }
        const data = (await res.json()) as ScanResponse
        if (!data.ok) {
          // 503 is "this server cannot match", which is NOT a non-match. Show
          // the server's own sentence rather than inventing one.
          setServerError(data.error)
          setPhase({ kind: 'idle' })
          return
        }
        setServerError(null)
        setSession(data.session)
        setPhase({ kind: 'result', result: data.result })
      } catch {
        // Network failure — queue it and tell the person it is saved. A
        // dropped scan is a person marked absent.
        setPending((prev) => [...prev, { ts: Date.now(), payload }])
        setOffline(true)
        setPhase({ kind: 'idle' })
      }
    },
    [logout],
  )

  // --- capture sources -----------------------------------------------------

  const [bridgeUp, setBridgeUp] = useState(false)

  useEffect(() => {
    if (!ready || !user) return
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch(`${BRIDGE_URL}/health`, { cache: 'no-store' })
        const h = (await res.json()) as { ok?: boolean; device?: boolean }
        if (!cancelled) setBridgeUp(Boolean(h.ok && h.device))
      } catch {
        if (!cancelled) setBridgeUp(false)
      }
    }
    check()
    const id = window.setInterval(check, BRIDGE_HEALTH_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [ready, user])

  // The check above runs in the BROWSER, so it only proves the scanner is on
  // this machine. Identification runs on the SERVER, and a server that cannot
  // match returns no_match for every scan — indistinguishable from an unknown
  // finger. Ask the server directly, and refuse to arm the loop if the answer
  // is no.
  const [matcherFault, setMatcherFault] = useState<string | null>(null)

  useEffect(() => {
    if (!ready || !user) return
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch('/api/biometrics/matcher-health', { cache: 'no-store' })
        const body = (await res.json()) as {
          matcher?: { configured?: boolean; reachable?: boolean | null; detail?: string }
        }
        if (cancelled) return
        const m = body.matcher
        const healthy = Boolean(m && m.configured && m.reachable !== false)
        setMatcherFault(healthy ? null : (m?.detail ?? 'This server cannot identify fingerprints.'))
      } catch {
        // A failed probe is not proof of a broken matcher — the page may
        // simply be offline. Leave the last known verdict alone.
      }
    }
    check()
    const id = window.setInterval(check, MATCHER_HEALTH_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [ready, user])

  const [usbDevice, setUsbDevice] = useState<Fs81Device | null>(null)
  const [usbBusy, setUsbBusy] = useState(false)
  const [usbError, setUsbError] = useState<string | null>(null)
  const usbSupported = isWebUsbSupported()

  // WebUSB permission is per-origin and persists, so a tablet grants once and
  // reconnects silently forever after. Open here rather than lazily on the
  // first press: opening resynchronises the bulk pipe, and a failure belongs on
  // the connect screen where an usher can act on it, not mid-queue.
  useEffect(() => {
    if (!usbSupported || bridgeUp) return
    let cancelled = false
    ;(async () => {
      try {
        const d = await Fs81Device.getAlreadyPermitted()
        if (!d) return
        await d.open()
        if (!cancelled) setUsbDevice(d)
      } catch (e) {
        if (!cancelled) setUsbError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [usbSupported, bridgeUp])

  // A tab that vanishes mid-frame strands the rest of that frame on the
  // scanner's IN endpoint, and the next page load reads those pixels where the
  // geometry should be. Hand the device back on the way out.
  useEffect(() => {
    if (!usbDevice) return
    const release = () => {
      usbDevice.close().catch(() => {})
    }
    window.addEventListener('pagehide', release)
    return () => {
      window.removeEventListener('pagehide', release)
      release()
    }
  }, [usbDevice])

  const connectUsb = useCallback(async () => {
    setUsbError(null)
    setUsbBusy(true)
    try {
      const device = await Fs81Device.request()
      await device.open()
      setUsbDevice(device)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setUsbError(/no device selected|cancelled/i.test(msg) ? null : msg)
    } finally {
      setUsbBusy(false)
    }
  }, [])

  const captureSource: 'bridge' | 'webusb' | null = bridgeUp
    ? 'bridge'
    : usbDevice
      ? 'webusb'
      : null

  // Scanning is only offered when BOTH halves work: a scanner is reachable
  // from this device, and the server can identify what it captures.
  const scanReady = captureSource !== null && matcherFault === null

  // --- capture loop --------------------------------------------------------
  // Armed only while idle with a session open. Each round is one long-poll
  // capture; `waitClear` forces the platen to empty first so one press cannot
  // check the same person in twice. Leaving idle tears the loop down.
  const sessionId = session?.occurrence.$id ?? null

  useEffect(() => {
    if (!scanReady || !sessionId || phase.kind !== 'idle') return
    let cancelled = false
    // Without this the torn-down loop keeps driving the scanner for up to
    // SCAN_TIMEOUT_S while the next one arms — two command sequences on one
    // bulk pipe, which desyncs it until the device is replugged.
    const abort = new AbortController()

    ;(async () => {
      while (!cancelled) {
        if (captureSource === 'webusb') {
          if (!usbDevice) break
          try {
            const frame = await usbDevice.captureFinger({
              timeoutMs: SCAN_TIMEOUT_S * 1000,
              waitClear: true,
              signal: abort.signal,
            })
            if (cancelled) break
            const { template } = await extractTemplate(frame.pixels, frame.width, frame.height)
            await submitScan(template)
            break
          } catch (e) {
            if (cancelled) break
            const msg = e instanceof Error ? e.message : String(e)
            if (msg === 'no_finger') continue // quiet timeout — re-arm
            // The tablet lost the device. Drop to manual until it is back.
            setUsbError(msg)
            setUsbDevice(null)
            break
          }
        }

        const scan = await bridgeScan(SCAN_TIMEOUT_S, { waitClear: true })
        if (cancelled) break
        if (scan.ok) {
          await submitScan(scan.template)
          break
        }
        if (scan.error === 'no_finger') continue
        if (scan.error === 'busy') {
          await new Promise((r) => setTimeout(r, BRIDGE_BUSY_RETRY_MS))
          continue
        }
        // Hardware fault or bridge gone — manual only until health recovers.
        setBridgeUp(false)
        break
      }
    })()

    return () => {
      cancelled = true
      abort.abort()
    }
  }, [scanReady, captureSource, usbDevice, sessionId, phase.kind, submitScan])

  // --- manual flow ---------------------------------------------------------

  const [manualQuery, setManualQuery] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)
  const [manualMemberId, setManualMemberId] = useState<string | null>(null)

  const lookupManual = useCallback(async (memberId: string) => {
    setManualError(null)
    setManualMemberId(memberId)
    setPhase({ kind: 'manual_pending' })
    try {
      const res = await fetch('/api/attendance/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, dry_run: true }),
      })
      const data = (await res.json()) as ScanResponse
      if (!data.ok) {
        setManualError(data.error)
        setPhase({ kind: 'manual' })
        return
      }
      setSession(data.session)
      // Only a would-be new mark needs confirming; everything else is already
      // its own final answer.
      if (data.result.kind === 'marked') {
        setPhase({ kind: 'manual_confirm', result: data.result })
      } else {
        setPhase({ kind: 'result', result: data.result })
      }
    } catch {
      setManualError('Network error. Please try again.')
      setPhase({ kind: 'manual' })
    }
  }, [])

  const confirmManual = useCallback(async () => {
    if (!manualMemberId) return
    setPhase((p) =>
      p.kind === 'manual_confirm' ? { kind: 'manual_committing', result: p.result } : p,
    )
    try {
      const res = await fetch('/api/attendance/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ member_id: manualMemberId }),
      })
      const data = (await res.json()) as ScanResponse
      if (!data.ok) {
        setManualError(data.error)
        setPhase({ kind: 'manual' })
        return
      }
      setSession(data.session)
      setManualQuery('')
      setManualMemberId(null)
      setPhase({ kind: 'result', result: data.result })
    } catch {
      setManualError('Network error during check-in. Please try again.')
      setPhase({ kind: 'manual' })
    }
  }, [manualMemberId])

  // Auto-reset result panels so the next person walks up to a ready screen.
  useEffect(() => {
    if (phase.kind !== 'result') return
    const id = window.setTimeout(() => setPhase({ kind: 'idle' }), RESULT_AUTO_RESET_MS)
    return () => window.clearTimeout(id)
  }, [phase])

  // --- fullscreen ----------------------------------------------------------

  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    onChange()
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }, [])

  const handleSignOut = useCallback(async () => {
    const ok = await dialog.confirm({
      title: 'Sign out of this kiosk?',
      message: 'Any queued scans will be lost.',
      confirmText: 'Sign out',
      tone: 'danger',
    })
    if (ok) await logout()
  }, [dialog, logout])

  const wallClock = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Africa/Accra',
      }).format(now),
    [now],
  )

  if (!ready || !user) return null

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-white">
      {/* Chrome */}
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
        <div className="flex items-center gap-3">
          {/* Points at /kiosk, not / — a kiosk account is redirected away from
              the app root, so a home link here would be a dead end. */}
          <Logo href="/kiosk" markOnly markClassName="size-8" />
          <div className="rounded-full bg-primary-500 px-4 py-1.5 text-sm font-bold text-neutral-950">
            {user.station ?? 'Check-in'}
          </div>
        </div>
        <div className="font-mono text-base text-white/60 tabular-nums">{wallClock}</div>
        <div className="flex items-center gap-2">
          {session ? (
            <span className="rounded-full bg-primary-500/20 px-3 py-1 text-sm font-semibold text-primary-400">
              ● {session.meeting.name}
            </span>
          ) : (
            <span className="rounded-full bg-white/10 px-3 py-1 text-sm text-white/60">
              ◐ No session
            </span>
          )}
          <button
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
            className="flex size-8 cursor-pointer items-center justify-center rounded-md border border-white/20 bg-white/10"
          >
            {isFullscreen ? (
              <ArrowsPointingInIcon className="size-4" />
            ) : (
              <ArrowsPointingOutIcon className="size-4" />
            )}
          </button>
          {/* Hidden in full screen — the kiosk is locked to this view during a
              service; exit full screen to reveal the way out. */}
          {/* Hidden in full screen along with sign-out: during a service the
              kiosk is locked to this view. Exit full screen to get both. */}
          {!isFullscreen && (
            <Link
              href="/setup"
              className="rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-sm"
            >
              Setup
            </Link>
          )}
          {!isFullscreen &&
            (user.label === 'kiosk' ? (
              <button
                onClick={handleSignOut}
                className="cursor-pointer rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-sm"
              >
                Sign out
              </button>
            ) : (
              <Link
                href="/"
                className="rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-sm"
              >
                ← Back
              </Link>
            ))}
        </div>
      </header>

      {(offline || pending.length > 0) && (
        <div className="bg-primary-500 px-5 py-2 text-center text-base font-bold text-neutral-950">
          {offline ? 'OFFLINE' : 'RECONNECTING'} — {pending.length} scan
          {pending.length === 1 ? '' : 's'} saved, will sync automatically
        </div>
      )}

      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        {session && (
          <h1 className="kiosk-headline max-w-4xl text-center text-white">
            {session.meeting.name}
          </h1>
        )}

        {/* When the SERVER cannot identify fingerprints, say so here rather
            than letting every press come back "not recognised". Colour is
            never the only signal — the heading carries the meaning in words. */}
        {matcherFault && (
          <div
            role="alert"
            className="max-w-3xl rounded-2xl border-2 border-red-500 bg-red-950/40 px-6 py-5"
          >
            <p className="mb-2 text-xl font-bold text-red-400">
              Fingerprint check-in unavailable on this server
            </p>
            <p className="text-base leading-snug text-white/90">{matcherFault}</p>
            <p className="mt-2 text-base font-semibold text-white/80">
              Use manual check-in below. Members can still be marked present.
            </p>
            {/* The one place this link matters most: whoever is reading this
                banner is the person who needs the diagnostic, and they are
                signed in as the kiosk with no account menu to find it in. */}
            <Link
              href="/setup"
              className="mt-3 inline-block rounded-lg border border-white/25 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
            >
              Run the setup check →
            </Link>
          </div>
        )}

        {serverError && !matcherFault && (
          <div
            role="alert"
            className="max-w-3xl rounded-2xl border-2 border-red-500 bg-red-950/40 px-6 py-4 text-base text-white/90"
          >
            {serverError}
          </div>
        )}

        {/* A tablet grants WebUSB once, then never again. Hidden entirely on a
            PC whose bridge is up. */}
        {!bridgeUp && usbSupported && !usbDevice && (
          <div className="flex max-w-md flex-col items-center gap-2">
            <button
              onClick={connectUsb}
              disabled={usbBusy}
              className="cursor-pointer rounded-xl bg-primary-500 px-6 py-3 text-lg font-bold text-neutral-950 disabled:opacity-60"
            >
              {usbBusy ? 'Connecting…' : 'Connect fingerprint scanner'}
            </button>
            <p className="text-center text-sm text-white/70">
              Plug the scanner into this tablet, then tap to allow access. Once only.
            </p>
            {usbError && (
              <p role="alert" className="text-center text-sm font-semibold text-red-400">
                Scanner not connected: {usbError}
              </p>
            )}
          </div>
        )}

        {!session ? (
          <WaitingPanel />
        ) : phase.kind === 'idle' ? (
          <IdlePanel
            scannerActive={scanReady}
            restricted={session.meeting.restricted}
            onManual={() => {
              setManualError(null)
              setPhase({ kind: 'manual' })
            }}
          />
        ) : phase.kind === 'scanning' ? (
          <ScanningPanel />
        ) : phase.kind === 'manual' || phase.kind === 'manual_pending' ? (
          <ManualPanel
            query={manualQuery}
            setQuery={setManualQuery}
            error={manualError}
            pending={phase.kind === 'manual_pending'}
            onPick={lookupManual}
            onBack={() => {
              setManualError(null)
              setPhase({ kind: 'idle' })
            }}
          />
        ) : phase.kind === 'manual_confirm' || phase.kind === 'manual_committing' ? (
          <ConfirmPanel
            result={phase.result}
            committing={phase.kind === 'manual_committing'}
            onConfirm={confirmManual}
            onCancel={() => setPhase({ kind: 'manual' })}
          />
        ) : (
          <ResultPanel result={phase.result} onNext={() => setPhase({ kind: 'idle' })} />
        )}
      </main>
    </div>
  )
}

// === Panels ================================================================

function WaitingPanel() {
  return (
    <div className="text-center">
      <p className="kiosk-headline mb-3 text-white">No session is open</p>
      <p className="text-xl text-white/60">Check-in will start when a service begins.</p>
    </div>
  )
}

function IdlePanel({
  scannerActive,
  restricted,
  onManual,
}: {
  scannerActive: boolean
  restricted: boolean
  onManual: () => void
}) {
  return (
    <div className="w-full max-w-md text-center">
      <div
        className={[
          'mx-auto mb-6 flex size-28 items-center justify-center rounded-full border-4',
          scannerActive
            ? 'kiosk-pulse border-primary-500 bg-primary-500/15'
            : 'border-white/15 bg-white/5',
        ].join(' ')}
      >
        <FingerPrintIcon
          className={scannerActive ? 'size-14 text-primary-500' : 'size-14 text-white/30'}
        />
      </div>

      {scannerActive ? (
        <>
          <p className="mb-2 text-3xl font-bold">Place your finger on the scanner</p>
          <p className="mb-8 text-base font-semibold text-primary-400">● Scanner ready</p>
        </>
      ) : (
        <>
          <p className="mb-2 text-2xl font-bold text-white/70">Fingerprint scanning</p>
          <p className="mb-8 text-base text-white/40">
            Scanner not connected — use manual check-in
          </p>
        </>
      )}

      {restricted && (
        <p className="mb-6 text-sm text-white/50">
          This meeting is for authorised members only.
        </p>
      )}

      <button
        onClick={onManual}
        className="mx-auto flex h-14 w-full max-w-xs cursor-pointer items-center justify-center rounded-xl bg-primary-500 text-lg font-bold text-neutral-950"
      >
        Manual check-in
      </button>
      <p className="mt-3 text-sm text-white/45">Search for a member by name</p>
    </div>
  )
}

function ScanningPanel() {
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <svg className="size-14 animate-spin text-primary-500" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <p className="text-xl font-semibold">Checking…</p>
    </div>
  )
}

/**
 * `tone` carries the colour; `label` carries the same meaning in words. Both,
 * always — PRD §2.4.
 */
function ResultCard({
  tone,
  label,
  children,
}: {
  tone: 'success' | 'warning' | 'error'
  label: string
  children: React.ReactNode
}) {
  const styles = {
    success: 'border-green-500 bg-green-950/50 text-green-400',
    warning: 'border-primary-500 bg-primary-950/40 text-primary-400',
    error: 'border-red-500 bg-red-950/50 text-red-400',
  }[tone]
  const [border, bg, text] = styles.split(' ')
  return (
    <div className={`w-full max-w-md rounded-2xl border-2 p-6 text-center shadow-lg ${border} ${bg}`}>
      <p className={`mb-3 text-base font-bold tracking-wide uppercase ${text}`}>{label}</p>
      {children}
    </div>
  )
}

function MemberBlock({
  photoFileId,
  name,
}: {
  photoFileId: string | null
  name: string
}) {
  const photo = memberPhotoUrl(photoFileId, 320)
  return (
    <>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt={name}
          // The photo, not the name, is what an usher actually checks a face
          // against — so it gets the space. See the note on `kiosk-name`.
          className="mx-auto mb-4 size-48 rounded-2xl border-2 border-white/15 object-cover"
        />
      ) : (
        <div className="mx-auto mb-4 flex size-48 items-center justify-center rounded-2xl border-2 border-dashed border-white/15 text-sm text-white/40">
          No photo
        </div>
      )}
      {/* Sized in styles/tailwind.css — see the note on `kiosk-name`. */}
      <p className="kiosk-name text-white">{name}</p>
    </>
  )
}

function ResultPanel({ result, onNext }: { result: ScanResult; onNext: () => void }) {
  const next = (
    <button
      onClick={onNext}
      className="mt-5 cursor-pointer rounded-xl border border-white/20 px-6 py-2.5 text-sm text-white"
    >
      Next person
    </button>
  )

  if (result.kind === 'marked') {
    return (
      <div className="flex w-full max-w-2xl flex-col items-center">
        <ResultCard tone="success" label="✓ Marked present">
          <MemberBlock photoFileId={result.member.photo_file_id} name={result.member.full_name} />
          {result.sequence > 0 && (
            <p className="mt-3 text-sm text-white/60">
              Number {result.sequence} in today&apos;s session
            </p>
          )}
        </ResultCard>
        {next}
      </div>
    )
  }

  if (result.kind === 'already_marked') {
    return (
      <div className="flex w-full max-w-2xl flex-col items-center">
        <ResultCard tone="warning" label="✓ Already marked present">
          <MemberBlock photoFileId={result.member.photo_file_id} name={result.member.full_name} />
          <p className="mt-3 text-sm text-white/70">
            Your attendance was already recorded — nothing new was saved.
          </p>
        </ResultCard>
        {next}
      </div>
    )
  }

  if (result.kind === 'not_authorised') {
    // The member IS identified. Naming them and the meeting is the whole point
    // — "fingerprint not recognised" here would send them to argue with an
    // usher about a biometric fault that does not exist (PRD §2.3).
    return (
      <div className="flex w-full max-w-2xl flex-col items-center">
        <ResultCard tone="error" label="✕ Not on this meeting's list">
          <MemberBlock photoFileId={result.member.photo_file_id} name={result.member.full_name} />
          <p className="mt-3 text-base leading-snug text-white/90">
            You are not authorised to attend{' '}
            <strong className="text-white">{result.meeting_name}</strong>, so your attendance
            cannot be marked for it.
          </p>
          <p className="mt-2 text-sm text-white/60">
            Speak to an administrator if you think this is wrong.
          </p>
        </ResultCard>
        {next}
      </div>
    )
  }

  if (result.kind === 'inactive_member') {
    return (
      <div className="flex w-full max-w-2xl flex-col items-center">
        <ResultCard tone="error" label="✕ Membership inactive">
          <MemberBlock photoFileId={result.member.photo_file_id} name={result.member.full_name} />
          <p className="mt-3 text-sm text-white/80">
            This membership is marked inactive. Please see an administrator.
          </p>
        </ResultCard>
        {next}
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-2xl flex-col items-center">
      <ResultCard tone="error" label="✕ Fingerprint not recognised">
        <p className="text-base leading-snug text-white/85">
          Try again, pressing firmly and covering the whole sensor. If it still does not work, use
          manual check-in.
        </p>
      </ResultCard>
      <button
        onClick={onNext}
        className="mt-5 cursor-pointer rounded-xl border border-white/20 px-6 py-2.5 text-sm text-white"
      >
        Try again
      </button>
    </div>
  )
}

function ConfirmPanel({
  result,
  committing,
  onConfirm,
  onCancel,
}: {
  result: ScanResult
  committing: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (result.kind !== 'marked') return null
  return (
    <div className="w-full max-w-2xl rounded-3xl border border-white/15 bg-white/5 p-8 text-center">
      <p className="mb-4 text-sm font-semibold tracking-wide text-primary-400 uppercase">
        Confirm identity
      </p>
      <MemberBlock photoFileId={result.member.photo_file_id} name={result.member.full_name} />
      <p className="mt-5 mb-6 rounded-xl bg-white/5 px-4 py-3 text-base text-white/70">
        Check the photo and name against the person in front of you before confirming.
      </p>
      <div className="flex gap-4">
        <button
          onClick={onCancel}
          disabled={committing}
          className="h-14 flex-1 cursor-pointer rounded-xl border border-white/20 text-base font-semibold disabled:opacity-50"
        >
          Not this person
        </button>
        <button
          onClick={onConfirm}
          disabled={committing}
          className="h-14 flex-1 cursor-pointer rounded-xl bg-primary-500 text-base font-bold text-neutral-950 disabled:opacity-60"
        >
          {committing ? 'Marking…' : 'Confirm — mark present'}
        </button>
      </div>
    </div>
  )
}

/** Exactly what /api/members/search returns — deliberately minimal. */
type MemberHit = { $id: string; full_name: string }

function ManualPanel({
  query,
  setQuery,
  error,
  pending,
  onPick,
  onBack,
}: {
  query: string
  setQuery: (s: string) => void
  error: string | null
  pending: boolean
  onPick: (memberId: string) => void
  onBack: () => void
}) {
  const [hits, setHits] = useState<MemberHit[]>([])
  const [searching, setSearching] = useState(false)

  // Debounced search. A kiosk keyboard is a touchscreen keyboard and every
  // keystroke is slow, so waiting 300ms costs nothing and saves a request per
  // letter.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    let cancelled = false
    setSearching(true)
    const id = window.setTimeout(async () => {
      try {
        // /api/members/search, NOT /api/members — a kiosk account is forbidden
        // from the registry (403), which silently emptied this list and left
        // manual check-in unusable on the one device that needs it when a
        // finger will not read. The search endpoint returns an id and a name
        // and nothing else.
        const res = await fetch(`/api/members/search?q=${encodeURIComponent(q)}`, {
          cache: 'no-store',
        })
        const data = (await res.json()) as { ok: boolean; members?: MemberHit[] }
        if (!cancelled) setHits(data.ok ? (data.members ?? []) : [])
      } catch {
        if (!cancelled) setHits([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [query])

  return (
    <div className="w-full max-w-lg">
      <div className="rounded-3xl border border-white/15 bg-white/5 p-6">
        <p className="mb-1 text-xl font-bold">Manual check-in</p>
        <p className="mb-5 text-base text-white/50">Type the member&apos;s name</p>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Ama Mensah"
          autoFocus
          className="mb-4 h-14 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-center text-lg text-white placeholder-white/30 outline-none focus:border-primary-500"
        />

        {error && (
          <p role="alert" className="mb-3 text-base text-red-400">
            {error}
          </p>
        )}

        <div className="max-h-72 overflow-y-auto">
          {query.trim().length < 2 ? (
            <p className="py-4 text-center text-sm text-white/40">
              Type at least two letters.
            </p>
          ) : searching ? (
            <p className="py-4 text-center text-sm text-white/40">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="py-4 text-center text-sm text-white/40">No active member matches.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {hits.map((m) => (
                <li key={m.$id}>
                  <button
                    onClick={() => onPick(m.$id)}
                    disabled={pending}
                    className="w-full cursor-pointer rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-lg hover:bg-white/10 disabled:opacity-50"
                  >
                    {m.full_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <button
        onClick={onBack}
        className="mt-4 w-full cursor-pointer text-center text-base text-white/40 underline"
      >
        ← Back to scanner
      </button>
    </div>
  )
}
