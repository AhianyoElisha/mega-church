import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MATCH_THRESHOLD,
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
