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
import { pickBestCandidate, type CandidateScore, type MatchDecision } from './matching';
import { decodeXytTemplate } from './codec';
import type { MatcherCandidate } from './types';

type NbisModule = {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _match_templates(a: number, b: number): number;
  stringToNewUTF8(s: string): number;
};

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
      return mod.default();
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
 * Score `probe` against every template in `candidates` and apply the same
 * threshold rule the bridge applies.
 *
 * Deliberately reuses `pickBestCandidate` rather than reimplementing "highest
 * score at or above threshold" — the bridge, the browser and this module must
 * not merely agree today, they must be the same rule.
 */
export async function matchWithWasm(
  probeXyt: string,
  candidates: MatcherCandidate[],
  threshold: number,
): Promise<MatchDecision | null> {
  const M = await loadModule();
  if (!M) throw new Error('NBIS wasm artifact not found on this server');

  const probePtr = M.stringToNewUTF8(probeXyt);
  try {
    const scores: CandidateScore[] = [];
    for (const candidate of candidates) {
      let best = 0;
      for (const wire of candidate.templates) {
        const text = decodeXytTemplate(wire);
        // A corrupt stored template must not take down the whole scan — skip
        // it and let the member's other impressions carry the match. This is
        // why multi-template enrolment is load-bearing (Plan 43 Phase A).
        if (!text) continue;
        const ptr = M.stringToNewUTF8(text);
        try {
          const score = M._match_templates(probePtr, ptr);
          if (Number.isFinite(score) && score > best) best = score;
        } finally {
          M._free(ptr);
        }
      }
      scores.push({ member_id: candidate.member_id, score: best });
    }
    return pickBestCandidate(scores, threshold);
  } finally {
    M._free(probePtr);
  }
}
