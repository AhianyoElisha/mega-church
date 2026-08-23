import 'server-only';

// Plan 45 (revised) — run the NBIS matcher INSIDE the Next server.
//
// The realisation this module is built on: **the matcher does not need a
// scanner.** The fingerprint bridge exists because capture needs a USB device
// and a vendor library; `/match` only needs bozorth3 over a probe and a
// candidate set. So the same wasm the tablet uses (Plan 42) can run in Node,
// and any deployment — hosted, OCI, or a laptop — can identify a fingerprint.
//
// What that buys, without moving identification onto the device:
//   - a tablet kiosk works against the hosted app, with no LAN dependency on
//     a PC in the church office and no Next server per entrance;
//   - therefore no Appwrite server key on every kiosk (Plan 44's fleet risk);
//   - and the SERVER still decides who you are, so a tampered kiosk cannot
//     assert an identity. That property is why this beats on-device 1:N.
//
// Measured on the Plan 43 corpus, 2026-08-08:
//   impostor comparison 1.05 ms, genuine 3.55 ms
//   -> a 60-member gallery at 12 templates each (720 comparisons) is ~760 ms.
// Impostor comparisons dominate a real 1:N and exit early, which is why the
// honest figure is far below 720 x the genuine cost.
//
// This is the number that makes gallery SCOPING load-bearing rather than a
// nicety: the whole registry at 12 templates a head does not fit in the time a
// person is willing to keep a finger on a scanner. See lib/biometrics/server.ts.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import {
  decisiveScore,
  pickBestCandidate,
  type CandidateScore,
  type MatchDecision,
} from './matching';
import { decodeXytTemplate } from './codec';
import type { MatcherCandidate } from './types';

type NbisModule = {
  _malloc(size: number): number;
  _free(ptr: number): void;
  /** 1:1 verification. Parses BOTH templates on every call — see below. */
  _match_templates(a: number, b: number): number;
  stringToNewUTF8(s: string): number;
  // --- 1:N identification. Absent from artifacts built before 2026-08-23. ---
  _set_probe?(ptr: number): number;
  _prepare_template?(ptr: number): number;
  _free_prepared?(ptr: number): void;
  _match_prepared?(ptr: number): number;
};

/** Does this artifact expose the 1:N entry points? */
function hasFastPath(
  M: NbisModule,
): M is NbisModule &
  Required<Pick<NbisModule, '_set_probe' | '_prepare_template' | '_match_prepared'>> {
  return (
    typeof M._set_probe === 'function' &&
    typeof M._prepare_template === 'function' &&
    typeof M._match_prepared === 'function'
  );
}

/**
 * Gallery templates parsed into wasm memory, keyed by their wire form.
 *
 * `struct xyt_struct` is ~2.4 KB, so the whole live gallery (1,188 templates)
 * is under 3 MB — cheap enough to parse at gallery-load time instead of inside
 * the scan loop, which is where it used to happen 1,188 times per press.
 *
 * Keyed by the wire string rather than by member, because that is what makes
 * the entry survive a gallery REFRESH: the same template re-fetched from
 * Appwrite is the same string, so nothing is re-parsed just because the cache
 * ticked over.
 */
const preparedTemplates = new Map<string, number>();
/** ~5,000 x 2.4 KB ≈ 12 MB. A congregation past this re-parses, it never leaks. */
const MAX_PREPARED = 5_000;
let moduleRef: NbisModule | null = null;

/** Free every prepared template. Called when the gallery is invalidated. */
export function resetPreparedTemplates(): void {
  const M = moduleRef;
  if (M && typeof M._free_prepared === 'function') {
    for (const ptr of preparedTemplates.values()) M._free_prepared(ptr);
  }
  preparedTemplates.clear();
}

function preparedPointer(
  M: NbisModule & Required<Pick<NbisModule, '_prepare_template'>>,
  wire: string,
): number | null {
  const hit = preparedTemplates.get(wire);
  if (hit !== undefined) return hit;

  const text = decodeXytTemplate(wire);
  if (!text) return null;
  const textPtr = M.stringToNewUTF8(text);
  let ptr: number;
  try {
    ptr = M._prepare_template(textPtr);
  } finally {
    M._free(textPtr);
  }
  if (!ptr) return null;

  if (preparedTemplates.size >= MAX_PREPARED) resetPreparedTemplates();
  preparedTemplates.set(wire, ptr);
  return ptr;
}

/**
 * Where the wasm lives at runtime. `public/nbis/` is the copy the browser
 * fetches (Plan 42); reusing it keeps ONE artifact rather than two that can
 * drift into disagreeing about scores. `tools/` is the build output and is
 * checked second so a dev box works even before anything is copied.
 */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, 'public', 'nbis', 'nbis.js'),
    path.join(cwd, 'tools', 'nbis-wasm', 'dist', 'nbis.js'),
  ];
}

