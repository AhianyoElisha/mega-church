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
