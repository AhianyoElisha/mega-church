#Requires -Version 5.1
<#
.SYNOPSIS
  Plan 44 Phase B - capture the Futronic FS81 driver ONCE, so every other kiosk
  can install it without a single click.

.DESCRIPTION
  Futronic ships the driver as a custom-wrapped installer inside
  ftrDriverSetup_win8_whql_3471.zip. Verified 2026-08-09: the zip contains
  exactly one file, a signed "Futronic Driver Installer" EXE, and it advertises
  NO silent switch - none of the usual /S, /silent, /q, /VERYSILENT markers of
  Inno, NSIS, InstallShield or Wise appear anywhere in the binary. Driving that
  installer unattended would be guesswork.

  So do not automate the installer. Automate WINDOWS instead.

  Once the driver is installed on ONE machine, Windows keeps the real driver
  package in its DriverStore, and it can be exported and then added to any
  other machine with `pnputil /add-driver ... /install` - fully unattended,
  and pre-stageable BEFORE the scanner is plugged in so the device binds
  correctly on first insertion.

  The exported package is WHQL-signed ("Microsoft Windows Hardware
  Compatibility Publisher"), so it raises none of the driver-signing or
  SmartScreen friction that the unsigned church-scan.exe does.

  Run this once on a machine where the scanner already works. Ship the output
  folder alongside the kiosk payload; install-kiosk.cmd consumes it.

  LICENCE NOTE: this copies Futronic's driver to other machines. Every one of
  them is running Futronic hardware the college bought, which is the case a
  WHQL driver exists for - but the redistribution terms are still formally
  unanswered (Plan 38, Plan 40, Plan 44). The always-safe fallback is to run
  the vendor installer by hand once per kiosk; -SkipExport prints how.

  KEEP THIS FILE ASCII-ONLY. PowerShell 5.1 reads a BOM-less UTF-8 file as
  CP1252, where a UTF-8 em-dash's trailing byte closes the enclosing string.

.PARAMETER OutDir
  Where to write the driver package. Defaults to .\driver next to this script.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\export-driver.ps1
#>
[CmdletBinding()]
param(
  [string] $OutDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot 'driver' }

function Ok($m)   { Write-Host "   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "   $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "   $m" -ForegroundColor Red; exit 1 }

Write-Host '== Exporting the Futronic FS81 driver ==' -ForegroundColor Cyan

# Find the driver in the DriverStore by its ORIGINAL inf name. The published
# name (oem<N>.inf) is assigned per machine and differs everywhere, so matching
# on it would work here and nowhere else.
#
# Walk the lines rather than splitting into blocks: pnputil emits CRLF, and a
# `^\s*$` block split treats the \r as content on some hosts, which silently
# separates "Published Name" from the "Original Name" that identifies it.
$published = $null
$lastPublished = $null
foreach ($line in (& pnputil /enum-drivers 2>&1)) {
  $text = [string]$line
  $m = [regex]::Match($text, 'Published Name\s*:\s*(\S+)')
  if ($m.Success) { $lastPublished = $m.Groups[1].Value; continue }
  if ($text -match 'ftrwinusb\.inf' -and $lastPublished) {
    $published = $lastPublished
    break
  }
}

if (-not $published) {
  Warn 'No Futronic driver found in this machine''s DriverStore.'
  Warn ''
  Warn 'Install it once, on this machine, then re-run:'
  Warn '  1. Download and run (elevated, interactive - it has no silent switch):'
  Warn '     https://www.futronic-tech.com/futronic/attachment/upload/futronic/download/ftrDriverSetup_win8_whql_3471.zip'
  Warn '  2. Plug in the FS81 and confirm:'
  Warn '     Get-PnpDevice -PresentOnly | Where-Object InstanceId -like "*VID_1491*"'
  Warn '     Status must be OK and Service must be WinUSB (not Code 28).'
  Warn '  3. powershell -ExecutionPolicy Bypass -File .\export-driver.ps1'
  exit 2
}

Ok "found $published (original: ftrwinusb.inf)"

if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

& pnputil /export-driver $published $OutDir | Out-Null
if ($LASTEXITCODE -ne 0) { Die "pnputil /export-driver failed (exit $LASTEXITCODE)" }

$inf = Get-ChildItem -Recurse -Path $OutDir -Filter '*.inf' | Select-Object -First 1
if (-not $inf) { Die "Export produced no .inf under $OutDir" }

$files = Get-ChildItem -Recurse -File -Path $OutDir
# Trim against the RESOLVED root: $OutDir may be relative, may carry a trailing
# separator, and PowerShell may normalise it - all of which make naive
# Substring arithmetic eat the first character of every name.
$root = (Resolve-Path -LiteralPath $OutDir).Path.TrimEnd('\')
Ok "exported $($files.Count) file(s) to $root"
foreach ($f in $files) {
  Write-Host ("     " + $f.FullName.Substring($root.Length).TrimStart('\')) -ForegroundColor Gray
}

# The .cat is what makes this install without a signing prompt; a package
# missing it will fail on a machine with driver signature enforcement on.
if (-not (Get-ChildItem -Recurse -Path $OutDir -Filter '*.cat')) {
  Warn 'No .cat in the export - the package is unsigned and will be refused.'
}

Write-Host ''
Ok 'Ship this folder with the kiosk payload. On a new PC, elevated:'
Write-Host "     pnputil /add-driver `"$($inf.Name)`" /install /subdirs" -ForegroundColor Gray
Write-Host '   or just run install-kiosk.cmd, which does that and the rest.' -ForegroundColor Gray
