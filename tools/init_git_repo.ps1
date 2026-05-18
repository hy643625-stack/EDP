param(
  [string]$RemoteUrl = "",
  [switch]$InitialCommit,
  [switch]$ForceRemoteUpdate
)

$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$GIT_COMMON_PATH = Join-Path $PSScriptRoot "git_common.ps1"
$GIT_EXE = $null

if (-not (Test-Path $GIT_COMMON_PATH)) {
  throw "Missing helper script: $GIT_COMMON_PATH"
}

. $GIT_COMMON_PATH

function Test-GitAvailable {
  try {
    $null = Resolve-GitExe
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-GitAvailable)) {
  throw "Git is not installed or not available in PATH."
}

$GIT_EXE = Resolve-GitExe

Push-Location $ROOT_DIR
try {
  if (-not (Test-Path (Join-Path $ROOT_DIR ".git"))) {
    Write-Host "[git] Initializing repository..."
    Invoke-Git -GitExe $GIT_EXE -Arguments @("init")
  } else {
    Write-Host "[git] Existing repository detected."
  }

  Ensure-GitSafeDirectory -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR

  Write-Host "[git] Setting default branch to main..."
  Invoke-Git -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR -Arguments @("branch", "-M", "main")

  if ($RemoteUrl) {
    & $GIT_EXE -C $ROOT_DIR remote get-url origin 1>$null 2>$null
    $hasOrigin = ($LASTEXITCODE -eq 0)

    if ($hasOrigin) {
      if (-not $ForceRemoteUpdate) {
        throw "Remote origin already exists. Re-run with -ForceRemoteUpdate to replace it."
      }
      Write-Host "[git] Updating remote origin..."
      Invoke-Git -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR -Arguments @("remote", "set-url", "origin", $RemoteUrl)
    } else {
      Write-Host "[git] Adding remote origin..."
      Invoke-Git -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR -Arguments @("remote", "add", "origin", $RemoteUrl)
    }
  }

  if ($InitialCommit) {
    Write-Host "[git] Staging files..."
    Invoke-Git -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR -Arguments @("add", ".")

    $hasHead = Test-Path (Join-Path $ROOT_DIR ".git\refs\heads\main")
    $commitMessage = if ($hasHead) { "chore: sync repository state" } else { "chore: initialize repository" }

    Write-Host "[git] Creating commit..."
    Invoke-Git -GitExe $GIT_EXE -RepositoryPath $ROOT_DIR -Arguments @("commit", "-m", $commitMessage)
  }

  Write-Host ""
  Write-Host "[ok] Git repository is ready."
  Write-Host "Repository root: $ROOT_DIR"
  Write-Host ""
  Write-Host "Next recommended commands:"
  Write-Host "  git status"
  if ($RemoteUrl) {
    Write-Host "  git push -u origin main"
  }
} finally {
  Pop-Location
}
