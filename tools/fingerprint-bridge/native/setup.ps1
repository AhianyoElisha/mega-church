#Requires -Version 5.1
<#
.SYNOPSIS
  Plan 40 Phase D - one-time setup of the Church fingerprint bridge on a Windows
  x64 kiosk PC. The PowerShell peer of setup.sh.

.DESCRIPTION
  Steps, in order:
    0. Preflight   - x64, MSYS2/MinGW gcc, Node, repo layout.
    1. Driver      - check the Futronic FS81 (USB VID_1491) is present via PnP.
    2. Vendor DLL  - put ftrScanAPI.dll from Futronic's *Windows* SDK in vendor\.
    3. NBIS        - unpack the prebuilt cwsq/mindtct/bozorth3 .exe artifact
                     (Plan 40 Phase B: built ONCE, shipped; kiosks never build it).
    4. church-scan   - mingw32-make -f Makefile.win install  -> church-scan.exe.
    5. Service     - run `npm run bridge` as a service (NSSM, else Task Scheduler).
    6. Health      - GET http://127.0.0.1:<port>/health and print the verdict.

  Every step is idempotent: re-running skips what is already in place.

.PARAMETER VendorZipUrl
  URL (or local path) of Futronic's Windows SDK zip containing ftrScanAPI.dll.
  Defaults to Futronic's published "ftrScanAPI demo for Windows" package, which
  is where the DLL actually comes from (verified 2026-08-07). Point it at an
  internal mirror if the kiosks are offline or the vendor moves the file.

  The FS81 also needs Futronic's WHQL USB driver installed once per kiosk PC -
  that is a separate, interactive, elevated installer this script cannot run:
    https://www.futronic-tech.com/futronic/attachment/upload/futronic/download/ftrDriverSetup_win8_whql_3471.zip
  Until it is in, the device sits at Code 28 and church-scan reports no_device.

