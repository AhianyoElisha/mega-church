# Church fingerprint bridge

A small **localhost-only** HTTP service that owns the two things a browser cannot do:

1. talk to the **Futronic FS81** scanner (closed USB protocol → vendor library, via the
   native `church-scan` binary), and
2. run the **NIST NBIS** matcher binaries (`cwsq` → `mindtct` → `bozorth3`).

It is deliberately **stateless**: `/match` receives the candidate set in the request, which
mirrors the shape of the future KNUST biometric API — retiring this bridge later is a config
change, not a refactor (Plan 38).

Raw fingerprint images exist only as temp files for the seconds between capture and minutiae
extraction; the temp dir is removed in a `finally`. Nothing biometric is written to disk by
the bridge.

---

## Status

| Piece | Linux | Windows |
|---|---|---|
| `church-scan` capture binary | ✅ built + hardware-verified (Plan 38) | ✅ built **i686** + hardware-verified 2026-08-07 (variance 2146.8, 153615-byte PGM) |
| NBIS (`cwsq`/`mindtct`/`bozorth3`) | ✅ built by `setup.sh` | ✅ built by `native/build-nbis-win.sh` (~10 min) |
| `bridge.ts` platform shim | ✅ | ✅ authored + unit-tested (`lib/biometrics/__tests__/platform.test.ts`) |
| Setup script | ✅ `native/setup.sh` | ✅ `native/setup.ps1` — run end-to-end 2026-08-07 |
| Hardware smoke | ✅ Plan 38/39 (0.96 s per scan) | ✅ 2026-08-07; matcher accuracy re-measured 2026-08-08 |

### Matcher accuracy — measured operating point

Measured **2026-08-08** on Windows against a real FS81 (Plan 43 Phase A). Corpus: **18
captures, 6 fingers, 2 people** → 18 genuine and 135 impostor pairs. `bozorth3` scores:

| pair type | n | min | median | max |
|---|---|---|---|---|
| **genuine** — same finger, different press | 18 | 16 | 84 | 173 |
| **impostor** — different finger, same person | 54 | 3 | 9 | 27 |
| **impostor** — different person | 81 | 5 | 8 | 22 |

At the default threshold of **33**: **0 of 135 impostor pairs are accepted.** Under
leave-one-out 1:N — two templates enrolled, the third press as the probe, the whole corpus
as the gallery, which is what `/api/attendance/scan` actually runs — the result is **18/18
correct identifications, 0 wrong identities, 0 rejections.** Thresholds from 30 to 40 all
produce that same outcome, so 33 sits mid-plateau, not on a cliff edge.

Re-derive any of this with:

```bash
npm run bridge                                  # the harness drives /scan
npx tsx scripts/_biometric-corpus.ts ri1        # one call per impression; label ends in the press no.
npx tsx scripts/_biometric-eval.ts              # matrix, distributions, sweep, 1:N simulation
```

Capture each finger under its own label stem (`ri`, `li`, `rt`, prefixed `p2_` etc. per
subject) — the label is the only thing telling genuine from impostor, so a mislabelled
capture silently inverts the result. That is precisely how the 2026-08-07 run went wrong.

**Two things the run established that matter operationally:**

1. **Multi-template enrolment is what makes weak fingers work.** Two captures in this corpus
   were poor (35 and 54 minutiae — dry fingertips, a light press). Judged as isolated pairs
   they fall below threshold (16 and 27) and would be false rejects. Enrolling 3 templates
   and taking the max lifts their worst genuine score to **55**, comfortably clear, while the
   best impostor anywhere stays at 27. Do not reduce the enrolment count to save time.
2. **Capture quality varies by person far more than by technique.** One subject produced
   80–96 minutiae; the other 35–85 on the same sensor minutes later, and coaching (breathe on
   the fingertip, press firmly and flat) moved it only slightly. A hall of 200 students will
   contain fingers like the second subject's. `/biometrics` should reject an enrolment capture
   under roughly 50 minutiae and re-prompt, rather than storing a template that will haunt
   check-in — that gate does not exist yet (Plan 43).

