param(
    [string]$OutputDir = "$PSScriptRoot\exports",
    [switch]$IncludeAssembly,
    [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"

$packageRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $packageRoot "..\..\..")
$scadSource = Join-Path $repoRoot "hardware\enclosure.scad"
$openScad = Get-Command openscad -ErrorAction SilentlyContinue

if (-not $openScad) {
    $fallback = "C:\Program Files\OpenSCAD\openscad.exe"
    if (Test-Path $fallback) {
        $openScadPath = (Resolve-Path $fallback).Path
    } else {
        throw "openscad was not found in PATH"
    }
} else {
    $openScadPath = $openScad.Source
    if ([System.IO.Path]::GetFileName($openScadPath) -ieq "openscad.com") {
        $exeCandidate = Join-Path ([System.IO.Path]::GetDirectoryName($openScadPath)) "openscad.exe"
        if (Test-Path $exeCandidate) {
            $openScadPath = (Resolve-Path $exeCandidate).Path
        }
    }
}

if (-not (Test-Path $scadSource)) {
    throw "OpenSCAD source not found: $scadSource"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$parts = @(
    @{ Name = "LOWER_CHASSIS"; File = "lower-chassis.stl" },
    @{ Name = "UPPER_BEZEL"; File = "upper-bezel.stl" },
    @{ Name = "SERVICE_DOOR"; File = "service-door.stl" },
    @{ Name = "LENS"; File = "lens.stl" },
    @{ Name = "BUTTON_CAPS"; File = "button-caps.stl" },
    @{ Name = "PLATE"; File = "inspection-plate.stl" }
)

if ($IncludeAssembly) {
    $parts += @{ Name = "ASSEMBLY"; File = "assembly.stl" }
}

$outputs = @()

foreach ($part in $parts) {
    $outFile = Join-Path $OutputDir $part.File
    $wrapperFile = Join-Path $OutputDir ("__render_" + $part.Name.ToLowerInvariant() + ".scad")
    $scadInclude = ($scadSource -replace "\\", "/")
    @(
        "part_to_render_override = `"$($part.Name)`";",
        "include <$scadInclude>;"
    ) | Set-Content -Encoding ASCII $wrapperFile
    $process = Start-Process -FilePath $openScadPath -ArgumentList @("-o", $outFile, $wrapperFile) -WindowStyle Hidden -PassThru -Wait:$false
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $process.Id } | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "OpenSCAD export timed out after $TimeoutSeconds seconds for $($part.Name)"
    }
    if ($process.ExitCode -ne 0) {
        throw "OpenSCAD export failed for $($part.Name) with exit code $($process.ExitCode)"
    }
    Remove-Item -LiteralPath $wrapperFile -Force
    $outputs += [ordered]@{
        part = $part.Name
        file = "mechanical/exports/$($part.File)"
        bytes = (Get-Item $outFile).Length
    }
}

$manifest = [ordered]@{
    status = "exported"
    package = "aetherguard-serial-deployer-ev1"
    source = "../../enclosure.scad"
    openscad = (& $openScadPath --version 2>&1 | Out-String).Trim()
    generatedAt = (Get-Date).ToString("o")
    outputs = $outputs
}

$manifestPath = Join-Path $OutputDir "mechanical-export-manifest.json"
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $manifestPath

Write-Host "Mechanical exports written to $OutputDir"
