// Plan 42 Phase E — drive the Futronic FS81 from the browser over WebUSB.
//
// Why this exists: a kiosk may be an Android tablet at an entrance, and
// none of tools/fingerprint-bridge/ can run on stock Android —
// no Node, no ELF loader, no vendor .so. The protocol was derived from real
// hardware precisely so the page could talk to the device itself.
//
// Everything below the `Fs81Device` class is pure and unit-tested; the class
// is the only part that touches `navigator.usb`.
//
// The protocol is documented in tools/fingerprint-bridge/protocol/fs81-protocol.md.
// Do not re-derive it from this file — that document is the source of truth and
// records how each value was observed.

/** `1491:0020`, vendor-specific class, bulk endpoints only. */
export const FS81_VENDOR_ID = 0x1491;
export const FS81_PRODUCT_ID = 0x0020;
export const FS81_EP_OUT = 1; // 0x01 BULK OUT
export const FS81_EP_IN = 2; // 0x82 BULK IN

/** Commands. One byte out; the ones that answer do so on the IN endpoint. */
export const CMD_INFO = 0xe0; // -> 512 bytes, carries geometry
export const CMD_HANDSHAKE_A = 0x6c; // -> 512, undecoded but required
export const CMD_HANDSHAKE_B = 0x50; // -> 512, undecoded but required
export const CMD_FRAME = 0x6e; // -> w*h greyscale
export const CMD_FRAME_FIRST = 0xfe; // what the vendor issues for frame 1
export const CMD_LAMP = 0xdd; // DD <n> 00

/** Lamp level the vendor passes to ftrScanSetDiodesStatus before each frame. */
export const LAMP_ON = 0x32;
export const LAMP_OFF = 0x00;

// Finger detection is not a device feature. These are semp-scan.c's numbers and
// must stay identical to it, so a tablet and a PC kiosk behave the same way.
export const FINGER_ON_THRESHOLD = 300;
export const FINGER_OFF_THRESHOLD = 150;

/** Sanity bounds on the geometry the device reports, so a garbled info packet
 *  cannot make us allocate something absurd or read forever. */
const MIN_DIM = 64;
const MAX_DIM = 2048;

export type Geometry = { width: number; height: number };

/**
 * Parse the `E0` reply. Bytes 4..5 are width and 6..7 height, big-endian
 * (`0140` = 320, `01E0` = 480). Read it rather than hardcoding: the protocol
 * doc is explicit that geometry comes from the device.
 */
export function parseDeviceInfo(info: Uint8Array): Geometry {
  if (info.length < 8) {
    throw new Error(`FS81 info packet too short (${info.length} bytes)`);
  }
  const width = (info[4] << 8) | info[5];
  const height = (info[6] << 8) | info[7];
  if (
    width < MIN_DIM ||
    width > MAX_DIM ||
    height < MIN_DIM ||
    height > MAX_DIM
  ) {
    throw new Error(`FS81 reported implausible geometry ${width}x${height}`);
  }
  return { width, height };
}

/**
 * Reverse row order.
 *
 * THE most important eight lines in this file. `libScanAPI` hands back the
 * image with rows reversed relative to the wire, and bozorth3 is not
 * reflection-invariant — so an unflipped frame reads as a *different finger*
 * and scores 5-8 against a threshold of 33. Flipped, the same capture scores
 * 79 against a vendor enrolment (vendor-vs-vendor on that finger is 64).
 *
 * This is what lets a tablet verify templates enrolled on the PC bridge with
 * no re-enrolment. If this is ever removed, every tablet silently stops
 * recognising everyone.
 */
export function flipRows(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width;
    out.set(pixels.subarray(src, src + width), y * width);
  }
  return out;
}

/**
 * Mean variance over 8x8 blocks — a direct port of `local_variance()` in
 * semp-scan.c, including its handling of a trailing partial block (skipped:
 * the loops step while `by + 8 <= h`). Empty platen reads ~48, a finger ~2100.
 *
 * Ported rather than reinvented so both kiosks make the same judgement about
 * what counts as a finger.
 */
