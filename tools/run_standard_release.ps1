param(
  [string]$Version = "",
  [ValidateSet("major", "minor", "patch")]
  [string]$Part = "",
  [switch]$Commit,
  [switch]$Tag,
  [switch]$Push,
  [switch]$GitHubRelease
)

$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$GIT_COMMON_PATH = Join-Path $PSScriptRoot "git_common.ps1"
$APP_METADATA_PATH = Join-Path $ROOT_DIR "app_metadata.py"
$VERSION_SCRIPT = Join-Path $ROOT_DIR "set_project_version.ps1"
$PUBLISH_SCRIPT = Join-Path $ROOT_DIR "publish_windows_release.ps1"
$TAG_SCRIPT = Join-Path $ROOT_DIR "tools\create_git_release_tag.ps1"
$PUBLISH_GITHUB_RELEASE_SCRIPT = Join-Path $ROOT_DIR "tools\publish_github_release.ps1"
$CHANGELOG_PATH = Join-Path $ROOT_DIR "CHANGELOG.md"
$POWERSHELL_EXE = (Get-Command powershell.exe -ErrorAction Stop).Source
$GIT_EXE = $null

if (-not (Test-Path $GIT_COMMON_PATH)) {
  throw "Missing helper script: $GIT_COMMON_PATH"
}

. $GIT_COMMON_PATH

function Get-ProjectVersion {
  $content = Get-Content -LiteralPath $APP_METADATA_PATH -Raw
  $match = [regex]::Match($content, 'version="(?<version>\d+\.\d+\.\d+)"')
  if (-not $match.Success) {
    throw "Could not resolve version from app_metadata.py"
  }
  return $match.Groups["version"].Value
}

function Assert-CleanWorkingTree {
  $status = & $GIT_EXE -C $ROOT_DIR status --short
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to query git status."
  }
  if ($status) {
    throw "Working tree is not clean. Please commit or stash current changes before running standard release."
  }
}

function Assert-ChangelogContainsVersion {
  param([string]$CurrentVersion)

  $content = Get-Content -LiteralPath $CHANGELOG_PATH -Raw
  if ($content -notmatch "##\s+$([regex]::Escape($CurrentVersion))\s+-") {
    throw "CHANGELOG.md does not contain a section for version $CurrentVersion"
  }
}

if (-not $Version -and -not $Part) {
  throw "Use -Version x.y.z or -Part major|minor|patch."
}

if ($Version -and $Part) {
  throw "Use either -Version or -Part, not both."
}

if (($Tag -or $Push) -and -not $Commit) {
  throw "Using -Tag or -Push requires -Commit."
}

if ($GitHubRelease -and (-not $Commit -or -not $Tag -or -not $Push)) {
  throw "Using -GitHubRelease requires -Commit -Tag -Push."
}

$GIT_EXE = Resolve-GitExe

Push-Location $ROOT_DIR
try {
  if (-not (Test-Path (Join-Path $ROOT_DIR ".git"))) {
    throw "Current directory is not a git repository: $ROOT_DIR"
  }

  Ensure-GitSafeDirectory -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR
  Assert-CleanWorkingTree

  Write-Host "[release] Updating project version..."
  if ($Version) {
    & $POWERSHELL_EXE -ExecutionPolicy Bypass -File $VERSION_SCRIPT -Version $Version
  } else {
    & $POWERSHELL_EXE -ExecutionPolicy Bypass -File $VERSION_SCRIPT -Part $Part
  }

  $newVersion = Get-ProjectVersion
  Write-Host "[release] Target version: $newVersion"

  Assert-ChangelogContainsVersion -CurrentVersion $newVersion

  Write-Host "[release] Building user release package..."
  & $POWERSHELL_EXE -ExecutionPolicy Bypass -File $PUBLISH_SCRIPT

  if ($Commit) {
    Write-Host "[release] Creating git commit..."
    Invoke-Git -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR -Arguments @("add", ".")
    Invoke-Git -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR -Arguments @("commit", "-m", "release: v$newVersion")
  }

  if ($Tag) {
    Write-Host "[release] Creating git tag..."
    & $POWERSHELL_EXE -ExecutionPolicy Bypass -File $TAG_SCRIPT -Version $newVersion
  }

  if ($Push) {
    Write-Host "[release] Pushing branch..."
    Invoke-Git -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR -Arguments @("push", "origin", "main")
    if ($Tag) {
      Write-Host "[release] Pushing tag..."
      Invoke-Git -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR -Arguments @("push", "origin", "v$newVersion")
    }
  }

  if ($GitHubRelease) {
    Write-Host "[release] Publishing GitHub Release..."
    & $POWERSHELL_EXE -ExecutionPolicy Bypass -File $PUBLISH_GITHUB_RELEASE_SCRIPT -Version $newVersion -MarkLatest
  }

  Write-Host "[ok] Standard release flow completed"
  Write-Host "      Version: $newVersion"
} finally {
  Pop-Location
}