**The corpus is small.** 135 impostor pairs, whereas a single live scan against a
200-student hall at 3 templates each is 600 comparisons. The maximum of 135 draws says
little about the maximum of 600. Threshold 33 is *supported* by this data, not *calibrated*
by it — widen the corpus before an all-hall rollout. Plan 43 Phase A carries the target.

> **Correction — supersedes a 2026-08-07 finding.** This README previously carried a ⛔
> blocking notice stating that a *different* finger outscored the *same* finger (impostors at
> 56–115), that the cause was ~30 % of minutiae falling on the platen border, and that
> 3-template enrolment made things worse. **All of that was wrong.** The 2026-08-07 session
> mis-labelled its captures: the same finger was presented for every "different finger" prompt,
> so every impostor pair in it was actually a genuine pair. Re-run with verified-distinct
> fingers, impostors land at 3–27 and the border-minutiae theory has nothing left to explain —
> impostor pairs share almost no minutiae (median score 8). Passing mindtct's full `.xyt` to
> bozorth3 is fine. If you are reading an old branch, commit, or plan revision that repeats the
> blocking claim, it is stale.

**Two things Plan 40 assumed that turned out to be false — read these before building:**

1. **The Windows vendor DLL is 32-bit.** "Futronic ships an x64 SDK only" is true of the
   *Linux* download (`Linux_gtk_demo_x64.zip`) and false of Windows. Both packages Futronic
   publishes contain a **PE32 i386** `ftrScanAPI.dll`, so `church-scan.exe` must be built with
   the **i686** toolchain. A 64-bit build links and installs happily and then fails at
   runtime with `no_device`, which is a miserable thing to debug on a kiosk. `Makefile.win`
   now pins the compiler and asserts the output is `Intel i386`.
2. **The vendor exports undecorated symbols** while `ftrScanAPI.h` declares `__stdcall`, so
   `-Wl,--enable-stdcall-fixup` is required, not cosmetic.

**Android does not use this bridge at all.** Stock Android runs neither Node,
the native binaries, nor the vendor `.so`, so the tablet talks to the scanner
from the browser over WebUSB instead. The FS81's protocol was derived from
hardware for exactly that purpose — see
[`protocol/fs81-protocol.md`](protocol/fs81-protocol.md) and Plan 42. The
headline: a browser-captured frame must have its **rows reversed** before
minutiae extraction, or it will not match anything enrolled through this
bridge.

> **Smart App Control will stop this dead.** On a *clean-installed* Windows 11 22H2+ PC,
> Smart App Control blocks `church-scan.exe` and all three NBIS binaries at image load — they
> are unsigned and have no reputation. It has **no exclusion list**, and it ignores the
> machine's certificate store, so a self-signed binary does not satisfy it either; only a
> CA-issued (in practice EV) code-signing certificate does. Symptom: every native binary
> dies with "Permission denied" / "An Application Control policy has blocked this file",
> and `Microsoft-Windows-CodeIntegrity/Operational` logs Event 3033/3077. Check with:
>
> ```powershell
> (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
> # 0 = off (fine)   1 = enforcing (blocks the bridge)   2 = evaluation (may start blocking)
> ```
>
> Turning it off is **irreversible without reinstalling Windows**, so decide deliberately
> when provisioning a kiosk. Machines *upgraded* from Windows 10 never have it on.
> `setup.ps1` checks this in preflight and tells you which case you are in.

---

## HTTP contract (identical on both platforms)

Listens on `127.0.0.1:${CHURCH_BRIDGE_PORT:-7788}` — loopback only, by design: that binding is
what keeps the LAN out of the fingerprint path. Do not change it.

| Endpoint | Body | Response |
|---|---|---|
| `GET /health` | — | `{ ok, device, scanBin, nbis, busy }` |
| `POST /scan` | `{ timeoutS?, waitClear? }` | `{ ok, template: "xyt:<b64>", minutiae, variance }` or `{ ok:false, error }` |
| `POST /match` | `{ probe, candidates: [{ index_number, templates[] }], threshold? }` | `{ ok, index_number\|null, score, threshold }` |

