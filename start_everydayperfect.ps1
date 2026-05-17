$ErrorActionPreference = "Stop"

$ROOT_DIR = $PSScriptRoot
$BACKEND_DIR = Join-Path $ROOT_DIR "backend"
$FRONTEND_DIR = Join-Path $ROOT_DIR "frontend"
$RUN_DIR = Join-Path $ROOT_DIR ".run"
$LOG_DIR = Join-Path $RUN_DIR "logs"
$PID_FILE = Join-Path $RUN_DIR "pids.env"
$BACKEND_PID_FILE = Join-Path $RUN_DIR "backend.pid"
$FRONTEND_PID_FILE = Join-Path $RUN_DIR "frontend.pid"
$BACKEND_LOG_FILE = Join-Path $LOG_DIR "backend.log"
$BACKEND_ERROR_LOG_FILE = Join-Path $LOG_DIR "backend.error.log"
$FRONTEND_LOG_FILE = Join-Path $LOG_DIR "frontend.log"
$FRONTEND_ERROR_LOG_FILE = Join-Path $LOG_DIR "frontend.error.log"

$DEFAULT_BACKEND_PORT = if ($env:BACKEND_PORT) { [int]$env:BACKEND_PORT } else { 18765 }
$DEFAULT_FRONTEND_PORT = if ($env:FRONTEND_PORT) { [int]$env:FRONTEND_PORT } else { 5173 }
$NO_OPEN_BROWSER = if ($env:NO_OPEN_BROWSER) { $env:NO_OPEN_BROWSER } else { "0" }

New-Item -ItemType Directory -Force -Path $RUN_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name"
  }
}

function Get-NodeVersionInfo {
  $version = (& node -v).Trim()
  if (-not $version) {
    throw "Unable to detect Node.js version"
  }

  $normalized = if ($version.StartsWith("v")) { $version.Substring(1) } else { $version }
  $major = [int](($normalized -split "\.")[0])

  return [PSCustomObject]@{
    Version = $version
    Major = $major
  }
}

function Write-NodeRecommendation {
  param([PSCustomObject]$NodeInfo)

  if ($NodeInfo.Major -ne 20) {
    Write-Host "[warn] Node $($NodeInfo.Version) detected. Windows flow is validated most on Node 20 LTS."
  } else {
    Write-Host "[info] Node $($NodeInfo.Version) detected."
  }
}

function Test-PortInUse {
  param([int]$Port)

  $listener = [System.Net.Sockets.TcpClient]::new()
  try {
    $result = $listener.BeginConnect("127.0.0.1", $Port, $null, $null)
    $completed = $result.AsyncWaitHandle.WaitOne(250)
    if (-not $completed) {
      return $false
    }

    $listener.EndConnect($result)
    return $true
  } catch {
    return $false
  } finally {
    $listener.Dispose()
  }
}

function Find-AvailablePort {
  param([int]$StartPort, [int]$MaxTries = 20)

  for ($i = 0; $i -le $MaxTries; $i++) {
    $candidate = $StartPort + $i
    if (-not (Test-PortInUse -Port $candidate)) {
      return $candidate
    }
  }

  throw "No available port found near $StartPort"
}

function Test-HttpReady {
  param([string]$Url, [int]$Retries = 60)

  for ($i = 0; $i -lt $Retries; $i++) {
    try {
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1 | Out-Null
      return $true
    } catch {
      Start-Sleep -Seconds 1
    }
  }

  return $false
}

function Get-PreferredDbPath {
  if ($env:TASK_DB_PATH) {
    return $env:TASK_DB_PATH
  }

  $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
  $preferredDir = Join-Path $localAppData "EveryDayPerfect"
  $preferred = Join-Path $preferredDir "task.db"

  try {
    New-Item -ItemType Directory -Force -Path $preferredDir | Out-Null
    if (-not (Test-Path $preferred)) {
      New-Item -ItemType File -Force -Path $preferred | Out-Null
    }
    return $preferred
  } catch {
    $fallback = Join-Path $RUN_DIR "task-win.db"
    New-Item -ItemType Directory -Force -Path $RUN_DIR | Out-Null
    if (-not (Test-Path $fallback)) {
      New-Item -ItemType File -Force -Path $fallback | Out-Null
    }
    Write-Host "[warn] Failed to use LocalAppData database path. Falling back to $fallback"
    return $fallback
  }
}

function Reset-LogFile {
  param([string]$Path)

  if (Test-Path $Path) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  }
}

function Read-LogText {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return ""
  }

  return Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
}

function Get-BackendFailureHint {
  $combined = @(
    Read-LogText -Path $BACKEND_ERROR_LOG_FILE
    Read-LogText -Path $BACKEND_LOG_FILE
  ) -join "`n"

  if ($combined -match "readonly database") {
    return "SQLite path is not writable. Set TASK_DB_PATH to a writable file such as $env:LOCALAPPDATA\EveryDayPerfect\task.db and retry."
  }

  if ($combined -match "No module named 'fastapi'" -or $combined -match "No module named 'uvicorn'") {
    return "Backend dependencies are missing. Reinstall them with .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt."
  }

  return ""
}

