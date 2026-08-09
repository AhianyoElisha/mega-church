#!/usr/bin/env bash
# Plan 40 Phase B — build NIST NBIS (cwsq / mindtct / bozorth3) on Windows.
#
#   Run from the "MSYS2 MINGW64" shell:
#     ./build-nbis-win.sh [BUILD_DIR]      # default BUILD_DIR=/c/church-build/nbis
#
# Prerequisites (once):
#   pacman -S --needed mingw-w64-x86_64-gcc make git
#
# YOU ONLY EVER RUN THIS ONCE, ON ONE MACHINE. The three binaries are pure
# file-in/file-out computation — no USB, no OS integration — so per Plan 40 they
# are built once and published as an artifact that setup.ps1 unpacks on each
# kiosk. Kiosks never build NBIS. This script exists so that artifact is
# reproducible, not because it belongs in a deployment.
#
# Measured on Windows 11 x64 / MSYS2 gcc 16.1.0 (2026-08-07): ~10 minutes.
# Plan 40 timeboxed this phase to a day on the assumption MinGW would need the
# usual 1990s-NIST-code fixes (sys/param.h, strings.h, getopt). It did not:
# NBIS ships `rules_msys.mak.src` and a `--MSYS` setup flag, and that path plus
# the same two patches the Linux build already needed was enough.
#
# WHY --MSYS (and not the plain Linux path):
#   rules_msys.mak.src keeps `-O2` (a comment in its history says -O2/-ansi were
#   once removed for Windows; they were restored) and adds two defines that
#   matter on Windows:
#     -DNO_FORK_AND_EXECL  — NBIS otherwise fork()s, which MSYS2 emulates slowly
#                            and MinGW binaries cannot do at all.
#     -D__MSYS__           — guards the platform branches inside NBIS itself.
#   Do NOT "simplify" this back to rules.mak.src.
#
# NOTE ON -O2: Plan 40 Phase E says a large scan-latency regression vs the Linux
# pilot's 0.96s means the NBIS build is unoptimised. Check the CFLAGS line this
# script prints below before you go looking anywhere else.
set -euo pipefail

BUILD_DIR="${1:-/c/church-build/nbis}"
NBIS_REPO="https://github.com/lessandro/nbis.git"
# Same set the Linux setup.sh uses. cwsq lives in imgtools, not its own package.
NBIS_PACKAGES="ijg png commonnbis an2k imgtools mindtct bozorth3"

case "$BUILD_DIR" in *[[:space:]]*)
  echo "ERROR: BUILD_DIR contains whitespace: $BUILD_DIR" >&2
  echo "NBIS's 1990s makefiles do not quote paths. Build somewhere like /c/church-build." >&2
  echo "(The INSTALLED binaries handle spaced paths fine — this is a build-time limit only," >&2
  echo " which is why the repo checkout under C:\\Users\\First Last\\ is not the build dir.)" >&2
  exit 1
;;
esac

echo "== [1/4] fetch NBIS =="
rm -rf "$BUILD_DIR/src"
mkdir -p "$BUILD_DIR/install"          # NBIS setup.sh exits 0 silently if this is absent
git clone --depth 1 -q "$NBIS_REPO" "$BUILD_DIR/src"
cd "$BUILD_DIR/src"

echo "== [2/4] configure (--MSYS) =="
./setup.sh "$BUILD_DIR/install" --MSYS --without-X11 --without-OPENJP2 >/dev/null

# Quirk 1: commonnbis' FFT includes little.h, which lives in the pcasys package
#          we deliberately exclude. Same fix as the Linux setup.sh.
cp pcasys/include/little.h commonnbis/include/
# Quirk 2: pre-C99 tentative definitions. GCC >= 10 defaults to -fno-common and
#          the link fails with multiple-definition errors without this.
sed -i 's|-O2 -w -ansi|-O2 -w -fcommon -ansi|' rules.mak

echo "   CFLAGS: $(grep -E '^CFLAGS' rules.mak | head -1 | cut -c1-120)"
case "$(grep -E '^CFLAGS' rules.mak | head -1)" in
  *-O2*) : ;;
  *) echo "ERROR: -O2 missing from CFLAGS; the build would be unoptimised." >&2; exit 1 ;;
esac

echo "== [3/4] build =="
make config  PACKAGES="$NBIS_PACKAGES" >/dev/null
make it      PACKAGES="$NBIS_PACKAGES" >/dev/null
make install PACKAGES="$NBIS_PACKAGES" >/dev/null

echo "== [4/4] verify + package =="
BIN="$BUILD_DIR/install/bin"
for exe in cwsq mindtct bozorth3; do
  [ -x "$BIN/$exe.exe" ] || { echo "ERROR: $exe.exe not built" >&2; exit 1; }
done

# A kiosk has no MSYS2, so the artifact must not depend on its runtime DLLs.
# The MinGW build links only KERNEL32 + msvcrt, both shipped by Windows.
if command -v objdump >/dev/null 2>&1; then
  for exe in cwsq mindtct bozorth3; do
    deps=$(objdump -p "$BIN/$exe.exe" | grep -i 'DLL Name' | tr -d ' \t' |
           sed 's/DLLName://I' | grep -viE '^(KERNEL32|msvcrt)\.dll$' || true)
    if [ -n "$deps" ]; then
      echo "WARNING: $exe.exe needs non-system DLLs, ship them alongside:" >&2
      echo "$deps" >&2
    fi
  done
fi

sha256sum "$BIN"/cwsq.exe "$BIN"/mindtct.exe "$BIN"/bozorth3.exe

echo
echo "Done. To publish the artifact setup.ps1 -NbisZipUrl consumes:"
echo "  mkdir -p /c/church-build/artifact/bin"
echo "  cp $BIN/{cwsq,mindtct,bozorth3}.exe /c/church-build/artifact/bin/"
echo "  powershell -c \"Compress-Archive -Path C:\\church-build\\artifact\\bin -DestinationPath nbis-win64-bin.zip -Force\""