`/scan` errors: `no_device`, `no_image_size`, `no_finger`, `write_failed`, `busy`,
`cwsq_failed`, `mindtct_failed`, `empty_template`.

### Environment

| Var | Where | Default | Meaning |
|---|---|---|---|
| `CHURCH_BRIDGE_PORT` | bridge process | `7788` | listen port |
| `CHURCH_BIOMETRIC_THRESHOLD` | bridge process | `33` | bozorth3 match threshold. **Hardware-derived, not platform-derived — do not re-tune during a port.** |
| `NEXT_PUBLIC_CHURCH_BRIDGE_URL` | Next app (`.env.local`) | — | e.g. `http://127.0.0.1:7788`; the kiosk/enrolment pages call this from the browser |
| `CHURCH_BIOMETRIC_MATCHER_URL` | Next server (`.env.local`) | — | same URL; selects `LocalMatcherBiometricService` |

Binary paths are **not** configurable — the bridge resolves them relative to itself:

```
tools/fingerprint-bridge/native/church-scan[.exe]
tools/fingerprint-bridge/native/nbis/install/bin/{cwsq,mindtct,bozorth3}[.exe]
```

The `.exe` suffix is applied by `withExe()` in `lib/biometrics/platform.ts` when
`process.platform === 'win32'`. If `/health` says `scanBin:false` or `nbis:false`, a file is
simply not at one of those paths.

---

## Linux install

```bash
sudo apt install -y libusb-0.1-4 build-essential git
sudo cp tools/fingerprint-bridge/native/60-futronic.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules      # then replug the scanner

cd tools/fingerprint-bridge/native
./setup.sh          # vendor lib + NBIS build + church-scan
```

`setup.sh` does three things: downloads Futronic's free Linux SDK zip and extracts
`libScanAPI.so` into `vendor/`; clones and builds NBIS into `nbis/`; builds `church-scan`.
Both `vendor/` and `nbis/` are gitignored — **never commit vendor binaries.**

Sanity check, then run:

```bash
./church-scan /tmp/x.pgm 2 ; echo exit=$?   # no finger → {"ok":false,"error":"no_finger"}, exit 2
npm run bridge
curl -s http://127.0.0.1:7788/health
```

To run it unattended, a user systemd unit works (`ExecStart=/usr/bin/npm run bridge`,
`WorkingDirectory=<repo>`, `Restart=always`).

---

## ⚠️ The kiosk must run the church app locally. A hosted the church app can never match a fingerprint.

Read this before provisioning anything — it is the single most expensive thing to learn the
hard way, and it cost a full session on 2026-08-08.

A scan has two halves that run in **different places**:

| half | runs | reaches the bridge? |
|---|---|---|
| capture (`POST /scan`) | in the **browser**, on the kiosk PC | yes — `127.0.0.1:7788` is local to the browser |
| identify (`match()`) | on the **server** serving `/api/attendance/scan` | only if that server *is* the kiosk PC |

So if you open the kiosk page from a deployed the church app (Vercel, or any other machine), capture
works, enrolment works — and **every scan comes back "FINGERPRINT NOT RECOGNISED"**, because
the server it posts to cannot reach a bridge bound to loopback on your desk. That screen is
identical to the one a genuinely unknown finger produces, which is what makes it so
expensive to diagnose.

This is deliberate: `server.listen(PORT, '127.0.0.1')` is what keeps the LAN out of the
fingerprint path. Every other the church app page works fine hosted; only the kiosk is pinned local.

Since Plan 43 Phase E the system says so itself — `/api/attendance/scan` answers **503** with
an explanation instead of a silent non-match, the kiosk refuses to arm its scanner and shows
the reason, and **`/setup` reports the whole chain**. If a kiosk misbehaves, open `/setup`
first.

```
On the kiosk PC:   start.bat        then open http://localhost:3000/kiosk
```

## Windows install

Target: **Windows x64 host**, running a 32-bit `church-scan.exe` under WoW64 (see the Status
note). ARM64 is out of scope — untested with the Futronic driver.

### Provisioning a new kiosk PC: one double-click

