// Plan 38 — Church fingerprint bridge.
//
// A small localhost HTTP service that owns the two things a browser cannot do:
//   1. talk to the Futronic FS81 (closed USB protocol → vendor libScanAPI.so
//      via the native `church-scan` binary), and
//   2. run the NBIS matcher binaries (cwsq / mindtct / bozorth3).
//
// It is deliberately STATELESS: /match receives the candidate set in the
// request. That mirrors the shape a hosted identify API would take, so
// retiring this bridge later is a config change, not a refactor.
//
// Run:  npm run bridge     (tsx tools/fingerprint-bridge/bridge.ts)
// Env:  CHURCH_BRIDGE_PORT (default 7788), CHURCH_BIOMETRIC_THRESHOLD (default 33)
//
// Endpoints:
//   GET  /health → { ok, device, scanBin, nbis, busy }
//   POST /scan   { timeoutS?, waitClear? }
//              → { ok, template: "xyt:<b64>", minutiae, variance }
//                | { ok:false, error: "no_finger" | "busy" | ... }
//   POST /match  { probe: "xyt:<b64>",
//                  candidates: [{ member_id, templates: ["xyt:<b64>", ...] }],
//                  threshold? }
//              → { ok, member_id|null, score, threshold }
//
// The captured image only ever exists as a temp file for the seconds between
// capture and minutiae extraction, then the whole temp dir is removed — raw
// fingerprint images are never persisted (plan 38 storage decision).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  encodeXytTemplate,
  decodeXytTemplate,
  countMinutiae,
} from '../../lib/biometrics/codec';
import {
  parseThreshold,
  pickBestCandidate,
  type CandidateScore,
} from '../../lib/biometrics/matching';
import {
  FUTRONIC_SYSFS_VENDOR_ID,
  isProbeFresh,
  parsePnpPresence,
  withExe,
} from '../../lib/biometrics/platform';

const PORT = Number(process.env.CHURCH_BRIDGE_PORT ?? 7788);
const NATIVE_DIR = path.join(__dirname, 'native');
// Plan 40 — `.exe` on Windows, bare on Linux. Every existsSync/spawn below
// depends on this being right; see lib/biometrics/platform.ts.
const SCAN_BIN = withExe(path.join(NATIVE_DIR, 'church-scan'), process.platform);
const NBIS_BIN = path.join(NATIVE_DIR, 'nbis', 'install', 'bin');
const CWSQ = withExe(path.join(NBIS_BIN, 'cwsq'), process.platform);
const MINDTCT = withExe(path.join(NBIS_BIN, 'mindtct'), process.platform);
const BOZORTH3 = withExe(path.join(NBIS_BIN, 'bozorth3'), process.platform);

const IMG_W = 320;
const IMG_H = 480;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_CANDIDATES = 512;
const MAX_TEMPLATES_PER_CANDIDATE = 8;

/** The scanner is exclusive-access hardware — serialize /scan. */
let scanBusy = false;

// ---------------------------------------------------------------------------
// helpers

function run(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Strip the P5 header from a PGM produced by church-scan → raw 8-bit pixels. */
function pgmToRaw(pgm: Buffer): Buffer {
  // Header is exactly three newline-terminated lines: "P5", "W H", "255".
  let cut = 0;
  for (let lines = 0; lines < 3 && cut < pgm.length; cut++) {
    if (pgm[cut] === 0x0a) lines++;
  }
  const raw = pgm.subarray(cut);
  if (raw.length !== IMG_W * IMG_H) {
    throw new Error(`unexpected raw size ${raw.length}, want ${IMG_W * IMG_H}`);
  }
  return raw;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(json);
}

const DEVICE_PROBE_TTL_MS = 8_000;
const DEVICE_PROBE_TIMEOUT_MS = 2_000;

let deviceProbe: { value: boolean; at: number } | null = null;
let deviceProbeInFlight: Promise<boolean> | null = null;

/** USB presence check via sysfs — no device open, no side effects. */
function scannerPresentLinux(): boolean {
  try {
    const base = '/sys/bus/usb/devices';
    for (const entry of readdirSync(base)) {
      try {
        const vendor = readFileSync(path.join(base, entry, 'idVendor'), 'utf8').trim();
        if (vendor === FUTRONIC_SYSFS_VENDOR_ID) return true;
      } catch {
        // not a device dir — skip
      }
    }
  } catch {
    // sysfs unavailable — shouldn't happen on Linux, treat as absent
  }
  return false;
}

/**
 * Windows has no sysfs — ask PnP instead. Deliberately fails OPTIMISTIC: if the
 * query errors, times out, or PowerShell is missing we report the scanner as
 * present. A false "detected" costs one `no_device` error on the next scan,
 * whereas a false "NOT DETECTED" hides the kiosk's scan affordance entirely
 * (app/kiosk/page.tsx gates on /health.device) — the worse failure by far.
 */
async function scannerPresentWindows(): Promise<boolean> {
  const script =
    "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like '*VID_1491*' } " +
    '| Select-Object -ExpandProperty InstanceId';
  try {
    const r = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      DEVICE_PROBE_TIMEOUT_MS,
    );
    if (r.code !== 0) return true;
    return parsePnpPresence(r.stdout);
  } catch {
    return true;
  }
}

