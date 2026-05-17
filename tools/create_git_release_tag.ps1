param(
  [string]$Version = "",
  [switch]$Push
)

$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$APP_METADATA_PATH = Join-Path $ROOT_DIR "app_metadata.py"
$GIT_EXE = $null

function Resolve-GitExe {
  $command = Get-Command git -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  $candidates = @(
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
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & $GIT_EXE @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git command failed: git $($Arguments -join ' ')"
  }
}

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

  $existingTagRaw = & $GIT_EXE tag --list $tagName
  $existingTag = if ($null -eq $existingTagRaw) { "" } else { "$existingTagRaw".Trim() }
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to list tags."
  }
  if ($existingTag) {
    throw "Tag already exists: $tagName"
  }

  Write-Host "[git] Creating annotated tag $tagName..."
  Invoke-Git -Arguments @("tag", "-a", $tagName, "-m", "Release $tagName")

  if ($Push) {
    & $GIT_EXE remote get-url origin *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "Remote origin is not configured. Configure it before using -Push."
    }

    Write-Host "[git] Pushing tag to origin..."
    Invoke-Git -Arguments @("push", "origin", $tagName)
  }

  Write-Host "[ok] Release tag created: $tagName"
} finally {
  Pop-Location
}
