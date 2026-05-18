param(
  [string]$Version = "",
  [switch]$Push
)

$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$GIT_COMMON_PATH = Join-Path $PSScriptRoot "git_common.ps1"
$APP_METADATA_PATH = Join-Path $ROOT_DIR "app_metadata.py"
$GIT_EXE = $null

if (-not (Test-Path $GIT_COMMON_PATH)) {
  throw "Missing helper script: $GIT_COMMON_PATH"
}

. $GIT_COMMON_PATH

$GIT_EXE = Resolve-GitExe

if (-not (Test-Path $APP_METADATA_PATH)) {
  throw "app_metadata.py not found: $APP_METADATA_PATH"
}

if (-not $Version) {
  $content = Get-Content -LiteralPath $APP_METADATA_PATH -Raw
  $match = [regex]::Match($content, 'version="(?<version>\d+\.\d+\.\d+)"')
  if (-not $match.Success) {
    throw "Could not resolve version from app_metadata.py"
  }
  $Version = $match.Groups["version"].Value
}

$tagName = "v$Version"

Push-Location $ROOT_DIR
try {
  if (-not (Test-Path (Join-Path $ROOT_DIR ".git"))) {
    throw "This directory is not a git repository: $ROOT_DIR"
  }

  Ensure-GitSafeDirectory -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR

  $existingTagRaw = & $GIT_EXE -C $ROOT_DIR tag --list $tagName
  $existingTag = if ($null -eq $existingTagRaw) { "" } else { "$existingTagRaw".Trim() }
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to list tags."
  }
  if ($existingTag) {
    throw "Tag already exists: $tagName"
  }

  Write-Host "[git] Creating annotated tag $tagName..."
  Invoke-Git -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR -Arguments @("tag", "-a", $tagName, "-m", "Release $tagName")

  if ($Push) {
    & $GIT_EXE -C $ROOT_DIR remote get-url origin *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "Remote origin is not configured. Configure it before using -Push."
    }

    Write-Host "[git] Pushing tag to origin..."
    Invoke-Git -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR -Arguments @("push", "origin", $tagName)
  }

  Write-Host "[ok] Release tag created: $tagName"
} finally {
  Pop-Location
}
