#!/usr/bin/env python3
"""Capture an FS81 frame WITHOUT the vendor library.

Speaks the protocol derived from the libusb-0.1 trace, using only bulk
transfers on EP 0x01 OUT / 0x82 IN — exactly the two primitives WebUSB gives
a browser (usb.transferOut / usb.transferIn). If this works, the Android
kiosk can do the same thing with no native code at all.

    open:   E0 -> 512 (info; width @4..5, height @6..7, big-endian)
            6C -> 512
            50 -> 512
    frame:  DD 32 00   (lamp on)
            6E         -> width*height bytes, 8-bit greyscale
    close:  DD 00 00   (lamp off)

Usage: rawcap.py <out.pgm> [frames]
"""
import ctypes, fcntl, struct, sys, time

VENDOR, PRODUCT = 0x1491, 0x0020
EP_OUT, EP_IN = 0x01, 0x82

# usbfs ioctls (linux/usbdevice_fs.h), encoded for x86_64.
USBDEVFS_BULK = (3 << 30) | (24 << 16) | (ord('U') << 8) | 2
USBDEVFS_CLAIMINTERFACE = (2 << 30) | (4 << 16) | (ord('U') << 8) | 15
USBDEVFS_RELEASEINTERFACE = (2 << 30) | (4 << 16) | (ord('U') << 8) | 16


def find_device():
    import os
    for bus in sorted(os.listdir('/dev/bus/usb')):
        bdir = f'/dev/bus/usb/{bus}'
        if not os.path.isdir(bdir):
            continue
        for dev in sorted(os.listdir(bdir)):
            path = f'{bdir}/{dev}'
            try:
                with open(path, 'rb') as fh:
                    d = fh.read(18)
            except OSError:
                continue
            if len(d) >= 12 and struct.unpack_from('<H', d, 8)[0] == VENDOR \
               and struct.unpack_from('<H', d, 10)[0] == PRODUCT:
                return path
    raise SystemExit('FS81 not found under /dev/bus/usb')


class Dev:
    def __init__(self, path):
        self.fd = open(path, 'r+b', buffering=0)
        iface = ctypes.c_uint(0)
        fcntl.ioctl(self.fd, USBDEVFS_CLAIMINTERFACE, iface)

    def _bulk(self, ep, buf, timeout=5000):
        data = ctypes.create_string_buffer(bytes(buf), len(buf))
        req = struct.pack('IIIxxxxP', ep, len(buf), timeout,
                          ctypes.addressof(data))
        req = ctypes.create_string_buffer(req, len(req))
        n = fcntl.ioctl(self.fd, USBDEVFS_BULK, req)
        return n, data.raw

    def write(self, payload):
        n, _ = self._bulk(EP_OUT, payload)
        return n

    def read(self, length):
        n, raw = self._bulk(EP_IN, bytearray(length))
        return raw[:n]

    def close(self):
        try:
            fcntl.ioctl(self.fd, USBDEVFS_RELEASEINTERFACE, ctypes.c_uint(0))
        finally:
            self.fd.close()


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'raw.pgm'
    frames = int(sys.argv[2]) if len(sys.argv) > 2 else 12

    dev = Dev(find_device())
    try:
        dev.write(b'\xE0')
        info = dev.read(512)
        w = int.from_bytes(info[4:6], 'big')
        h = int.from_bytes(info[6:8], 'big')
        print(f'device info: {w}x{h}')
        if not (0 < w <= 4096 and 0 < h <= 4096):
            raise SystemExit(f'implausible geometry {w}x{h}')

        dev.write(b'\x6C'); dev.read(512)
        dev.write(b'\x50'); dev.read(512)

        # Same finger-detection rule church-scan uses: wait for two consecutive
        # frames above FINGER_ON_THRESHOLD, keep the sharpest.
        best, best_var = None, -1.0
        stable = 0
        for i in range(frames):
            dev.write(b'\xDD\x32\x00')
            dev.write(b'\x6E')
            img = dev.read(w * h)
            if len(img) != w * h:
                print(f'  frame {i}: short read {len(img)}', flush=True)
                continue
            var = variance(img, w, h)
            print(f'  frame {i}: variance {var:.1f}', flush=True)
            if var > 300.0:
                stable += 1
                if var > best_var:
                    best, best_var = img, var
                if stable >= 2:
                    print('  finger detected — captured', flush=True)
                    break
            else:
                stable = 0
            time.sleep(0.12)
        if best is None:
            dev.write(b'\xDD\x00\x00')
            raise SystemExit('no_finger — nothing above the 300 variance threshold')

        dev.write(b'\xDD\x00\x00')
    finally:
        dev.close()

    with open(out, 'wb') as f:
        f.write(b'P5\n%d %d\n255\n' % (w, h))
        f.write(best)
    print(f'wrote {out}  best variance {best_var:.1f}')


def variance(b, w, h):
    """Same 8x8 block variance church-scan uses to detect a finger."""
    acc, blocks = 0.0, 0
    for by in range(0, h - 7, 8):
        for bx in range(0, w - 7, 8):
            s = ss = 0
            for y in range(8):
                row = (by + y) * w + bx
                for v in b[row:row + 8]:
                    s += v; ss += v * v
            m = s / 64.0
            acc += ss / 64.0 - m * m
            blocks += 1
    return acc / blocks if blocks else 0.0


if __name__ == '__main__':
    main()
