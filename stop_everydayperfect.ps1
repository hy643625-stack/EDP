$ErrorActionPreference = "Stop"

$ROOT_DIR = $PSScriptRoot
$RUN_DIR = Join-Path $ROOT_DIR ".run"
$PID_FILE = Join-Path $RUN_DIR "pids.env"
$BACKEND_PID_FILE = Join-Path $RUN_DIR "backend.pid"
$FRONTEND_PID_FILE = Join-Path $RUN_DIR "frontend.pid"

function Stop-PidFile {
  param([string]$File, [string]$Name)
  if (-not (Test-Path $File)) { return }
  $targetPid = (Get-Content $File -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($targetPid -and ($targetPid -as [int])) {
    try {
      Stop-Process -Id ([int]$targetPid) -Force -ErrorAction Stop
      Write-Host "[$Name] stopped pid=$targetPid"
    } catch {
      # ignore stale pid
    }
  }
  Remove-Item -Force $File -ErrorAction SilentlyContinue
}

Stop-PidFile -File $BACKEND_PID_FILE -Name "backend"
Stop-PidFile -File $FRONTEND_PID_FILE -Name "frontend"

if (Test-Path $PID_FILE) {
  Remove-Item -Force $PID_FILE -ErrorAction SilentlyContinue
}

Write-Host "[ok] stop completed"
