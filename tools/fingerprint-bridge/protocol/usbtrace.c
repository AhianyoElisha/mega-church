// LD_PRELOAD shim that logs every libusb-0.1 bulk transfer the Futronic
// vendor library performs. The FS81's whole protocol is bulk (the vendor .so
// imports no usb_control_msg), so this captures all of it.
//
// Output: one line per transfer to $CHURCH_USB_TRACE (default stderr), as
//   > EP01 len=<requested> ret=<returned> <hex bytes>
//   < EP82 len=<requested> ret=<returned> <hex bytes>
// Large IN payloads (the image) are truncated to HEAD_BYTES so the log stays
// readable — the image content doesn't matter, the framing does.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static FILE *out;
static const int HEAD_BYTES = 64;

static void ensure_out(void) {
    if (out) return;
    const char *p = getenv("CHURCH_USB_TRACE");
    out = (p && *p) ? fopen(p, "w") : stderr;
    if (!out) out = stderr;
}

static void dump(const char *dir, int ep, const char *buf, int req, int ret) {
    ensure_out();
    fprintf(out, "%s EP%02X len=%d ret=%d ", dir, ep & 0xFF, req, ret);
    int n = ret > 0 ? ret : 0;
    int show = n < HEAD_BYTES ? n : HEAD_BYTES;
    for (int i = 0; i < show; i++)
        fprintf(out, "%02X", (unsigned char)buf[i]);
    if (n > show) fprintf(out, "…(+%d)", n - show);
    fprintf(out, "\n");
    fflush(out);
}

typedef int (*bulk_fn)(void *, int, char *, int, int);

int usb_bulk_write(void *dev, int ep, char *bytes, int size, int timeout) {
    static bulk_fn real;
    if (!real) real = (bulk_fn)dlsym(RTLD_NEXT, "usb_bulk_write");
    int ret = real(dev, ep, bytes, size, timeout);
    dump(">", ep, bytes, size, ret > 0 ? (ret < size ? ret : size) : ret);
    return ret;
}

int usb_bulk_read(void *dev, int ep, char *bytes, int size, int timeout) {
    static bulk_fn real;
    if (!real) real = (bulk_fn)dlsym(RTLD_NEXT, "usb_bulk_read");
    int ret = real(dev, ep, bytes, size, timeout);
    dump("<", ep, bytes, size, ret);
    return ret;
}
