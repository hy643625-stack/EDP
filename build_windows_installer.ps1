$ErrorActionPreference = "Stop"

$ROOT_DIR = $PSScriptRoot
$INSTALLER_SCRIPT = Join-Path $ROOT_DIR "packaging\windows\EveryDayPerfect.iss"
$INSTALLER_OUTPUT_DIR = Join-Path $ROOT_DIR "dist\installer"
$DESKTOP_DIST_DIR = Join-Path $ROOT_DIR "dist\EveryDayPerfect"
$ISCC_CANDIDATES = @(
  $env:ISCC_PATH,
  (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
  (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
) | Where-Object { $_ }

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

function Find-Iscc {
  foreach ($candidate in $ISCC_CANDIDATES) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  $command = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  throw "Inno Setup compiler not found. Install Inno Setup 6 or set ISCC_PATH to ISCC.exe."
}

function Assert-CleanDesktopDist {
  param([string]$DesktopDistDir)

  if (-not (Test-Path $DesktopDistDir)) {
    throw "Desktop dist directory not found: $DesktopDistDir"
  }

  $sensitivePatterns = @("*.db", "*.sqlite", "*.sqlite3", "*.log", "ai-settings.json", "task.db")
  $hits = @()
  foreach ($pattern in $sensitivePatterns) {
    $hits += Get-ChildItem -Path $DesktopDistDir -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue
  }

  $hits += Get-ChildItem -Path (Join-Path $DesktopDistDir "logs") -Recurse -File -ErrorAction SilentlyContinue

  $unique = $hits | Sort-Object FullName -Unique
  if ($unique.Count -gt 0) {
    Write-Host "[error] Sensitive/test data detected in desktop dist:"
    $unique | ForEach-Object { Write-Host " - $($_.FullName)" }
    throw "Release build blocked: remove test/user data from dist before packaging."
  }
}

$iscc = Find-Iscc
Write-Host "[installer] Using Inno Setup compiler: $iscc"

if (-not (Test-Path $INSTALLER_SCRIPT)) {
  throw "Installer script not found: $INSTALLER_SCRIPT"
}

if (-not (Test-Path $INSTALLER_OUTPUT_DIR)) {
  New-Item -ItemType Directory -Force -Path $INSTALLER_OUTPUT_DIR | Out-Null
}

Write-Host "[desktop] Building packaged desktop app first..."
& (Join-Path $ROOT_DIR "build_windows_desktop.ps1")

Write-Host "[installer] Verifying desktop dist is clean (no test/user data)..."
Assert-CleanDesktopDist -DesktopDistDir $DESKTOP_DIST_DIR

Write-Host "[installer] Building Windows installer..."
Invoke-NativeCommand -FailureMessage "Inno Setup installer build failed" -Command {
  & $iscc /Qp $INSTALLER_SCRIPT
}

Write-Host "[ok] Installer build completed"
Write-Host "      Output: $INSTALLER_OUTPUT_DIR"
