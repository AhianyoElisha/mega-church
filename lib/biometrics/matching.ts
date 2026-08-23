// Matcher decision logic (pure). Extracted from SEMP; see tools/PROVENANCE.md.
//
// bozorth3 emits an integer similarity score per probe/gallery pair.
//
// Provenance of the threshold (measured 2026-08-08 on the Futronic FS81 via
// `mindtct -m1` + `bozorth3 -m1`, cwsq 2.25, raw sensor image): 18 captures,
// 6 fingers, 2 people = 18 genuine + 135 impostor pairs.
//
//   genuine  (same finger)      median  84, range 16-173
//   impostor (different finger) median   8, range  3-27, mean 9.5, sd 3.9
//
// At 33 the corpus yields 0/135 false accepts and, under leave-one-out 1:N
// (2 templates enrolled, 3rd press as probe, whole corpus as the gallery),
// 18/18 correct identifications with 0 rejections. Thresholds 30-40 all give
// the same result, so 33 sits mid-plateau rather than on an edge.
//
// This supersedes a 2026-08-07 measurement that appeared to show impostors
// scoring 56-115. That run mis-labelled its captures — the same finger was
// presented throughout, so every "impostor" pair was actually genuine.
//
// READ THIS BEFORE A LARGE ROLLOUT. The corpus is small: 135 impostor pairs,
// while one live scan against a 400-member gallery at 12 templates each is
// 4,800 draws. False-accept probability grows with gallery size, which is
// exactly why identification is scoped (lib/biometrics/server.ts) rather than
// run against the whole registry. 33 is evidence-backed but not calibrated at
// the FAR levels a large congregation needs — widen the corpus before trusting
// it at that scale. Override with CHURCH_BIOMETRIC_THRESHOLD.

export const DEFAULT_MATCH_THRESHOLD = 33

export interface CandidateScore {
  member_id: string
  /** Max bozorth3 score across this candidate's enrolled templates. */
  score: number
}

export interface MatchDecision {
  member_id: string
  score: number
}

export function parseThreshold(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || raw.trim() === '') return DEFAULT_MATCH_THRESHOLD
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1 || n > 500) return DEFAULT_MATCH_THRESHOLD
  return Math.floor(n)
}

/**
 * Pick the winning candidate: highest score, at or above threshold.
 * Ties go to the first-seen candidate (stable). Null = no match.
 */
export function pickBestCandidate(
  scores: readonly CandidateScore[],
  threshold: number,
): MatchDecision | null {
  let best: CandidateScore | null = null
  for (const s of scores) {
    if (!Number.isFinite(s.score)) continue
    if (best === null || s.score > best.score) best = s
  }
  if (best === null || best.score < threshold) return null
  return { member_id: best.member_id, score: best.score }
}

// === Latency ================================================================
//
// Measured on the live gallery, 2026-08-23: 99 members, 1,188 templates.
// One identification took **2,816 ms** on average, because every scan scored
// the probe against every template and then took the argmax. That is ~3.2 ms
// per bozorth3 comparison × 1,188, and it grows linearly with the congregation.
//
// Two changes below take it to ~634 ms (4.4x) without changing which member is
// named on any of the ten sampled scans:
//
//   1. stop early when the evidence is DECISIVE (this file);
//   2. score the people who have not checked in yet FIRST (`orderByLikelihood`).
//
// They are a package: ordering alone buys nothing, because argmax has to look
// at everything anyway. It is the early exit that turns a good ordering into
// time saved.
//
// The honest cost of (1): argmax over the whole gallery is the only rule that
// cannot, even in principle, be beaten by a later candidate. Exiting early
// trades that for speed, so the bar is set where an impostor realistically
// cannot reach — see `decisiveScore`.

/**
 * The score at which we stop looking.
 *
 * Twice the match threshold, and expressed as a MULTIPLE rather than a constant
 * so it moves when the threshold is recalibrated. At the default threshold of
 * 33 that is 66, against a corpus where impostors scored 3-27 (max 27) and
 * genuine pairs had a median of 84 — so the bar sits at roughly 2.4x the
 * highest impostor ever observed.
 *
 * On the live gallery the ten sampled genuine scans scored 49 / median 146 /
 * max 283. The one at 49 is the interesting case: it does NOT clear the bar, so
 * that scan falls through to a full argmax and is decided exactly as it is
 * today — slower, and correct. Failing to be decisive costs time, never
 * accuracy, which is the direction this has to fail in.
 *
 * `CHURCH_BIOMETRIC_DECISIVE` overrides it. Setting it very high (say 9999)
 * disables early exit entirely and restores exact argmax semantics, which is
 * the escape hatch if a false accept is ever traced to this.
 */
export const DECISIVE_MULTIPLE = 2

export function decisiveScore(threshold: number, raw?: string | null): number {
  if (raw !== undefined && raw !== null && raw.trim() !== '') {
    const n = Number(raw)
    // Below the threshold a "decisive" score would be one we would not even
    // accept as a match, which is nonsense — ignore it rather than obey it.
    if (Number.isFinite(n) && n >= threshold) return Math.floor(n)
  }
  return threshold * DECISIVE_MULTIPLE
}

/**
 * Put the people most likely to be at the scanner first.
 *
 * `deprioritise` is whoever has ALREADY been marked present at this occurrence.
 * They are not removed — someone who scans twice must still be identified, so
 * the kiosk can say "already checked in" by name rather than "not recognised"
 * (PRD §4). They simply go last, because the next person to press the sensor is
 * almost never one of them.
 *
 * Mid-service that is half the congregation, and moving them behind everyone
 * else roughly halves the comparisons before the genuine match is found.
 *
 * Stable within each group, so the gallery order is otherwise untouched. This
 * is ORDERING, never filtering: every member remains matchable on every scan,
 * so it cannot cause a "not recognised" for anybody.
 */
export function orderByLikelihood<T extends { member_id: string }>(
  candidates: readonly T[],
  deprioritise: readonly string[] | undefined,
): T[] {
  if (!deprioritise || deprioritise.length === 0) return [...candidates]
  const done = new Set(deprioritise)
  const first: T[] = []
  const last: T[] = []
  for (const c of candidates) (done.has(c.member_id) ? last : first).push(c)
  return [...first, ...last]
}