function Get-FrontendFailureHint {
  $combined = @(
    Read-LogText -Path $FRONTEND_ERROR_LOG_FILE
    Read-LogText -Path $FRONTEND_LOG_FILE
  ) -join "`n"

  if ($combined -match "spawn EPERM" -or $combined -match "esbuild") {
    $esbuildPath = Join-Path $FRONTEND_DIR "node_modules\@esbuild\win32-x64\esbuild.exe"
    return "Windows likely blocked esbuild. Use Node 20 LTS, allow $esbuildPath in Windows Security or Controlled Folder Access, or retry in an elevated PowerShell window."
  }

  if ($combined -match "not recognized" -or $combined -match "not an internal or external command") {
    return "Frontend dependencies look incomplete. Run cd frontend, then npm.cmd install, and retry."
  }

  if ($combined -match "Cannot find module" -or $combined -match "MODULE_NOT_FOUND") {
    return "A frontend dependency is missing. Reinstall frontend dependencies with npm.cmd install."
  }

  return ""
}

function Stop-StaleProcess {
  param([string]$PidFile)

  if (-not (Test-Path $PidFile)) {
    return
  }

  $pidValue = Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $pidValue) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    return
  }

  try {
    $process = Get-Process -Id ([int]$pidValue) -ErrorAction Stop
    Stop-Process -Id $process.Id -Force -ErrorAction Stop
  } catch {
  }

  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Assert-NodeModulesReady {
  $viteCmd = Join-Path $FRONTEND_DIR "node_modules\.bin\vite.cmd"
  $viteJs = Join-Path $FRONTEND_DIR "node_modules\vite\bin\vite.js"
  $esbuildExe = Join-Path $FRONTEND_DIR "node_modules\@esbuild\win32-x64\esbuild.exe"

  if ((Test-Path $viteCmd) -and (Test-Path $viteJs) -and (Test-Path $esbuildExe)) {
    return
  }

  Write-Host "[setup] Installing frontend dependencies..."
  Push-Location $FRONTEND_DIR
  try {
    & npm.cmd install
  } finally {
    Pop-Location
  }

  if ((-not (Test-Path $viteCmd)) -or (-not (Test-Path $viteJs)) -or (-not (Test-Path $esbuildExe))) {
    throw "Frontend dependencies are incomplete. Missing Vite or esbuild runtime files."
  }
}

function Assert-EsbuildRuntimeReady {
  param([string]$NodeExe, [string]$CheckScript)

  Write-Host "[check] Verifying frontend esbuild runtime..."
  Push-Location $FRONTEND_DIR
  try {
    & $NodeExe $CheckScript
    if ($LASTEXITCODE -ne 0) {
      throw "esbuild runtime preflight failed"
    }
  } finally {
    Pop-Location
  }
}

Require-Command -Name "python"
Require-Command -Name "node"
Require-Command -Name "npm.cmd"

$NODE_EXE = (Get-Command node -ErrorAction Stop).Source
$NODE_INFO = Get-NodeVersionInfo
Write-NodeRecommendation -NodeInfo $NODE_INFO

$PY_EXE = Join-Path $ROOT_DIR ".venv\Scripts\python.exe"
$VITE_JS = Join-Path $FRONTEND_DIR "node_modules\vite\bin\vite.js"
$ESBUILD_CHECK_SCRIPT = Join-Path $FRONTEND_DIR "scripts\check-esbuild-runtime.mjs"

if (-not (Test-Path $PY_EXE)) {
  Write-Host "[setup] Creating Python virtual environment..."
  & python -m venv (Join-Path $ROOT_DIR ".venv")
}

try {
  & $PY_EXE -c "import fastapi, uvicorn" | Out-Null
} catch {
  Write-Host "[setup] Installing backend dependencies..."
  & $PY_EXE -m pip install -r (Join-Path $BACKEND_DIR "requirements.txt")
}

Assert-NodeModulesReady
Assert-EsbuildRuntimeReady -NodeExe $NODE_EXE -CheckScript $ESBUILD_CHECK_SCRIPT

$TASK_DB_PATH_ACTUAL = Get-PreferredDbPath
$backendPort = $DEFAULT_BACKEND_PORT
$frontendPort = $DEFAULT_FRONTEND_PORT

$backendLocalUrl = "http://127.0.0.1:$backendPort"
if (Test-PortInUse -Port $backendPort) {
  if (Test-HttpReady -Url "$backendLocalUrl/health" -Retries 1) {
    Write-Host "[backend] Reusing running backend: $backendLocalUrl"
  } else {
    Stop-StaleProcess -PidFile $BACKEND_PID_FILE
    $backendPort = Find-AvailablePort -StartPort $backendPort
    $backendLocalUrl = "http://127.0.0.1:$backendPort"
    Write-Host "[backend] Default port busy. Switching to $backendPort"
  }
}

