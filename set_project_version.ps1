param(
  [string]$Version,
  [ValidateSet("major", "minor", "patch")]
  [string]$Part
)

$ErrorActionPreference = "Stop"

$ROOT_DIR = $PSScriptRoot
$APP_METADATA_PATH = Join-Path $ROOT_DIR "app_metadata.py"

if ([string]::IsNullOrWhiteSpace($Version) -and [string]::IsNullOrWhiteSpace($Part)) {
  throw "Use -Version x.y.z or -Part major|minor|patch."
}

if (-not [string]::IsNullOrWhiteSpace($Version) -and -not [string]::IsNullOrWhiteSpace($Part)) {
  throw "Use either -Version or -Part, not both."
}

if (-not (Test-Path -LiteralPath $APP_METADATA_PATH)) {
  throw "app_metadata.py not found: $APP_METADATA_PATH"
}

function Parse-Version {
  param([string]$Value)

  if ($Value -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid version format: $Value. Expected x.y.z"
  }

  return [int[]]($Value.Split("."))
}

function Format-Version {
  param([int[]]$Parts)
  return "$($Parts[0]).$($Parts[1]).$($Parts[2])"
}

$content = Get-Content -LiteralPath $APP_METADATA_PATH -Raw
$match = [regex]::Match($content, 'version="(?<version>\d+\.\d+\.\d+)"')
if (-not $match.Success) {
  throw "Could not find version field in app_metadata.py"
}

$currentVersion = $match.Groups["version"].Value
$newVersion = $null

if (-not [string]::IsNullOrWhiteSpace($Version)) {
  [void](Parse-Version -Value $Version)
  $newVersion = $Version
} else {
  $parts = Parse-Version -Value $currentVersion
  switch ($Part) {
    "major" {
      $parts[0] += 1
      $parts[1] = 0
      $parts[2] = 0
    }
    "minor" {
      $parts[1] += 1
      $parts[2] = 0
    }
    "patch" {
      $parts[2] += 1
    }
  }
  $newVersion = Format-Version -Parts $parts
}

if ($newVersion -eq $currentVersion) {
  Write-Host "[info] Version unchanged: $currentVersion"
  exit 0
}

$updatedContent = [regex]::Replace(
  $content,
  'version="\d+\.\d+\.\d+"',
  ('version="{0}"' -f $newVersion),
  1
)

Set-Content -LiteralPath $APP_METADATA_PATH -Value $updatedContent -Encoding UTF8

Write-Host "[ok] Project version updated"
Write-Host "     Old: $currentVersion"
Write-Host "     New: $newVersion"
Write-Host "     File: $APP_METADATA_PATH"
