$ErrorActionPreference = "Stop"

$ROOT_DIR = $PSScriptRoot
$FRONTEND_DIR = Join-Path $ROOT_DIR "frontend"
$BACKEND_DIR = Join-Path $ROOT_DIR "backend"
$WINDOWS_PACKAGING_DIR = Join-Path $ROOT_DIR "packaging\windows"
$VENV_PYTHON = Join-Path $ROOT_DIR ".venv\Scripts\python.exe"
$SPEC_FILE = Join-Path $ROOT_DIR "packaging\windows\EveryDayPerfect.spec"
$DIST_DIR = Join-Path $ROOT_DIR "dist"
$BUILD_DIR = Join-Path $ROOT_DIR "build"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name"
  }
}

function Invoke-NativeCommand {
  param(
    [string]$FailureMessage,
    [scriptblock]$Command
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit code $LASTEXITCODE)"
  }
}

Require-Command -Name "python"
Require-Command -Name "node"
Require-Command -Name "npm.cmd"

if (-not (Test-Path $VENV_PYTHON)) {
  Write-Host "[setup] Creating Python virtual environment..."
  Invoke-NativeCommand -FailureMessage "Failed to create Python virtual environment" -Command {
    python -m venv (Join-Path $ROOT_DIR ".venv")
  }
}

Write-Host "[setup] Installing desktop packaging dependencies..."
Invoke-NativeCommand -FailureMessage "Failed to install desktop packaging dependencies" -Command {
  & $VENV_PYTHON -m pip install -r (Join-Path $BACKEND_DIR "requirements-desktop.txt")
}

Write-Host "[assets] Generating Windows desktop assets..."
Invoke-NativeCommand -FailureMessage "Failed to generate Windows desktop assets" -Command {
  & $VENV_PYTHON (Join-Path $WINDOWS_PACKAGING_DIR "generate_windows_assets.py")
}

Write-Host "[frontend] Installing frontend dependencies if needed..."
Push-Location $FRONTEND_DIR
try {
  if (-not (Test-Path (Join-Path $FRONTEND_DIR "node_modules\vite\bin\vite.js"))) {
    Invoke-NativeCommand -FailureMessage "Failed to install frontend dependencies" -Command {
      & npm.cmd install
    }
  }

  Write-Host "[frontend] Building frontend..."
  Invoke-NativeCommand -FailureMessage "Frontend build failed" -Command {
    & npm.cmd run build
  }
} finally {
  Pop-Location
}

Write-Host "[backend] Running backend tests..."
Invoke-NativeCommand -FailureMessage "Backend tests failed" -Command {
  & $VENV_PYTHON -m pytest (Join-Path $BACKEND_DIR "tests") -q --basetemp (Join-Path $ROOT_DIR ".run\pytest-temp")
}

Write-Host "[desktop] Running frontend tests..."
Push-Location $FRONTEND_DIR
try {
  Invoke-NativeCommand -FailureMessage "Frontend tests failed" -Command {
    & npm.cmd run test
  }
} finally {
  Pop-Location
}

Write-Host "[desktop] Cleaning previous desktop build outputs..."
if (Test-Path $DIST_DIR) {
  Remove-Item -LiteralPath $DIST_DIR -Recurse -Force
}
if (Test-Path $BUILD_DIR) {
  Remove-Item -LiteralPath $BUILD_DIR -Recurse -Force
}

Write-Host "[desktop] Building Windows desktop package..."
Invoke-NativeCommand -FailureMessage "PyInstaller desktop package build failed" -Command {
  & $VENV_PYTHON -m PyInstaller $SPEC_FILE --noconfirm --clean
}

Write-Host "[ok] Desktop build completed"
Write-Host "      Output: $(Join-Path $DIST_DIR 'EveryDayPerfect')"
