// Plan 42 Phase C/D — check the WASM build against the native NBIS pipeline.
//
// Run this after rebuilding, or after touching src/nbis_wasm.c. It proves the
// property the tablet depends on: a template extracted in the browser scores
// the same against a PC-enrolled template as one extracted by the native
// binaries. If that stops being true, tablets silently stop recognising people
// enrolled on the PC.
//
// Fixtures are NOT committed — they are real fingerprints. Make your own:
//
//   1. Capture through the vendor library (this is an "enrolment"):
//        cd tools/fingerprint-bridge/native
//        LD_LIBRARY_PATH=./vendor ./church-scan /tmp/vendor.pgm 30
//
//   2. Capture the same finger through the WebUSB-equivalent path:
//        python3 tools/fingerprint-bridge/protocol/rawcap.py /tmp/raw.pgm 240
//
//   3. node tools/nbis-wasm/verify.mjs /tmp/raw.pgm /tmp/vendor.pgm
//
// Expected: a score comfortably above the 33 threshold (77-78 when measured on
// 2026-08-04). A score in the single digits means the vertical flip regressed —
// see tools/fingerprint-bridge/protocol/fs81-protocol.md.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import createNbis from './dist/nbis.js';

const THRESHOLD = Number(process.env.CHURCH_BIOMETRIC_THRESHOLD ?? 33);

/** Strip the PGM header, returning {width, height, pixels}. */
function readPgm(file) {
  const buf = readFileSync(file);
  let i = 0;
  const token = () => {
    while (buf[i] === 0x20 || buf[i] === 0x0a || buf[i] === 0x0d || buf[i] === 0x09) i++;
    const start = i;
    while (i < buf.length && ![0x20, 0x0a, 0x0d, 0x09].includes(buf[i])) i++;
    return buf.subarray(start, i).toString('ascii');
  };
  const magic = token();
  if (magic !== 'P5') throw new Error(`${file}: not a binary PGM (got ${magic})`);
  const width = Number(token());
  const height = Number(token());
  token(); // maxval
  i++; // single whitespace byte before the raster
  return { width, height, pixels: buf.subarray(i, i + width * height) };
}

/** Reverse row order — what libScanAPI does and a raw WebUSB frame does not. */
function flipRows({ width, height, pixels }) {
  const out = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    pixels.copy(out, y * width, (height - 1 - y) * width, (height - y) * width);
  }
  return { width, height, pixels: out };
}

const M = await createNbis();

function extract({ width, height, pixels }) {
  const p = M._malloc(pixels.length);
  M.HEAPU8.set(pixels, p);
  const ptr = M._extract_minutiae(p, width, height);
  const text = ptr ? M.UTF8ToString(ptr) : null;
  if (ptr) M._free_result(ptr);
  M._free(p);
  if (!text) throw new Error('extract_minutiae failed');
  return text;
}

function match(a, b) {
  const pa = M.stringToNewUTF8(a);
  const pb = M.stringToNewUTF8(b);
  const score = M._match_templates(pa, pb);
  M._free(pa);
  M._free(pb);
  return score;
}

const [rawPgm, vendorPgm] = process.argv.slice(2);
if (!rawPgm || !vendorPgm) {
  const self = path.relative(process.cwd(), fileURLToPath(import.meta.url));
  console.error(`usage: node ${self} <raw-webusb.pgm> <vendor.pgm>`);
  process.exit(2);
}

// The raw capture is in wire order, so it needs the flip. The vendor capture is
// already flipped by libScanAPI.
const probe = extract(flipRows(readPgm(rawPgm)));
const gallery = extract(readPgm(vendorPgm));

const cross = match(probe, gallery);
const self = match(probe, probe);

console.log(`probe minutiae   : ${probe.trim().split('\n').length}`);
console.log(`gallery minutiae : ${gallery.trim().split('\n').length}`);
console.log(`self-match       : ${self}`);
console.log(`cross-path match : ${cross}  (threshold ${THRESHOLD})`);

// Also confirm the flip is what carries the match, not luck: the unflipped
// probe should score near zero. This is the check that would have caught the
// original bug.
const unflipped = extract(readPgm(rawPgm));
const unflippedScore = match(unflipped, gallery);
console.log(`unflipped probe  : ${unflippedScore}  (expected well below ${THRESHOLD})`);

if (cross < THRESHOLD) {
  console.error('\nFAIL: a browser-captured template no longer matches a vendor-captured one.');
  process.exit(1);
}
if (unflippedScore >= THRESHOLD) {
  console.error('\nFAIL: the unflipped probe also matched — the flip is not being applied.');
  process.exit(1);
}
console.log('\nOK: browser-path templates verify against vendor-path enrolments.');
