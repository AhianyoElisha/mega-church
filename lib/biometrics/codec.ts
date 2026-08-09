// Plan 38 — fingerprint template wire codec.
//
// A template is the text of an NBIS `mindtct -m1` .xyt file: one minutia per
// line, `x y theta [quality]` as integers. On the wire (kiosk → API → matcher)
// it travels as `xyt:<base64 of that text>` in the existing `fingerprint_data`
// string field, alongside the simulator's `sim:<index>` payloads.
//
// Pure module — used by the Next server seam AND the fingerprint bridge (tsx).

export const XYT_PREFIX = 'xyt:';

/** Max decoded template size we accept — a real .xyt is 1-4 KB. */
const MAX_TEMPLATE_BYTES = 64 * 1024;

const LINE_RE = /^\s*\d+\s+\d+\s+\d+(\s+\d+)?\s*$/;

/** True when the .xyt text is structurally valid (≥1 minutia line). */
export function isValidXytText(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEMPLATE_BYTES) {
    return false;
  }
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return false;
  return lines.every((l) => LINE_RE.test(l));
}

/** Number of minutiae in a valid .xyt text. */
export function countMinutiae(text: string): number {
  return text.split('\n').filter((l) => l.trim().length > 0).length;
}

// Plan 42 — this module now runs in the BROWSER too (the tablet kiosk extracts
// its own template), and `Buffer` is Node-only. Feature-detect rather than
// polyfill: the server and the tsx bridge keep the fast path, and the browser
// gets a correct one. `.xyt` text is ASCII, but encode through TextEncoder
// anyway so the two paths cannot disagree on anything.
function textToBase64(text: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToText(b64: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** `.xyt` text → `xyt:<base64>` wire form. Throws on invalid input. */
export function encodeXytTemplate(text: string): string {
  if (!isValidXytText(text)) throw new Error('invalid xyt template text');
  return XYT_PREFIX + textToBase64(text);
}

/** Wire form → `.xyt` text, or null when not a valid `xyt:` payload. */
export function decodeXytTemplate(data: string): string | null {
  if (typeof data !== 'string' || !data.startsWith(XYT_PREFIX)) return null;
  const b64 = data.slice(XYT_PREFIX.length);
  if (b64.length === 0 || b64.length > MAX_TEMPLATE_BYTES * 2) return null;
  let text: string;
  try {
    text = base64ToText(b64);
  } catch {
    return null;
  }
  return isValidXytText(text) ? text : null;
}
