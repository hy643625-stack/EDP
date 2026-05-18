param(
  [string]$Version = "",
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$PYTHON_EXE = Join-Path $ROOT_DIR ".venv\Scripts\python.exe"
$PYTHON_SCRIPT = Join-Path $PSScriptRoot "export_release_notes.py"

if (-not (Test-Path $PYTHON_SCRIPT)) {
  throw "Missing Python helper script: $PYTHON_SCRIPT"
}

if (-not (Test-Path $PYTHON_EXE)) {
  throw "Python virtual environment not found: $PYTHON_EXE"
}

$arguments = @($PYTHON_SCRIPT)
if ($Version) {
  $arguments += @("--version", $Version)
}
if ($OutputPath) {
  $arguments += @("--output", $OutputPath)
}

& $PYTHON_EXE @arguments
if ($LASTEXITCODE -ne 0) {
  throw "Release notes export failed."
}
