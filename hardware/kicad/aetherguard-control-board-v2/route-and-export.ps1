# AetherGuard Control Board v2 — Auto-Routing Workflow
#
# This script orchestrates the full routing pipeline:
#   1. Export DSN from KiCad PCB Editor (manual step)
#   2. Run FreeRouting headless
#   3. Import SES back (manual step)
#   4. Add zones + DRC (manual step)
#   5. Export Gerbers
#
# Prerequisites:
#   - KiCad 9.0.7 installed
#   - FreeRouting 2.1.0 (already in repo)
#   - DSN file exported from KiCad (see Step 1)

$ErrorActionPreference = "Stop"

$ProjectDir = "X:\repos\Networksafe\hardware\kicad\aetherguard-control-board-v2"
$PcbFile    = "$ProjectDir\aetherguard-control-board-v2.kicad_pcb"
$DsnFile    = "$ProjectDir\aetherguard-control-board-v2.dsn"
$SesFile    = "$ProjectDir\aetherguard-control-board-v2.ses"
$FreeRoute  = "X:\repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\tools\freerouting\app\freerouting\freerouting.exe"
$KicadCli   = "C:\Program Files\KiCad\9.0\bin\kicad-cli.exe"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " AetherGuard Control Board v2 - Auto-Routing Pipeline" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Check DSN file ---
Write-Host "[Step 1] Checking for DSN file..." -ForegroundColor Yellow

if (-not (Test-Path $DsnFile)) {
    Write-Host ""
    Write-Host "  DSN file not found. You need to export it from KiCad first:" -ForegroundColor Red
    Write-Host ""
    Write-Host "  1. Open: $PcbFile" -ForegroundColor White
    Write-Host "  2. Menu: File -> Export -> Specctra DSN..." -ForegroundColor White
    Write-Host "  3. Save as: $DsnFile" -ForegroundColor White
    Write-Host ""
    Write-Host "  Then re-run this script." -ForegroundColor Red
    Write-Host ""
    exit 1
}

$dsnSize = (Get-Item $DsnFile).Length
Write-Host "  DSN found: $DsnFile ($dsnSize bytes)" -ForegroundColor Green
Write-Host ""

# --- Step 2: Run FreeRouting ---
Write-Host "[Step 2] Running FreeRouting (this may take 5-30 minutes)..." -ForegroundColor Yellow
Write-Host "  Input:  $DsnFile" -ForegroundColor Gray
Write-Host "  Output: $SesFile" -ForegroundColor Gray
Write-Host ""

if (-not (Test-Path $FreeRoute)) {
    Write-Host "  ERROR: FreeRouting not found at $FreeRoute" -ForegroundColor Red
    exit 1
}

# Remove old SES if exists
if (Test-Path $SesFile) {
    Remove-Item $SesFile -Force
}

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

# FreeRouting 2.1.0 CLI:
#   -de <file>  : input design file (DSN)
#   -do <file>  : output session file (SES)
#   -mp <n>     : max passes (200 is generous for a 90x60mm 4-layer board)
#   -da         : disable analytics/update check (avoids SSL errors)
$frArgs = @(
    "-de", $DsnFile,
    "-do", $SesFile,
    "-mp", "200",
    "-da"
)

Write-Host "  Starting FreeRouting..." -ForegroundColor Cyan
Write-Host "  Command: freerouting.exe -de ... -do ... -mp 200 -da" -ForegroundColor Gray
Write-Host ""

$frProcess = Start-Process -FilePath $FreeRoute -ArgumentList $frArgs `
    -WorkingDirectory $ProjectDir `
    -RedirectStandardOutput "$ProjectDir\freerouting-stdout.log" `
    -RedirectStandardError "$ProjectDir\freerouting-stderr.log" `
    -PassThru -NoNewWindow

# Wait with timeout (30 minutes)
$timeout = 1800
$completed = $frProcess.WaitForExit($timeout * 1000)

$stopwatch.Stop()
$elapsed = $stopwatch.Elapsed.TotalSeconds

if (-not $completed) {
    Write-Host "  TIMEOUT after $($timeout)s. Killing FreeRouting..." -ForegroundColor Red
    $frProcess.Kill()
    exit 2
}

Write-Host "  FreeRouting finished in $([math]::Round($elapsed, 1))s (exit code: $($frProcess.ExitCode))" -ForegroundColor Green

# Check if SES was generated
if (Test-Path $SesFile) {
    $sesSize = (Get-Item $SesFile).Length
    Write-Host "  SES output: $SesFile ($sesSize bytes)" -ForegroundColor Green
} else {
    Write-Host "  WARNING: No SES file generated. Check freerouting-stdout.log" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Last 10 lines of log:" -ForegroundColor Gray
    Get-Content "$ProjectDir\freerouting-stdout.log" -Tail 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
    exit 3
}

Write-Host ""

# --- Step 3: Import SES ---
Write-Host "[Step 3] Import SES back into KiCad (MANUAL)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1. Open: $PcbFile" -ForegroundColor White
Write-Host "  2. Menu: File -> Import -> Specctra Session..." -ForegroundColor White
Write-Host "  3. Select: $SesFile" -ForegroundColor White
Write-Host "  4. Save the board (Ctrl+S)" -ForegroundColor White
Write-Host ""

# --- Step 4: Add Zones ---
Write-Host "[Step 4] Add copper zones (MANUAL)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  After importing SES:" -ForegroundColor White
Write-Host "  1. Select layer: In1.Cu" -ForegroundColor White
Write-Host "  2. Add Filled Zone -> Net: GND -> Draw rectangle covering entire board" -ForegroundColor White
Write-Host "  3. Select layer: In2.Cu" -ForegroundColor White
Write-Host "  4. Add Filled Zone -> Net: +3V3 -> Draw rectangle (right 2/3 of board)" -ForegroundColor White
Write-Host "  5. Add Filled Zone -> Net: +5V -> Draw rectangle (left 1/3 of board)" -ForegroundColor White
Write-Host "  6. Edit -> Fill All Zones (B)" -ForegroundColor White
Write-Host ""

# --- Step 5: Export Gerbers ---
Write-Host "[Step 5] Export Gerbers (run after zones are filled)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Run: python $ProjectDir\export_proto_release.py" -ForegroundColor White
Write-Host "  Or manually: File -> Fabrication Outputs -> Gerbers" -ForegroundColor White
Write-Host ""

# --- Summary ---
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Routing log: $ProjectDir\freerouting-stdout.log" -ForegroundColor Gray
Write-Host " Error log:   $ProjectDir\freerouting-stderr.log" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " NEXT: Complete Steps 3-5 in KiCad GUI, then run DRC." -ForegroundColor Green
Write-Host ""
