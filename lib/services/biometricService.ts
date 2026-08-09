// The matcher seam. Ported from SEMP; see tools/PROVENANCE.md.
//
// One narrow interface (`match`). Three implementations, in factory priority:
//
//   - LocalMatcherBiometricService — POSTs the probe + candidate set to the
//     fingerprint bridge's /match. Selected by CHURCH_BIOMETRIC_MATCHER_URL.
//     Ranked first so a PC kiosk that already has a working bridge keeps using
//     the path that has been running longest.
//   - WasmBiometricService — runs NBIS-as-WebAssembly inside THIS Next process.
//     What a hosted deployment falls into, where the alternative was a stub and
//     a silent failure.
//   - StubBiometricService — `sim:<member_id>` passthrough, for development and
//     for testing the flow without hardware.
//
// The caller only ever does `getBiometricService(deps).match(payload)`.

import type { Databases } from 'node-appwrite'
import { XYT_PREFIX, decodeXytTemplate } from '@/lib/biometrics/codec'
import {
  loadAllCandidateTemplates,
  loadCandidatesForMeeting,
} from '@/lib/biometrics/server'
import { parseThreshold, type MatchDecision } from '@/lib/biometrics/matching'
import type { MatcherCandidate, MatcherHealth } from '@/lib/biometrics/types'
import { isWasmMatcherAvailable, matchWithWasm } from '@/lib/biometrics/wasm-matcher'

/**
 * Escape hatch. `CHURCH_WASM_MATCHER=0` forces the old behaviour (stub + a
 * clear 503) if the in-process matcher ever misbehaves in production — an env
 * change beats a redeploy at 7am on a Sunday.
 *
 * Read per call, not at module load: a switch you must restart the process to
 * use is not much of an emergency switch.
 */
function wasmMatcherEnabled(): boolean {
  return process.env.CHURCH_WASM_MATCHER !== '0'
}

export type BiometricMatch = { member_id: string } | null

export interface BiometricService {
  /**
   * Resolve a fingerprint payload to a `member_id`.
   *
   * Returns `null` when — and ONLY when — the matcher ran and nobody matched.
   */
  match(fingerprint_data: string): Promise<BiometricMatch>
}

const SIM_PREFIX = 'sim:'

/**
 * "This server cannot match" is NOT "that finger did not match", and conflating
 * them cost SEMP a full exam session on 2026-08-08.
 *
 * A kiosk pointed at a server with no reachable matcher got `null` from every
 * scan, which the kiosk rendered as FINGERPRINT NOT RECOGNISED — a screen
 * pixel-identical to a genuinely unknown finger. Enrolment kept working
 * (capture is browser-side and needs no matcher), so the fault looked
 * biometric. It was configuration.
 *
 * Everything that is not a clean non-match throws this, and the route turns it
 * into a 503 the kiosk can explain in words.
 */
export class MatcherUnavailableError extends Error {
  constructor(
    readonly reason: 'not_configured' | 'unreachable' | 'matcher_error',
    message: string,
  ) {
    super(message)
    this.name = 'MatcherUnavailableError'
  }
}

/**
 * Default stub. Accepts `sim:<member_id>`. A real `xyt:` template reaching the
 * stub means no matcher is configured on THIS server — a misconfiguration, not
 * a non-match, so it throws rather than returning null.
 */
export class StubBiometricService implements BiometricService {
  async match(fingerprint_data: string): Promise<BiometricMatch> {
    if (typeof fingerprint_data !== 'string') return null
    const trimmed = fingerprint_data.trim()
    if (trimmed.startsWith(XYT_PREFIX)) {
      throw new MatcherUnavailableError(
        'not_configured',
        'This server has no fingerprint matcher, so it cannot identify a real fingerprint. ' +
          'Either deploy the NBIS WebAssembly artifact (public/nbis/) or run the app on the ' +
          'kiosk PC alongside the scanner bridge.',
      )
    }
    if (!trimmed.startsWith(SIM_PREFIX)) return null
    const id = trimmed.slice(SIM_PREFIX.length).trim()
    return id.length === 0 ? null : { member_id: id }
  }
}

/** The pilot-proven path: a stateless bridge on loopback. Every probe travels
 *  WITH its candidate set, so swapping the matcher is a config change. */
export class LocalMatcherBiometricService implements BiometricService {
  private readonly stub = new StubBiometricService()

  constructor(
    private readonly matcherUrl: string,
    private readonly databases: Databases,
    private readonly scope?: BiometricServiceDeps['scope'],
  ) {}

