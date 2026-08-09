# Futronic FS81 — USB protocol

Derived from real hardware on 2026-08-04 so the scanner can be driven from a
browser over WebUSB (Plan 42), where Futronic's `libScanAPI.so` cannot run.

Everything here was observed, not guessed. To re-derive it, see
[Re-deriving the trace](#re-deriving-the-trace) at the bottom.

## Device

| | |
|---|---|
| Vendor / product | `1491:0020` — "FS81 Fingerprint Scanner Module" |
| Class | vendor-specific (`0xFF`) — no kernel driver claims it |
| Endpoints | `0x01` BULK OUT, `0x82` BULK IN, 512-byte packets |
| Image | 320 × 480, 8-bit greyscale, 153,600 bytes, no header |

The vendor library links **libusb-0.1** and imports only `usb_bulk_read` and
`usb_bulk_write` — there is not a single control transfer in the protocol.
That matters because bulk transfers are exactly what WebUSB exposes.

## Command set

Every command is a bulk write to `0x01`. Commands that return data are followed
by a bulk read from `0x82` of a fixed size.

| Out | In | Meaning |
|---|---|---|
| `E0` | 512 | Device info. **Bytes 4..5 = width, 6..7 = height, big-endian** (`0140` = 320, `01E0` = 480). Read geometry from here rather than hardcoding it. |
| `6C` | 512 | Part of the open handshake. Contents not decoded; the device does not return frames without it. |
| `50` | 512 | Part of the open handshake. Same. |
| `DD <n> 00` | — | Lamp / diodes. `n = 0x32` (50) before each frame, `n = 0x00` to switch off. Mirrors `ftrScanSetDiodesStatus(h, 50, 0)`. |
| `6E` | w×h | Capture one frame. |
| `FE` | w×h | Capture one frame — what the vendor issues for the *first* frame after open. `6E` works for every subsequent one. |

### Sequence

```
open      OUT E0        IN 512      (parse width/height)
          OUT 6C        IN 512
          OUT 50        IN 512

per frame OUT DD 32 00              lamp on
          OUT 6E        IN w*h      greyscale frame

close     OUT DD 00 00              lamp off
```

## The vertical flip — do not skip this

`libScanAPI` returns the image with **row order reversed** relative to the
wire. A frame used as-is produces a template that does not match a
vendor-captured one at all: bozorth3 scores 5–8 against a threshold of 33.
Reversing the rows fixes it.

Measured, one finger, threshold 33:

| Probe | vs vendor A | vs vendor B |
|---|---|---|
| as received | 6 | 11 |
| mirrored horizontally | 16 | 13 |
| rotated 180° | 8 | 7 |
| **rows reversed** | **79** | **71** |

Vendor-vs-vendor on the same finger scores 64, so a flipped raw capture matches
vendor enrolments as well as the vendor path matches itself. **This is why a
tablet can verify fingerprints enrolled on the PC bridge — no re-enrolment.**

## Finger detection

Not a device feature. `church-scan.c` computes mean 8×8 block variance per frame:

- `> 300` — finger present
- `< 150` — platen cleared (used by `--wait-clear` to force a lift between scans)
- capture on two consecutive frames above the threshold, keep the highest

Reuse those numbers anywhere else that captures, so every kiosk behaves alike.
Averaging frames (the vendor's `CAPTURE_DOSE = 4`) helps a little but is not
required — a single flipped frame scored 77.

## Reference implementation

`rawcap.py` drives the device through Linux usbfs with **no vendor library**,
using only the two primitives WebUSB provides. It is the executable form of
this document and the thing to check a WebUSB port against.

```bash
python3 tools/fingerprint-bridge/protocol/rawcap.py out.pgm 240
```

Prints per-frame variance, waits for a finger, writes a PGM. Note it writes the
frame **unflipped**, matching the wire — flip before extracting minutiae.

## Re-deriving the trace

`usbtrace.c` is an `LD_PRELOAD` shim over libusb-0.1's two bulk calls. Use it if
Futronic ever changes the library, or to decode a different Futronic model:

```bash
gcc -shared -fPIC -o usbtrace.so usbtrace.c -ldl
cd tools/fingerprint-bridge/native
CHURCH_USB_TRACE=/tmp/trace.txt \
  LD_PRELOAD=/path/to/usbtrace.so \
  LD_LIBRARY_PATH=./vendor \
  ./church-scan /tmp/cap.pgm 20
```

Each line is `> EPxx len= ret= <hex>` for writes and `< EPxx …` for reads, with
long payloads truncated — the framing is what matters, not the pixels.
