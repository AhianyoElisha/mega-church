// Plan 42 Phase C/D/E — NBIS in the browser.
//
// The tablet kiosk captures a frame over WebUSB and has to turn it into the
// same `xyt:` template the PC bridge produces, because a tablet scan must
// verify against templates enrolled on the PC. `tools/nbis-wasm/` compiles
// mindtct's detector and bozorth3's matcher to 121 KB of wasm for exactly this.
//
// The design decision this encodes (Plan 42): extraction runs ON THE DEVICE.
// Raw fingerprint images never leave the machine that captured them — only the
// template travels, the same posture as the PC bridge. Shipping images to the
// server would have been easier and would have broken that promise.
//
// The module is loaded from /nbis/nbis.js at runtime rather than bundled: it is
// an Emscripten ES module that fetches its own .wasm sibling, and it is only
// needed on a kiosk that has a scanner attached. Keeping it out of the main
// bundle costs one fetch and saves every other page 130 KB.

import { encodeXytTemplate } from './codec';

/** The subset of the Emscripten module we use. */
type NbisModule = {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _free_result(ptr: number): void;
  _extract_minutiae(pixels: number, width: number, height: number): number;
  _match_templates(a: number, b: number): number;
  stringToNewUTF8(s: string): number;
  UTF8ToString(ptr: number): string;
  HEAPU8: Uint8Array;
};

type NbisFactory = () => Promise<NbisModule>;

const WASM_URL = '/nbis/nbis.js';

let modulePromise: Promise<NbisModule> | null = null;

/**
 * Load (once) and cache the wasm module. Concurrent callers share the same
 * promise — a kiosk that fires two scans while loading must not instantiate
 * two copies of a 121 KB module.
 */
/**
 * Add the glue to the page as a CLASSIC script, once, and resolve when the
 * global it defines is there.
 *
 * It must be a script tag, not `import()`. `tools/nbis-wasm/build.sh` builds
 * with `MODULARIZE=1 EXPORT_NAME=createNbis` and *without* `EXPORT_ES6=1`, so
 * the output is UMD: it assigns a global `createNbis` and a CommonJS export,
 * and has no `export default`. A file with no `export` statements is still a
 * valid ES module — one with no exports — so `import()` resolves happily and
 * `mod.default` is `undefined`, which surfaces at the first scan as
 * "mod.default is not a function". `verify.mjs` gets away with a default
 * import only because Node has CommonJS interop; a browser has none.
 *
 * A script tag is also what the build expects: it reads
 * `document.currentScript.src` to find its `.wasm` sibling, and under
 * `import()` there is no currentScript to read.
 */
function loadNbisScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-nbis="${src}"]`,
    );
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`failed to load ${src}`)), {
        once: true,
      });
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.dataset.nbis = src;
    el.addEventListener(
      'load',
      () => {
        el.dataset.loaded = '1';
        resolve();
      },
      { once: true },
    );
    el.addEventListener('error', () => reject(new Error(`failed to load ${src}`)), {
      once: true,
    });
    document.head.appendChild(el);
  });
}

export function loadNbis(): Promise<NbisModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      if (typeof document === 'undefined') {
        throw new Error('the NBIS wasm module can only be loaded in a browser');
      }
      await loadNbisScript(WASM_URL);
      const factory = (globalThis as unknown as { createNbis?: NbisFactory })
        .createNbis;
      if (typeof factory !== 'function') {
        throw new Error(
          `${WASM_URL} loaded but did not define createNbis — is public/nbis in step with tools/nbis-wasm/build.sh?`,
        );
      }
      return factory();
    })().catch((e) => {
      // Don't cache a failure — a kiosk that loses the network briefly should
      // be able to retry rather than being poisoned until reload.
      modulePromise = null;
      throw e;
    });
  }
  return modulePromise;
}

/**
 * Greyscale pixels → `.xyt` text, exactly as `mindtct -m1` would produce.
 *
 * `pixels` must ALREADY be row-corrected (see `flipRows` in webusb.ts). This
 * function cannot tell a flipped image from an unflipped one — it will happily
 * extract minutiae from either, and the unflipped one scores 5-8 instead of 79.
 */
export async function extractXytText(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<string> {
  const M = await loadNbis();
  const ptr = M._malloc(pixels.length);
  let resultPtr = 0;
  try {
    M.HEAPU8.set(pixels, ptr);
    resultPtr = M._extract_minutiae(ptr, width, height);
    if (!resultPtr) throw new Error('minutiae extraction failed');
    return M.UTF8ToString(resultPtr);
  } finally {
    if (resultPtr) M._free_result(resultPtr);
    M._free(ptr);
  }
}

/** Pixels → `xyt:<base64>` wire form, ready for /api/attendance/scan. */
export async function extractTemplate(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<{ template: string; minutiae: number }> {
  const text = await extractXytText(pixels, width, height);
  const minutiae = text.split('\n').filter((l) => l.trim().length > 0).length;
  return { template: encodeXytTemplate(text), minutiae };
}

/**
 * bozorth3 score between two `.xyt` texts — the same number the bridge's
 * /match returns, compared against SEMP_BIOMETRIC_THRESHOLD.
 *
 * Not used by the kiosk scan path (the server still does identification, so
 * the candidate set never has to reach the tablet). Exposed because it is what
 * makes fully on-device 1:N possible later, and because verify.mjs's parity
 * check depends on this half of the module existing.
 */
export async function matchXytTexts(probe: string, gallery: string): Promise<number> {
  const M = await loadNbis();
  const a = M.stringToNewUTF8(probe);
  const b = M.stringToNewUTF8(gallery);
  try {
    return M._match_templates(a, b);
  } finally {
    M._free(a);
    M._free(b);
  }
}
