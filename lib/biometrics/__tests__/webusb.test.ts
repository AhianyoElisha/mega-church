import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FINGER_OFF_THRESHOLD,
  FINGER_ON_THRESHOLD,
  FS81_PRODUCT_ID,
  FS81_VENDOR_ID,
  Fs81Device,
  flipRows,
  looksLikeInfoPacket,
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

  it('reports the offending bytes, because they say WHICH fault this is', () => {
    // 14149x22119 as seen at a live kiosk: bytes 37 45 56 67, i.e. greyscale
    // 55/69/86/103 — the tail of a queued frame, not a broken scanner.
    const tail = new Uint8Array(512).map((_, i) => 0x30 + i);
    expect(() => parseDeviceInfo(tail)).toThrow(/34 35 36 37/);
  });
});

describe('looksLikeInfoPacket', () => {
  it('accepts a real info packet and rejects a frame tail', () => {
    expect(looksLikeInfoPacket(infoPacket(320, 480))).toBe(true);
    // A brightness ramp — what a stranded frame looks like at bytes 4..7.
    expect(looksLikeInfoPacket(new Uint8Array(512).map((_, i) => 0x30 + i))).toBe(false);
    expect(looksLikeInfoPacket(new Uint8Array(4))).toBe(false);
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

/**
 * A stand-in for the FS81, modelling the two behaviours measured on real
 * hardware (Windows 11, Chrome, scanner freshly replugged):
 *
 *  1. The IN endpoint is a QUEUE that survives the page, so it can already
 *     hold the tail of somebody else's frame.
 *  2. While that backlog is queued a command MAY not be accepted: transferOut
 *     of a single byte was seen both landing at once and not settling until
 *     the backlog had been read. This models the worst of the two, because
 *     code that awaits a write before reading deadlocks under it — the bug
 *     this fake exists to catch. `reset` rejects by default for the same
 *     reason: that is what Windows does, so the drain has to carry the fix.
 */
function fakeDevice(stalePackets: Uint8Array[] = [], { canReset = false } = {}) {
  const queued = [...stalePackets];
  const writes: number[][] = [];
  let resets = 0;
  const stalled: Array<() => void> = [];

  const replyTo = (cmd: number) => {
    if (cmd === 0xe0) queued.push(infoPacket(320, 480));
    else if (cmd === 0x6c || cmd === 0x50) queued.push(new Uint8Array(512));
  };

  const dev = {
    vendorId: FS81_VENDOR_ID,
    productId: FS81_PRODUCT_ID,
    opened: false,
    configuration: null as unknown,
    open: async () => void (dev.opened = true),
    close: async () => void (dev.opened = false),
    selectConfiguration: async () => void (dev.configuration = {}),
    claimInterface: async () => {},
    releaseInterface: async () => {},
    reset: async () => {
      // Windows rejects this outright; the drain is what has to carry the fix.
      if (!canReset) throw new Error('Unable to reset the device.');
      resets++;
      queued.length = 0;
    },
    transferOut: (_ep: number, data: Uint8Array) => {
      writes.push([...data]);
      if (queued.length === 0) {
        replyTo(data[0]);
        return Promise.resolve({ status: 'ok', bytesWritten: data.length });
      }
      // Wedged: this promise settles only once the backlog has drained.
      return new Promise((resolve) => {
        stalled.push(() => {
          replyTo(data[0]);
          resolve({ status: 'ok', bytesWritten: data.length });
        });
      });
    },
    transferIn: async (_ep: number, length: number) => {
      const next = queued.shift();
      if (!next) throw new Error('test hang: read with nothing queued');
      if (queued.length === 0) while (stalled.length) stalled.shift()!();
      return { status: 'ok', data: new DataView(next.slice(0, length).buffer) };
    },
  };
  return { dev, writes, queued, resets: () => resets };
}

/** 512 bytes of the greyscale ramp a stranded frame leaves behind. */
const frameTail = () => new Uint8Array(512).map((_, i) => 0x30 + i);

async function connect(dev: unknown) {
  vi.stubGlobal('navigator', { usb: { getDevices: async () => [dev] } });
  const d = await Fs81Device.getAlreadyPermitted();
  if (!d) throw new Error('fake device not offered');
  return d;
}

describe('Fs81Device.open — pipe resynchronisation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('drains a stranded frame instead of reading it as the info packet', async () => {
    // The reported bug, on the platform it was reported from: a previous page
    // died mid-frame, and reset() is unavailable. 300 packets is a whole frame.
    const stale = Array.from({ length: 300 }, frameTail);
    const { dev, queued } = fakeDevice(stale);
    const device = await connect(dev);
    await expect(device.open()).resolves.toEqual({ width: 320, height: 480 });
    // Nothing left behind: a resync that ends one packet off has only moved
    // the fault into the handshake reads.
    expect(queued).toHaveLength(0);
  });

  it('does not deadlock awaiting a write the wedged device will not accept', async () => {
    // The regression this file exists for. Measured on hardware: with a
    // backlog queued, transferOut never settles. An implementation that awaits
    // the E0 write before reading hangs here rather than failing, so this test
    // times out instead of asserting — that IS the assertion.
    const { dev } = fakeDevice(Array.from({ length: 300 }, frameTail));
    const device = await connect(dev);
    await expect(device.open()).resolves.toEqual({ width: 320, height: 480 });
  }, 5000);

  it('uses a port reset when the platform actually supports one', async () => {
    const { dev, resets } = fakeDevice([frameTail(), frameTail()], { canReset: true });
    const device = await connect(dev);
    await expect(device.open()).resolves.toEqual({ width: 320, height: 480 });
    expect(resets()).toBe(1);
  });

  it('tells the operator to replug when nothing usable ever arrives', async () => {
    const { dev } = fakeDevice();
    // A device that only ever answers with pixels, however often it is asked.
    dev.transferOut = () => Promise.resolve({ status: 'ok', bytesWritten: 1 });
    dev.transferIn = async () => ({
      status: 'ok',
      data: new DataView(frameTail().buffer),
    });
    const device = await connect(dev);
    await expect(device.open()).rejects.toThrow(/unplug the scanner/i);
  });

  it('serialises captures so two loops cannot interleave on one pipe', async () => {
    // Overlapping command sequences are what desync the pipe in the first
    // place; the second caller must wait, not interleave.
    const { dev, writes } = fakeDevice();
    const device = await connect(dev);
    await Promise.all([device.open(), device.open()]);
    // One handshake, not two halves of two.
    expect(writes.filter((w) => w[0] === 0xe0)).toHaveLength(1);
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
