/* church-scan — wait for a finger on the Futronic FS81, capture one image.
 *
 *   church-scan <out.pgm> [timeout_s] [--wait-clear]
 *
 * Emits exactly one JSON line on stdout:
 *   {"ok":true,"path":"...","width":320,"height":480,"variance":2145.8}
 *   {"ok":false,"error":"no_device" | "no_image_size" | "no_finger" | "write_failed"}
 * Exit codes: 0 ok, 1 device/write error, 2 timeout without finger.
 *
 * Hardware constraints (verified on FS81, USB 1491:0020 — see Plan 38):
 * - ftrScanIsFingerPresent / ftrScanGetFrame are NOT implemented on this module
 *   (always FTR_ERROR_EMPTY_FRAME). Only ftrScanGetImage works, so finger
 *   detection is done here by thresholding mean local variance over 8x8 blocks:
 *   empty platen ~48, finger ~2100. Two consecutive positive frames required so
 *   we don't capture mid-press.
 * - The green diode is the illumination source; it must be on before capture.
 * - --wait-clear first waits for the platen to be EMPTY before arming detection,
 *   so a kiosk loop can't re-capture the same press twice.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif
#include "ftrScanAPI.h"

#define FINGER_ON_THRESHOLD  300.0
#define FINGER_OFF_THRESHOLD 150.0
#define CAPTURE_DOSE         4
#define POLL_INTERVAL_US     250000

/* Plan 40 Phase A — the only POSIX dependency this file had was usleep().
 * Windows' Sleep() takes whole milliseconds, so round UP: sleeping slightly
 * longer only lengthens a poll tick, whereas rounding down could busy-spin at
 * sub-millisecond sleeps. The capture loop's thresholds are hardware-verified
 * (Plan 38) and are NOT affected by a sub-millisecond change in tick length. */
static void nap_us(unsigned long us)
{
#ifdef _WIN32
    Sleep((DWORD)((us + 999UL) / 1000UL));
#else
    usleep(us);
#endif
}

/* Plan 40 Phase E — emit `s` as the inside of a JSON string literal.
 *
 * This exists because of a Windows-only bug that only a real capture surfaces:
 * the success line embeds the output path, and on Windows that path arrives
 * full of backslashes (the bridge builds it with path.join, so
 * C:\Users\...\cap.pgm). Printed raw, `\U` and `\A` are invalid JSON escapes,
 * JSON.parse throws in bridge.ts::handleScan, and the caller sees the generic
 * "scan_failed" — with no hint that the capture itself was perfect.
 *
 * The failure path has no %s in it, which is why /health and every no_finger
 * scan looked healthy while every genuine scan failed.
 *
 * Escapes exactly what RFC 8259 requires: backslash, double quote, and the
 * C0 controls. Everything else (including UTF-8 bytes) passes through. */
static void print_json_escaped(const char *s)
{
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        switch (c) {
        case '\\': fputs("\\\\", stdout); break;
        case '"':  fputs("\\\"", stdout); break;
        case '\b': fputs("\\b", stdout);  break;
        case '\f': fputs("\\f", stdout);  break;
        case '\n': fputs("\\n", stdout);  break;
        case '\r': fputs("\\r", stdout);  break;
        case '\t': fputs("\\t", stdout);  break;
        default:
            if (c < 0x20) printf("\\u%04x", c);
            else putchar(c);
        }
    }
}

static double local_variance(const unsigned char *b, int w, int h)
{
    double acc = 0; int blocks = 0;
    for (int by = 0; by + 8 <= h; by += 8)
        for (int bx = 0; bx + 8 <= w; bx += 8) {
            double s = 0, ss = 0;
            for (int y = 0; y < 8; y++)
                for (int x = 0; x < 8; x++) {
                    double v = b[(by + y) * w + (bx + x)];
                    s += v; ss += v * v;
                }
            double m = s / 64.0;
            acc += (ss / 64.0) - (m * m);
            blocks++;
        }
    return blocks ? acc / blocks : 0.0;
}

static void fail(FTRHANDLE h, unsigned char *buf, const char *err, int code)
{
    if (h) { ftrScanSetDiodesStatus(h, 0, 0); ftrScanCloseDevice(h); }
    free(buf);
    printf("{\"ok\":false,\"error\":\"%s\"}\n", err);
    exit(code);
}

int main(int argc, char **argv)
{
    const char *out = (argc > 1) ? argv[1] : "scan.pgm";
    int timeout_s = (argc > 2) ? atoi(argv[2]) : 30;
    int wait_clear = 0;
    for (int i = 1; i < argc; i++)
        if (strcmp(argv[i], "--wait-clear") == 0) wait_clear = 1;
    if (timeout_s <= 0 || timeout_s > 300) timeout_s = 30;

    FTRHANDLE h = ftrScanOpenDevice();
    if (!h) fail(NULL, NULL, "no_device", 1);

    FTRSCAN_IMAGE_SIZE sz; memset(&sz, 0, sizeof(sz));
    if (!ftrScanGetImageSize(h, &sz) || sz.nImageSize <= 0)
        fail(h, NULL, "no_image_size", 1);

    unsigned char *buf = calloc(1, sz.nImageSize);
    if (!buf) fail(h, NULL, "no_memory", 1);

    int ticks = timeout_s * (1000000 / POLL_INTERVAL_US);
    int stable = 0, captured = 0, cleared = !wait_clear;
    double best = 0;

    for (int i = 0; i < ticks; i++) {
        ftrScanSetDiodesStatus(h, 50, 0);
        if (!ftrScanGetImage(h, CAPTURE_DOSE, buf)) { nap_us(POLL_INTERVAL_US); continue; }
        double v = local_variance(buf, sz.nWidth, sz.nHeight);

        if (!cleared) {
            if (v < FINGER_OFF_THRESHOLD) cleared = 1;
        } else if (v > FINGER_ON_THRESHOLD) {
            stable++;
            if (v > best) best = v;
            if (stable >= 2) { captured = 1; break; }
        } else {
            stable = 0;
        }
        nap_us(POLL_INTERVAL_US);
    }
    ftrScanSetDiodesStatus(h, 0, 0);

    if (!captured) fail(h, buf, "no_finger", 2);

    FILE *f = fopen(out, "wb");
    if (!f) fail(h, buf, "write_failed", 1);
    fprintf(f, "P5\n%d %d\n255\n", sz.nWidth, sz.nHeight);
    size_t wrote = fwrite(buf, 1, sz.nImageSize, f);
    fclose(f);
    if (wrote != (size_t)sz.nImageSize) fail(h, buf, "write_failed", 1);

    printf("{\"ok\":true,\"path\":\"");
    print_json_escaped(out);
    printf("\",\"width\":%d,\"height\":%d,\"variance\":%.1f}\n",
           sz.nWidth, sz.nHeight, best);
    free(buf);
    ftrScanCloseDevice(h);
    return 0;
}