$frontendLocalUrl = "http://127.0.0.1:$frontendPort"
if (Test-PortInUse -Port $frontendPort) {
  if (Test-HttpReady -Url $frontendLocalUrl -Retries 1) {
    Write-Host "[frontend] Reusing running frontend: $frontendLocalUrl"
  } else {
    Stop-StaleProcess -PidFile $FRONTEND_PID_FILE
    $frontendPort = Find-AvailablePort -StartPort $frontendPort
    $frontendLocalUrl = "http://127.0.0.1:$frontendPort"
    Write-Host "[frontend] Default port busy. Switching to $frontendPort"
  }
}

$corsOriginsEffective = if ($env:CORS_ORIGINS) {
  $env:CORS_ORIGINS
} else {
  @("http://127.0.0.1:$frontendPort", "http://localhost:$frontendPort") -join ","
}

$backendReuseExisting = Test-HttpReady -Url "$backendLocalUrl/health" -Retries 1
if (-not $backendReuseExisting) {
  Write-Host "[backend] Starting..."
  Reset-LogFile -Path $BACKEND_LOG_FILE
  Reset-LogFile -Path $BACKEND_ERROR_LOG_FILE

  $env:TASK_DB_PATH = $TASK_DB_PATH_ACTUAL
  $env:CORS_ORIGINS = $corsOriginsEffective
  $backendProc = Start-Process `
    -FilePath $PY_EXE `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--app-dir", $BACKEND_DIR, "--host", "127.0.0.1", "--port", $backendPort) `
    -WorkingDirectory $ROOT_DIR `
    -PassThru `
    -RedirectStandardOutput $BACKEND_LOG_FILE `
    -RedirectStandardError $BACKEND_ERROR_LOG_FILE
  $backendProc.Id | Out-File -FilePath $BACKEND_PID_FILE -Encoding ascii -Force
}

Write-Host "[wait] Waiting for backend..."
if (-not (Test-HttpReady -Url "$backendLocalUrl/health" -Retries 60)) {
  $backendHint = Get-BackendFailureHint
  $backendSuffix = if ($backendHint) { " Hint: $backendHint" } else { "" }
  throw ("[error] Backend failed to start. Check {0} and {1}.{2}" -f $BACKEND_LOG_FILE, $BACKEND_ERROR_LOG_FILE, $backendSuffix)
}

$frontendReuseExisting = Test-HttpReady -Url $frontendLocalUrl -Retries 1
if (-not $frontendReuseExisting) {
  Write-Host "[frontend] Starting..."
  Reset-LogFile -Path $FRONTEND_LOG_FILE
  Reset-LogFile -Path $FRONTEND_ERROR_LOG_FILE

  $env:VITE_API_BASE_URL = $backendLocalUrl
  $frontendProc = Start-Process `
    -FilePath $NODE_EXE `
    -ArgumentList @($VITE_JS, "--host", "127.0.0.1", "--port", $frontendPort) `
    -WorkingDirectory $FRONTEND_DIR `
    -PassThru `
    -RedirectStandardOutput $FRONTEND_LOG_FILE `
    -RedirectStandardError $FRONTEND_ERROR_LOG_FILE
  $frontendProc.Id | Out-File -FilePath $FRONTEND_PID_FILE -Encoding ascii -Force
}

Write-Host "[wait] Waiting for frontend..."
if (-not (Test-HttpReady -Url $frontendLocalUrl -Retries 60)) {
  $frontendHint = Get-FrontendFailureHint
  $frontendSuffix = if ($frontendHint) { " Hint: $frontendHint" } else { "" }
  throw ("[error] Frontend failed to start. Check {0} and {1}.{2}" -f $FRONTEND_LOG_FILE, $FRONTEND_ERROR_LOG_FILE, $frontendSuffix)
}

@(
  "ROOT_DIR=$ROOT_DIR"
  "BACKEND_PORT=$backendPort"
  "FRONTEND_PORT=$frontendPort"
  "BACKEND_URL=$backendLocalUrl"
  "FRONTEND_URL=$frontendLocalUrl"
  "TASK_DB_PATH=$TASK_DB_PATH_ACTUAL"
  if (Test-Path $BACKEND_PID_FILE) { "BACKEND_PID=$(Get-Content $BACKEND_PID_FILE)" }
  if (Test-Path $FRONTEND_PID_FILE) { "FRONTEND_PID=$(Get-Content $FRONTEND_PID_FILE)" }
) | Set-Content -Path $PID_FILE -Encoding ascii

Write-Host "[ok] Services are ready"
Write-Host "      Frontend : $frontendLocalUrl"
Write-Host "      Backend  : $backendLocalUrl"
Write-Host "      DB Path  : $TASK_DB_PATH_ACTUAL"
Write-Host "      Logs     : $LOG_DIR"

if ($NO_OPEN_BROWSER -ne "1") {
  Start-Process $frontendLocalUrl | Out-Null
}
