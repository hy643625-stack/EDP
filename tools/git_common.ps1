function Resolve-GitExe {
  $command = Get-Command git -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  $candidates = @(
    "D:\Git\bin\git.exe",
    "D:\Git\cmd\git.exe",
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

function Get-NormalizedPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (Test-Path $Path) {
    return (Resolve-Path -LiteralPath $Path).Path
  }

  return [System.IO.Path]::GetFullPath($Path)
}

function Ensure-GitSafeDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$GitExe,
    [Parameter(Mandatory = $true)]
    [string]$RepositoryPath
  )

  $repoPath = Get-NormalizedPath -Path $RepositoryPath
  $existingRaw = & $GitExe config --global --get-all safe.directory 2>$null
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -and $exitCode -ne 1) {
    throw "Failed to read global git safe.directory configuration."
  }

  $existingValues = @()
  if ($null -ne $existingRaw -and "$existingRaw".Trim()) {
    if ($existingRaw -is [System.Array]) {
      $existingValues = $existingRaw
    } else {
      $existingValues = @("$existingRaw")
    }
  }

  foreach ($value in $existingValues) {
    if ($value.Trim().ToLowerInvariant() -eq $repoPath.ToLowerInvariant()) {
      return
    }
  }

  & $GitExe config --global --add safe.directory $repoPath
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to add git safe.directory for $repoPath"
  }

  Write-Host "[git] Added safe.directory: $repoPath"
}

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)]
    [string]$GitExe,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [string]$RepositoryPath = ""
  )

  if ($RepositoryPath) {
    Ensure-GitSafeDirectory -GitExe $GitExe -RepositoryPath $RepositoryPath
  }

  & $GitExe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git command failed: git $($Arguments -join ' ')"
  }
}
