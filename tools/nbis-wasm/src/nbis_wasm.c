// Plan 42 Phase C — the parts of NBIS the Android kiosk needs, as WASM.
//
// The PC bridge shells out to `cwsq` + `mindtct` + `bozorth3`. A browser can't
// spawn processes, so the tablet gets the same algorithms compiled to
// WebAssembly instead. Keeping extraction on the device is deliberate: only the
// `xyt:` template ever leaves it, exactly as on the PC (Plan 38).
//
// Two entry points, both operating on memory rather than files:
//
//   extract_minutiae() — raw greyscale in, ".xyt" text out. This skips WSQ
//     entirely: the bridge's PGM → cwsq → WSQ → mindtct pipeline exists only
//     because `mindtct` is a CLI that must be handed a *file* in a format it
//     recognises. `get_minutiae()` underneath it takes raw pixels, so a browser
//     capture can go straight in and the WSQ round-trip disappears.
//
//   match_templates() — bozorth3 over two xyt texts, returning the same score
//     the bridge's `/match` compares against CHURCH_BIOMETRIC_THRESHOLD.
//
// Output must stay byte-identical to `mindtct -m1`, because templates enrolled
// on the PC bridge have to verify against tablet scans (see
// tools/fingerprint-bridge/protocol/fs81-protocol.md).

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "lfs.h"
#include "bozorth.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

// mindtct's default when the image carries no resolution. The FS81 reports
// 500 ppi and the bridge already passes 500 to cwsq, so the two paths agree.
#define SCANNER_PPI 500.0

// bozorth3's library half reads these, but they are DEFINED in its command-line
// program (src/bin/bozorth3/bozorth3.c) rather than the library — so any
// non-CLI caller has to supply them. Values match what the CLI sets with no
// flags, which is how the bridge invokes it (`bozorth3 -m1 -p probe gallery`).
int verbose_bozorth = 0;
int min_computable_minutiae = MIN_COMPUTABLE_BOZORTH_MINUTIAE;
FILE *errorfp = NULL;  // set to stderr on first use; see init below

// 1, NOT 0 — this is bozorth3's `-m1` switch, and it is read by the matcher
// itself (bozorth3.c), not just the file loader, so it changes scores. The
// bridge runs `bozorth3 -m1` against templates written by `mindtct -m1`;
// leaving this 0 would silently score M1 templates under the NIST-internal
// convention and produce numbers that don't match the PC's.
int m1_xyt = 1;

// Only reached inside bozorth3's own diagnostics, which we never enable. They
// exist so the linker is satisfied without dragging in bz_io.c's file loader.
char *get_progname(void) { return (char *)"nbis-wasm"; }
char *get_probe_filename(void) { return (char *)"<probe>"; }
char *get_gallery_filename(void) { return (char *)"<gallery>"; }

/**
 * Extract minutiae from an 8-bit greyscale image.
 *
 * `pixels` must already be in the orientation the vendor library produces —
 * i.e. the caller has reversed the row order of a raw WebUSB frame. Feeding a
 * wire-order frame here yields a template that matches nothing.
 *
 * Returns malloc'd NUL-terminated ".xyt" text (one "x y theta quality" per
 * line) that the caller must free with free_result(), or NULL on failure.
 */
EXPORT char *extract_minutiae(unsigned char *pixels, int width, int height) {
    MINUTIAE *minutiae = NULL;
    int *quality_map = NULL, *direction_map = NULL, *low_contrast_map = NULL;
    int *low_flow_map = NULL, *high_curve_map = NULL;
    int map_w = 0, map_h = 0;
    unsigned char *bdata = NULL;
    int bw = 0, bh = 0, bd = 0;

    if (pixels == NULL || width <= 0 || height <= 0) return NULL;

    // get_minutiae() copies what it needs; `pixels` stays owned by the caller.
    if (get_minutiae(&minutiae, &quality_map, &direction_map,
                     &low_contrast_map, &low_flow_map, &high_curve_map,
                     &map_w, &map_h, &bdata, &bw, &bh, &bd,
                     pixels, width, height, 8,
                     SCANNER_PPI / (double)MM_PER_INCH, &lfsparms_V2) != 0) {
        return NULL;
    }

    // 32 bytes per line is comfortably above "x y t q\n" at any plausible
    // coordinate, and +1 leaves room for the terminator on an empty result.
    size_t cap = (size_t)minutiae->num * 32 + 1;
    char *out = (char *)malloc(cap);
    if (out == NULL) goto done;

    size_t used = 0;
    for (int i = 0; i < minutiae->num; i++) {
        MINUTIA *m = minutiae->list[i];
        int ox, oy, ot;
        // M1 representation — the bridge runs `mindtct -m1`, and bozorth3
        // scores are only comparable between templates in the same rep.
        lfs2m1_minutia_XYT(&ox, &oy, &ot, m);
        int oq = sround(m->reliability * 100.0);
        used += snprintf(out + used, cap - used, "%d %d %d %d\n", ox, oy, ot, oq);
        if (used >= cap) break;  // unreachable given the sizing; refuse to run off the end
    }
    out[used < cap ? used : cap - 1] = '\0';

done:
    free_minutiae(minutiae);
    free(quality_map);
    free(direction_map);
    free(low_contrast_map);
    free(low_flow_map);
    free(high_curve_map);
    free(bdata);
    return out;
}

/** Free a string returned by extract_minutiae(). */
EXPORT void free_result(char *p) { free(p); }

/**
 * Parse ".xyt" text into bozorth3's fixed-size struct.
 *
 * bozorth3's own bz_load() reads a FILE and silently keeps only the first
 * MAX_BOZORTH_MINUTIAE rows; this does the same from memory. Quality is
 * ignored, matching `bozorth3 -m1` on a 4-column file.
 */
static int parse_xyt(const char *text, struct xyt_struct *out) {
    int n = 0;
    const char *p = text;
    while (p != NULL && *p != '\0' && n < MAX_BOZORTH_MINUTIAE) {
        int x, y, t, q;
        int got = sscanf(p, "%d %d %d %d", &x, &y, &t, &q);
        if (got >= 3) {
            out->xcol[n] = x;
            out->ycol[n] = y;
            out->thetacol[n] = t;
            n++;
        }
        p = strchr(p, '\n');
        if (p != NULL) p++;
    }
    out->nrows = n;
    return n;
}

/**
 * Bozorth3 match score between two ".xyt" templates.
 *
 * Same number the bridge's POST /match compares against
 * CHURCH_BIOMETRIC_THRESHOLD (default 33), so the tablet and the PC agree on
 * what counts as a match. Returns -1 if either template is unusable.
 */
EXPORT int match_templates(const char *probe_xyt, const char *gallery_xyt) {
    static struct xyt_struct probe;   // ~36KB each — static keeps them off the
    static struct xyt_struct gallery; // stack, which is small under wasm.
    if (errorfp == NULL) errorfp = stderr;
    if (probe_xyt == NULL || gallery_xyt == NULL) return -1;
    if (parse_xyt(probe_xyt, &probe) == 0) return -1;
    if (parse_xyt(gallery_xyt, &gallery) == 0) return -1;
    return bozorth_main(&probe, &gallery);
}