On a machine that has never seen the scanner, right-click **Run as
administrator**:

```
tools\fingerprint-bridge\native\install-kiosk.cmd
```

It elevates itself, stages the scanner driver with no clicks, then runs
`setup.ps1` for the vendor DLL, the NBIS binaries, `church-scan.exe` and the
background service. Finish at `http://localhost:3000/setup`, which reports
every layer and prints the fix for anything still red.

It expects a `.\driver` folder beside it. **Produce that once**, on a PC where
the scanner already works:

```powershell
powershell -ExecutionPolicy Bypass -File .\export-driver.ps1
```

#### Why an export rather than "run the vendor installer silently"

Verified 2026-08-09: `ftrDriverSetup_win8_whql_3471.zip` contains **one file** —
a signed *Futronic Driver Installer* EXE with **no silent switch**. It is not
Inno, NSIS, InstallShield or Wise; none of their markers are in the binary, and
no `/S`, `/silent`, `/q` or `/VERYSILENT` is advertised. Automating it would be
guesswork.

Windows, on the other hand, already keeps the real driver package once it is
installed, and will replay it anywhere:

```powershell
pnputil /enum-drivers                            # oem<N>.inf, original ftrwinusb.inf
pnputil /export-driver oem55.inf .\driver        # inf + cat + 2 coinstallers
pnputil /add-driver ftrwinusb.inf /install /subdirs
```

That keeps the **WHQL signature**, so it installs with no prompt, and it can be
staged **before** the scanner is plugged in so the device binds on first
insertion rather than appearing at Code 28.

`native/driver/` is gitignored — vendor binaries are never committed. Ship the
folder with the payload, or install the vendor driver by hand once per kiosk
(`install-kiosk.cmd` prints the link when the folder is absent).

### Provisioning a kiosk: use the prebuilt payload (Plan 44 Phase A)

`church-scan.exe` and the three NBIS binaries are **identical on every kiosk** — i686
executables doing pure computation over files. Build them once on a dev box and ship the
artifact; a kiosk then needs **no MSYS2 and no compiler**, which is about a gigabyte of
toolchain and an interactive `pacman` session removed from every machine.

On the dev box, after building both halves:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-payload.ps1
```

That writes `church-kiosk-payload-<date>.zip` (the four binaries + `SHA256SUMS.txt`), asserts
`church-scan.exe` is `i386`, and prints the exact `setup.ps1` line to run on a kiosk. It
deliberately **excludes `ftrScanAPI.dll` and the driver** — Futronic's redistribution terms
are still unanswered, so `setup.ps1` keeps fetching those from the vendor.

On each kiosk, from an elevated PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1 `
  -ScanExeUrl    \\fileserver\church\bin\church-scan.exe `
  -ScanExeSha256 <hash printed by build-payload.ps1> `
  -NbisZipUrl    \\fileserver\church\church-kiosk-payload-<date>.zip
