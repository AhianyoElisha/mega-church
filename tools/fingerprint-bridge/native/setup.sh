#!/usr/bin/env bash
# One-time setup for the fingerprint bridge on a Linux x64 machine.
#   1. Downloads Futronic's free Linux SDK zip and extracts libScanAPI.so → vendor/
#   2. Clones and builds NIST NBIS (public domain) → nbis/  (mindtct, bozorth3, cwsq)
#   3. Builds church-scan
#
# Prerequisites (need root once, not needed to run afterwards):
#   sudo apt install -y libusb-0.1-4 build-essential git
#   sudo cp 60-futronic.rules /etc/udev/rules.d/ && sudo udevadm control --reload-rules
#   (then replug the scanner)
set -euo pipefail
cd "$(dirname "$0")"

FUTRONIC_URL="https://www.futronic-tech.com/futronic/attachment/upload/futronic/download/Linux_gtk_demo_x64.zip"
NBIS_REPO="https://github.com/lessandro/nbis.git"
NBIS_PACKAGES="ijg png commonnbis an2k imgtools mindtct bozorth3"

echo "== [1/3] Futronic vendor library =="
if [ ! -f vendor/libScanAPI.so ]; then
  mkdir -p vendor
  tmp=$(mktemp -d)
  curl -sSL --fail -o "$tmp/sdk.zip" "$FUTRONIC_URL"
  unzip -o -q "$tmp/sdk.zip" -d "$tmp"
  cp "$tmp"/Linux_gtk_demo_x64/libScanAPI.so vendor/
  cp "$tmp"/Linux_gtk_demo_x64/ftrapi.so vendor/ 2>/dev/null || true
  rm -rf "$tmp"
  echo "   vendor/libScanAPI.so installed"
else
  echo "   vendor/libScanAPI.so already present"
fi

echo "== [2/3] NIST NBIS (mindtct / bozorth3 / cwsq) =="
if [ ! -x nbis/install/bin/mindtct ]; then
  rm -rf nbis/src
  # NBIS's setup.sh silently exits 0 if the install dir doesn't pre-exist
  mkdir -p nbis/install
  git clone --depth 1 -q "$NBIS_REPO" nbis/src
  pushd nbis/src >/dev/null
  ./setup.sh "$(cd .. && pwd)/install" --without-X11 --without-OPENJP2 >/dev/null
  # NBIS quirk 1: commonnbis' FFT includes little.h which lives in the (excluded)
  # pcasys package. NBIS quirk 2: pre-C99 tentative definitions need -fcommon on
  # modern GCC (default -fno-common since GCC 10).
  cp pcasys/include/little.h commonnbis/include/
  sed -i 's|^CFLAGS\t:= -O2 -w -ansi|CFLAGS\t:= -O2 -w -fcommon -ansi|' rules.mak
  make config PACKAGES="$NBIS_PACKAGES" >/dev/null
  make it     PACKAGES="$NBIS_PACKAGES" >/dev/null
  make install PACKAGES="$NBIS_PACKAGES" >/dev/null
  popd >/dev/null
  echo "   built: $(ls nbis/install/bin | tr '\n' ' ')"
else
  echo "   nbis/install/bin/mindtct already present"
fi

echo "== [3/3] church-scan =="
make church-scan
echo
echo "Done. Sanity check (no finger needed):"
echo "  ./church-scan /tmp/church-probe.pgm 2 ; echo exit=\$?   # expect no_finger, exit 2"
