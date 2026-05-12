param(
    [switch]$CreateArchive,
    [switch]$RequireReady
)

$ErrorActionPreference = "Stop"

$packageRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $packageRoot "..\..\..")
$pcbRoot = Join-Path $repoRoot "hardware\kicad\esp32-serial-deployer-pcb"
$pcbProject = Join-Path $pcbRoot "esp32-serial-deployer-pcb.kicad_pro"
$pcbBoard = Join-Path $pcbRoot "esp32-serial-deployer-pcb.kicad_pcb"
$pcbSch = Join-Path $pcbRoot "esp32-serial-deployer-pcb.kicad_sch"
$exportRoot = Join-Path $packageRoot "pcb\exports"
$reportRoot = Join-Path $exportRoot "reports"
$readinessPath = Join-Path $packageRoot "readiness-report.json"
$bomSource = Join-Path $packageRoot "pcb\bom-ev1.csv"

New-Item -ItemType Directory -Force -Path $exportRoot, $reportRoot | Out-Null

$gates = New-Object System.Collections.Generic.List[object]
$metrics = [ordered]@{}

function Add-Gate {
    param(
        [string]$Name,
        [string]$Status,
        [string]$Detail
    )
    $script:gates.Add([ordered]@{
        name = $Name
        status = $Status
        detail = $Detail
    }) | Out-Null
}

function Resolve-Tool {
    param(
        [string]$CommandName,
        [string[]]$FallbackPaths
    )

    $cmd = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    foreach ($candidate in $FallbackPaths) {
        if (Test-Path $candidate) {
            return (Resolve-Path $candidate).Path
        }
    }

    return $null
}

function Invoke-Tool {
    param(
        [string]$Name,
        [string]$Exe,
        [string[]]$ToolArgs,
        [switch]$Optional
    )

    try {
        $safeName = ($Name -replace '[^A-Za-z0-9_.-]', '-')
        $logPath = Join-Path $reportRoot "$safeName.log"
        & $Exe @ToolArgs *> $logPath
        if ($LASTEXITCODE -eq 0) {
            Add-Gate $Name "pass" "exit code 0"
            return $true
        }
        $status = if ($Optional) { "blocked" } else { "fail" }
        Add-Gate $Name $status "exit code $LASTEXITCODE; see pcb/exports/reports/$safeName.log"
        return $false
    } catch {
        $status = if ($Optional) { "blocked" } else { "fail" }
        Add-Gate $Name $status $_.Exception.Message
        return $false
    }
}

function Read-JsonFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        return $null
    }
    return Get-Content -Raw -Encoding UTF8 $Path | ConvertFrom-Json
}

function Count-JsonArray {
    param($Value)
    if ($null -eq $Value) {
        return 0
    }
    return @($Value).Count
}

function Count-Severity {
    param(
        $Violations,
        [string]$Severity
    )
    return @($Violations | Where-Object { $_.severity -eq $Severity }).Count
}

function Add-JsonGate {
    param(
        [string]$Name,
        [string]$Path,
        [string]$Kind
    )

    $json = Read-JsonFile $Path
    if ($null -eq $json) {
        Add-Gate $Name "fail" "report missing: $Path"
        return $false
    }

    if ($Kind -eq "erc") {
        $violations = Count-JsonArray $json.violations
        $script:metrics.ercViolations = $violations
        if ($violations -eq 0) {
            Add-Gate $Name "pass" "0 ERC violations"
            return $true
        }
        Add-Gate $Name "fail" "$violations ERC violations"
        return $false
    }

    if ($Kind -eq "drc") {
        $violations = Count-JsonArray $json.violations
        $errors = Count-Severity $json.violations "error"
        $warnings = Count-Severity $json.violations "warning"
        $unconnected = Count-JsonArray $json.unconnected_items
        $script:metrics.drcViolations = $violations
        $script:metrics.drcErrors = $errors
        $script:metrics.drcWarnings = $warnings
        $script:metrics.unconnectedItems = $unconnected
        if ($violations -eq 0 -and $unconnected -eq 0) {
            Add-Gate $Name "pass" "0 DRC violations, 0 unconnected items"
            return $true
        }
        Add-Gate $Name "fail" "$errors errors, $warnings warnings, $unconnected unconnected items"
        return $false
    }

    if ($Kind -eq "parity") {
        $issues = Count-JsonArray $json.schematic_parity
        $script:metrics.schematicParityIssues = $issues
        if ($issues -eq 0) {
            Add-Gate $Name "pass" "0 schematic parity issues"
            return $true
        }
        Add-Gate $Name "fail" "$issues schematic parity issues"
        return $false
    }

    throw "Unknown JSON gate kind: $Kind"
}