  async match(fingerprint_data: string): Promise<BiometricMatch> {
    if (typeof fingerprint_data !== 'string') return null
    const trimmed = fingerprint_data.trim()
    if (!trimmed.startsWith(XYT_PREFIX)) return this.stub.match(trimmed)

    const decision = await identifyAcrossScopes(this.databases, this.scope, (candidates) =>
      this.askBridge(trimmed, candidates),
    )
    if (!decision) return null
    console.log(`[biometric] bridge match → ${decision.member_id} (score=${decision.score})`)
    return { member_id: decision.member_id }
  }

  private async askBridge(
    probeWire: string,
    candidates: MatcherCandidate[],
  ): Promise<MatchDecision | null> {
    let res: Response
    try {
      res = await fetch(`${this.matcherUrl.replace(/\/$/, '')}/match`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          probe: probeWire,
          candidates,
          threshold: parseThreshold(process.env.CHURCH_BIOMETRIC_THRESHOLD),
        }),
        cache: 'no-store',
      })
    } catch (e) {
      // A bridge that cannot be reached is a configuration fault, not a
      // non-match. The commonest cause by far is this server not being the
      // machine the scanner is plugged into.
      throw new MatcherUnavailableError(
        'unreachable',
        `The fingerprint matcher at ${this.matcherUrl} is unreachable from this server ` +
          `(${e instanceof Error ? e.message : String(e)}). If this is a hosted deployment it ` +
          'cannot reach a kiosk-local bridge — the bridge binds to loopback by design.',
      )
    }
    if (!res.ok) {
      throw new MatcherUnavailableError(
        'unreachable',
        `The fingerprint matcher at ${this.matcherUrl} answered HTTP ${res.status}.`,
      )
    }
    const body = (await res.json()) as {
      ok?: boolean
      error?: unknown
      member_id?: unknown
      score?: unknown
    }
    // `{ ok:true, member_id:null }` is a real "nobody matched"; `ok:false` is
    // the matcher itself failing (invalid_probe / bozorth3_failed).
    if (!body.ok) {
      throw new MatcherUnavailableError(
        'matcher_error',
        `The fingerprint matcher rejected the request: ${String(body.error ?? 'unknown error')}.`,
      )
    }
    if (typeof body.member_id !== 'string' || body.member_id.length === 0) return null
    return {
      member_id: body.member_id,
      score: typeof body.score === 'number' ? body.score : 0,
    }
  }
}

/**
 * The matcher, running in THIS server process.
 *
 * The bridge exists because *capture* needs a USB device and a vendor library.
 * *Matching* needs neither, so the same NBIS WebAssembly the tablet uses runs
 * here in Node and any deployment can identify a fingerprint. That removes the
 * need for a Next server (and an Appwrite key) on every kiosk, while keeping
 * the property that makes on-device identification unattractive: the SERVER
 * decides who you are, so a tampered kiosk cannot assert an identity.
 */
export class WasmBiometricService implements BiometricService {
  private readonly stub = new StubBiometricService()

  constructor(
    private readonly databases: Databases,
    private readonly scope?: BiometricServiceDeps['scope'],
  ) {}

  async match(fingerprint_data: string): Promise<BiometricMatch> {
    if (typeof fingerprint_data !== 'string') return null
    const trimmed = fingerprint_data.trim()
    if (!trimmed.startsWith(XYT_PREFIX)) return this.stub.match(trimmed)

    const probe = decodeXytTemplate(trimmed)
    if (!probe) return null

    const threshold = parseThreshold(process.env.CHURCH_BIOMETRIC_THRESHOLD)
    let decision: MatchDecision | null
    try {
      decision = await identifyAcrossScopes(this.databases, this.scope, (candidates) =>
        matchWithWasm(probe, candidates, threshold),
      )
    } catch (e) {
      // The artifact is missing or failed to instantiate. That is a broken
      // server, not a failed match, and must not read as "unknown finger".
      throw new MatcherUnavailableError(
        'unreachable',
        `The in-process fingerprint matcher failed to run (${
          e instanceof Error ? e.message : String(e)
        }). Check that public/nbis/ is present in this deployment.`,
      )
    }
    if (!decision) return null
    console.log(`[biometric] wasm match → ${decision.member_id} (score=${decision.score})`)
    return { member_id: decision.member_id }
  }
}

export interface BiometricServiceDeps {
  databases?: Databases
  /**
   * Narrows the gallery to who could plausibly be pressing this scanner.
   *
   * `meeting_id` is only meaningful together with `restricted: true` — an open
   * service's gallery IS every active member, so there is nothing to narrow.
   */
  scope?: { meeting_id: string; restricted: boolean }
}

