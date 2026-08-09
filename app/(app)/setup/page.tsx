'use client'

// Kiosk readiness checklist. Ported from SEMP, where it exists to answer the
// question that cost a session: "everything looks installed, so why does every
// scan say NOT RECOGNISED?"
//
// A browser cannot install a driver, write outside its sandbox, or create a
// Windows service — that is an OS boundary, not something to code around. So
// this page does the half that IS possible: probe every layer, name precisely
// which one is broken, and hand over the exact command that fixes it.
//
// The two probes are deliberately different in kind:
//   bridge   browser -> 127.0.0.1:7788. Proves a scanner is attached to THIS
//            machine, and nothing whatsoever about the server.
//   matcher  server -> its own matcher. Proves the server handling
//            /api/attendance/scan can actually identify a fingerprint.
//
// A kiosk needs BOTH, and only the second one fails silently.

import { useEffect, useState } from 'react'
import { FingerPrintIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import { Card, PageHeader, PageWrap } from '@/components/ui'
import { BRIDGE_URL, useBridgeHealth, useMatcherHealth } from '@/lib/queries/biometrics'

type Level = 'ok' | 'warn' | 'fail' | 'unknown'

const LEVEL_META: Record<Level, { label: string; color: 'green' | 'yellow' | 'red' | 'zinc' }> = {
  ok: { label: 'READY', color: 'green' },
  warn: { label: 'CHECK', color: 'yellow' },
  fail: { label: 'BLOCKED', color: 'red' },
  unknown: { label: 'CHECKING', color: 'zinc' },
}

type Row = {
  title: string
  level: Level
  detail: string
  /** Copy-pasteable remedy, shown only when the row is not OK. */
  fix?: string
}

function CheckRow({ row }: { row: Row }) {
  const meta = LEVEL_META[row.level]
  return (
    <div className="flex gap-4 border-b border-neutral-100 px-5 py-4 last:border-0 dark:border-neutral-700">
      <div className="w-24 shrink-0 pt-0.5">
        {/* Colour is never the only signal — the word carries the meaning. */}
        <Badge color={meta.color}>{meta.label}</Badge>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-neutral-950 dark:text-white">{row.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          {row.detail}
        </p>
        {row.fix && row.level !== 'ok' && (
          <pre className="mt-3 overflow-x-auto rounded-lg bg-neutral-100 p-3 text-xs leading-relaxed whitespace-pre-wrap text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
            {row.fix}
          </pre>
        )}
      </div>
    </div>
  )
}

export default function SetupPage() {
  const bridge = useBridgeHealth()
  const matcher = useMatcherHealth()

  // Client-only facts, read after mount so the server render cannot disagree
  // with the browser about a value it has no way to know.
  const [client, setClient] = useState<{
    platform: string
    host: string
    local: boolean
    https: boolean
  } | null>(null)

  useEffect(() => {
    const uaPlatform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
        ?.platform ?? ''
    const host = window.location.hostname
    setClient({
      platform: uaPlatform || navigator.userAgent,
      host,
      local: host === 'localhost' || host === '127.0.0.1' || host === '[::1]',
      https: window.location.protocol === 'https:',
    })
  }, [])

  const isWindows = client ? /win/i.test(client.platform) : false
  const bh = bridge.data
  const mh = matcher.data?.matcher

  const rows: Row[] = []

  // 1. Platform.
  rows.push({
    title: 'Operating system',
    level: client === null ? 'unknown' : isWindows ? 'ok' : 'warn',
    detail:
      client === null
        ? 'Reading browser platform…'
        : isWindows
          ? 'Windows detected. The fingerprint stack is supported here.'
          : `This browser reports "${client.platform}". A PC kiosk is Windows-only — the ` +
            'Futronic driver and church-scan.exe are Windows binaries. An Android tablet can ' +
            'still drive the scanner over WebUSB in Chrome, and every other page works anywhere.',
  })

  // 2. Can the SERVER identify a fingerprint? The one that used to fail
  //    silently, and the one a hosted deployment gets wrong.
  rows.push({
    title: 'The server can identify fingerprints',
    level: matcher.isLoading
      ? 'unknown'
      : !mh
        ? 'warn'
        : mh.configured && mh.reachable !== false
          ? 'ok'
          : 'fail',
    detail: matcher.isLoading
      ? 'Asking the server…'
      : (mh?.detail ??
        'Could not reach the server to ask. Check that the app is running and you are signed in.'),
    fix:
      'A HOSTED deployment (Vercel and similar) matches in-process using the NBIS\n' +
      'WebAssembly at public/nbis/. If this row is BLOCKED there, that artifact did not\n' +
      'ship into the serverless function. next.config.ts must force it in:\n\n' +
      '  outputFileTracingIncludes: {\n' +
      "    '/api/attendance/scan': ['./public/nbis/**'],\n" +
      "    '/api/biometrics/matcher-health': ['./public/nbis/**'],\n" +
      '  }\n\n' +
      'Do NOT set CHURCH_BIOMETRIC_MATCHER_URL on a hosted deployment — the bridge is\n' +
      'bound to loopback on the kiosk PC, so a hosted server can never reach it.\n' +
      'That variable is only for running the app ON the kiosk itself.',
  })

  // 3. Where is this page served from? Not a failure on its own any more —
  //    the server can match in-process — but it changes what capture needs.
  rows.push({
    title: 'Page origin',
    level: client === null ? 'unknown' : client.local ? 'ok' : 'warn',
    detail:
      client === null
        ? 'Reading page origin…'
        : client.local
          ? `Served from ${client.host} — the same machine as the scanner. Capture and matching ` +
            'both have the shortest possible path.'
          : `Served from "${client.host}". That is fine for MATCHING, which happens on the ` +
            'server. Capture still happens in this browser and still reaches the scanner on ' +
            'this machine — but a page on a public origin talking to 127.0.0.1 is subject to ' +
            "Chrome's Private Network Access rules, so the bridge has to opt in.",
    fix:
      'The bridge must answer preflight with:\n' +
      '  Access-Control-Allow-Private-Network: true\n\n' +
      'Packs built after 2026-08-09 do this. If capture fails from a hosted page with a\n' +
      'CORS error in the console, re-download the kiosk pack and re-run install.cmd.',
  })

  // 4. Bridge reachable from the browser.
  rows.push({
    title: 'Fingerprint bridge (this machine)',
    level: bridge.isLoading ? 'unknown' : bh?.ok ? 'ok' : 'fail',
    detail: bridge.isLoading
      ? `Probing ${BRIDGE_URL}…`
      : bh?.ok
        ? `Answering at ${BRIDGE_URL}.`
        : `No answer from ${BRIDGE_URL}. The bridge is not running on this machine, so no ` +
          'fingerprint can be captured here. Manual check-in still works.',
    fix:
      'Confirm the background service, and that the MACHINE started it rather than you:\n' +
      '  powershell -ExecutionPolicy Bypass -File check-install.ps1\n\n' +
      'That script ships inside the kiosk pack. If the service is missing, re-run\n' +
      'install.cmd from the pack as administrator.',
  })

  // 5/6. Bridge internals — only meaningful once it answers at all.
  if (bh?.ok) {
    rows.push({
      title: 'Scanner detected (Futronic FS81)',
      level: bh.device ? 'ok' : 'fail',
      detail: bh.device
        ? 'The reader is plugged in and the driver has bound to it.'
        : 'The bridge is running but sees no scanner. Either it is unplugged, or the Futronic ' +
          'WHQL driver is missing — an undriven device still enumerates but sits at Code 28.',
      fix:
        'Check what Windows sees:\n' +
        '  Get-PnpDevice | Where-Object InstanceId -match "VID_1491"\n' +
        '  (Status OK + Service WinUSB is a working reader; Code 28 means no driver)\n\n' +
        'The driver ships inside the kiosk pack and installs unattended. Re-run\n' +
        'install.cmd as administrator, then plug the scanner in.',
    })
    rows.push({
      title: 'Capture and matcher binaries',
      level: bh.scanBin && bh.nbis ? 'ok' : 'fail',
      detail:
        bh.scanBin && bh.nbis
          ? 'church-scan.exe and the NBIS binaries (cwsq, mindtct, bozorth3) are all present.'
          : `Missing: ${[!bh.scanBin && 'church-scan.exe', !bh.nbis && 'NBIS binaries']
              .filter(Boolean)
              .join(', ')}.`,
      fix: 'Re-run install.cmd from the kiosk pack as administrator — it carries all of them.',
    })
  }

  const blocked = rows.filter((r) => r.level === 'fail').length
  const checking = rows.some((r) => r.level === 'unknown')

  return (
    <PageWrap className="max-w-4xl">
      <PageHeader
        title="Kiosk setup check"
        subtitle="What this machine still needs before fingerprint check-in will work"
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-4">
          <FingerPrintIcon
            className={`size-8 shrink-0 ${
              blocked === 0 && !checking ? 'text-primary-500' : 'text-red-500'
            }`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-neutral-950 dark:text-white">
              {checking
                ? 'Checking this machine…'
                : blocked === 0
                  ? 'Ready for fingerprint check-in'
                  : `${blocked} thing${blocked === 1 ? '' : 's'} still blocking fingerprint check-in`}
            </p>
            <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
              Manual check-in works regardless of anything on this page — a member can always be
              marked present.
            </p>
          </div>
          <Button
            outline
            onClick={() => {
              void bridge.refetch()
              void matcher.refetch()
            }}
          >
            Re-check
          </Button>
        </div>
      </Card>

      <Card padded={false}>
        {rows.map((r) => (
          <CheckRow key={r.title} row={r} />
        ))}
      </Card>

      {/* Provisioning a NEW machine. A kiosk needs no repo, no node_modules and
          no Appwrite key — identification happens on the server, so the PC only
          needs something local that can drive the scanner. That is the pack. */}
      <Card className="mt-5">
        <h2 className="text-base font-bold text-neutral-950 dark:text-white">
          Setting up a different Windows PC?
        </h2>
        <p className="mt-1 mb-4 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          You do not need to copy this app onto it. Download the pack on that machine — it carries
          the scanner driver, the capture and matcher binaries, and a self-elevating installer.
          About 4 MB.
        </p>

        <ol className="mb-5 list-decimal space-y-1.5 pl-6 text-sm text-neutral-800 dark:text-neutral-200">
          <li>
            Install Node.js LTS on that PC —{' '}
            <a
              href="https://nodejs.org/en/download"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-primary-600 hover:underline dark:text-primary-400"
            >
              nodejs.org/en/download
            </a>
          </li>
          <li>Download the pack below and unzip it anywhere</li>
          <li>
            Right-click <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-900">install.cmd</code>{' '}
            → <strong>Run as administrator</strong>
          </li>
          <li>Plug the scanner in when it says to — the driver is already staged</li>
          <li>Reboot, then run <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-900">check-install.ps1</code> to prove it starts by itself</li>
          <li>Open this page on that PC and confirm every row is READY</li>
        </ol>

        <div className="flex flex-wrap items-center gap-3">
          <Button color="primary" href="/api/kiosk-pack">
            Download kiosk pack
          </Button>
          <span className="text-xs text-neutral-400 dark:text-neutral-500">
            .zip · includes SHA256SUMS.txt
          </span>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
          If Smart App Control is enforcing on that PC it will block the capture and matcher
          binaries at load — turn it off before installing, or sign them. The driver itself is
          WHQL-signed and installs regardless.
        </p>
      </Card>

      <p className="mt-4 text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
        Provisioning is documented in <code>tools/fingerprint-bridge/README.md</code>. The driver
        install and the background service both need an elevated PowerShell — a web page can do
        neither, which is why this screen reports rather than installs.
      </p>
    </PageWrap>
  )
}