function Count-Regex {
    param(
        [string]$Path,
        [string]$Pattern
    )
    if (-not (Test-Path $Path)) {
        return 0
    }
    $text = Get-Content -Raw -Encoding UTF8 $Path
    return ([regex]::Matches($text, $Pattern)).Count
}

$kicad = Resolve-Tool "kicad-cli" @(
    "C:\Program Files\KiCad\9.0\bin\kicad-cli.exe",
    "C:\Program Files\KiCad\8.0\bin\kicad-cli.exe"
)
$openscad = Resolve-Tool "openscad" @(
    "C:\Program Files\OpenSCAD\openscad.exe"
)

if ($openscad -and ([System.IO.Path]::GetFileName($openscad) -ieq "openscad.com")) {
    $exeCandidate = Join-Path ([System.IO.Path]::GetDirectoryName($openscad)) "openscad.exe"
    if (Test-Path $exeCandidate) {
        $openscad = (Resolve-Path $exeCandidate).Path
    }
}

if ($kicad) {
    Add-Gate "kicad-cli" "pass" $kicad
} else {
    Add-Gate "kicad-cli" "blocked" "kicad-cli not found in PATH or known KiCad install paths"
}

if ($openscad) {
    $version = (& $openscad --version 2>&1 | Out-String).Trim()
    Add-Gate "openscad" "pass" $version
} else {
    Add-Gate "openscad" "blocked" "openscad not found in PATH or known install paths"
}

$sourceChecks = @(
    @{ Path = $pcbProject; Relative = "../../kicad/esp32-serial-deployer-pcb/esp32-serial-deployer-pcb.kicad_pro" },
    @{ Path = $pcbBoard; Relative = "../../kicad/esp32-serial-deployer-pcb/esp32-serial-deployer-pcb.kicad_pcb" },
    @{ Path = $pcbSch; Relative = "../../kicad/esp32-serial-deployer-pcb/esp32-serial-deployer-pcb.kicad_sch" }
)

foreach ($sourceCheck in $sourceChecks) {
    $requiredPath = $sourceCheck.Path
    if (Test-Path $requiredPath) {
        Add-Gate "source:$([System.IO.Path]::GetFileName($requiredPath))" "pass" $sourceCheck.Relative
    } else {
        Add-Gate "source:$([System.IO.Path]::GetFileName($requiredPath))" "fail" "missing: $($sourceCheck.Relative)"
    }
}

$kiCadChecksPassed = $false

