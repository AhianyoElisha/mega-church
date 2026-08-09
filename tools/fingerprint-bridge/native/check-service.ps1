# Plan 40 - acceptance check for the Church fingerprint bridge Windows service.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\check-service.ps1
#
# Read-only: queries service config, the process tree behind port 7788, and
# /health. Changes nothing. Run it after provisioning a kiosk, and again after
# the reboot acceptance test.
#
# It answers the question a bare "is it running?" cannot: was the bridge started
# BY THE MACHINE, or by a human who happened to be logged in? Boot-to-listener
# delay is the discriminator - anything past a few minutes means somebody
# started it, which is exactly the failure a kiosk shows up with on exam morning
# when nobody is there to do that.
#
# KEEP THIS FILE ASCII-ONLY. PowerShell 5.1 reads a BOM-less UTF-8 file as
# CP1252, where a UTF-8 em-dash's trailing byte is a right-double-quote that
# closes the enclosing string early. That cost setup.ps1 ten syntax errors and
# a never-executed install; this script repeated the mistake while being
# written. Use plain ASCII hyphens.

$ErrorActionPreference = 'Continue'
$svcName  = 'ChurchFingerprintBridge'
$taskName = 'Church Fingerprint Bridge'
$fail = @()

# There are TWO ways a kiosk gets its bridge started at boot, and this script
# has to accept either - it reported a perfectly healthy kiosk as broken until
# it learned the second one (2026-08-09):
#
#   NSSM service    - setup.ps1, on a machine that has the repo.
#   Scheduled task  - the downloaded kiosk pack, which has no repo and cannot
#                     assume NSSM is installed. schtasks ships with Windows.
#
# What is being tested is the same either way: did the MACHINE start the
# bridge, or did a human? Everything below the autostart section (process tree,
# session, health, boot delay) is mechanism-agnostic and unchanged.
$svc  = Get-Service -Name $svcName -ErrorAction SilentlyContinue
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$nssm = if ($null -ne $svc) {
  (Get-CimInstance Win32_Service -Filter "Name='$svcName'").PathName -replace '^"([^"]+)".*$', '$1'
} else { $null }

Write-Output "=== BOOT ==="
$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
$uptime = [int]((Get-Date) - $boot).TotalSeconds
Write-Output ("last boot        : " + $boot.ToString('yyyy-MM-dd HH:mm:ss'))
Write-Output ("now              : " + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
Write-Output ("uptime           : {0}s ({1:N1} h)" -f $uptime, ($uptime / 3600))

Write-Output ""
Write-Output "=== AUTOSTART ==="
$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($null -eq $svc -and $null -eq $task) {
  if ($isAdmin) {
    Write-Output "NEITHER an NSSM service NOR a scheduled task is installed."
    $fail += 'no autostart mechanism installed (no NSSM service, no scheduled task)'
  } else {
    # Do not report a failure that is indistinguishable from a permission
    # limit: a SYSTEM scheduled task is simply not visible from an unelevated
    # shell, so "not found" here means "cannot see", not "not installed".
    Write-Output "CANNOT TELL - not running elevated, and a SYSTEM task is invisible from here."
    Write-Output "  Re-run this in an elevated PowerShell to check the autostart mechanism."
    $inconclusive = $true
  }
} elseif ($null -ne $svc -and $null -ne $task) {
  # Both would race for port 7788: one binds, the other dies, and which one
  # wins is a coin toss on every boot.
  Write-Output "BOTH an NSSM service and a scheduled task exist - they will fight for 7788."
  $fail += 'both an NSSM service and a scheduled task are installed; remove one'
}

if ($null -ne $svc) {
  Write-Output "mechanism         : NSSM service ($svcName)"
  Write-Output ("status            : " + $svc.Status)
  Write-Output ("start type        : " + $svc.StartType)
  if ($svc.Status -ne 'Running')      { $fail += "service is $($svc.Status), not Running" }
  if ($svc.StartType -ne 'Automatic') { $fail += "start type is $($svc.StartType), not Automatic" }

  Write-Output ""
  Write-Output "=== NSSM CONFIG ==="
  if ($null -ne $nssm -and (Test-Path $nssm)) {
    foreach ($k in 'Application','AppParameters','AppDirectory','AppStdout','AppKillProcessTree','Start') {
      # nssm emits UTF-16; strip embedded nulls so the value prints on one line.
      $v = (((& $nssm get $svcName $k 2>&1) -join ' ') -replace "`0", '').Trim()
      Write-Output ("{0,-19}: {1}" -f $k, $v)
      if ($k -eq 'AppKillProcessTree' -and $v -ne '1') {
        # tsx re-execs node, so the tree is nssm -> node (tsx) -> node (listener).
        # Without this, stopping the service orphans the listener and port 7788
        # stays bound, which looks exactly like a start failure on next boot.
        $fail += 'AppKillProcessTree is not 1 (stop would orphan the listener)'
      }
    }
  } else {
    Write-Output "nssm.exe NOT FOUND at: $nssm"; $fail += 'nssm.exe missing from its installed path'
  }
}

if ($null -ne $task) {
  Write-Output "mechanism         : scheduled task ($taskName)"
  Write-Output ("state             : " + $task.State)
  $principal = $task.Principal
  $action    = $task.Actions | Select-Object -First 1
  $trigger   = $task.Triggers | Select-Object -First 1
  Write-Output ("run as            : " + $principal.UserId + " (" + $principal.RunLevel + ")")
  Write-Output ("runs              : " + $action.Execute + " " + $action.Arguments)
  Write-Output ("trigger           : " + ($trigger.CimClass.CimClassName -replace '^MSFT_Task', ''))

  # Disabled is the failure that hides: the task exists, looks configured, and
  # simply never fires.
  if ($task.State -eq 'Disabled') { $fail += 'scheduled task is Disabled' }

  # SYSTEM + boot trigger is the whole point: a kiosk must come back after a
  # power cut with nobody logged in. A task tied to a user account waits for
  # that user to log in, which on exam morning means it never starts.
  if ($principal.UserId -notmatch 'SYSTEM') {
    $fail += "task runs as $($principal.UserId), not SYSTEM (waits for that user to log in)"
  }
  if ($trigger.CimClass.CimClassName -notmatch 'Boot') {
    $fail += "task trigger is $($trigger.CimClass.CimClassName), not at-startup"
  }

  $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -ne $info) {
    Write-Output ("last run          : " + $info.LastRunTime + "  result 0x" + ('{0:X}' -f $info.LastTaskResult))
    # 0 = ok, 0x41301 = currently running. Anything else ran and failed.
    if ($info.LastTaskResult -ne 0 -and $info.LastTaskResult -ne 267009) {
      $fail += ("task last result was 0x{0:X}, not success" -f $info.LastTaskResult)
    }
  }
}