/**
 * Cached + de-duplicated so the kiosk's 10s /health poll doesn't stack
 * PowerShell starts. Linux stays uncached — the sysfs walk is a few reads.
 */
async function scannerPresent(): Promise<boolean> {
  if (process.platform !== 'win32') return scannerPresentLinux();

  if (deviceProbe && isProbeFresh(deviceProbe.at, Date.now(), DEVICE_PROBE_TTL_MS)) {
    return deviceProbe.value;
  }
  if (deviceProbeInFlight) return deviceProbeInFlight;

  deviceProbeInFlight = scannerPresentWindows()
    .then((value) => {
      deviceProbe = { value, at: Date.now() };
      return value;
    })
    .finally(() => {
      deviceProbeInFlight = null;
    });
  return deviceProbeInFlight;
}

// ---------------------------------------------------------------------------
// endpoints

async function handleScan(body: {
  timeoutS?: number;
  waitClear?: boolean;
}): Promise<Record<string, unknown>> {
  const timeoutS = Math.min(Math.max(Math.floor(body.timeoutS ?? 25), 1), 60);
  const args = [/* out path set below */ '', String(timeoutS)];
  if (body.waitClear) args.push('--wait-clear');

  const dir = await mkdtemp(path.join(tmpdir(), 'church-fp-'));
  try {
    const pgmPath = path.join(dir, 'cap.pgm');
    args[0] = pgmPath;

    const scan = await run(SCAN_BIN, args, (timeoutS + 10) * 1000);
    let scanOut: { ok?: boolean; error?: string; variance?: number } = {};
    try {
      scanOut = JSON.parse(scan.stdout.trim().split('\n').pop() ?? '{}');
    } catch {
      // fall through to generic error below
    }
    if (scan.code !== 0 || !scanOut.ok) {
      return { ok: false, error: scanOut.error ?? 'scan_failed' };
    }

    // PGM → raw → WSQ (light 5:1) → mindtct -m1 → .xyt
    const rawPath = path.join(dir, 'cap.raw');
    await writeFile(rawPath, pgmToRaw(await readFile(pgmPath)));

    const cwsq = await run(
      CWSQ,
      ['2.25', 'wsq', rawPath, '-raw_in', `${IMG_W},${IMG_H},8,500`],
      15000,
    );
    if (cwsq.code !== 0) return { ok: false, error: 'cwsq_failed' };

    const mindtct = await run(
      MINDTCT,
      ['-m1', path.join(dir, 'cap.wsq'), path.join(dir, 'out')],
      20000,
    );
    if (mindtct.code !== 0) return { ok: false, error: 'mindtct_failed' };

    const xyt = await readFile(path.join(dir, 'out.xyt'), 'utf8');
    let template: string;
    try {
      template = encodeXytTemplate(xyt);
    } catch {
      return { ok: false, error: 'empty_template' };
    }
    return {
      ok: true,
      template,
      minutiae: countMinutiae(xyt),
      variance: scanOut.variance ?? null,
    };
  } finally {
    // Raw fingerprint images must not outlive extraction (plan 38).
    await rm(dir, { recursive: true, force: true });
  }
}

interface MatchCandidate {
  member_id: string;
  templates: string[];
}