/**
 * Identify a probe against progressively wider galleries, stopping at the first
 * that recognises it.
 *
 * For a RESTRICTED meeting:
 *   1. the meeting's authorised roster — small, and the common case;
 *   2. every active member — so somebody who is NOT authorised is still
 *      identified, and the kiosk can tell them by name that they do not have
 *      access to this meeting (PRD §2.3).
 *
 * Stage 2 is the whole reason this is two-stage. Without it an unauthorised
 * member gets "fingerprint not recognised", which is both wrong and the least
 * helpful thing the screen can say — it sends them to an usher to debug a
 * biometric fault that does not exist. The caller compares the identified
 * member against the roster and decides `marked` vs `not_authorised`.
 *
 * For an open service there is one stage: every active member.
 *
 * The escalation is on **no match**, not on an empty gallery. A roster that is
 * simply empty is a configuration problem, and falling through to the full set
 * is the right recovery — better to identify someone and refuse them for a
 * stated reason than to tell a real member their finger is unknown.
 */
async function identifyAcrossScopes(
  databases: Databases,
  scope: BiometricServiceDeps['scope'],
  identify: (candidates: MatcherCandidate[]) => Promise<MatchDecision | null>,
): Promise<MatchDecision | null> {
  const stages: Array<() => Promise<MatcherCandidate[]>> =
    scope?.restricted && scope.meeting_id
      ? [
          () => loadCandidatesForMeeting(databases, scope.meeting_id),
          () => loadAllCandidateTemplates(databases),
        ]
      : [() => loadAllCandidateTemplates(databases)]

  for (const load of stages) {
    const candidates = await load()
    if (candidates.length === 0) continue
    const decision = await identify(candidates)
    if (decision) return decision
  }
  return null
}

export type { MatcherHealth } from '@/lib/biometrics/types'

/**
 * Probe the configured matcher. Never throws — this is the diagnostic that runs
 * WHEN things are broken, so it reports rather than fails.
 */
export async function probeBiometricMatcher(): Promise<MatcherHealth> {
  const matcherUrl = process.env.CHURCH_BIOMETRIC_MATCHER_URL

  if (!matcherUrl || matcherUrl.length === 0) {
    if (wasmMatcherEnabled() && (await isWasmMatcherAvailable())) {
      return {
        implementation: 'wasm',
        configured: true,
        reachable: true,
        url: null,
        detail:
          'This server matches fingerprints in-process (NBIS as WebAssembly), so it can ' +
          'identify members without a local scanner bridge.',
      }
    }
    return {
      implementation: 'stub',
      configured: false,
      reachable: null,
      url: null,
      detail:
        'No fingerprint matcher is available on this server, so it cannot identify ' +
        'fingerprints. Either deploy the NBIS WebAssembly artifact (public/nbis/) or run the ' +
        'app on the kiosk PC alongside the scanner bridge.',
    }
  }

  try {
    const res = await fetch(`${matcherUrl.replace(/\/$/, '')}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) {
      return {
        implementation: 'local_bridge',
        configured: true,
        reachable: false,
        url: matcherUrl,
        detail: `The fingerprint bridge at ${matcherUrl} answered HTTP ${res.status}.`,
      }
    }
    const body = (await res.json()) as {
      ok?: boolean
      device?: boolean
      scanBin?: boolean
      nbis?: boolean
    }
    const missing: string[] = []
    if (body.device === false) missing.push('scanner not detected')
    if (body.scanBin === false) missing.push('capture binary missing')
    if (body.nbis === false) missing.push('NBIS binaries missing')
    return {
      implementation: 'local_bridge',
      configured: true,
      reachable: true,
      url: matcherUrl,
      detail:
        missing.length === 0
          ? 'The fingerprint bridge is reachable from this server and fully healthy.'
          : `The fingerprint bridge is reachable but reports: ${missing.join(', ')}.`,
    }
  } catch (e) {
    return {
      implementation: 'local_bridge',
      configured: true,
      reachable: false,
      url: matcherUrl,
      detail:
        `This server cannot reach the fingerprint bridge at ${matcherUrl} ` +
        `(${e instanceof Error ? e.message : String(e)}). If the app is running on a hosted ` +
        'deployment it never can — the bridge binds to loopback on the kiosk PC by design. ' +
        'Either run the app on the kiosk, or unset CHURCH_BIOMETRIC_MATCHER_URL and let this ' +
        'server match in-process.',
    }
  }
}

/** Factory. Priority: local bridge > in-process wasm > simulator stub. */
export function getBiometricService(deps: BiometricServiceDeps = {}): BiometricService {
  const matcherUrl = process.env.CHURCH_BIOMETRIC_MATCHER_URL
  if (matcherUrl && matcherUrl.length > 0 && deps.databases) {
    return new LocalMatcherBiometricService(matcherUrl, deps.databases, deps.scope)
  }
  if (deps.databases && wasmMatcherEnabled()) {
    return new WasmBiometricService(deps.databases, deps.scope)
  }
  return new StubBiometricService()
}
