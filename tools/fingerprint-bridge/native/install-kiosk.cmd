@echo off
setlocal EnableExtensions
REM ===========================================================================
REM  Plan 44 - provision a Church fingerprint kiosk on a fresh Windows PC.
REM
REM  Double-click this. It elevates itself, installs the scanner driver with no
REM  clicks, then hands over to setup.ps1 for the vendor DLL, the NBIS
REM  binaries, church-scan.exe and the background service.
REM
REM  Why a .cmd and not just the .ps1: staff can double-click a .cmd, it
REM  survives the default ExecutionPolicy, and it can re-launch itself elevated.
REM  Everything real still lives in the PowerShell scripts.
REM
REM  Driver note (verified 2026-08-09): Futronic's own installer is a custom
REM  wrapper with NO silent switch, so it cannot be driven unattended. Instead
REM  export the WHQL driver ONCE from a working machine (export-driver.ps1) and
REM  pnputil it here. That is unattended, keeps the Microsoft WHQL signature,
REM  and can be staged BEFORE the scanner is plugged in so it binds on first
REM  insertion.
REM ===========================================================================

cd /d "%~dp0"

REM --- elevate if we are not already admin -----------------------------------
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

REM --- 1. driver -------------------------------------------------------------
set "DRIVER_DIR=%~dp0driver"
set "DRIVER_INF="
if exist "%DRIVER_DIR%" (
    for /f "delims=" %%F in ('dir /b /s "%DRIVER_DIR%\*.inf" 2^>nul') do set "DRIVER_INF=%%F"
)

if defined DRIVER_INF (
    echo [1/2] Installing the fingerprint scanner driver...
    pnputil /add-driver "%DRIVER_INF%" /install /subdirs
    if errorlevel 1 (
        echo(
        echo    Driver install reported a problem. If the scanner still works,
        echo    it was probably already present. Continuing.
    ) else (
        echo    Driver staged. Plug the scanner in now if it is not already.
    )
) else (
    echo [1/2] No driver package found next to this script ^(expected .\driver^).
    echo(
    echo    Produce one ONCE, on a PC where the scanner already works:
    echo      powershell -ExecutionPolicy Bypass -File .\export-driver.ps1
    echo    then copy the resulting .\driver folder next to this file.
    echo(
    echo    Or install it by hand here, interactively ^(no silent switch exists^):
    echo      https://www.futronic-tech.com/futronic/attachment/upload/futronic/download/ftrDriverSetup_win8_whql_3471.zip
    echo(
    echo    Continuing - setup.ps1 will tell you if the device is missing.
)

echo(
echo [2/2] Vendor DLL, NBIS, church-scan.exe, service...
echo(

REM --- 2. everything else ----------------------------------------------------
REM  Pass through any arguments, so a kiosk can be pointed at an internal
REM  mirror:  install-kiosk.cmd -ScanExeUrl \\share\church-scan.exe ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
set "RC=%ERRORLEVEL%"

echo(
if "%RC%"=="0" (
    echo ==========================================================
    echo   Done. Open http://localhost:3000/setup to confirm.
    echo ==========================================================
) else (
    echo ==========================================================
    echo   setup.ps1 exited with code %RC% - read the messages above.
    echo ==========================================================
)

echo(
pause
exit /b %RC%