async function handleMatch(body: {
  probe?: string;
  candidates?: MatchCandidate[];
  threshold?: number | string;
}): Promise<Record<string, unknown>> {
  const probeText = decodeXytTemplate(body.probe ?? '');
  if (!probeText) return { ok: false, error: 'invalid_probe' };

  const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, MAX_CANDIDATES) : [];
  const threshold =
    body.threshold !== undefined
      ? parseThreshold(String(body.threshold))
      : parseThreshold(process.env.CHURCH_BIOMETRIC_THRESHOLD);

  const dir = await mkdtemp(path.join(tmpdir(), 'church-mt-'));
  try {
    const probePath = path.join(dir, 'probe.xyt');
    await writeFile(probePath, probeText);

    // Flatten every candidate template into one bozorth3 invocation, keeping
    // a parallel index so stdout line N maps back to its candidate.
    const galleryPaths: string[] = [];
    const galleryOwner: string[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c || typeof c.member_id !== 'string' || !Array.isArray(c.templates)) continue;
      for (let j = 0; j < Math.min(c.templates.length, MAX_TEMPLATES_PER_CANDIDATE); j++) {
        const text = decodeXytTemplate(c.templates[j]);
        if (!text) continue;
        const p = path.join(dir, `g_${i}_${j}.xyt`);
        await writeFile(p, text);
        galleryPaths.push(p);
        galleryOwner.push(c.member_id);
      }
    }
    if (galleryPaths.length === 0) {
      return { ok: true, member_id: null, score: 0, threshold };
    }

    const boz = await run(BOZORTH3, ['-m1', '-p', probePath, ...galleryPaths], 30000);
    if (boz.code !== 0) return { ok: false, error: 'bozorth3_failed' };

    const lines = boz.stdout.trim().split('\n').filter((l) => l.trim() !== '');
    const bestPerCandidate = new Map<string, number>();
    for (let i = 0; i < lines.length && i < galleryOwner.length; i++) {
      const score = Number(lines[i].trim());
      if (!Number.isFinite(score)) continue;
      const owner = galleryOwner[i];
      const prev = bestPerCandidate.get(owner);
      if (prev === undefined || score > prev) bestPerCandidate.set(owner, score);
    }

    const scores: CandidateScore[] = [...bestPerCandidate.entries()].map(
      ([member_id, score]) => ({ member_id, score }),
    );
    const best = pickBestCandidate(scores, threshold);
    return {
      ok: true,
      member_id: best?.member_id ?? null,
      score: best?.score ?? Math.max(0, ...scores.map((s) => s.score)),
      threshold,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// server

const server = createServer(async (req, res) => {
  const url = req.url ?? '/';
  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }

  try {
    if (req.method === 'GET' && url === '/health') {
      send(res, 200, {
        ok: existsSync(SCAN_BIN) && existsSync(MINDTCT) && existsSync(BOZORTH3),
        device: await scannerPresent(),
        scanBin: existsSync(SCAN_BIN),
        nbis: existsSync(MINDTCT) && existsSync(BOZORTH3) && existsSync(CWSQ),
        busy: scanBusy,
      });
      return;
    }

    if (req.method === 'POST' && url === '/scan') {
      if (scanBusy) {
        send(res, 409, { ok: false, error: 'busy' });
        return;
      }
      scanBusy = true;
      try {
        const body = JSON.parse((await readBody(req)) || '{}');
        send(res, 200, await handleScan(body));
      } finally {
        scanBusy = false;
      }
      return;
    }

    if (req.method === 'POST' && url === '/match') {
      const body = JSON.parse((await readBody(req)) || '{}');
      send(res, 200, await handleMatch(body));
      return;
    }

    send(res, 404, { ok: false, error: 'not_found' });
  } catch (err) {
    send(res, 500, { ok: false, error: err instanceof Error ? err.message : 'internal' });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`[church-bridge] listening on http://127.0.0.1:${PORT}`);
  console.log(`[church-bridge] platform: ${process.platform}`);
  console.log(`[church-bridge] scan bin: ${SCAN_BIN} (${existsSync(SCAN_BIN) ? 'ok' : 'MISSING'})`);
  console.log(`[church-bridge] nbis:     ${NBIS_BIN} (${existsSync(MINDTCT) ? 'ok' : 'MISSING'})`);
  console.log(`[church-bridge] scanner:  ${(await scannerPresent()) ? 'detected' : 'NOT DETECTED'}`);
});
