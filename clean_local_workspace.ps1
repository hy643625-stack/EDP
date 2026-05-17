param(
  [switch]$Deep
)

$ErrorActionPreference = "Stop"

$ROOT_DIR = $PSScriptRoot

function Remove-PathSafe {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  try {
    Remove-Item -LiteralPath $Path -Recurse -Force
    Write-Host "[clean] Removed $Label"
  } catch {
    Write-Host "[warn] Could not remove $Label"
    Write-Host "       $Path"
    Write-Host "       $($_.Exception.Message)"
  }
}

function Remove-FilePatternSafe {
  param(
    [string]$Directory,
    [string]$Filter,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $Directory)) {
    return
  }

  $items = Get-ChildItem -LiteralPath $Directory -Filter $Filter -Force -ErrorAction SilentlyContinue
  foreach ($item in $items) {
    try {
      Remove-Item -LiteralPath $item.FullName -Force
      Write-Host "[clean] Removed ${Label}: $($item.Name)"
    } catch {
      Write-Host "[warn] Could not remove ${Label}: $($item.FullName)"
      Write-Host "       $($_.Exception.Message)"
    }
  }
}

Write-Host "[info] Cleaning local workspace outputs..."

$safeTargets = @(
  @{ Path = (Join-Path $ROOT_DIR "build"); Label = "build output" },
  @{ Path = (Join-Path $ROOT_DIR "dist"); Label = "desktop package output" },
  @{ Path = (Join-Path $ROOT_DIR "frontend\dist"); Label = "frontend build output" },
  @{ Path = (Join-Path $ROOT_DIR "__pycache__"); Label = "root Python cache" },
  @{ Path = (Join-Path $ROOT_DIR "backend\.pytest_cache"); Label = "pytest cache" },
  @{ Path = (Join-Path $ROOT_DIR ".run\logs"); Label = "runtime logs" },
  @{ Path = (Join-Path $ROOT_DIR "packaging\windows\EveryDayPerfect.ico"); Label = "generated app icon" },
  @{ Path = (Join-Path $ROOT_DIR "packaging\windows\version_info.txt"); Label = "generated version info" },
  @{ Path = (Join-Path $ROOT_DIR "packaging\windows\app_metadata.iss"); Label = "generated installer metadata" }
)

foreach ($target in $safeTargets) {
  Remove-PathSafe -Path $target.Path -Label $target.Label
}

Remove-FilePatternSafe -Directory (Join-Path $ROOT_DIR "frontend") -Filter "*.tsbuildinfo" -Label "TypeScript build info"

$runDir = Join-Path $ROOT_DIR ".run"
if (Test-Path -LiteralPath $runDir) {
  Remove-FilePatternSafe -Directory $runDir -Filter "*.pid" -Label "runtime PID file"
  Remove-FilePatternSafe -Directory $runDir -Filter "*.log" -Label "runtime log file"

  $remaining = Get-ChildItem -LiteralPath $runDir -Force -ErrorAction SilentlyContinue
  if ($remaining.Count -eq 0) {
    Remove-PathSafe -Path $runDir -Label ".run folder"
  } else {
    Write-Host "[info] .run still contains files that were left in place:"
    $remaining | Select-Object Name | Format-Table -AutoSize
  }
}

if ($Deep) {
  Write-Host "[info] Deep clean enabled"
  Remove-PathSafe -Path (Join-Path $ROOT_DIR "frontend\node_modules") -Label "frontend dependencies"
}

Write-Host "[ok] Local cleanup finished"