if ($kicad) {
    $ercJson = Join-Path $reportRoot "erc.json"
    $drcJson = Join-Path $reportRoot "drc.json"
    $parityJson = Join-Path $reportRoot "schematic-parity.json"
    $netlistPath = Join-Path $exportRoot "netlist.kicadsexpr"
    $bomXmlPath = Join-Path $exportRoot "bom.xml"
    $schematicPdf = Join-Path $exportRoot "schematic.pdf"
    $layoutTopSvg = Join-Path $exportRoot "pcb-layout-top.svg"
    $layoutBottomSvg = Join-Path $exportRoot "pcb-layout-bottom.svg"
    $assemblyTopSvg = Join-Path $exportRoot "assembly-top.svg"
    $assemblyBottomSvg = Join-Path $exportRoot "assembly-bottom.svg"
    $bomExportPath = Join-Path $exportRoot "bom-ev1.csv"

    Invoke-Tool "export:netlist" $kicad @("sch", "export", "netlist", "--format", "kicadsexpr", "--output", $netlistPath, $pcbSch) | Out-Null
    Invoke-Tool "export:bom-xml" $kicad @("sch", "export", "python-bom", "--output", $bomXmlPath, $pcbSch) | Out-Null
    Invoke-Tool "export:schematic-pdf" $kicad @("sch", "export", "pdf", "--output", $schematicPdf, $pcbSch) -Optional | Out-Null
    Invoke-Tool "export:pcb-layout-top-svg" $kicad @("pcb", "export", "svg", "--output", $layoutTopSvg, "--layers", "F.Cu,F.Mask,F.SilkS,Edge.Cuts", "--page-size-mode", "2", "--exclude-drawing-sheet", "--mode-single", $pcbBoard) -Optional | Out-Null
    Invoke-Tool "export:pcb-layout-bottom-svg" $kicad @("pcb", "export", "svg", "--output", $layoutBottomSvg, "--layers", "B.Cu,B.Mask,B.SilkS,Edge.Cuts", "--mirror", "--page-size-mode", "2", "--exclude-drawing-sheet", "--mode-single", $pcbBoard) -Optional | Out-Null
    Invoke-Tool "export:assembly-top-svg" $kicad @("pcb", "export", "svg", "--output", $assemblyTopSvg, "--layers", "F.Fab,F.SilkS,F.CrtYd,Edge.Cuts", "--page-size-mode", "2", "--exclude-drawing-sheet", "--mode-single", "--sketch-pads-on-fab-layers", $pcbBoard) -Optional | Out-Null
    Invoke-Tool "export:assembly-bottom-svg" $kicad @("pcb", "export", "svg", "--output", $assemblyBottomSvg, "--layers", "B.Fab,B.SilkS,B.CrtYd,Edge.Cuts", "--mirror", "--page-size-mode", "2", "--exclude-drawing-sheet", "--mode-single", "--sketch-pads-on-fab-layers", $pcbBoard) -Optional | Out-Null

    if (Test-Path $bomSource) {
        Copy-Item -Force -LiteralPath $bomSource -Destination $bomExportPath
        Add-Gate "export:bom-csv" "pass" "copied pcb/bom-ev1.csv"
    } else {
        Add-Gate "export:bom-csv" "fail" "missing pcb/bom-ev1.csv"
    }

    Invoke-Tool "report:erc-json" $kicad @("sch", "erc", "--format", "json", "--output", $ercJson, $pcbSch) | Out-Null
    Invoke-Tool "report:drc-json" $kicad @("pcb", "drc", "--format", "json", "--output", $drcJson, $pcbBoard) | Out-Null
    Invoke-Tool "report:schematic-parity-json" $kicad @("pcb", "drc", "--schematic-parity", "--format", "json", "--output", $parityJson, $pcbBoard) | Out-Null

    $components = Count-Regex $netlistPath '\(comp \(ref "'
    $nets = Count-Regex $netlistPath '\(net \(code "'
    $bomComponents = Count-Regex $bomXmlPath '<comp ref='
    $metrics.netlistComponents = $components
    $metrics.netlistNets = $nets
    $metrics.bomComponents = $bomComponents

    if ($components -gt 0 -and $nets -gt 0) {
        Add-Gate "netlist-non-empty" "pass" "$components components, $nets nets"
    } else {
        Add-Gate "netlist-non-empty" "fail" "$components components, $nets nets"
    }

    if ($bomComponents -gt 0) {
        Add-Gate "bom-non-empty" "pass" "$bomComponents BOM components"
    } else {
        Add-Gate "bom-non-empty" "fail" "$bomComponents BOM components"
    }

    $ercOk = Add-JsonGate "erc" $ercJson "erc"
    $drcOk = Add-JsonGate "drc" $drcJson "drc"
    $parityOk = Add-JsonGate "schematic-parity" $parityJson "parity"
    $kiCadChecksPassed = $ercOk -and $drcOk -and $parityOk -and ($components -gt 0) -and ($nets -gt 0) -and ($bomComponents -gt 0)

    if ($kiCadChecksPassed) {
        $gerberDir = Join-Path $exportRoot "gerber"
        $drillDir = Join-Path $exportRoot "drill"
        $positionPath = Join-Path $exportRoot "position.csv"
        New-Item -ItemType Directory -Force -Path $gerberDir, $drillDir | Out-Null

        Invoke-Tool "export:gerber" $kicad @("pcb", "export", "gerbers", "--output", $gerberDir, $pcbBoard) | Out-Null
        Invoke-Tool "export:drill" $kicad @("pcb", "export", "drill", "--output", $drillDir, $pcbBoard) | Out-Null
        Invoke-Tool "export:position" $kicad @("pcb", "export", "pos", "--output", $positionPath, "--format", "csv", "--units", "mm", "--side", "both", $pcbBoard) | Out-Null
    } else {
        Add-Gate "manufacturing-export" "blocked" "Gerber, drill, and position exports blocked until ERC, DRC, schematic parity, netlist, and BOM gates pass"
    }
} else {
    Add-Gate "export:netlist" "blocked" "kicad-cli unavailable"
    Add-Gate "export:bom-xml" "blocked" "kicad-cli unavailable"
    Add-Gate "erc" "blocked" "kicad-cli unavailable"
    Add-Gate "drc" "blocked" "kicad-cli unavailable"
    Add-Gate "schematic-parity" "blocked" "kicad-cli unavailable"
    Add-Gate "manufacturing-export" "blocked" "kicad-cli unavailable"
}

