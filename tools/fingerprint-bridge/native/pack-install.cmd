@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM ===========================================================================
REM  Church fingerprint kiosk - install on a fresh Windows PC.
REM
REM  This file ships INSIDE the kiosk pack downloaded from the church app. Everything it
REM  needs is in this folder: there is no repo here, no node_modules, no MSYS2
REM  and no compiler.
REM
REM  What it does:
REM    1. installs the fingerprint scanner driver (WHQL-signed, unattended)
REM    2. registers the bridge to start at boot
REM    3. starts it and checks it answers
REM
REM  Afterwards, open the the church app kiosk page in Chrome on THIS PC. The page talks
REM  to this bridge on 127.0.0.1 for capture; identification happens on the
REM  the church app server, so nothing else needs installing here.
REM
REM  Layout expected beside this file:
REM    church-bridge.js
REM    native\church-scan.exe, native\ftrScanAPI.dll
REM    native\nbis\install\bin\{cwsq,mindtct,bozorth3}.exe
REM    driver\ftrwinusb.inf (+ .cat, amd64\)
REM ===========================================================================

cd /d "%~dp0"
set "TASKNAME=Church Fingerprint Bridge"
set "PORT=7788"

net session >nul 2>&1
if errorlevel 1 (
    echo Requesting administrator rights...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
)

echo(
echo ==========================================================
echo   Church fingerprint kiosk setup
echo ==========================================================
echo(

REM --- 0. Node -----------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo [!] Node.js is not installed, and the bridge runs on it.
    echo(
    echo     Install the LTS build, then run this again:
    echo       https://nodejs.org/en/download
    echo(
    pause
    exit /b 1
)
for /f "delims=" %%V in ('node -v') do set "NODEV=%%V"
echo [0/3] Node %NODEV% found.

REM --- 1. driver ---------------------------------------------------------
set "DRIVER_INF="
if exist "%~dp0driver" (
    for /f "delims=" %%F in ('dir /b /s "%~dp0driver\*.inf" 2^>nul') do set "DRIVER_INF=%%F"
)
if defined DRIVER_INF (
    echo [1/3] Installing the scanner driver...
    pnputil /add-driver "!DRIVER_INF!" /install /subdirs >nul
    if errorlevel 1 (
        echo       pnputil reported a problem - if the scanner already worked here,
        echo       it was probably already installed. Continuing.
    ) else (
        echo       Driver staged. It binds when you plug the scanner in.
    )
) else (
    echo [1/3] No driver folder in this pack - skipping.
    echo       If the scanner is not detected later, install the vendor driver once:
    echo       https://www.futronic-tech.com/futronic/attachment/upload/futronic/download/ftrDriverSetup_win8_whql_3471.zip
)

REM --- 1b. is the port already taken? -------------------------------------
REM  If another bridge already owns 7788 - typically an NSSM service from an
REM  older repo-based install - this pack's bridge cannot bind, and the health
REM  check at the end would still PASS because the other one answers. That is
REM  a false success, so refuse instead of reporting a lie.
REM  Get-NetTCPConnection rather than parsing netstat: findstr's /c: switch is
REM  fragile to quoting, and the script already depends on PowerShell below.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo(
    echo [!] Something is already listening on port %PORT%.
    echo(
    echo     Probably an older the church app install on this PC. This pack's bridge
    echo     cannot bind while that is running, and a health check would pass
    echo     against the WRONG bridge - so stopping here rather than reporting
    echo     a success that is not yours.
    echo(
    echo     Stop the old one, then run this again:
    echo       sc stop ChurchFingerprintBridge ^&^& sc delete ChurchFingerprintBridge
    echo     or, if it is a scheduled task:
    echo       schtasks /end /tn "%TASKNAME%"
    echo(
    pause
    exit /b 1
)

REM --- 2. start at boot --------------------------------------------------
REM  schtasks rather than NSSM: a fresh PC has schtasks and does not have NSSM,
REM  and one less thing to download is one less thing to go wrong. SYSTEM +
REM  onstart means the kiosk comes back after a power cut with nobody logged in,
REM  which is the property that actually matters on exam morning.
echo [2/3] Registering "%TASKNAME%" to start at boot...
for /f "delims=" %%N in ('where node') do set "NODEEXE=%%N"
schtasks /query /tn "%TASKNAME%" >nul 2>&1
if not errorlevel 1 (
    schtasks /end /tn "%TASKNAME%" >nul 2>&1
    schtasks /delete /tn "%TASKNAME%" /f >nul 2>&1
)
schtasks /create /tn "%TASKNAME%" /ru SYSTEM /sc onstart /rl highest /f ^
    /tr "\"!NODEEXE!\" \"%~dp0church-bridge.js\"" >nul
if errorlevel 1 (
    echo       Could not register the scheduled task.
    goto :fail
)
echo       Registered.

REM --- 3. start + verify --------------------------------------------------
echo [3/3] Starting the bridge...
schtasks /run /tn "%TASKNAME%" >nul 2>&1
set "OK="
for /l %%i in (1,1,10) do (
    if not defined OK (
        timeout /t 2 /nobreak >nul
        powershell -NoProfile -Command "try{ $r=Invoke-RestMethod -Uri 'http://127.0.0.1:%PORT%/health' -TimeoutSec 3; if($r.ok){ exit 0 } else { exit 1 } }catch{ exit 1 }" >nul 2>&1
        if not errorlevel 1 set "OK=1"
    )
)

echo(
if defined OK (
    powershell -NoProfile -Command "$r=Invoke-RestMethod -Uri 'http://127.0.0.1:%PORT%/health' -TimeoutSec 3; Write-Host ('       scanner detected : ' + $r.device); Write-Host ('       capture binary   : ' + $r.scanBin); Write-Host ('       matcher binaries : ' + $r.nbis)"
    echo(
    echo ==========================================================
    echo   Bridge is running on http://127.0.0.1:%PORT%
    echo(
    echo   If "scanner detected" is False, plug the scanner in now -
    echo   the driver is staged and it will bind automatically.
    echo(
    echo   Now open the church app in Chrome on THIS PC and go to /setup.
    echo ==========================================================
) else (
    echo ==========================================================
    echo   The bridge did not answer on port %PORT%.
    echo   Try running it in this window to see why:
    echo      node "%~dp0church-bridge.js"
    echo ==========================================================
)

echo(
pause
exit /b 0

:fail
echo(
pause
exit /b 1
