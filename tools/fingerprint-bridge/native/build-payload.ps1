#Requires -Version 5.1
<#
.SYNOPSIS
  Plan 44 Phase A - package the kiosk binary payload ONCE on the dev box.

.DESCRIPTION
  church-scan.exe and the three NBIS binaries are identical on every kiosk:
  i686/PE executables, pure computation over files, nothing machine-specific.
  Plan 40 Phase B already accepted that argument for NBIS ("build once, ship
  the artifact; kiosks never build it") - this extends it to church-scan.exe and
  produces a single verifiable zip.

  What that buys: a kiosk needs no MSYS2 and no compiler. That is roughly a
  gigabyte of toolchain, plus an interactive pacman session, removed from every
  machine you provision.

  The zip deliberately does NOT contain:
    - ftrScanAPI.dll or the Futronic driver. Redistribution terms are unstated
      (Plan 38 and Plan 40 both flag this, still unanswered), so setup.ps1 keeps
      fetching those from the vendor. Do not add them here without written
      permission from Futronic.
    - .env.local or anything carrying an Appwrite key.

  Run this from an MSYS2-capable dev box AFTER building both halves:
    make -f Makefile.win install      (church-scan.exe)
    ./build-nbis-win.sh               (cwsq / mindtct / bozorth3)

  KEEP THIS FILE ASCII-ONLY. PowerShell 5.1 reads a BOM-less UTF-8 file as
  CP1252, where a UTF-8 em-dash's trailing byte is a right-double-quote that
  closes the enclosing string early. That cost setup.ps1 ten syntax errors.

.PARAMETER OutDir
  Where to write the zip. Defaults to the repo root.

.PARAMETER Version
  Version stamp in the artifact name. Defaults to today, yyyyMMdd.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\build-payload.ps1
#>
[CmdletBinding()]
param(
  [string] $OutDir,
  [string] $Version = (Get-Date -Format 'yyyyMMdd')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$NativeDir  = $PSScriptRoot
$BridgeDir  = Split-Path -Parent $NativeDir
$RepoRoot   = Split-Path -Parent (Split-Path -Parent $BridgeDir)
$NbisBinDir = Join-Path $NativeDir 'nbis\install\bin'
$ScanExe    = Join-Path $NativeDir 'church-scan.exe'
if (-not $OutDir) { $OutDir = $RepoRoot }

function Ok($msg)   { Write-Host "   $msg" -ForegroundColor Green }
function Die($msg)  { Write-Host "   $msg" -ForegroundColor Red; exit 1 }

function Get-PeMachine {
  param([string] $Path)
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
}

Write-Host '== Collecting kiosk payload ==' -ForegroundColor Cyan

if (-not (Test-Path $ScanExe)) {
  Die "church-scan.exe not found. Build it first: make -f Makefile.win install"
}
# The vendor DLL is PE32 i386, so a 64-bit church-scan links cleanly and then
# fails at runtime with no_device. Catch it here, not on a kiosk.
$machine = Get-PeMachine -Path $ScanExe
if ($machine -ne 'i386') {
  Die "church-scan.exe is $machine, expected i386 - rebuild with the mingw32 gcc."
}
Ok "church-scan.exe ($machine)"

$nbis = @('cwsq.exe', 'mindtct.exe', 'bozorth3.exe')
foreach ($exe in $nbis) {
  if (-not (Test-Path (Join-Path $NbisBinDir $exe))) {
    Die "$exe not found in $NbisBinDir. Build it first: ./build-nbis-win.sh"
  }
}
Ok "nbis: $($nbis -join ' ')"

$stage = Join-Path ([IO.Path]::GetTempPath()) ("church-payload-" + [guid]::NewGuid())
$stageBin = Join-Path $stage 'bin'
New-Item -ItemType Directory -Force -Path $stageBin | Out-Null

try {
  Copy-Item $ScanExe $stageBin -Force
  foreach ($exe in $nbis) { Copy-Item (Join-Path $NbisBinDir $exe) $stageBin -Force }
  # Runtime DLLs the NBIS build may have left beside the binaries.
  Get-ChildItem -Path $NbisBinDir -Filter '*.dll' -ErrorAction SilentlyContinue |
    ForEach-Object { Copy-Item $_.FullName $stageBin -Force }

  # Guard against ever shipping the vendor library by accident - the licence
  # question is open, and an artifact on a file share is redistribution.
  $leaked = Get-ChildItem -Path $stageBin -Filter 'ftrScanAPI*' -ErrorAction SilentlyContinue
  if ($leaked) {
    Die 'ftrScanAPI.dll ended up in the payload. Vendor redistribution terms are unresolved - remove it.'
  }

  $sums = Join-Path $stage 'SHA256SUMS.txt'
  Get-ChildItem -Path $stageBin -File | ForEach-Object {
    $h = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    "$h  $($_.Name)"
  } | Set-Content -LiteralPath $sums -Encoding ASCII

  $zip = Join-Path $OutDir "church-kiosk-payload-$Version.zip"
  if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip

  $scanHash = (Get-FileHash -LiteralPath $ScanExe -Algorithm SHA256).Hash

  Write-Host ''
  Ok "wrote $zip"
  Write-Host ''
  Write-Host '   Contents:' -ForegroundColor Gray
  Get-Content -LiteralPath $sums | ForEach-Object { Write-Host "     $_" -ForegroundColor Gray }
  Write-Host ''
  Write-Host '   Provision a kiosk with (no MSYS2, no compiler needed):' -ForegroundColor Gray
  Write-Host '     powershell -ExecutionPolicy Bypass -File .\setup.ps1 `' -ForegroundColor Gray
  Write-Host "       -ScanExeUrl    \\<share>\church\bin\church-scan.exe ``" -ForegroundColor Gray
  Write-Host "       -ScanExeSha256 $scanHash ``" -ForegroundColor Gray
  Write-Host "       -NbisZipUrl    \\<share>\church\church-kiosk-payload-$Version.zip" -ForegroundColor Gray
  Write-Host ''
  Write-Host '   The Futronic driver and ftrScanAPI.dll are deliberately NOT in' -ForegroundColor Gray
  Write-Host '   this zip - setup.ps1 fetches them from the vendor, because their' -ForegroundColor Gray
  Write-Host '   redistribution terms are still unanswered.' -ForegroundColor Gray
} finally {
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
}
