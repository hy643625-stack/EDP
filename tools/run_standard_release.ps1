param(
  [string]$Version = "",
  [ValidateSet("major", "minor", "patch")]
  [string]$Part = "",
  [switch]$Commit,
  [switch]$Tag,
  [switch]$Push
)

$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$APP_METADATA_PATH = Join-Path $ROOT_DIR "app_metadata.py"
$VERSION_SCRIPT = Join-Path $ROOT_DIR "set_project_version.ps1"
$PUBLISH_SCRIPT = Join-Path $ROOT_DIR "publish_windows_release.ps1"
$TAG_SCRIPT = Join-Path $ROOT_DIR "tools\create_git_release_tag.ps1"
$CHANGELOG_PATH = Join-Path $ROOT_DIR "CHANGELOG.md"
$GIT_EXE = $null

function Resolve-GitExe {
  $command = Get-Command git -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  $candidates = @(
    "D:\Git\bin\git.exe",
    "C:\Program Files\Git\cmd\git.exe",
    "C:\Program Files\Git\bin\git.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "Git is not installed or not available in PATH."
}

function Invoke-Git {
  param([string[]]$Arguments)

  & $GIT_EXE @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git command failed: git $($Arguments -join ' ')"
  }
}

function Get-ProjectVersion {
  $content = Get-Content -LiteralPath $APP_METADATA_PATH -Raw
  $match = [regex]::Match($content, 'version="(?<version>\d+\.\d+\.\d+)"')
  if (-not $match.Success) {
    throw "Could not resolve version from app_metadata.py"
  }
  return $match.Groups["version"].Value
}

function Assert-CleanWorkingTree {
  $status = & $GIT_EXE status --short
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

$GIT_EXE = Resolve-GitExe

Push-Location $ROOT_DIR
try {
  if (-not (Test-Path (Join-Path $ROOT_DIR ".git"))) {
    throw "Current directory is not a git repository: $ROOT_DIR"
  }

  Assert-CleanWorkingTree

  Write-Host "[release] Updating project version..."
  if ($Version) {
    powershell -ExecutionPolicy Bypass -File $VERSION_SCRIPT -Version $Version
  } else {
    powershell -ExecutionPolicy Bypass -File $VERSION_SCRIPT -Part $Part
  }

  $newVersion = Get-ProjectVersion
  Write-Host "[release] Target version: $newVersion"

  Assert-ChangelogContainsVersion -CurrentVersion $newVersion

  Write-Host "[release] Building user release package..."
  powershell -ExecutionPolicy Bypass -File $PUBLISH_SCRIPT

  if ($Commit) {
    Write-Host "[release] Creating git commit..."
    Invoke-Git -Arguments @("add", ".")
    Invoke-Git -Arguments @("commit", "-m", "release: v$newVersion")
  }

  if ($Tag) {
    Write-Host "[release] Creating git tag..."
    powershell -ExecutionPolicy Bypass -File $TAG_SCRIPT -Version $newVersion
  }

  if ($Push) {
    Write-Host "[release] Pushing branch..."
    Invoke-Git -Arguments @("push", "origin", "main")
    if ($Tag) {
      Write-Host "[release] Pushing tag..."
      Invoke-Git -Arguments @("push", "origin", "v$newVersion")
    }
  }

  Write-Host "[ok] Standard release flow completed"
  Write-Host "      Version: $newVersion"
} finally {
  Pop-Location
}
