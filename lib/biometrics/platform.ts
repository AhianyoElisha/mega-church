// Plan 40 Phase C — bridge platform differences (pure).
//
// The fingerprint bridge spawns native binaries and asks the OS whether the
// Futronic scanner is plugged in. Both of those are the only things in
// `tools/fingerprint-bridge/bridge.ts` that differ between Linux and Windows,
// so the decisions live here as pure functions and the IO stays in the bridge.
//
// Lives in lib/biometrics/ (not tools/) for the same reason codec.ts and
// matching.ts do: it is pure, the bridge already imports its pure helpers from
// here, and vitest only discovers `lib/**/__tests__`.

/** Futronic's USB vendor id as sysfs reports it, in each device's `idVendor` file. */
export const FUTRONIC_SYSFS_VENDOR_ID = '1491';

/** The same vendor id as it appears in a Windows PnP InstanceId (`USB\VID_1491&PID_0020\…`). */
export const FUTRONIC_PNP_VENDOR_TOKEN = 'VID_1491';

// A valid PnP vendor id is exactly 4 hex digits, so anything hex immediately
// after ours means we matched the wrong device (VID_14915 is not us).
const PNP_VENDOR_RE = new RegExp(`${FUTRONIC_PNP_VENDOR_TOKEN}(?![0-9A-F])`, 'i');

export function exeSuffix(platform: NodeJS.Platform): string {
  return platform === 'win32' ? '.exe' : '';
}

/**
 * Windows names every one of the bridge's native binaries with a `.exe` suffix
 * (`semp-scan.exe`, `mindtct.exe`, …); Linux names none of them. Without this
 * the bridge's `existsSync` checks fail on Windows, `/health` reports
 * `ok:false`, and the kiosk silently refuses to scan.
 *
 * Idempotent — applying it twice does not produce `semp-scan.exe.exe`.
 */
export function withExe(binPath: string, platform: NodeJS.Platform): string {
  const suffix = exeSuffix(platform);
  if (suffix === '') return binPath;
  return binPath.toLowerCase().endsWith(suffix) ? binPath : binPath + suffix;
}

/**
 * Does a Windows PnP device listing mention the Futronic scanner?
 *
 * Fed the stdout of a `Get-PnpDevice … -ExpandProperty InstanceId` query that
 * has already filtered to matching devices — the regex is a second check, not
 * the primary filter, so a PowerShell that ignores the filter still can't
 * produce a false positive.
 */
export function parsePnpPresence(stdout: string): boolean {
  return PNP_VENDOR_RE.test(stdout);
}

/**
 * Is a cached device probe still usable?
 *
 * The kiosk polls `/health` every 10s and the Windows probe costs a PowerShell
 * start (~300-700ms), so the result is cached just under that poll interval:
 * long enough that bursts collapse, short enough that unplugging the scanner
 * surfaces on the next poll rather than the one after.
 */
export function isProbeFresh(probedAt: number, now: number, ttlMs: number): boolean {
  if (!Number.isFinite(probedAt) || !Number.isFinite(now)) return false;
  const age = now - probedAt;
  // A clock that jumped backwards must expire the cache, not extend it.
  return age >= 0 && age < ttlMs;
}
