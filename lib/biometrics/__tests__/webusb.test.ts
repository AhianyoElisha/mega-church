import { describe, expect, it } from 'vitest';
import {
  FINGER_OFF_THRESHOLD,
  FINGER_ON_THRESHOLD,
  FS81_PRODUCT_ID,
  FS81_VENDOR_ID,
  flipRows,
  meanBlockVariance,
  parseDeviceInfo,
  pickBestFrame,
} from '@/lib/biometrics/webusb';

/** Build an `E0` reply with the given geometry at bytes 4..7, big-endian. */
function infoPacket(width: number, height: number, length = 512): Uint8Array {
  const p = new Uint8Array(length);
  p[4] = (width >> 8) & 0xff;
  p[5] = width & 0xff;
  p[6] = (height >> 8) & 0xff;
  p[7] = height & 0xff;
  return p;
}

describe('parseDeviceInfo', () => {
  it('reads the FS81 geometry the protocol doc records', () => {
    // 0x0140 = 320, 0x01E0 = 480 — the values observed on real hardware.
    expect(parseDeviceInfo(infoPacket(320, 480))).toEqual({ width: 320, height: 480 });
  });

  it('rejects a short packet instead of reading past the end', () => {
    expect(() => parseDeviceInfo(new Uint8Array(4))).toThrow(/too short/i);
  });

  it('rejects implausible geometry rather than allocating from garbage', () => {
    expect(() => parseDeviceInfo(infoPacket(0, 0))).toThrow(/implausible/i);
    expect(() => parseDeviceInfo(infoPacket(9999, 480))).toThrow(/implausible/i);
  });
});

describe('flipRows', () => {
  it('reverses row order and nothing else', () => {
    // 3 wide x 4 tall, each row filled with its own index.
    const w = 3;
    const h = 4;
    const src = new Uint8Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(Array.from(flipRows(src, w, h))).toEqual([3, 3, 3, 2, 2, 2, 1, 1, 1, 0, 0, 0]);
  });

  it('preserves pixel order WITHIN a row (a vertical flip, not a rotation)', () => {
    // The distinction matters: a 180-degree rotation scored 8 against a vendor
    // enrolment where the vertical flip scored 79.
    const src = new Uint8Array([1, 2, 3, 4, 5, 6]);
    expect(Array.from(flipRows(src, 3, 2))).toEqual([4, 5, 6, 1, 2, 3]);
  });

  it('is its own inverse', () => {
    const w = 4;
    const h = 5;
    const src = new Uint8Array(w * h).map((_, i) => (i * 7) % 251);
    expect(Array.from(flipRows(flipRows(src, w, h), w, h))).toEqual(Array.from(src));
  });

  it('does not alias the input buffer', () => {
    const src = new Uint8Array([1, 1, 2, 2]);
    const out = flipRows(src, 2, 2);
    out[0] = 99;
    expect(src[0]).toBe(1);
  });
});

describe('meanBlockVariance', () => {
  it('is zero on a flat image', () => {
    const px = new Uint8Array(16 * 16).fill(128);
    expect(meanBlockVariance(px, 16, 16)).toBe(0);
  });

  it('matches the closed form on a known block', () => {
    // One 8x8 block, half 0 and half 255: mean 127.5, variance 127.5^2.
    const px = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) px[y * 8 + x] = x < 4 ? 0 : 255;
    }
    expect(meanBlockVariance(px, 8, 8)).toBeCloseTo(127.5 * 127.5, 6);
  });

  it('ignores a trailing partial block, exactly as semp-scan.c does', () => {
    // 12 wide = one full 8-wide block plus 4 leftover columns. The leftover
    // must not contribute, or a tablet and a PC would disagree about a press.
    const px = new Uint8Array(12 * 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 8; x < 12; x++) px[y * 12 + x] = 255; // noise, outside any block
    }
    expect(meanBlockVariance(px, 12, 8)).toBe(0);
  });

  it('separates an empty platen from a finger at the shipped thresholds', () => {
    const w = 64;
    const h = 64;
    // Empty platen: near-flat with a little sensor noise.
    const empty = new Uint8Array(w * h).map((_, i) => 120 + (i % 3));
    // Finger: strong ridge/valley alternation.
    const finger = new Uint8Array(w * h).map((_, i) =>
      Math.floor(i / w) % 2 === 0 ? 20 : 230,
    );
    expect(meanBlockVariance(empty, w, h)).toBeLessThan(FINGER_OFF_THRESHOLD);
    expect(meanBlockVariance(finger, w, h)).toBeGreaterThan(FINGER_ON_THRESHOLD);
  });
});

describe('pickBestFrame', () => {
  it('returns the sharpest frame', () => {
    const frames = [
      { pixels: new Uint8Array([1]), variance: 400 },
      { pixels: new Uint8Array([2]), variance: 2100 },
      { pixels: new Uint8Array([3]), variance: 900 },
    ];
    expect(pickBestFrame(frames)?.variance).toBe(2100);
  });

  it('returns null when nothing was captured', () => {
    expect(pickBestFrame([])).toBeNull();
  });
});

describe('device constants', () => {
  it('match the hardware the protocol was derived from', () => {
    // 1491:0020. Wrong ids mean requestDevice shows an empty picker, which
    // looks like "no scanner" rather than a typo.
    expect(FS81_VENDOR_ID).toBe(0x1491);
    expect(FS81_PRODUCT_ID).toBe(0x0020);
  });

  it('keeps the finger thresholds identical to semp-scan.c', () => {
    expect(FINGER_ON_THRESHOLD).toBe(300);
    expect(FINGER_OFF_THRESHOLD).toBe(150);
  });
});