```

`setup.ps1` verifies the hash and reads the PE header to confirm the binary is `i386`. That
guard matters: the vendor DLL is PE32 i386, so a 64-bit `church-scan.exe` links cleanly and
then fails at *runtime* with `no_device` — a trap that already cost one debugging session.

### Prerequisites, once per kiosk PC

1. **Futronic Windows driver** — this is the WHQL USB driver, *not* the SDK:
   [`ftrDriverSetup_win8_whql_3471.zip`](https://www.futronic-tech.com/futronic/attachment/upload/futronic/download/ftrDriverSetup_win8_whql_3471.zip)
   (signed by Futronic Technology Co. Ltd., DigiCert EV). Run the installer elevated, plug
   in the FS81, and confirm:
   ```powershell
   Get-PnpDevice -PresentOnly | Where-Object InstanceId -like '*VID_1491*'
   ```
   Status must be `OK` and `Service` must be `WinUSB`. Without it the device sits at
   **Code 28** ("drivers for this device are not installed") and `church-scan` returns
   `no_device` — note it *enumerates* and shows a friendly name even with no driver, so
   "Windows can see it" is not evidence the driver is in. (Windows has no udev equivalent
   and needs none — the bridge runs as a normal user.)
2. **Node.js LTS** on `PATH` (the repo already runs the Next app on Windows via
   `install.bat` / `start.bat`), and `npm install` run once in the repo root — the bridge
   starts via `npm run bridge`, which needs `tsx` from `devDependencies`.
3. **MSYS2 + MinGW-w64** — **not needed on a kiosk** if you pass `-ScanExeUrl` (see
   "Provisioning a kiosk" above). Required only on the dev box that builds the binaries.
   Install MSYS2 (`winget install MSYS2.MSYS2`), then from the **MSYS2 MSYS** shell:
   ```
   pacman -S --needed mingw-w64-i686-gcc make
   ```
   **i686, not x86_64** — the vendor DLL is 32-bit. You do not need either tool on the
   Windows `PATH`; `setup.ps1` resolves both from `C:\msys64\` directly.
   MinGW is preferred over MSVC: the vendor header declares every entry point `__stdcall`,
   which MinGW links off the DLL with no `.def` file.
4. **NSSM** (optional but preferred, https://nssm.cc) for the service install.
5. **Smart App Control off** — see the Status note. Check it *before* you build, not after
   you are debugging a bridge that reports `scanBin:true` and fails every scan.

### Run setup

From an **elevated** PowerShell, in `tools\fingerprint-bridge\native`:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1 `
  -VendorZipUrl \\fileserver\church\futronic-windows-sdk.zip `
  -NbisZipUrl   \\fileserver\church\nbis-win64-bin.zip
```

Both parameters accept a URL **or** a UNC/local path, and both are optional — omit them and
the script tells you exactly which file to drop where. It is idempotent; re-running skips
whatever is already in place. Steps: preflight → driver check → vendor DLL → NBIS →
`mingw32-make -f Makefile.win install` → service → `GET /health`.

Expected layout when it finishes:

```
tools\fingerprint-bridge\native\
  church-scan.exe
  ftrScanAPI.dll                 <- copied next to the exe; PE has no rpath, so
  vendor\ftrScanAPI.dll             the loader resolves it from the exe's folder
  nbis\install\bin\{cwsq,mindtct,bozorth3}.exe
```

### Build `church-scan.exe` by hand

```
mingw32-make -f Makefile.win install
.\church-scan.exe %TEMP%\church-probe.pgm 2      # expect no_finger, exit 2
```

With a finger on the platen it must print one JSON line with `"variance"` well above 1000,
exit 0, and the `.pgm` must be **exactly 153615 bytes** (15-byte `P5` header + 320×480).
That byte count is the proof that the writer's `"wb"` mode survived — if anyone ever changes
it to `"w"`, CRLF translation silently corrupts every capture and `pgmToRaw` in `bridge.ts`
starts throwing.

### Building NBIS once

`cwsq`, `mindtct` and `bozorth3` are pure file-in/file-out computation: no USB, no OS
integration. So build them **once** under MSYS2/MinGW-w64 and publish the three `.exe`s as a
zip on an internal share; kiosks never build NBIS, they just unpack that zip via
`setup.ps1 -NbisZipUrl`.

```bash
# from the MSYS2 MINGW64 shell:
pacman -S --needed mingw-w64-x86_64-gcc make git
./build-nbis-win.sh                 # ~10 minutes; writes /c/church-build/nbis/install/bin
```

`build-nbis-win.sh` scripts the whole thing. What it does that matters:

* **uses NBIS's own `--MSYS` path.** NBIS ships `rules_msys.mak.src`, which keeps `-O2` and
  adds `-DNO_FORK_AND_EXECL` (NBIS otherwise `fork()`s, which MinGW binaries cannot do) and
  `-D__MSYS__`. Don't "simplify" it back to the Linux `rules.mak.src`.
* carries both Linux patches `setup.sh` already applies: `cp pcasys/include/little.h
  commonnbis/include/` (commonnbis' FFT includes a header from the excluded `pcasys`
  package) and `-fcommon` in `CFLAGS` (the code predates C99 tentative definitions).