export function meanBlockVariance(
  pixels: Uint8Array,
  width: number,
  height: number,
): number {
  let acc = 0;
  let blocks = 0;
  for (let by = 0; by + 8 <= height; by += 8) {
    for (let bx = 0; bx + 8 <= width; bx += 8) {
      let s = 0;
      let ss = 0;
      for (let y = 0; y < 8; y++) {
        const row = (by + y) * width + bx;
        for (let x = 0; x < 8; x++) {
          const v = pixels[row + x];
          s += v;
          ss += v * v;
        }
      }
      const m = s / 64;
      acc += ss / 64 - m * m;
      blocks++;
    }
  }
  return blocks ? acc / blocks : 0;
}

export type CaptureFrame = { pixels: Uint8Array; variance: number };

/**
 * semp-scan's rule: a finger needs TWO consecutive frames over the threshold
 * (so we never capture mid-press), and of the frames seen we keep the sharpest.
 * Returns null while the run is not yet established.
 */
export function pickBestFrame(frames: CaptureFrame[]): CaptureFrame | null {
  if (frames.length === 0) return null;
  let best = frames[0];
  for (const f of frames) if (f.variance > best.variance) best = f;
  return best;
}

/** True when this browser can talk to USB devices at all. Android Chrome yes;
 *  Firefox and iOS Safari have not implemented WebUSB. */
export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

export type CaptureOptions = {
  /** Give up after this long without a finger. */
  timeoutMs?: number;
  /** Require the platen to read empty before arming (the kiosk's re-scan
   *  guard — same intent as semp-scan's --wait-clear). */
  waitClear?: boolean;
  /** Frames to average over once armed; the vendor uses 4. Quality nicety
   *  rather than a requirement — a single flipped frame scored 77. */
  dose?: number;
  signal?: AbortSignal;
};

export type CaptureResult = {
  /** Row-order corrected, ready for minutiae extraction. */
  pixels: Uint8Array;
  width: number;
  height: number;
  variance: number;
};

/**
 * A connected FS81. Construct via `Fs81Device.request()` (needs a user
 * gesture) or `Fs81Device.getAlreadyPermitted()` on subsequent loads —
 * WebUSB permission is per-origin and persists, so a kiosk grants once.
 */
export class Fs81Device {
  private geometry: Geometry | null = null;
  private framesRead = 0;

  private constructor(private readonly device: USBDevice) {}

  /** Prompt the user to pick the scanner. MUST be called from a click. */
  static async request(): Promise<Fs81Device> {
    if (!isWebUsbSupported()) {
      throw new Error(
        'This browser cannot talk to USB devices. The tablet kiosk needs Chrome on Android; ' +
          'Firefox and iOS Safari do not implement WebUSB.',
      );
    }
    const device = await navigator.usb.requestDevice({
      filters: [{ vendorId: FS81_VENDOR_ID, productId: FS81_PRODUCT_ID }],
    });
    return new Fs81Device(device);
  }

  /** The scanner this origin was already granted, if it is plugged in. */
  static async getAlreadyPermitted(): Promise<Fs81Device | null> {
    if (!isWebUsbSupported()) return null;
    const devices = await navigator.usb.getDevices();
    const hit = devices.find(
      (d) => d.vendorId === FS81_VENDOR_ID && d.productId === FS81_PRODUCT_ID,
    );
    return hit ? new Fs81Device(hit) : null;
  }

  get size(): Geometry | null {
    return this.geometry;
  }

