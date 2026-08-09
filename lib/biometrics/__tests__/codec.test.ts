import { describe, it, expect } from 'vitest';
import {
  XYT_PREFIX,
  isValidXytText,
  countMinutiae,
  encodeXytTemplate,
  decodeXytTemplate,
} from '../codec';

const XYT_3COL = '12 34 90\n100 200 45\n7 8 180\n';
const XYT_4COL = '12 34 90 20\n100 200 45 31\n';

describe('isValidXytText', () => {
  it('accepts 3-column and 4-column minutia lines', () => {
    expect(isValidXytText(XYT_3COL)).toBe(true);
    expect(isValidXytText(XYT_4COL)).toBe(true);
  });

  it('rejects empty, junk, and oversized input', () => {
    expect(isValidXytText('')).toBe(false);
    expect(isValidXytText('\n\n')).toBe(false);
    expect(isValidXytText('hello world\n')).toBe(false);
    expect(isValidXytText('1 2\n')).toBe(false); // too few columns
    expect(isValidXytText('1 2 3 4 5\n')).toBe(false); // too many columns
    expect(isValidXytText('-1 2 3\n')).toBe(false); // negative
    expect(isValidXytText('9 9 9\n'.repeat(20000))).toBe(false); // > 64KB
  });

  it('tolerates trailing newline and blank lines between minutiae', () => {
    expect(isValidXytText('1 2 3\n\n4 5 6\n')).toBe(true);
  });
});

describe('countMinutiae', () => {
  it('counts non-blank lines', () => {
    expect(countMinutiae(XYT_3COL)).toBe(3);
    expect(countMinutiae('1 2 3\n\n4 5 6\n')).toBe(2);
  });
});

describe('encode / decode round-trip', () => {
  it('round-trips a valid template', () => {
    const wire = encodeXytTemplate(XYT_4COL);
    expect(wire.startsWith(XYT_PREFIX)).toBe(true);
    expect(decodeXytTemplate(wire)).toBe(XYT_4COL);
  });

  it('encode throws on invalid text', () => {
    expect(() => encodeXytTemplate('nonsense')).toThrow();
  });

  it('decode returns null for non-xyt payloads', () => {
    expect(decodeXytTemplate('sim:1234567')).toBeNull();
    expect(decodeXytTemplate('')).toBeNull();
    expect(decodeXytTemplate('xyt:')).toBeNull();
    expect(decodeXytTemplate('xyt:!!!not-base64!!!')).toBeNull();
    // valid base64 of invalid xyt text
    expect(decodeXytTemplate(XYT_PREFIX + Buffer.from('junk').toString('base64'))).toBeNull();
  });
});