* **refuses to build in a path containing a space.** NBIS's makefiles don't quote paths, so
  a checkout under `C:\Users\First Last\` cannot be the build dir. The *installed* binaries
  handle spaced paths fine — this is a build-time limit only.
* asserts `-O2` survived. A large scan-latency regression against the Linux pilot's measured
  **0.96 s** usually means an unoptimised build; check that line before looking elsewhere.

The MinGW build links only `KERNEL32` + `msvcrt`, both shipped by Windows, so the three
`.exe`s drop onto a kiosk with no MSYS2 and no runtime DLLs alongside. The script warns if
that ever stops being true.

> Plan 40 timeboxed this phase to a day, expecting the usual 1990s-NIST-code archaeology
> (`sys/param.h`, `strings.h`, `getopt` shims). None of it was needed — the `--MSYS` path
> plus the two known patches built clean first time on gcc 16.1.0.

### Running as a service

Staff must not be able to close the bridge by mistake, so it does not run in a terminal
window. `setup.ps1` installs it one of two ways:

* **NSSM (preferred)** — service `ChurchFingerprintBridge`, auto-start, `npm run bridge` with
  `AppDirectory` = repo root, stdout/stderr to `bridge.log`. NSSM restarts it on crash.
  ```powershell
  nssm status  ChurchFingerprintBridge
  nssm restart ChurchFingerprintBridge
  nssm remove  ChurchFingerprintBridge confirm
  ```
* **Task Scheduler (fallback, no extra software)** — task `Church Fingerprint Bridge`, at
  startup, as `SYSTEM`, hidden, no execution time limit, 3 restart attempts.
  ```powershell
  Get-ScheduledTask  -TaskName 'Church Fingerprint Bridge'
  Start-ScheduledTask -TaskName 'Church Fingerprint Bridge'
  ```

Acceptance: reboot the kiosk PC, log in, and `/health` answers within 30 s with no human
intervention and no visible console window. Check it with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\check-service.ps1
```

Read-only; exits 0 on PASS, 1 with a reason list on FAIL. It asserts what "is it running?"
cannot: the **boot-to-listener delay**. A bridge that appeared 27 minutes into uptime was
started by a logged-in human, which is precisely the kiosk that comes up dead on exam
morning when nobody is there to do it — so anything past 180 s fails. It also asserts
session 0 (a listener in any other session was launched from someone's desktop and dies
with their logoff), `AppKillProcessTree=1`, `StartType=Automatic`, and `/health` all-true.

Run it once after provisioning each kiosk, not just after the reboot test.

### SmartScreen / Defender

`church-scan.exe` is **unsigned**, so its first run may be blocked by SmartScreen, and
Defender occasionally quarantines freshly built MinGW binaries. Either:

* right-click `church-scan.exe` → **Properties** → **Unblock** (and the NBIS `.exe`s), or
* add a Defender folder exclusion for `tools\fingerprint-bridge\native`, or
* sign the binaries if KNUST has a code-signing certificate (the durable fix).