  /** Open, claim, and run the three-command handshake. Idempotent. */
  async open(): Promise<Geometry> {
    if (this.geometry) return this.geometry;
    if (!this.device.opened) await this.device.open();
    if (this.device.configuration === null) {
      await this.device.selectConfiguration(1);
    }
    await this.device.claimInterface(0);

    const info = await this.command(CMD_INFO, 512);
    const geometry = parseDeviceInfo(info);
    // Both replies are required — the device will not return frames without
    // them — but their contents have never been decoded.
    await this.command(CMD_HANDSHAKE_A, 512);
    await this.command(CMD_HANDSHAKE_B, 512);

    this.geometry = geometry;
    this.framesRead = 0;
    return geometry;
  }

  private async write(bytes: number[]): Promise<void> {
    const res = await this.device.transferOut(FS81_EP_OUT, new Uint8Array(bytes));
    if (res.status !== 'ok') throw new Error(`FS81 write failed: ${res.status}`);
  }

  /** Read exactly `length` bytes, reassembling the 512-byte packets. */
  private async read(length: number): Promise<Uint8Array> {
    const out = new Uint8Array(length);
    let got = 0;
    while (got < length) {
      const res = await this.device.transferIn(FS81_EP_IN, length - got);
      if (res.status !== 'ok') throw new Error(`FS81 read failed: ${res.status}`);
      if (!res.data || res.data.byteLength === 0) {
        throw new Error('FS81 returned an empty packet');
      }
      out.set(
        new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength),
        got,
      );
      got += res.data.byteLength;
    }
    return out;
  }

  private async command(cmd: number, replyBytes: number): Promise<Uint8Array> {
    await this.write([cmd]);
    return this.read(replyBytes);
  }

  private async setLamp(level: number): Promise<void> {
    await this.write([CMD_LAMP, level, 0x00]);
  }

  /** One frame, in WIRE order (not yet flipped). */
  async readFrame(): Promise<Uint8Array> {
    const geo = this.geometry ?? (await this.open());
    await this.setLamp(LAMP_ON);
    // The vendor issues FE for the first frame after open and 6E thereafter.
    const cmd = this.framesRead === 0 ? CMD_FRAME_FIRST : CMD_FRAME;
    await this.write([cmd]);
    const pixels = await this.read(geo.width * geo.height);
    this.framesRead++;
    return pixels;
  }

  /**
   * Poll until a finger is present, then return the sharpest frame — the same
   * shape of decision semp-scan makes, so both kiosks accept the same presses.
   */
  async captureFinger(opts: CaptureOptions = {}): Promise<CaptureResult> {
    const { timeoutMs = 25_000, waitClear = false, dose = 4, signal } = opts;
    const geo = await this.open();
    const deadline = Date.now() + timeoutMs;

    let cleared = !waitClear;
    let run: CaptureFrame[] = [];

    try {
      while (Date.now() < deadline) {
        if (signal?.aborted) throw new Error('capture aborted');
        const wire = await this.readFrame();
        const variance = meanBlockVariance(wire, geo.width, geo.height);

        if (!cleared) {
          if (variance < FINGER_OFF_THRESHOLD) cleared = true;
          continue;
        }
        if (variance > FINGER_ON_THRESHOLD) {
          run.push({ pixels: wire, variance });
          // Two consecutive frames over the line, then take the best of the
          // dose. Matches semp-scan's `stable >= 2`.
          if (run.length >= Math.max(2, dose)) break;
        } else {
          run = [];
        }
      }

      const best = run.length >= 2 ? pickBestFrame(run) : null;
      if (!best) {
        throw new Error('no_finger');
      }
      return {
        pixels: flipRows(best.pixels, geo.width, geo.height),
        width: geo.width,
        height: geo.height,
        variance: best.variance,
      };
    } finally {
      // Never leave the lamp burning, even on timeout or abort.
      await this.setLamp(LAMP_OFF).catch(() => {});
    }
  }

  async close(): Promise<void> {
    try {
      await this.setLamp(LAMP_OFF);
      await this.device.releaseInterface(0);
    } catch {
      // Closing a device that already went away is not an error worth raising.
    } finally {
      this.geometry = null;
      if (this.device.opened) await this.device.close().catch(() => {});
    }
  }
}
