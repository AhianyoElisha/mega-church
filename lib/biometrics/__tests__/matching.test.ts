import { describe, it, expect } from 'vitest';
import {
  DECISIVE_MULTIPLE,
  DEFAULT_MATCH_THRESHOLD,
  decisiveScore,
  orderByLikelihood,
  parseThreshold,
  pickBestCandidate,
} from '../matching';

describe('parseThreshold', () => {
  it('defaults when unset/blank/garbage/out-of-range', () => {
    expect(parseThreshold(undefined)).toBe(DEFAULT_MATCH_THRESHOLD);
    expect(parseThreshold(null)).toBe(DEFAULT_MATCH_THRESHOLD);
    expect(parseThreshold('')).toBe(DEFAULT_MATCH_THRESHOLD);
    expect(parseThreshold('abc')).toBe(DEFAULT_MATCH_THRESHOLD);
    expect(parseThreshold('0')).toBe(DEFAULT_MATCH_THRESHOLD);
    expect(parseThreshold('-5')).toBe(DEFAULT_MATCH_THRESHOLD);
    expect(parseThreshold('9999')).toBe(DEFAULT_MATCH_THRESHOLD);
  });

  it('parses valid integers and floors floats', () => {
    expect(parseThreshold('40')).toBe(40);
    expect(parseThreshold('33.9')).toBe(33);
  });
});

describe('pickBestCandidate', () => {
  it('returns null on empty input', () => {
    expect(pickBestCandidate([], 33)).toBeNull();
  });

  it('returns null when nothing reaches threshold (measured impostor band)', () => {
    expect(
      pickBestCandidate(
        [
          { member_id: 'A', score: 13 },
          { member_id: 'B', score: 11 },
        ],
        33,
      ),
    ).toBeNull();
  });

  it('picks the highest score at/above threshold (measured genuine band)', () => {
    const r = pickBestCandidate(
      [
        { member_id: 'A', score: 12 },
        { member_id: 'B', score: 58 },
        { member_id: 'C', score: 41 },
      ],
      33,
    );
    expect(r).toEqual({ member_id: 'B', score: 58 });
  });

  it('score exactly at threshold matches', () => {
    expect(pickBestCandidate([{ member_id: 'A', score: 33 }], 33)).toEqual({
      member_id: 'A',
      score: 33,
    });
  });

  it('ties go to the first-seen candidate', () => {
    const r = pickBestCandidate(
      [
        { member_id: 'first', score: 50 },
        { member_id: 'second', score: 50 },
      ],
      33,
    );
    expect(r?.member_id).toBe('first');
  });

  it('ignores non-finite scores', () => {
    expect(pickBestCandidate([{ member_id: 'A', score: NaN }], 33)).toBeNull();
  });
});

describe('decisiveScore', () => {
  it('is a multiple of the threshold, so it moves when the threshold is recalibrated', () => {
    expect(decisiveScore(33)).toBe(33 * DECISIVE_MULTIPLE);
    expect(decisiveScore(50)).toBe(50 * DECISIVE_MULTIPLE);
  });

  it('accepts an explicit override', () => {
    expect(decisiveScore(33, '120')).toBe(120);
  });

  // A "decisive" score below the threshold would be one we would not accept as
  // a match at all — obeying it would end the search on evidence we have
  // already decided is too weak.
  it('ignores an override below the threshold', () => {
    expect(decisiveScore(33, '10')).toBe(33 * DECISIVE_MULTIPLE);
  });

  it('ignores rubbish', () => {
    expect(decisiveScore(33, 'soon')).toBe(66);
    expect(decisiveScore(33, '')).toBe(66);
    expect(decisiveScore(33, null)).toBe(66);
  });

  // The documented escape hatch: set it high enough and nothing is ever
  // decisive, so every scan falls through to a full argmax.
  it('can be set high enough to disable early exit entirely', () => {
    expect(decisiveScore(33, '9999')).toBe(9999);
  });
});

describe('orderByLikelihood', () => {
  const gallery = [{ member_id: 'a' }, { member_id: 'b' }, { member_id: 'c' }];

  it('moves already-marked members to the back', () => {
    expect(orderByLikelihood(gallery, ['a'])).toEqual([
      { member_id: 'b' },
      { member_id: 'c' },
      { member_id: 'a' },
    ]);
  });

  // The property that keeps this an optimisation rather than a behaviour
  // change: nobody is dropped, so a member who scans twice is still identified
  // and still told "already checked in" by name.
  it('never drops anybody', () => {
    const out = orderByLikelihood(gallery, ['a', 'b', 'c']);
    expect(out.map((c) => c.member_id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('is stable within each group', () => {
    expect(orderByLikelihood(gallery, ['b'])).toEqual([
      { member_id: 'a' },
      { member_id: 'c' },
      { member_id: 'b' },
    ]);
  });

  it('is a no-op when nothing is marked', () => {
    expect(orderByLikelihood(gallery, [])).toEqual(gallery);
    expect(orderByLikelihood(gallery, undefined)).toEqual(gallery);
  });

  it('ignores ids that are not in the gallery', () => {
    expect(orderByLikelihood(gallery, ['zzz'])).toEqual(gallery);
  });

  it('does not mutate the gallery it was given', () => {
    const original = [...gallery];
    orderByLikelihood(gallery, ['a']);
    expect(gallery).toEqual(original);
  });
});