.PARAMETER NbisZipUrl
  URL (or local path) of the prebuilt NBIS zip (a `bin\` folder holding
  cwsq.exe, mindtct.exe, bozorth3.exe). See README "Building NBIS once".

.PARAMETER ScanExeUrl
  Plan 44 Phase A - URL (or local path) of a PREBUILT church-scan.exe. The binary
  is identical on every kiosk (i686 PE linking ftrScanAPI.dll; nothing about it
  is machine-specific), so the same "build once, ship the artifact" rule that
  already applies to NBIS applies here too. Supplying this means a kiosk needs
  no MSYS2 and no compiler at all - about a gigabyte of toolchain per machine
  that provisioning no longer has to install.

  Produce the artifact with native\build-payload.ps1 on the dev box.

.PARAMETER ScanExeSha256
  Expected SHA-256 of the prebuilt exe. Verified after download; setup refuses
  a mismatch. build-payload.ps1 prints the value and writes SHA256SUMS.txt.

.PARAMETER Port
  Bridge port. Must match CHURCH_BRIDGE_PORT / NEXT_PUBLIC_CHURCH_BRIDGE_URL in
  .env.local. Default 7788.

.PARAMETER SkipService
  Build and verify only; do not install the background service.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup.ps1 `
    -VendorZipUrl \\fileserver\church\futronic-windows-sdk.zip `
    -NbisZipUrl   \\fileserver\church\nbis-win64-bin.zip
#>
[CmdletBinding()]
param(
  [string] $VendorZipUrl = 'https://www.futronic-tech.com/futronic/attachment/upload/futronic/download/ftrScanApiEx_v4.5.zip',
  [string] $NbisZipUrl,
  [string] $ScanExeUrl,
  [string] $ScanExeSha256,
  [int]    $Port = $(if ($env:CHURCH_BRIDGE_PORT) { [int]$env:CHURCH_BRIDGE_PORT } else { 7788 }),
  [switch] $SkipService
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$NativeDir  = $PSScriptRoot                                   # ...\tools\fingerprint-bridge\native
$BridgeDir  = Split-Path -Parent $NativeDir                   # ...\tools\fingerprint-bridge
$RepoRoot   = Split-Path -Parent (Split-Path -Parent $BridgeDir)
$VendorDir  = Join-Path $NativeDir 'vendor'
$NbisBinDir = Join-Path $NativeDir 'nbis\install\bin'
$ScanExe    = Join-Path $NativeDir 'church-scan.exe'
$ServiceName = 'ChurchFingerprintBridge'
$TaskName    = 'Church Fingerprint Bridge'

function Step($n, $msg) { Write-Host "== [$n] $msg ==" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "   $msg" -ForegroundColor Green }
function Warn($msg)    { Write-Host "   $msg" -ForegroundColor Yellow }
function Die($msg)      { Write-Host "   $msg" -ForegroundColor Red; exit 1 }

function Get-Payload {
  param([string] $Source, [string] $Destination)
  # Accepts a URL, a UNC path or a local path - kiosks are often offline.
  if ($Source -match '^(https?|ftp)://') {
    Invoke-WebRequest -Uri $Source -OutFile $Destination -UseBasicParsing
  } else {
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
  }
}

function Get-PeMachine {
  # Read the COFF machine type straight out of the PE header: DOS header holds
  # e_lfanew at 0x3C, which points at the "PE\0\0" signature, and the machine
  # word sits 4 bytes past it. Cheaper and more reliable than shelling out to
  # `file` (which needs MSYS2) or dumpbin (which needs Visual Studio).
  param([string] $Path)
  try {
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 0x40) { return 'unknown' }
    $peOff = [BitConverter]::ToInt32($bytes, 0x3C)
    if ($peOff -le 0 -or ($peOff + 6) -ge $bytes.Length) { return 'unknown' }
    if ($bytes[$peOff] -ne 0x50 -or $bytes[$peOff + 1] -ne 0x45) { return 'unknown' }
    switch ([BitConverter]::ToUInt16($bytes, $peOff + 4)) {
      0x014c  { return 'i386' }
      0x8664  { return 'x64' }
      0xAA64  { return 'arm64' }
      default { return 'unknown' }
    }
  } catch {
    return 'unknown'
  }
}

# ---------------------------------------------------------------------------
Step '0/6' 'Preflight'

if ([Environment]::Is64BitOperatingSystem -ne $true) {
  Die 'the church app kiosks are x64 Windows (Plan 40 out-of-scope: 32-bit Windows hosts).'
}
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
  Die 'ARM64 Windows is out of scope - untested with the Futronic driver.'
}

# Plan 40 Phase A, corrected 2026-08-07: the vendor's published WINDOWS SDK ships
# a 32-BIT ftrScanAPI.dll (the x64 assumption came from the Linux download), so
# church-scan.exe is built i686 and needs the mingw32 toolchain. See Makefile.win.
# Resolve both tools by absolute path as well as by PATH. A stock MSYS2 install
# puts NEITHER on the Windows PATH (make lives in C:\msys64\usr\bin, the 32-bit
# gcc in C:\msys64\mingw32\bin), so a PATH-only probe reports "toolchain not
# found" on a machine where it is installed and working.
function Resolve-Tool {
  param([string] $Name, [string[]] $Candidates)
  $c = Get-Command $Name -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in $Candidates) { if (Test-Path $p) { return $p } }
  return $null
}

$make = Resolve-Tool 'mingw32-make' @('C:\msys64\usr\bin\make.exe')
if (-not $make) { $make = Resolve-Tool 'make' @('C:\msys64\usr\bin\make.exe') }
# 32-bit gcc: see the Makefile.win header for why this is i686 and not x86_64.
$gcc  = Resolve-Tool 'i686-w64-mingw32-gcc' @('C:\msys64\mingw32\bin\gcc.exe')

if (-not $make -or -not $gcc) {
  Warn 'MinGW-w64 (32-bit) toolchain not found. Install MSYS2 (https://www.msys2.org),'
  Warn 'then in the "MSYS2 MSYS" shell:  pacman -S --needed mingw-w64-i686-gcc make'
  Warn 'Continuing - the build step will be skipped.'
  if ($gcc)  { Ok "  (found gcc:  $gcc)" }
  if ($make) { Ok "  (found make: $make)" }
} else {
  Ok "toolchain: $gcc"
  Ok "make:      $make"
}

# Smart App Control is a Microsoft-managed kernel Code Integrity policy. It has
# no exclusion list and ignores this machine's certificate trust store, so a
# locally-signed binary does NOT satisfy it - only a CA-issued (in practice EV)
# code-signing certificate does. With it enforcing, every binary this script
# installs is blocked at image load and the bridge cannot scan or match.
# It auto-enables only on CLEAN Windows 11 22H2+ installs; machines upgraded
# from Windows 10 have it off, which is why many kiosks will never see this.
$sac = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' `
          -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState
if ($sac -eq 1) {
  Warn 'Smart App Control is ENFORCING on this PC.'
  Warn 'It will block church-scan.exe and the NBIS binaries (Event ID 3033/3077 in'
  Warn 'Microsoft-Windows-CodeIntegrity/Operational). Turn it off in Windows'
  Warn 'Security > App & browser control > Smart App Control, or EV-sign the'
  Warn 'binaries. NOTE: turning it off is IRREVERSIBLE without a Windows reinstall.'
} elseif ($sac -eq 2) {
  Warn 'Smart App Control is in evaluation mode; it may switch itself on later and'
  Warn 'start blocking the bridge binaries. Consider turning it off deliberately.'
} else {
  Ok 'Smart App Control: off (or unsupported) - unsigned bridge binaries will run'
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Die 'Node.js not found on PATH - the bridge runs under `npm run bridge`.' }
Ok "node: $(& node -v)"

New-Item -ItemType Directory -Force -Path $VendorDir  | Out-Null
New-Item -ItemType Directory -Force -Path $NbisBinDir | Out-Null

# ---------------------------------------------------------------------------
Step '1/6' 'Futronic FS81 driver / device presence'

# Same vendor token the bridge itself probes for (lib/biometrics/platform.ts:
# FUTRONIC_PNP_VENDOR_TOKEN). Kept in sync deliberately.
$fs81 = @()
try {
  $fs81 = @(Get-PnpDevice -PresentOnly -ErrorAction Stop |
            Where-Object { $_.InstanceId -like '*VID_1491*' })
} catch {
  Warn "Get-PnpDevice unavailable ($($_.Exception.Message)) - skipping device check."
}

if ($fs81.Count -eq 0) {
  Warn 'No USB device with VID_1491 is present.'
  Warn 'Plug the FS81 in and install the Futronic Windows driver (vendor installer,'
  Warn 'once per kiosk PC). Setup continues - the build does not need the device,'
  Warn 'but /health will report device:false until the driver is in place.'
} else {
  foreach ($d in $fs81) {
    if ($d.Status -eq 'OK') { Ok "$($d.FriendlyName) [$($d.InstanceId)] - $($d.Status)" }
    else { Warn "$($d.FriendlyName) [$($d.InstanceId)] - $($d.Status) (driver not bound; run the Futronic installer)" }
  }
}

# ---------------------------------------------------------------------------
Step '2/6' 'Vendor library (ftrScanAPI.dll)'

$VendorDll = Join-Path $VendorDir 'ftrScanAPI.dll'
if (Test-Path $VendorDll) {
  Ok 'vendor\ftrScanAPI.dll already present'
} elseif ($VendorZipUrl) {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("church-sdk-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp 'sdk.zip'
    Get-Payload -Source $VendorZipUrl -Destination $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $found = Get-ChildItem -Path $tmp -Recurse -Filter 'ftrScanAPI.dll' | Select-Object -First 1
    if (-not $found) { Die "ftrScanAPI.dll not found inside $VendorZipUrl" }
    Copy-Item $found.FullName $VendorDll -Force
    # Optional import lib - Makefile.win uses it when present, links the DLL otherwise.
    Get-ChildItem -Path $tmp -Recurse -Filter 'ftrScanAPI.lib' |
      Select-Object -First 1 |
      ForEach-Object { Copy-Item $_.FullName (Join-Path $VendorDir 'ftrScanAPI.lib') -Force }
    Ok 'vendor\ftrScanAPI.dll installed'
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
} else {
  Warn 'Missing vendor\ftrScanAPI.dll and no -VendorZipUrl given.'
  Warn 'Download Futronic''s WINDOWS SDK (not Linux_gtk_demo_x64.zip), and copy'
  Warn "ftrScanAPI.dll into: $VendorDir"
  Warn 'vendor\ is gitignored - never commit vendor binaries.'
}

# ---------------------------------------------------------------------------
Step '3/6' 'NBIS binaries (cwsq / mindtct / bozorth3)'

$needNbis = @(@('cwsq.exe','mindtct.exe','bozorth3.exe') |
              Where-Object { -not (Test-Path (Join-Path $NbisBinDir $_)) })

if ($needNbis.Count -eq 0) {
  Ok 'nbis\install\bin already has cwsq/mindtct/bozorth3'
} elseif ($NbisZipUrl) {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("church-nbis-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp 'nbis.zip'
    Get-Payload -Source $NbisZipUrl -Destination $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    foreach ($exe in @('cwsq.exe','mindtct.exe','bozorth3.exe')) {
      $hit = Get-ChildItem -Path $tmp -Recurse -Filter $exe | Select-Object -First 1
      if (-not $hit) { Die "$exe not found inside $NbisZipUrl" }
      Copy-Item $hit.FullName (Join-Path $NbisBinDir $exe) -Force
    }
    # Carry any runtime DLLs shipped alongside (e.g. libgcc/libwinpthread).
    Get-ChildItem -Path $tmp -Recurse -Filter '*.dll' |
      ForEach-Object { Copy-Item $_.FullName $NbisBinDir -Force }
    Ok "installed: $((Get-ChildItem $NbisBinDir -Filter *.exe | ForEach-Object Name) -join ' ')"
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
} else {
  Warn "Missing $($needNbis -join ', ') and no -NbisZipUrl given."
  Warn 'These three are pure file-in/file-out computation - build them ONCE under'
  Warn 'MSYS2 (see README "Building NBIS once") and publish the zip internally.'
  Warn "Kiosks never build NBIS. Expected layout: $NbisBinDir\<exe>"
}

# ---------------------------------------------------------------------------
Step '4/6' 'Build church-scan.exe'

if ($make -and $gcc -and (Test-Path $VendorDll)) {
  Push-Location $NativeDir
  try {
    # $make/$gcc are absolute paths (strings), not CommandInfo objects.
    # CC is passed explicitly because make predefines CC, so Makefile.win's own
    # default cannot fire when the variable is already set - and a 64-bit gcc
    # here silently yields an exe that fails with no_device at runtime.
    # Forward slashes are mandatory: MSYS2 make runs recipes through /bin/sh,
    # which eats the backslashes and turns C:\msys64\...\gcc.exe into the
    # nonexistent command "C:msys64...gcc.exe".
    $ccArg = $gcc -replace '\\', '/'
    & $make -f Makefile.win install "CC=$ccArg"
    if ($LASTEXITCODE -ne 0) { Die "build failed (exit $LASTEXITCODE)" }
    Ok 'church-scan.exe built'
  } finally { Pop-Location }
} elseif (Test-Path $ScanExe) {
  Ok 'church-scan.exe already present (skipping build)'
} elseif ($ScanExeUrl) {
  # Plan 44 Phase A - no toolchain on this machine, so take the prebuilt
  # binary. This is the normal kiosk path; building is the dev-box path.
  Get-Payload -Source $ScanExeUrl -Destination $ScanExe
  if ($ScanExeSha256) {
    $got = (Get-FileHash -LiteralPath $ScanExe -Algorithm SHA256).Hash
    if ($got -ne $ScanExeSha256.ToUpper()) {
      Remove-Item -LiteralPath $ScanExe -Force -ErrorAction SilentlyContinue
      Die "church-scan.exe SHA-256 mismatch: expected $ScanExeSha256, got $got"
    }
    Ok "hash verified ($got)"
  } else {
    Warn 'No -ScanExeSha256 given; the downloaded binary was not verified.'
  }
  # A 64-bit build links fine and then fails at RUNTIME with no_device, because
  # the vendor DLL is PE32 i386. That cost a debugging session in Plan 40, so
  # assert the architecture here rather than discovering it at the platen.
  $machine = Get-PeMachine -Path $ScanExe
  if ($machine -ne 'i386') {
    Remove-Item -LiteralPath $ScanExe -Force -ErrorAction SilentlyContinue
    Die "church-scan.exe is $machine but must be i386 - the Futronic Windows DLL is 32-bit."
  }
  Ok 'prebuilt church-scan.exe installed (i386 verified)'
} else {
  Warn 'Skipped: needs the MinGW toolchain + vendor\ftrScanAPI.dll to build,'
  Warn 'or -ScanExeUrl pointing at a prebuilt church-scan.exe (see build-payload.ps1).'
  Warn 'Kiosks should use -ScanExeUrl: the binary is identical on every machine,'
  Warn 'so there is no reason to install a compiler on each one.'
}

if (Test-Path $ScanExe) {
  Write-Host ''
  Write-Host '   Sanity check (no finger needed):' -ForegroundColor Gray
  Write-Host "     .\church-scan.exe `$env:TEMP\church-probe.pgm 2   # expect no_finger, exit 2" -ForegroundColor Gray
  Write-Host '   With a finger on the platen it must print {"ok":true,...,"variance":>1000}' -ForegroundColor Gray
  Write-Host '   and the .pgm must be exactly 153615 bytes (15-byte header + 320*480).' -ForegroundColor Gray
  Write-Host ''
  Write-Host '   SmartScreen/Defender: church-scan.exe is unsigned, so first run may be' -ForegroundColor Gray
  Write-Host '   blocked. Right-click > Properties > Unblock, or add an exclusion for' -ForegroundColor Gray
  Write-Host "   $NativeDir. Sign it if KNUST has a code-signing cert." -ForegroundColor Gray
  Write-Host ''
}

# ---------------------------------------------------------------------------
Step '5/6' 'Background service'

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

if ($SkipService) {
  Warn '-SkipService given; not installing.'
} elseif (-not (Test-Admin)) {
  Warn 'Not running as Administrator - service install skipped.'
  Warn 'Re-run this script from an elevated PowerShell to install it.'
} else {
  $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
  if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
  if (-not $npm) { Die 'npm not found on PATH - cannot install the service.' }
  $nssm = Get-Command nssm -ErrorAction SilentlyContinue

  # Run node DIRECTLY rather than through `npm run bridge`. npm.cmd is a batch
  # wrapper, so the service manager ends up supervising cmd.exe while the real
  # listener is a grandchild node process -- kill the wrapper and node survives,
  # still holding port 7788, and the next start fails to bind. (Observed exactly
  # that during Plan 40: stopping the npm wrapper orphaned node on 7788.)
  #
  # This does NOT reduce the service to a single process, and it is worth being
  # precise about why: tsx re-executes node to register its loader hooks, so the
  # live tree is nssm -> node (tsx) -> node (the listener), measured on this
  # kiosk as 14912 -> 5240 -> 2040. Dropping tsx would need bridge.ts to carry
  # explicit .ts import extensions for node's native type stripping, which is a
  # source change made for a packaging reason -- not worth it. What removing
  # npm.cmd does buy is a tree with no cmd.exe in it and one less layer to lose
  # a signal in; the actual no-orphan guarantee is AppKillProcessTree, set
  # explicitly below rather than left to NSSM's default.
  #
  # The two script paths are passed RELATIVE to the repo root, which both
  # launchers below set as the working directory. That is not cosmetic: every
  # value handed to nssm.exe has to survive PowerShell 5.1's native-argument
  # quoting, and PS 5.1 escapes an embedded double quote as \" while omitting
  # the outer quotes -- so a pre-quoted "C:\Users\PY TECH\...\cli.mjs" reaches
  # nssm already shredded, and node starts with C:\Users\PY as its script and
  # dies MODULE_NOT_FOUND before binding the port. (Plain spaces with no inner
  # quotes ARE handled correctly, which is why AppDirectory always survived.)
  # Relative paths have no spaces on this repo layout, so there is nothing to
  # quote and nothing for PS 5.1 to mangle.
  $nodeExe  = (Get-Command node -ErrorAction SilentlyContinue)
  $tsxRel   = 'node_modules\tsx\dist\cli.mjs'
  $bridgeRel = 'tools\fingerprint-bridge\bridge.ts'
  if ($nodeExe -and (Test-Path (Join-Path $RepoRoot $tsxRel)) `
                -and (Test-Path (Join-Path $RepoRoot $bridgeRel))) {
    $svcProgram = $nodeExe.Source
    $svcArgs    = @($tsxRel, $bridgeRel)
    Ok 'service will run node directly (single process)'
  } else {
    # node_modules absent (npm install not run yet) - fall back to the wrapper
    # so setup still produces a working service; it just stops less cleanly.
    $svcProgram = $npm.Source
    $svcArgs    = @('run', 'bridge')
    Warn 'node_modules/tsx not found - service will wrap `npm run bridge`.'
    Warn 'Run `npm install` in the repo root, then re-run this script to switch'
    Warn 'to the single-process form (stops cleanly, cannot orphan the port).'
  }

  # NSSM stores AppParameters as ONE raw string appended to Application, and
  # Task Scheduler's -Argument is the same shape, so the args are joined by a
  # space. Per the note above they must not need quoting - assert that rather
  # than trust it, because a future edit that reintroduces an absolute path
  # here would fail only at service-start time, in a log nobody reads.
  foreach ($a in $svcArgs) {
    if ($a -match '\s') {
      Die "service argument '$a' contains a space; it cannot survive PowerShell 5.1 -> nssm quoting. Use a path relative to the repo root."
    }
  }
  $svcArgLine = $svcArgs -join ' '
  $BridgeLog = Join-Path $RepoRoot 'bridge.log'

  if ($nssm) {
    # Preferred: a real service. Staff cannot close it, and it starts before login.
    # Config is re-applied on every run so the script stays idempotent in the
    # sense that matters: converging an EXISTING service onto current settings,
    # not merely skipping it. Application/AppParameters are set in the common
    # block rather than passed to `install` so there is exactly one code path
    # that decides how the command line is quoted.
    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $existing) {
      & $nssm.Source install $ServiceName $svcProgram | Out-Null
    } else {
      & $nssm.Source stop $ServiceName | Out-Null
    }
    & $nssm.Source set $ServiceName Application $svcProgram       | Out-Null
    & $nssm.Source set $ServiceName AppParameters $svcArgLine     | Out-Null
    & $nssm.Source set $ServiceName AppDirectory $RepoRoot        | Out-Null
    & $nssm.Source set $ServiceName AppEnvironmentExtra "CHURCH_BRIDGE_PORT=$Port" | Out-Null
    & $nssm.Source set $ServiceName Start SERVICE_AUTO_START      | Out-Null
    & $nssm.Source set $ServiceName AppStdout $BridgeLog          | Out-Null
    & $nssm.Source set $ServiceName AppStderr $BridgeLog          | Out-Null
    # An exam-hall kiosk runs unattended for weeks; an unrotated log is a slow
    # disk leak. Roll at 10 MB.
    & $nssm.Source set $ServiceName AppRotateFiles 1        | Out-Null
    & $nssm.Source set $ServiceName AppRotateBytes 10485760 | Out-Null
    # The listener is tsx's CHILD node (see above), so stopping the service has
    # to take the whole tree or the grandchild keeps port 7788 and the next
    # start cannot bind. This is NSSM's default, but it is the single setting
    # the no-orphan property depends on, and this block also has to converge a
    # service some earlier install may have left at 0 - so set it, don't assume.
    & $nssm.Source set $ServiceName AppKillProcessTree 1    | Out-Null
    & $nssm.Source start $ServiceName | Out-Null

    # An app that dies inside NSSM's throttle window leaves the service PAUSED,
    # not STOPPED, and `nssm start` reports that on stderr without failing the
    # script. Announcing "started" off the back of the start call therefore
    # claims success for a service that is not running - which is exactly how
    # the unquoted-AppParameters bug above got past a full setup run. Confirm
    # the state, and put the reason on screen when it is wrong.
    $svc = $null
    for ($i = 0; $i -lt 10; $i++) {
      $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
      if ($svc -and $svc.Status -eq 'Running') { break }
      Start-Sleep -Seconds 1
    }
    if ($svc -and $svc.Status -eq 'Running') {
      Ok "service '$ServiceName' installed/updated and started (auto-start at boot)"
    } else {
      $state = if ($svc) { "$($svc.Status)" } else { 'absent' }
      Warn "service '$ServiceName' is $state, not Running - the bridge exited."
      if (Test-Path $BridgeLog) {
        Warn "Last lines of $BridgeLog"
        Get-Content $BridgeLog -Tail 15 | ForEach-Object { Warn "  $_" }
      }
      Die "service '$ServiceName' failed to start."
    }
  } else {
    # Fallback (Plan 40 D): Task Scheduler, run whether the user is logged on or
    # not, hidden - same "staff can't close it by mistake" property, no extra
    # software to install. NSSM is still preferred: it restarts on crash.
    Warn 'NSSM not found (https://nssm.cc) - falling back to Task Scheduler.'
    Warn 'Note: Task Scheduler does not restart the bridge if it crashes mid-exam,'
    Warn 'only if it exits. NSSM is worth installing on a real kiosk.'
    # Same single-process reasoning, and the same quoting, as the NSSM branch.
    $action = New-ScheduledTaskAction -Execute $svcProgram `
                -Argument $svcArgLine -WorkingDirectory $RepoRoot
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' `
                   -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
                  -DontStopIfGoingOnBatteries -Hidden `
                  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
                  -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
      -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    Ok "scheduled task '$TaskName' registered (at startup, hidden) and started"
  }
}

# ---------------------------------------------------------------------------
Step '6/6' "Health check (http://127.0.0.1:$Port/health)"

$health = $null
for ($i = 0; $i -lt 15; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
    break
  } catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $health) {
  Warn "No answer on 127.0.0.1:$Port after 30s."
  Warn "Start it by hand to see why:  cd $RepoRoot ; npm run bridge"
  exit 1
}

Write-Host ("   ok={0} device={1} scanBin={2} nbis={3} busy={4}" -f `
  $health.ok, $health.device, $health.scanBin, $health.nbis, $health.busy)

if ($health.ok -and $health.device) {
  Ok "Bridge is healthy. Set NEXT_PUBLIC_CHURCH_BRIDGE_URL=http://127.0.0.1:$Port and CHURCH_BIOMETRIC_MATCHER_URL=http://127.0.0.1:$Port in .env.local"
} else {
  if (-not $health.scanBin) { Warn 'scanBin:false - church-scan.exe missing (step 4).' }
  if (-not $health.nbis)    { Warn 'nbis:false - cwsq/mindtct/bozorth3 .exe missing (step 3).' }
  if (-not $health.device)  { Warn 'device:false - FS81 not present / driver not installed (step 1).' }
  exit 1
}
