param(
  [string]$RemoteUrl = "",
  [switch]$InitialCommit,
  [switch]$ForceRemoteUpdate
)

$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
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
    Invoke-Git -Arguments @("init")
  } else {
    Write-Host "[git] Existing repository detected."
  }

  Write-Host "[git] Setting default branch to main..."
  Invoke-Git -Arguments @("branch", "-M", "main")

  if ($RemoteUrl) {
    & $GIT_EXE remote get-url origin 1>$null 2>$null
    $hasOrigin = ($LASTEXITCODE -eq 0)

    if ($hasOrigin) {
      if (-not $ForceRemoteUpdate) {
        throw "Remote origin already exists. Re-run with -ForceRemoteUpdate to replace it."
      }
      Write-Host "[git] Updating remote origin..."
      Invoke-Git -Arguments @("remote", "set-url", "origin", $RemoteUrl)
    } else {
      Write-Host "[git] Adding remote origin..."
      Invoke-Git -Arguments @("remote", "add", "origin", $RemoteUrl)
    }
  }

  if ($InitialCommit) {
    Write-Host "[git] Staging files..."
    Invoke-Git -Arguments @("add", ".")

    $hasHead = Test-Path (Join-Path $ROOT_DIR ".git\refs\heads\main")
    $commitMessage = if ($hasHead) { "chore: sync repository state" } else { "chore: initialize repository" }

    Write-Host "[git] Creating commit..."
    Invoke-Git -Arguments @("commit", "-m", $commitMessage)
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
