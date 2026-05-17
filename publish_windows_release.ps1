$ErrorActionPreference = "Stop"

$ROOT_DIR = $PSScriptRoot
$WORKSPACE_ROOT = Split-Path (Split-Path $ROOT_DIR -Parent) -Parent
$VENV_PYTHON = Join-Path $ROOT_DIR ".venv\Scripts\python.exe"
$INSTALLER_BUILD_SCRIPT = Join-Path $ROOT_DIR "build_windows_installer.ps1"
$INSTALLER_OUTPUT_DIR = Join-Path $ROOT_DIR "dist\installer"
$USER_SOFTWARE_ROOT = Join-Path $WORKSPACE_ROOT "02-user-software"
$SEND_ROOT = Join-Path $WORKSPACE_ROOT "03-send-package"
$TEMPLATE_PATH = Join-Path $ROOT_DIR "packaging\windows\user_release_note_template.txt"
$releaseManifestTarget = $null
$sendManifestPath = $null

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

if (-not (Test-Path $VENV_PYTHON)) {
  throw "Python virtual environment not found: $VENV_PYTHON"
}

$version = (& $VENV_PYTHON -c "from app_metadata import APP_METADATA; print(APP_METADATA.version)").Trim()
if (-not $version) {
  throw "Failed to resolve app version from app_metadata.py"
}

$releaseName = "EveryDayPerfect-$version"
$installerName = "EveryDayPerfect-Setup-$version.exe"
$userReleaseDir = Join-Path $USER_SOFTWARE_ROOT $releaseName
$sendZipPath = Join-Path $SEND_ROOT "$releaseName-delivery.zip"
$sendManifestPath = Join-Path $SEND_ROOT "$releaseName-manifest.json"
$installerSource = Join-Path $INSTALLER_OUTPUT_DIR $installerName
$readmeTarget = Join-Path $userReleaseDir "README-user.txt"
$installerTarget = Join-Path $userReleaseDir $installerName
$releaseManifestTarget = Join-Path $userReleaseDir "release-manifest.json"

Write-Host "[release] Building installer..."
Invoke-NativeCommand -FailureMessage "Installer build failed" -Command {
  powershell -ExecutionPolicy Bypass -File $INSTALLER_BUILD_SCRIPT
}

if (-not (Test-Path $installerSource)) {
  throw "Expected installer not found: $installerSource"
}

New-Item -ItemType Directory -Force -Path $USER_SOFTWARE_ROOT | Out-Null
New-Item -ItemType Directory -Force -Path $SEND_ROOT | Out-Null
if (Test-Path $userReleaseDir) {
  Get-ChildItem -LiteralPath $userReleaseDir -Force | Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $userReleaseDir | Out-Null

Copy-Item -LiteralPath $installerSource -Destination $installerTarget -Force

$template = Get-Content $TEMPLATE_PATH -Raw -Encoding UTF8
$template.Replace("{VERSION}", $version) | Set-Content -LiteralPath $readmeTarget -Encoding UTF8

if (Test-Path $sendZipPath) {
  Remove-Item -LiteralPath $sendZipPath -Force
}
Compress-Archive -Path $userReleaseDir -DestinationPath $sendZipPath

$installerHash = (Get-FileHash -LiteralPath $installerTarget -Algorithm SHA256).Hash
$zipHash = (Get-FileHash -LiteralPath $sendZipPath -Algorithm SHA256).Hash
$installerInfo = Get-Item -LiteralPath $installerTarget
$zipInfo = Get-Item -LiteralPath $sendZipPath

$manifest = [ordered]@{
  product = "EveryDayPerfect"
  version = $version
  generated_at = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  source_root = $ROOT_DIR
  user_release_dir = $userReleaseDir
  installer = [ordered]@{
    name = $installerInfo.Name
    path = $installerInfo.FullName
    size_bytes = $installerInfo.Length
    sha256 = $installerHash
  }
  send_package = [ordered]@{
    name = $zipInfo.Name
    path = $zipInfo.FullName
    size_bytes = $zipInfo.Length
    sha256 = $zipHash
  }
}

$manifestJson = $manifest | ConvertTo-Json -Depth 4
$manifestJson | Set-Content -LiteralPath $releaseManifestTarget -Encoding UTF8
$manifestJson | Set-Content -LiteralPath $sendManifestPath -Encoding UTF8

Write-Host "[ok] User release exported"
Write-Host "      User folder: $userReleaseDir"
Write-Host "      Send zip:    $sendZipPath"
Write-Host "      Manifest:    $sendManifestPath"
