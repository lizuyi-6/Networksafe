# Runner for IntelliJ IDEA command-line inspector against the project inspection profile.
# Usage: powershell -File scripts/dev/run-idea-inspect.ps1 [scope-dir]
# Example: powershell -File scripts/dev/run-idea-inspect.ps1 backend\src
$ErrorActionPreference = 'Stop'

# Resolve project root from this script's location (scripts/dev -> repo root).
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$project   = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$profile   = Join-Path $project '.idea\inspectionProfiles\Project_Default.xml'
$out       = Join-Path $project '.idea-inspect-results'
$scope     = if ($args.Count -ge 1) { (Resolve-Path $args[0]).Path } else { $null }

# Discover the IntelliJ IDEA install (Toolbox first, then local Programs).
function Find-IdeaInstall {
  $candidates = @()
  Get-ChildItem "$env:LOCALAPPDATA\JetBrains\Toolbox\apps\IDEA*\ch-0\*" -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { $candidates += $_.FullName }
  $candidates += "$env:LOCALAPPDATA\Programs\IntelliJ IDEA"
  foreach ($c in $candidates) {
    $bat = Join-Path $c 'bin\inspect.bat'
    if (Test-Path $bat) { return $c }
  }
  return $null
}
$idea = Find-IdeaInstall
if (-not $idea) { Write-Error "IntelliJ IDEA install not found (looked in Toolbox apps and $env:LOCALAPPDATA\Programs)"; exit 2 }
$inspect = Join-Path $idea 'bin\inspect.bat'

# Isolate config/system paths so the headless inspector does not collide with a
# currently-running IntelliJ GUI (which holds a single-instance lock).
$isoHome = Join-Path $env:TEMP 'idea-inspect-home'
Remove-Item $isoHome -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $isoHome -Force | Out-Null
$plugins = Join-Path $idea 'plugins'

if (-not (Test-Path $inspect)) { Write-Error "inspect.bat not found at $inspect"; exit 2 }
if (Test-Path $out) { [System.IO.Directory]::Delete($out, $true) }
[System.IO.Directory]::CreateDirectory($out) | Out-Null

Write-Host "Running IntelliJ inspector: $inspect"
if ($scope) { Write-Host "  scope = $scope" }
& $inspect $project $profile $out -v2 $(if ($scope) { @('-d', $scope) } else { @() }) "-Didea.config.path=$isoHome\config" "-Didea.system.path=$isoHome\system" "-Didea.plugins.path=$plugins" "-Didea.home.path=$idea"
$code = $LASTEXITCODE
Write-Host "INSPECT_EXIT=$code"

Write-Host "---- result files ----"
Get-ChildItem -Recurse $out -File -ErrorAction SilentlyContinue | Select-Object FullName, Length

exit $code