Symptom if you skip this: `/health` shows `scanBin:true` but every `/scan` returns
`scan_failed` with no JSON line on stdout.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/health` all-green, no-finger `/scan` correctly says `no_finger`, but every **real** capture returns `scan_failed` | Windows only. `church-scan` embedded the output path in its JSON success line unescaped, and `path.join` paths are full of backslashes — `\U`, `\A` are invalid JSON escapes, so `JSON.parse` threw and the bridge fell back to the generic error. The failure path has no `%s`, which is why everything *except* a genuine scan looked healthy. | Fixed 2026-08-07 by `print_json_escaped()` in `church-scan.c`. If it recurs, run `church-scan.exe 'C:\some\path\x.pgm' 30` by hand with a finger and check the line parses: `node -e 'JSON.parse(...)'` |
| `church-scan.exe` / NBIS die with "Permission denied" or "An Application Control policy has blocked this file" | Smart App Control (see Status) | turn it off, or EV-sign the binaries. There is no exclusion list and self-signing does not help. |
| `church-scan` says `no_device` but Device Manager shows the scanner | driver not installed — the FS81 enumerates and shows a friendly name at **Code 28** with no driver bound | run the Futronic WHQL driver installer elevated; `Get-PnpDevice` must show `Status OK` **and** `Service WinUSB` |
| `npm run bridge` → `'tsx' is not recognized` | `node_modules` missing on the kiosk | `npm install` in the repo root |
| `/health` → `scanBin:false` | `church-scan[.exe]` not at `native/`, or missing `.exe` on Windows | rebuild (`make` / `make -f Makefile.win install`); confirm the bridge's startup log line `scan bin: … (MISSING)` |
| `/health` → `nbis:false` | `cwsq`/`mindtct`/`bozorth3` missing from `native/nbis/install/bin` | Linux: `./setup.sh`. Windows: `setup.ps1 -NbisZipUrl …` |
| `/health` → `device:false` **on Linux** | scanner unplugged, or no udev rule | replug; `sudo cp 60-futronic.rules /etc/udev/rules.d/ && sudo udevadm control --reload-rules` |
| `/health` → `device:false` **on Windows** | PnP has no `VID_1491` device | plug it in / install the Futronic driver. Note the Windows probe fails **optimistic** — it reports `true` if the PowerShell query itself fails, because a false "NOT DETECTED" hides the kiosk's scan button entirely, while a false "detected" costs one `no_device` error |
| Windows: `church-scan.exe` exits with code `0xC0000135` / "ftrScanAPI.dll not found" | DLL not next to the exe | `make -f Makefile.win install` copies it; PE has no rpath, so the DLL must sit beside the exe (or on `PATH`) |
| `/scan` → `no_device` while the device shows in PnP | another process holds the scanner (a second bridge, or Futronic's demo app) | close it — the scanner is exclusive-access; the bridge also serialises `/scan` internally (`busy`) |
| `/scan` → `no_finger` every time | platen dirty/dry finger, or the diode is off | wipe the platen, press firmly; `variance` should exceed ~2000 with a finger vs ~48 empty |
| `unexpected raw size …` in the bridge log | the PGM is not 15 + 320×480 bytes | on Windows, almost always the `"wb"`→`"w"` regression described above |
| Kiosk page can't reach the bridge from an **https** deployment | mixed content | browsers treat `127.0.0.1` as *potentially trustworthy*, so this is allowed; if a policy blocks it, run Next locally on the kiosk PC |
| Bridge dies when staff close a window | it was started by hand | install it as a service (above) |
| NBIS fails only for some users | `os.tmpdir()` under `C:\Users\First Last\…` | `spawn` passes argv correctly, but NBIS's 1990s arg parsing on spaced paths is unverified — test with a spaced username explicitly |

Useful one-liners:

```bash
curl -s http://127.0.0.1:7788/health
curl -s -XPOST http://127.0.0.1:7788/scan -d '{"timeoutS":10}'
```
```powershell
Invoke-RestMethod http://127.0.0.1:7788/health
```

---

## Files

```
tools/fingerprint-bridge/
  bridge.ts                  Node HTTP service (no deps). `npm run bridge`
  README.md                  this file
  native/
    church-scan.c              capture tool; portable (nap_us() wraps usleep/Sleep)
    ftrScanAPI.h             Futronic header — cross-platform as shipped, do NOT fork
    Makefile                 Linux build  (-l:libScanAPI.so, $ORIGIN rpath)
    Makefile.win             Windows build (MinGW-w64 → church-scan.exe)
    setup.sh                 Linux one-time setup
    setup.ps1                Windows one-time setup (+ service install)
    check-service.ps1        Windows service acceptance check (read-only, exits 1 on fail)
    60-futronic.rules        Linux udev rule (no Windows equivalent needed)
    vendor/                  gitignored — libScanAPI.so / ftrScanAPI.dll
    nbis/                    gitignored — NBIS source + install/bin
```

Pure helpers live in `lib/biometrics/` (`codec.ts`, `matching.ts`, `platform.ts`) so vitest
can discover them; the bridge imports from there.

Background: `.agent/plans/38.fingerprint-pilot-bridge.md` (pilot),
`.agent/plans/39.*` (latency), `.agent/plans/40.windows-bridge-port.md` (this port).