Write-Output ""
Write-Output "=== PROCESS TREE (port 7788) ==="
$listenStart = $null
$conn = Get-NetTCPConnection -LocalPort 7788 -State Listen -ErrorAction SilentlyContinue
if ($null -eq $conn) {
  Write-Output "NOTHING LISTENING ON 7788"; $fail += 'nothing listening on 7788'
} else {
  $seen = @{}
  foreach ($c in $conn) {
    $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess) -ErrorAction SilentlyContinue
    if ($null -ne $p -and $null -eq $listenStart) { $listenStart = $p.CreationDate }
    while ($null -ne $p -and -not $seen.ContainsKey([int]$p.ProcessId)) {
      $seen[[int]$p.ProcessId] = $true
      $sess = (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue).SessionId
      Write-Output ("pid {0,-6} {1,-12} session {2}  started {3}  (+{4}s after boot)" -f `
        $p.ProcessId, $p.Name, $sess, $p.CreationDate.ToString('HH:mm:ss'),
        [int]($p.CreationDate - $boot).TotalSeconds)
      if ($null -ne $sess -and $sess -ne 0) {
        # Session 0 is the service session. Anything else means it was launched
        # from somebody's desktop and dies with their logoff.
        $fail += "pid $($p.ProcessId) runs in session $sess, not 0 (started from a desktop)"
      }
      $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.ParentProcessId) -ErrorAction SilentlyContinue
    }
  }
}

Write-Output ""
Write-Output "=== HEALTH ==="
$sw = [Diagnostics.Stopwatch]::StartNew()
try {
  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:7788/health' -TimeoutSec 10
  Write-Output ("responded in {0} ms: ok={1} device={2} scanBin={3} nbis={4} busy={5}" -f `
    $sw.ElapsedMilliseconds, $r.ok, $r.device, $r.scanBin, $r.nbis, $r.busy)
  if (-not $r.ok)     { $fail += 'health ok=false (a binary is missing - check scanBin/nbis)' }
  if (-not $r.device) { $fail += 'health device=false (scanner not detected)' }
} catch {
  Write-Output ("HEALTH FAILED after {0} ms: {1}" -f $sw.ElapsedMilliseconds, $_.Exception.Message)
  $fail += 'health endpoint did not answer'
}

Write-Output ""
Write-Output "=== VERDICT ==="
if ($null -ne $listenStart) {
  $delay = [int]($listenStart - $boot).TotalSeconds
  Write-Output ("bridge listener started {0}s after boot (uptime now {1}s)" -f $delay, $uptime)
  if ($delay -le 180) {
    Write-Output "  -> automatic boot start, no human intervention"
  } else {
    $fail += "listener started ${delay}s after boot - not a boot start (started by hand, or restarted since)"
  }
}
if ($fail.Count -eq 0 -and $inconclusive) {
  # Everything checkable passed, but the one thing this script exists to prove
  # could not be read. Saying PASS here would be the same class of lie as a
  # health check that cannot fail.
  Write-Output "INCONCLUSIVE - everything visible from here is healthy, but the"
  Write-Output "autostart mechanism could not be read. Re-run elevated."
  exit 2
} elseif ($fail.Count -eq 0) {
  $how = if ($null -ne $svc) { 'NSSM service' } else { 'scheduled task' }
  Write-Output "PASS - auto-started at boot by the $how, session 0, /health all true"
  exit 0
} else {
  Write-Output "FAIL:"
  $fail | ForEach-Object { Write-Output ("  - " + $_) }
  exit 1
}