let modulePromise: Promise<NbisModule | null> | null = null;

/** Load once per process; null when the artifact is not deployed. */
function loadModule(): Promise<NbisModule | null> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const file = candidatePaths().find((p) => existsSync(p));
      if (!file) return null;
      // Built at runtime so no bundler tries to trace or inline it: the
      // Emscripten glue resolves its own .wasm sibling relative to this URL.
      const href = pathToFileURL(file).href;
      const mod = (await import(/* webpackIgnore: true */ href)) as {
        default: () => Promise<NbisModule>;
      };
      const instance = await mod.default();
      moduleRef = instance;
      return instance;
    })().catch((e) => {
      // Never cache a failure — a transient load error should not disable
      // fingerprint check-in until the process restarts.
      modulePromise = null;
      throw e;
    });
  }
  return modulePromise;
}

/** True when this server can match without any external help. */
export async function isWasmMatcherAvailable(): Promise<boolean> {
  try {
    return (await loadModule()) !== null;
  } catch {
    return false;
  }
}

/**
 * Score `probe` against `candidates` and apply the same threshold rule the
 * bridge applies.
 *
 * Two exits, and the difference between them is the whole latency story:
 *
 *   DECISIVE   a score at or above `decisiveScore(threshold)` ends the search
 *              immediately. On the live gallery that is where the median
 *              genuine scan (146) sits and where no impostor has ever been
 *              observed (max 27). See the note in matching.ts.
 *   ARGMAX     anything less and every candidate is scored, then
 *              `pickBestCandidate` picks the highest — byte for byte the rule
 *              that shipped before, so a marginal match is decided exactly as
 *              it always was.
 *
 * `pickBestCandidate` is still the only place "highest at or above threshold"
 * is written down: the bridge, the browser and this module must not merely
 * agree today, they must be the same rule.
 */
export async function matchWithWasm(
  probeXyt: string,
  candidates: MatcherCandidate[],
  threshold: number,
): Promise<MatchDecision | null> {
  const M = await loadModule();
  if (!M) throw new Error('NBIS wasm artifact not found on this server');

  const decisive = decisiveScore(threshold, process.env.CHURCH_BIOMETRIC_DECISIVE);
  const fast = hasFastPath(M);

  // The probe's comparison "Web" is built ONCE here, not once per gallery
  // template. `bozorth_main` — what the slow path calls — is literally
  // `bozorth_probe_init()` followed by `bozorth_to_gallery()`, so a 1,188
  // template gallery rebuilt the same probe Web 1,188 times to get 1,188
  // identical intermediate results. Same call sequence, loop-invariant half
  // hoisted: scores are unchanged by construction.
  let probePtr = 0;
  if (fast) {
    const p = M.stringToNewUTF8(probeXyt);
    let ok: number;
    try {
      ok = M._set_probe(p);
    } finally {
      M._free(p);
    }
    if (!ok) return null; // unusable probe, not a failed match
  } else {
    probePtr = M.stringToNewUTF8(probeXyt);
  }

  try {
    const scores: CandidateScore[] = [];
    let decided: CandidateScore | null = null;

    for (const candidate of candidates) {
      let best = 0;
      for (const wire of candidate.templates) {
        // A corrupt stored template must not take down the whole scan — skip
        // it and let the member's other impressions carry the match. This is
        // why multi-template enrolment is load-bearing (Plan 43 Phase A).
        let score: number;
        if (fast) {
          const ptr = preparedPointer(M, wire);
          if (ptr === null) continue;
          score = M._match_prepared(ptr);
        } else {
          // Older artifact without the 1:N entry points. Correct, just slow —
          // and worth keeping so new server code can be deployed against a
          // wasm build that has not been refreshed yet.
          const text = decodeXytTemplate(wire);
          if (!text) continue;
          const ptr = M.stringToNewUTF8(text);
          try {
            score = M._match_templates(probePtr, ptr);
          } finally {
            M._free(ptr);
          }
        }
        if (Number.isFinite(score) && score > best) best = score;
        // This member is already identified beyond doubt; their remaining
        // impressions cannot change the answer, only the clock.
        if (best >= decisive) break;
      }
      scores.push({ member_id: candidate.member_id, score: best });
      if (best >= decisive) {
        decided = { member_id: candidate.member_id, score: best };
        break;
      }
    }

    if (decided) return { member_id: decided.member_id, score: decided.score };
    return pickBestCandidate(scores, threshold);
  } finally {
    if (probePtr) M._free(probePtr);
  }
}
