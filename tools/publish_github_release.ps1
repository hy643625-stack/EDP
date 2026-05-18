param(
  [string]$Version = "",
  [switch]$MarkLatest
)

$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$WORKSPACE_ROOT = Split-Path (Split-Path $ROOT_DIR -Parent) -Parent
$APP_METADATA_PATH = Join-Path $ROOT_DIR "app_metadata.py"
$SEND_ROOT = Join-Path $WORKSPACE_ROOT "03-send-package"
$GIT_COMMON_PATH = Join-Path $PSScriptRoot "git_common.ps1"

if (-not (Test-Path $GIT_COMMON_PATH)) {
  throw "Missing helper script: $GIT_COMMON_PATH"
}

. $GIT_COMMON_PATH

function Get-ProjectVersion {
  $content = Get-Content -LiteralPath $APP_METADATA_PATH -Raw -Encoding UTF8
  $match = [regex]::Match($content, 'version="(?<version>\d+\.\d+\.\d+)"')
  if (-not $match.Success) {
    throw "Could not resolve version from app_metadata.py"
  }
  return $match.Groups["version"].Value
}

function Resolve-GitHubCli {
  $command = Get-Command gh -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  $candidates = @(
    "C:\Program Files\GitHub CLI\gh.exe",
    "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  throw "GitHub CLI (gh) is not installed. Install it first: https://cli.github.com/"
}

if (-not (Test-Path $APP_METADATA_PATH)) {
  throw "app_metadata.py not found: $APP_METADATA_PATH"
}

if (-not $Version) {
  $Version = Get-ProjectVersion
}

$releaseName = "EveryDayPerfect-$Version"
$tagName = "v$Version"
$sendZipPath = Join-Path $SEND_ROOT "$releaseName-delivery.zip"
$sendManifestPath = Join-Path $SEND_ROOT "$releaseName-manifest.json"
$releaseNotesPath = Join-Path $SEND_ROOT "$releaseName-release-notes.md"

foreach ($requiredPath in @($sendZipPath, $sendManifestPath, $releaseNotesPath)) {
  if (-not (Test-Path $requiredPath)) {
    throw "Missing release asset: $requiredPath. Run .\publish_windows_release.ps1 first."
  }
}

$gitExe = Resolve-GitExe
Ensure-GitSafeDirectory -GitExe $gitExe -RepositoryPath $ROOT_DIR
$ghExe = Resolve-GitHubCli

$tagExists = (& $gitExe -C $ROOT_DIR tag --list $tagName).Trim()
if (-not $tagExists) {
  throw "Git tag not found: $tagName. Create and push the tag before publishing a GitHub Release."
}

& $ghExe auth status *> $null
if ($LASTEXITCODE -ne 0) {
  throw "GitHub CLI is not authenticated. Run 'gh auth login' first."
}

$releaseListJson = & $ghExe release list --repo hy643625-stack/EDP --limit 100 --json tagName 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to query existing GitHub Releases."
}

$releaseList = @()
if ($releaseListJson -and "$releaseListJson".Trim()) {
  $releaseList = $releaseListJson | ConvertFrom-Json
}

$releaseExists = $false
foreach ($release in $releaseList) {
  if ($release.tagName -eq $tagName) {
    $releaseExists = $true
    break
  }
}

if ($releaseExists) {
  $editArgs = @(
    "release", "edit", $tagName,
    "--repo", "hy643625-stack/EDP",
    "--title", "EveryDayPerfect v$Version",
    "--notes-file", $releaseNotesPath
  )
  if ($MarkLatest) {
    $editArgs += "--latest"
  }

  & $ghExe @editArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to update GitHub Release: $tagName"
  }

  & $ghExe release upload $tagName $sendZipPath $sendManifestPath --clobber --repo hy643625-stack/EDP
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to upload release assets for $tagName"
  }

  Write-Host "[ok] GitHub Release updated: $tagName"
} else {
  $createArgs = @(
    "release", "create", $tagName,
    $sendZipPath,
    $sendManifestPath,
    "--repo", "hy643625-stack/EDP",
    "--title", "EveryDayPerfect v$Version",
    "--notes-file", $releaseNotesPath
  )
  if ($MarkLatest) {
    $createArgs += "--latest"
  }

  & $ghExe @createArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create GitHub Release: $tagName"
  }

  Write-Host "[ok] GitHub Release created: $tagName"
}
