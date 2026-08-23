#!/usr/bin/env bash
# Plan 42 Phase C — build the NBIS pieces the Android kiosk needs as WASM.
#
# Only mindtct's minutiae detector and bozorth3's matcher are compiled; the rest
# of NBIS (image codecs, an2k, pcasys…) is not reachable from the two entry
# points in src/nbis_wasm.c. Notably there is no WSQ encoder: the browser hands
# raw pixels to get_minutiae() directly, so the PC's PGM → cwsq → WSQ hop
# disappears on the tablet.
#
# Usage:  ./build.sh            (expects emsdk at ~/emsdk, or EMSDK set)
# Output: dist/nbis.js + dist/nbis.wasm
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NBIS="${NBIS_SRC:-$HERE/../fingerprint-bridge/native/nbis/src}"
EMSDK_DIR="${EMSDK:-$HOME/emsdk}"

if [ ! -d "$NBIS/mindtct" ]; then
  echo "NBIS sources not found at $NBIS — run tools/fingerprint-bridge/native/setup.sh first" >&2
  exit 1
fi

# Two NBIS headers are GENERATED from .src templates by NBIS's own setup.sh,
# which the bridge's setup.sh runs as part of building the native binaries. The
# wasm build needs neither those binaries nor a Linux box — only the headers —
# so generate them here if they are missing. The substituted paths are runtime
# data directories that nothing reachable from our two entry points ever reads.
#
# Without this, a bare `git clone` of NBIS fails with "'an2k.h' file not found",
# which is a confusing way to say "a prerequisite script has not run".
if [ ! -f "$NBIS/an2k/include/an2k.h" ]; then
  sed 's,SED_INSTALL_DATA_DIR_STRING,/nbis/data,'     < "$NBIS/an2k/include/an2k.h.src" > "$NBIS/an2k/include/an2k.h"
fi
if [ ! -f "$NBIS/commonnbis/include/little.h" ]; then
  sed -e 's,SED_INSTALL_DIR_STRING,/nbis,'       -e 's,SED_INSTALL_DATA_DIR_STRING,/nbis/data,'       -e 's,SED_INSTALL_NBIS_DIR_STRING,/nbis,'     < "$NBIS/pcasys/include/little.h.src" > "$NBIS/commonnbis/include/little.h"
fi

# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1

mkdir -p "$HERE/dist"

# mindtct's detector, minus the CLI and the file-format readers.
# Arrays, not strings: a checkout under a path containing a space (a Windows
# home directory, say) word-splits an unquoted list, and emcc is handed half a
# directory name as an input file.
mapfile -t MINDTCT_SRC < <(find "$NBIS/mindtct/src/lib/mindtct" -name '*.c' \
  ! -name 'to_type9.c' ! -name 'results.c' | sort)

# bozorth3's matcher, minus its CLI (bozorth3.c) and file loader (bz_io.c),
# which pull in argv parsing and stdio paths we don't want in a browser.
mapfile -t BOZORTH_SRC < <(find "$NBIS/bozorth3/src/lib/bozorth3" -name '*.c' \
  ! -name 'bz_io.c' | sort)

# Shared helpers both libraries call (memory, sorting, misc utils).
#
# time.c is excluded: it passes `long*` to time()/ctime(), which is fine on
# LP64 Linux but not under wasm32 where time_t is 64-bit. Nothing reachable
# from our two entry points calls it — mindtct carries its own mytime.c.
mapfile -t COMMON_SRC < <(find "$NBIS/commonnbis/src/lib/util" -name '*.c' \
  ! -name 'time.c' 2>/dev/null | sort)

emcc -O3 \
  -I "$HERE/src" \
  -I "$NBIS/mindtct/include" \
  -I "$NBIS/bozorth3/include" \
  -I "$NBIS/commonnbis/include" \
  -I "$NBIS/imgtools/include" \
  -I "$NBIS/an2k/include" \
  "$HERE/src/nbis_wasm.c" \
  "${MINDTCT_SRC[@]}" "${BOZORTH_SRC[@]}" "${COMMON_SRC[@]}" \
  -o "$HERE/dist/nbis.js" \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createNbis \
  -s EXPORTED_FUNCTIONS='["_extract_minutiae","_match_templates","_set_probe","_prepare_template","_free_prepared","_match_prepared","_free_result","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAPU8","UTF8ToString","stringToNewUTF8"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s ENVIRONMENT=web,worker,node \
  -s FILESYSTEM=0

# Publish to public/nbis/ as well.
#
# There is ONE artifact, deliberately: the browser fetches it from public/, and
# the Next server loads the same file rather than a second copy that could
# drift into disagreeing about scores. Copying here means a rebuild cannot leave
# the deployed matcher stale — which would show up as nothing at all, because
# the old build works fine, just slowly and without the 1:N entry points.
PUBLIC="$HERE/../../public/nbis"
if [ -d "$PUBLIC" ]; then
  cp "$HERE/dist/nbis.js" "$HERE/dist/nbis.wasm" "$PUBLIC/"
  echo "published: $PUBLIC/nbis.js + nbis.wasm"
fi

echo "built: $HERE/dist/nbis.js + nbis.wasm"
ls -la "$HERE/dist"
