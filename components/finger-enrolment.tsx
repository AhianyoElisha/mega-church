'use client'

// Enrol one member: four fingers, three presses each (PRD §1.2).
//
// Capture comes from whichever source this machine has, and the two are
// interchangeable because both produce the same `xyt:` template:
//
//   1. the local bridge (a PC with the scanner plugged in), or
//   2. WebUSB straight from this page (a tablet), with minutiae extracted by
//      NBIS compiled to WebAssembly.
//
// Nothing below the capture call knows which one ran.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import { Banner, Card } from '@/components/ui'
import { useDialog } from '@/components/dialog'
import {
  FINGER_DISPLAY,
  FINGER_LABELS,
  VARIATIONS_PER_FINGER,
  type FingerLabel,
} from '@/lib/appwrite/config'
import {
  bridgeScan,
  useBridgeHealth,
  useDeleteTemplates,
  useEnrollFinger,
  useMatcherHealth,
  useMemberTemplates,
} from '@/lib/queries/biometrics'
import { Fs81Device, isWebUsbSupported } from '@/lib/biometrics/webusb'
import { extractTemplate } from '@/lib/biometrics/nbis-wasm'

type Capture = { template: string; minutiae: number }

const CAPTURE_TIMEOUT_S = 30

export default function FingerEnrolment({
  memberId,
  memberName,
}: {
  memberId: string
  memberName: string
}) {
  const bridge = useBridgeHealth()
  const matcher = useMatcherHealth()
  const templates = useMemberTemplates(memberId)
  const enroll = useEnrollFinger()
  const removeTemplates = useDeleteTemplates()
  const dialog = useDialog()

  const [finger, setFinger] = useState<FingerLabel>(FINGER_LABELS[0])
  const [captures, setCaptures] = useState<Capture[]>([])
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState<{ tone: 'info' | 'error' | 'success'; text: string } | null>(
    null,
  )

  // --- capture sources -----------------------------------------------------

  const bridgeUp = bridge.data?.ok === true && bridge.data?.device === true

  const [usbDevice, setUsbDevice] = useState<Fs81Device | null>(null)
  const [usbBusy, setUsbBusy] = useState(false)
  const usbSupported = isWebUsbSupported()

  // WebUSB permission is per-origin and PERSISTS, so a tablet grants once and
  // silently reconnects on every later load. Only the first grant needs a
  // gesture, which is why this can run on mount.
  useEffect(() => {
    if (!usbSupported || bridgeUp) return
    let cancelled = false
    Fs81Device.getAlreadyPermitted()
      .then((d) => {
        if (!cancelled && d) setUsbDevice(d)
      })
      .catch(() => {
        // No permission yet — the Connect button is the way in.
      })
    return () => {
      cancelled = true
    }
  }, [usbSupported, bridgeUp])

  const connectUsb = useCallback(async () => {
    setUsbBusy(true)
    setMessage(null)
    try {
      const device = await Fs81Device.request()
      await device.open()
      setUsbDevice(device)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // A cancelled picker is a normal outcome, not an error worth shouting.
      if (!/no device selected|cancelled/i.test(msg)) {
        setMessage({ tone: 'error', text: `Scanner not connected: ${msg}` })
      }
    } finally {
      setUsbBusy(false)
    }
  }, [])

  const source: 'bridge' | 'webusb' | null = bridgeUp ? 'bridge' : usbDevice ? 'webusb' : null

  // --- existing enrolment --------------------------------------------------

  const byFinger = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of templates.data?.templates ?? []) {
      map.set(t.finger_label, (map.get(t.finger_label) ?? 0) + 1)
    }
    return map
  }, [templates.data])

  const doneCount = FINGER_LABELS.filter(
    (f) => (byFinger.get(f) ?? 0) >= VARIATIONS_PER_FINGER,
  ).length
  const complete = doneCount === FINGER_LABELS.length

  // --- capture -------------------------------------------------------------

  const captureOne = useCallback(async () => {
    if (!source) return
    setScanning(true)
    setMessage({ tone: 'info', text: 'Press firmly on the scanner and hold still…' })

    try {
      if (source === 'webusb') {
        const frame = await usbDevice!.captureFinger({
          timeoutMs: CAPTURE_TIMEOUT_S * 1000,
          // Force the platen to read empty before arming, so one press cannot
          // be captured twice in a row.
          waitClear: true,
        })
        const { template, minutiae } = await extractTemplate(
          frame.pixels,
          frame.width,
          frame.height,
        )
        setCaptures((c) => [...c, { template, minutiae }])
        setMessage(null)
        return
      }

      const r = await bridgeScan(CAPTURE_TIMEOUT_S, { waitClear: true })
      if (r.ok) {
        setCaptures((c) => [...c, { template: r.template, minutiae: r.minutiae }])
        setMessage(null)
      } else {
        setMessage({
          tone: 'error',
          text:
            r.error === 'no_finger'
              ? 'No finger detected. Press firmly and try again.'
              : r.error === 'bridge_unreachable'
                ? 'The scanner service is not running on this PC.'
                : `Capture failed: ${r.error}`,
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'no_finger') {
        setMessage({ tone: 'error', text: 'No finger detected. Press firmly and try again.' })
      } else {
        // The tablet lost the device (unplugged, or Android suspended the port).
        setUsbDevice(null)
        setMessage({ tone: 'error', text: `Scanner disconnected: ${msg}` })
      }
    } finally {
      setScanning(false)
    }
  }, [source, usbDevice])

  const save = useCallback(async () => {
    if (captures.length === 0) return
    const res = await enroll.mutateAsync({
      member_id: memberId,
      finger_label: finger,
      templates: captures.map((c) => c.template),
      replace: true,
    })
    if (res.ok) {
      setCaptures([])
      setMessage({
        tone: 'success',
        text: `${FINGER_DISPLAY[finger]} saved for ${memberName} — ${res.total_templates} of ${
          FINGER_LABELS.length * VARIATIONS_PER_FINGER
        } prints on file.`,
      })
      // Move to the next finger that still needs work, so an operator can
      // enrol all four without touching the selector.
      const next = FINGER_LABELS.find(
        (f) => f !== finger && (byFinger.get(f) ?? 0) < VARIATIONS_PER_FINGER,
      )
      if (next) setFinger(next)
    } else {
      setMessage({ tone: 'error', text: res.error })
    }
  }, [captures, enroll, finger, memberId, memberName, byFinger])

  const clearFinger = useCallback(async () => {
    const ok = await dialog.confirm({
      title: `Clear ${FINGER_DISPLAY[finger].toLowerCase()}?`,
      message: `The stored prints for this finger will be deleted. ${memberName}'s other fingers are not affected.`,
      confirmText: 'Clear',
      tone: 'danger',
    })
    if (!ok) return
    await removeTemplates.mutateAsync({ member_id: memberId, finger_label: finger })
    setCaptures([])
    setMessage({ tone: 'info', text: `${FINGER_DISPLAY[finger]} cleared.` })
  }, [dialog, finger, memberId, memberName, removeTemplates])

  // --- render --------------------------------------------------------------

  const matcherFault =
    matcher.data && !(matcher.data.matcher.configured && matcher.data.matcher.reachable !== false)
      ? matcher.data.matcher.detail
      : null

  return (
    <Card>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-neutral-950 dark:text-white">
            Fingerprint enrolment
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
            Four fingers, three presses each. Prints are stored as templates — the image never
            leaves this machine.
          </p>
        </div>
        <Badge color={complete ? 'green' : doneCount > 0 ? 'yellow' : 'zinc'}>
          {complete ? 'Fully enrolled' : `${doneCount} of ${FINGER_LABELS.length} fingers`}
        </Badge>
      </div>

      {/* The server-side half of the health picture. Enrolment works without a
          matcher (capture is browser-side), so this is a warning, not a block —
          but a church that enrols everybody and only then discovers the server
          cannot match has wasted an afternoon. */}
      {matcherFault && (
        <Banner tone="warning" className="mb-4">
          <strong className="block">This server cannot identify fingerprints yet.</strong>
          {matcherFault} Enrolment still works and the prints are saved.
        </Banner>
      )}

      {!source && (
        <Banner tone="info" className="mb-4">
          {usbSupported ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>No scanner connected to this device.</span>
              <Button color="primary" onClick={connectUsb} disabled={usbBusy}>
                {usbBusy ? 'Connecting…' : 'Connect scanner'}
              </Button>
            </div>
          ) : (
            <>
              No scanner detected. On a PC, install and start the scanner service. On a tablet,
              use Chrome for Android — Firefox and iOS Safari cannot talk to USB devices.
            </>
          )}
        </Banner>
      )}

      {message && (
        <Banner
          tone={message.tone === 'success' ? 'success' : message.tone === 'error' ? 'error' : 'info'}
          className="mb-4"
          onDismiss={message.tone === 'info' ? undefined : () => setMessage(null)}
        >
          {message.text}
        </Banner>
      )}

      {/* Finger picker. A tick means all three presses are on file. */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FINGER_LABELS.map((f) => {
          const count = byFinger.get(f) ?? 0
          const full = count >= VARIATIONS_PER_FINGER
          const selected = f === finger
          return (
            <button
              key={f}
              onClick={() => {
                setFinger(f)
                setCaptures([])
                setMessage(null)
              }}
              className={[
                'cursor-pointer rounded-xl border px-3 py-3 text-left transition',
                selected
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800',
              ].join(' ')}
            >
              <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {FINGER_DISPLAY[f]}
              </span>
              <span
                className={[
                  'mt-0.5 block text-xs',
                  full ? 'text-green-600 dark:text-green-400' : 'text-neutral-500 dark:text-neutral-400',
                ].join(' ')}
              >
                {/* Colour is never the only signal — the words carry it. */}
                {full ? '✓ Complete' : `${count} of ${VARIATIONS_PER_FINGER} saved`}
              </span>
            </button>
          )
        })}
      </div>

      {/* Capture slots for the selected finger. */}
      <div className="mb-4 flex flex-wrap gap-2">
        {Array.from({ length: VARIATIONS_PER_FINGER }).map((_, i) => {
          const c = captures[i]
          return (
            <div
              key={i}
              className={[
                'flex h-20 w-28 flex-col items-center justify-center rounded-xl border text-xs',
                c
                  ? 'border-primary-500 bg-primary-500 text-neutral-950'
                  : 'border-dashed border-neutral-300 text-neutral-400 dark:border-neutral-600 dark:text-neutral-500',
              ].join(' ')}
            >
              <span className="font-semibold">Press {i + 1}</span>
              {/* Minutiae count is the only quality signal an operator gets.
                  A capture in the teens will match poorly; showing it lets
                  them re-take on the spot rather than at the door on Sunday. */}
              <span className="mt-0.5">{c ? `${c.minutiae} points` : 'waiting'}</span>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          color="primary"
          onClick={captureOne}
          disabled={!source || scanning || captures.length >= VARIATIONS_PER_FINGER}
        >
          {scanning
            ? 'Scanning…'
            : `Capture press ${Math.min(captures.length + 1, VARIATIONS_PER_FINGER)} of ${VARIATIONS_PER_FINGER}`}
        </Button>
        <Button
          outline
          onClick={save}
          disabled={captures.length === 0 || enroll.isPending || scanning}
        >
          {enroll.isPending ? 'Saving…' : `Save ${FINGER_DISPLAY[finger].toLowerCase()}`}
        </Button>
        {captures.length > 0 && (
          <Button plain onClick={() => setCaptures([])} disabled={scanning}>
            Start over
          </Button>
        )}
        {(byFinger.get(finger) ?? 0) > 0 && (
          <Button plain onClick={clearFinger} disabled={removeTemplates.isPending}>
            Clear saved prints
          </Button>
        )}
      </div>

      <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">
        Saving replaces whatever was stored for this finger. Three presses of the same finger give
        the matcher its best chance — a dry or smudged press is carried by the other two.
      </p>
    </Card>
  )
}
