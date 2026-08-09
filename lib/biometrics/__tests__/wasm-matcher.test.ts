import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isWasmMatcherAvailable, matchWithWasm } from '@/lib/biometrics/wasm-matcher';
import { encodeXytTemplate } from '@/lib/biometrics/codec';
import type { MatcherCandidate } from '@/lib/biometrics/types';

/**
 * Plan 45 — the in-process matcher.
 *
 * These run against the REAL wasm artifact rather than a mock: the whole point
 * of this module is that it produces the same scores as the bridge and the
 * browser, and a mock cannot tell us that.
 *
 * The corpus (`corpus/*.xyt`) is real fingerprint data and is deliberately NOT
 * committed, so the score assertions skip when it is absent. Everything that
 * does not need real minutiae still runs everywhere.
 */
const CORPUS = path.join(process.cwd(), 'corpus');
const hasCorpus =
  existsSync(CORPUS) && readdirSync(CORPUS).filter((f) => f.endsWith('.xyt')).length >= 4;

const loadXyt = (f: string) => readFileSync(path.join(CORPUS, f), 'utf8');
const asCandidate = (name: string, files: string[]): MatcherCandidate => ({
  member_id: name,
  templates: files.map((f) => encodeXytTemplate(loadXyt(f))),
});

describe('wasm matcher availability', () => {
  it('finds the artifact this repo ships', async () => {
    // If this fails the deployment is missing public/nbis/, which is exactly
    // the condition probeBiometricMatcher reports as "no matcher".
    expect(await isWasmMatcherAvailable()).toBe(true);
  });
});

describe('matchWithWasm', () => {
  it('returns null for an empty gallery rather than throwing', async () => {
    expect(await matchWithWasm('10 20 30 40\n', [], 33)).toBeNull();
  });

  it('skips a corrupt stored template instead of failing the whole scan', async () => {
    // Multi-template enrolment is what carries dry fingers (Plan 43 Phase A);
    // one unreadable template must not cost a member their check-in.
    const candidates: MatcherCandidate[] = [
      { member_id: 'BAD', templates: ['xyt:!!!not-base64!!!', 'not-even-prefixed'] },
    ];
    expect(await matchWithWasm('10 20 30 40\n', candidates, 33)).toBeNull();
  });

  it.skipIf(!hasCorpus)('identifies a different impression of the same finger', async () => {
    // li1/li2/li3 are three presses of one finger; p2_* is a different person.
    const gallery = [
      asCandidate('SUBJECT_1', ['li1.xyt', 'li3.xyt']),
      asCandidate('SUBJECT_2', ['p2_li1.xyt', 'p2_ri1.xyt']),
    ];
    const decision = await matchWithWasm(loadXyt('li2.xyt'), gallery, 33);
    expect(decision?.member_id).toBe('SUBJECT_1');
    expect(decision!.score).toBeGreaterThan(33);
  });

  it.skipIf(!hasCorpus)('rejects a finger belonging to nobody in the gallery', async () => {
    const gallery = [asCandidate('SUBJECT_2', ['p2_li1.xyt', 'p2_li2.xyt', 'p2_li3.xyt'])];
    // A different subject's finger must fall below threshold, not merely rank
    // lower — this is the property that stops a stranger being admitted.
    expect(await matchWithWasm(loadXyt('li1.xyt'), gallery, 33)).toBeNull();
  });

  it.skipIf(!hasCorpus)('takes the best score across a student\'s templates', async () => {
    // Enrolling three impressions should never score WORSE than enrolling the
    // single best one — Plan 43 measured this as the thing that rescues weak
    // captures.
    const single = await matchWithWasm(loadXyt('li2.xyt'), [asCandidate('S', ['li1.xyt'])], 1);
    const multi = await matchWithWasm(
      loadXyt('li2.xyt'),
      [asCandidate('S', ['li1.xyt', 'li3.xyt'])],
      1,
    );
    expect(multi!.score).toBeGreaterThanOrEqual(single!.score);
  });

  it.skipIf(!hasCorpus)('honours the threshold it is given', async () => {
    const gallery = [asCandidate('SUBJECT_1', ['li1.xyt'])];
    const low = await matchWithWasm(loadXyt('li2.xyt'), gallery, 1);
    expect(low).not.toBeNull();
    // Same pair, absurd threshold — must refuse rather than return its best.
    expect(await matchWithWasm(loadXyt('li2.xyt'), gallery, 100_000)).toBeNull();
  });
});
