import { describe, it, expect } from 'vitest';
import {
  FUTRONIC_PNP_VENDOR_TOKEN,
  FUTRONIC_SYSFS_VENDOR_ID,
  exeSuffix,
  isProbeFresh,
  parsePnpPresence,
  withExe,
} from '../platform';

describe('exeSuffix', () => {
  it('suffixes only on win32', () => {
    expect(exeSuffix('win32')).toBe('.exe');
    expect(exeSuffix('linux')).toBe('');
    expect(exeSuffix('darwin')).toBe('');
  });
});

describe('withExe', () => {
  it('leaves Linux paths untouched', () => {
    expect(withExe('/opt/semp/native/semp-scan', 'linux')).toBe('/opt/semp/native/semp-scan');
    expect(withExe('/opt/semp/native/nbis/install/bin/mindtct', 'linux')).toBe(
      '/opt/semp/native/nbis/install/bin/mindtct',
    );
  });

  it('appends .exe on win32', () => {
    expect(withExe('C:\\semp\\native\\semp-scan', 'win32')).toBe('C:\\semp\\native\\semp-scan.exe');
    expect(withExe('C:\\semp\\native\\bozorth3', 'win32')).toBe('C:\\semp\\native\\bozorth3.exe');
  });

  it('is idempotent — never produces semp-scan.exe.exe', () => {
    const once = withExe('C:\\semp\\semp-scan', 'win32');
    expect(withExe(once, 'win32')).toBe(once);
    expect(withExe('C:\\semp\\semp-scan.EXE', 'win32')).toBe('C:\\semp\\semp-scan.EXE');
  });

  it('does not mistake a dotted directory for a suffix', () => {
    expect(withExe('C:\\tools\\v1.exe.d\\semp-scan', 'win32')).toBe(
      'C:\\tools\\v1.exe.d\\semp-scan.exe',
    );
  });
});

describe('parsePnpPresence', () => {
  it('detects the FS81 in a real InstanceId line', () => {
    expect(parsePnpPresence('USB\\VID_1491&PID_0020\\6&1F2C3D4E&0&2')).toBe(true);
  });

  it('is case-insensitive and tolerates surrounding whitespace/CRLF', () => {
    expect(parsePnpPresence('\r\nusb\\vid_1491&pid_0020\\5&ABC\r\n')).toBe(true);
  });

  it('returns false on empty output (query ran, scanner absent)', () => {
    expect(parsePnpPresence('')).toBe(false);
    expect(parsePnpPresence('\r\n  \r\n')).toBe(false);
  });

  it('does not match an unrelated vendor', () => {
    expect(parsePnpPresence('USB\\VID_8087&PID_0026\\0')).toBe(false);
  });

  it('does not match a longer vendor id that merely starts with ours', () => {
    // Not a valid 4-hex PnP vendor id, but the guard is what stops a
    // substring match from reporting the wrong device as our scanner.
    expect(parsePnpPresence('USB\\VID_14915&PID_0020\\0')).toBe(false);
  });

  it('matches the Futronic models the udev rules cover', () => {
    for (const pid of ['0020', '0088', '0090']) {
      expect(parsePnpPresence(`USB\\VID_1491&PID_${pid}\\6&1&2`)).toBe(true);
    }
  });
});

describe('isProbeFresh', () => {
  it('is fresh inside the TTL and stale at/after it', () => {
    expect(isProbeFresh(1_000, 1_000, 8_000)).toBe(true);
    expect(isProbeFresh(1_000, 8_999, 8_000)).toBe(true);
    expect(isProbeFresh(1_000, 9_000, 8_000)).toBe(false);
    expect(isProbeFresh(1_000, 20_000, 8_000)).toBe(false);
  });

  it('expires rather than extends when the clock jumps backwards', () => {
    expect(isProbeFresh(10_000, 5_000, 8_000)).toBe(false);
  });

  it('rejects non-finite inputs', () => {
    expect(isProbeFresh(NaN, 1_000, 8_000)).toBe(false);
    expect(isProbeFresh(1_000, NaN, 8_000)).toBe(false);
  });
});

describe('vendor id constants', () => {
  it('keep the sysfs and PnP spellings in sync', () => {
    // The two OSes spell the same USB vendor id differently; if one is ever
    // edited the other must follow, or one platform silently stops detecting.
    expect(FUTRONIC_PNP_VENDOR_TOKEN).toBe(`VID_${FUTRONIC_SYSFS_VENDOR_ID}`);
  });
});