if ($openscad) {
    $mechanicalManifest = Join-Path $packageRoot "mechanical\exports\mechanical-export-manifest.json"
    if (Test-Path $mechanicalManifest) {
        Add-Gate "mechanical-export" "pass" "existing OpenSCAD STL manifest found"
    } else {
        try {
            & (Join-Path $packageRoot "mechanical\export-mechanical.ps1") -TimeoutSeconds 240
            if ($LASTEXITCODE -eq 0) {
                Add-Gate "mechanical-export" "pass" "OpenSCAD STL outputs generated"
            } else {
                Add-Gate "mechanical-export" "fail" "OpenSCAD script returned $LASTEXITCODE"
            }
        } catch {
            Add-Gate "mechanical-export" "fail" $_.Exception.Message
        }
    }
} else {
    Add-Gate "mechanical-export" "blocked" "openscad unavailable"
}

$failedOrBlocked = @($gates | Where-Object { $_.status -ne "pass" })
$status = if ($failedOrBlocked.Count -eq 0) { "pcb-prototype-order-ready" } else { "factory-draft" }

$readiness = [ordered]@{
    package = "aetherguard-serial-deployer-ev1"
    status = $status
    generatedAt = (Get-Date).ToString("o")
    pcbSource = "../../kicad/esp32-serial-deployer-pcb/esp32-serial-deployer-pcb.kicad_pro"
    mechanicalSource = "../../enclosure.scad"
    metrics = $metrics
    manufacturingExportsGated = -not $kiCadChecksPassed
    gates = $gates
}

$readiness | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $readinessPath

if ($RequireReady -and $status -ne "pcb-prototype-order-ready") {
    throw "Package is not PCB prototype order ready. See $readinessPath"
}

if ($CreateArchive) {
    $archivePath = Join-Path $packageRoot "..\aetherguard-serial-deployer-ev1-factory-draft.zip"
    if (Test-Path $archivePath) {
        Remove-Item -LiteralPath $archivePath
    }
    Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $archivePath
    Write-Host "Archive written to $archivePath"
}

Write-Host "Readiness report written to $readinessPath"
Write-Host "Package status: $status"
