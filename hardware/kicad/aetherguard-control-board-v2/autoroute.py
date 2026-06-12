#!/usr/bin/env python3
"""
AetherGuard Control Board v2 — Auto-routing workflow via FreeRouting.

This script:
1. Exports the PCB to Specctra DSN format using KiCad's pcbnew Python API
2. Runs FreeRouting in headless mode to auto-route
3. Imports the resulting SES (session) file back into the PCB

Prerequisites:
- KiCad 9.0.7 installed at C:\Program Files\KiCad\9.0\
- FreeRouting 2.1.0 at the path below
- Run from KiCad's Python environment or with pcbnew on sys.path

Usage:
  # Option A: Run from KiCad scripting console
  exec(open(r'hardware/kicad/aetherguard-control-board-v2/autoroute.py').read())

  # Option B: Run from command line with KiCad Python
  "C:\Program Files\KiCad\9.0\bin\python.exe" hardware/kicad/aetherguard-control-board-v2/autoroute.py

  # Option C: Manual workflow (if pcbnew import fails)
  # See MANUAL WORKFLOW section at bottom of this file
"""

import os
import sys
import subprocess
import shutil
import time
from pathlib import Path

# === Configuration ===

PROJECT_DIR = Path(__file__).parent.resolve()
PCB_FILE = PROJECT_DIR / "aetherguard-control-board-v2.kicad_pcb"
DSN_FILE = PROJECT_DIR / "aetherguard-control-board-v2.dsn"
SES_FILE = PROJECT_DIR / "aetherguard-control-board-v2.ses"
ROUTED_PCB = PROJECT_DIR / "aetherguard-control-board-v2-routed.kicad_pcb"

FREEROUTING_EXE = Path(
    r"X:\repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb"
    r"\tools\freerouting\app\freerouting\freerouting.exe"
)

KICAD_CLI = Path(r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe")

# FreeRouting parameters
FR_MAX_PASSES = 200
FR_TIMEOUT_SECONDS = 1800  # 30 minutes max


def export_dsn():
    """Export PCB to Specctra DSN format using KiCad scripting API."""
    print(f"[1/4] Exporting DSN from {PCB_FILE.name}...")

    try:
        # Try using pcbnew Python API (works inside KiCad Python env)
        sys.path.insert(0, r"C:\Program Files\KiCad\9.0\bin\Lib\site-packages")
        import pcbnew

        board = pcbnew.LoadBoard(str(PCB_FILE))
        pcbnew.ExportSpecctraDSN(board, str(DSN_FILE))
        print(f"   DSN exported: {DSN_FILE}")
        return True

    except ImportError:
        print("   pcbnew not available in this Python environment.")
        print("   Trying alternative: KiCad CLI pcb export...")

        # KiCad 9 doesn't have DSN export in CLI, so provide manual instructions
        print("")
        print("   === MANUAL DSN EXPORT REQUIRED ===")
        print(f"   1. Open {PCB_FILE} in KiCad PCB Editor")
        print(f"   2. File → Export → Specctra DSN...")
        print(f"   3. Save as: {DSN_FILE}")
        print(f"   4. Re-run this script")
        print("")

        if DSN_FILE.exists():
            print(f"   Found existing DSN file, proceeding...")
            return True
        return False


def run_freerouting():
    """Run FreeRouting in headless/batch mode on the DSN file."""
    print(f"[2/4] Running FreeRouting (max {FR_MAX_PASSES} passes, timeout {FR_TIMEOUT_SECONDS}s)...")

    if not FREEROUTING_EXE.exists():
        print(f"   ERROR: FreeRouting not found at {FREEROUTING_EXE}")
        return False

    if not DSN_FILE.exists():
        print(f"   ERROR: DSN file not found at {DSN_FILE}")
        return False

    # FreeRouting 2.1.0 CLI arguments:
    # -de <file>  : design file (DSN input)
    # -do <file>  : output file (SES output)
    # -mp <n>     : max passes
    # -mt <n>     : max threads (0 = auto)
    # -dl         : disable logging to file
    # -da         : disable analytics/update check
    cmd = [
        str(FREEROUTING_EXE),
        "-de", str(DSN_FILE),
        "-do", str(SES_FILE),
        "-mp", str(FR_MAX_PASSES),
        "-mt", "0",
        "-da",
    ]

    print(f"   Command: {' '.join(cmd[:4])}...")
    print(f"   This may take 5-30 minutes depending on board complexity.")
    print("")

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(PROJECT_DIR),
        )

        start_time = time.time()
        while proc.poll() is None:
            elapsed = time.time() - start_time
            if elapsed > FR_TIMEOUT_SECONDS:
                print(f"   TIMEOUT after {elapsed:.0f}s, terminating...")
                proc.terminate()
                proc.wait(timeout=10)
                return False

            # Print progress every 30 seconds
            time.sleep(5)
            if int(elapsed) % 30 == 0 and elapsed > 5:
                print(f"   ... routing in progress ({elapsed:.0f}s elapsed)")

        stdout = proc.stdout.read()
        stderr = proc.stderr.read()

        if proc.returncode == 0 or SES_FILE.exists():
            print(f"   FreeRouting completed (exit code {proc.returncode})")
            if SES_FILE.exists():
                print(f"   SES output: {SES_FILE} ({SES_FILE.stat().st_size} bytes)")
                return True
            else:
                print(f"   WARNING: No SES file generated")
                return False
        else:
            print(f"   FreeRouting failed (exit code {proc.returncode})")
            if stderr:
                for line in stderr.strip().split('\n')[:10]:
                    print(f"   ERR: {line}")
            return False

    except FileNotFoundError:
        print(f"   ERROR: Cannot execute {FREEROUTING_EXE}")
        return False
    except Exception as e:
        print(f"   ERROR: {e}")
        return False


def import_ses():
    """Import FreeRouting SES result back into the PCB."""
    print(f"[3/4] Importing SES routes into PCB...")

    if not SES_FILE.exists():
        print(f"   ERROR: SES file not found at {SES_FILE}")
        return False

    try:
        sys.path.insert(0, r"C:\Program Files\KiCad\9.0\bin\Lib\site-packages")
        import pcbnew

        # Make a backup
        backup = PCB_FILE.with_suffix('.kicad_pcb.pre-route-backup')
        if not backup.exists():
            shutil.copy2(PCB_FILE, backup)
            print(f"   Backup saved: {backup.name}")

        board = pcbnew.LoadBoard(str(PCB_FILE))
        pcbnew.ImportSpecctraSES(board, str(SES_FILE))
        pcbnew.SaveBoard(str(ROUTED_PCB), board)
        print(f"   Routed PCB saved: {ROUTED_PCB.name}")
        return True

    except ImportError:
        print("   pcbnew not available.")
        print("")
        print("   === MANUAL SES IMPORT REQUIRED ===")
        print(f"   1. Open {PCB_FILE} in KiCad PCB Editor")
        print(f"   2. File → Import → Specctra Session...")
        print(f"   3. Select: {SES_FILE}")
        print(f"   4. Save the board")
        print("")
        return False


def run_drc():
    """Run DRC on the routed board."""
    print(f"[4/4] Running DRC on routed board...")

    target = ROUTED_PCB if ROUTED_PCB.exists() else PCB_FILE
    drc_report = PROJECT_DIR / "release" / "drc-routed.rpt"

    cmd = [
        str(KICAD_CLI),
        "pcb", "drc",
        str(target),
        "--output", str(drc_report),
        "--exit-code-violations",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)

    if drc_report.exists():
        content = drc_report.read_text(encoding="utf-8")
        # Count errors vs warnings
        errors = content.count("error")
        warnings = content.count("warning")
        unconnected = "0 unconnected" in content
        print(f"   DRC: {errors} errors, {warnings} warnings")
        if unconnected:
            print(f"   All nets connected!")
        else:
            # Extract unconnected count
            for line in content.split('\n'):
                if 'unconnected' in line.lower() and 'Found' in line:
                    print(f"   {line.strip()}")
    else:
        print(f"   DRC report not generated (exit code {result.returncode})")

    return result.returncode == 0


def main():
    print("=" * 60)
    print("AetherGuard Control Board v2 — Auto-Routing Workflow")
    print("=" * 60)
    print(f"PCB: {PCB_FILE}")
    print(f"FreeRouting: {FREEROUTING_EXE}")
    print("")

    # Step 1: Export DSN
    if not export_dsn():
        print("\nABORTED: DSN export failed. See instructions above.")
        sys.exit(1)

    # Step 2: Run FreeRouting
    if not run_freerouting():
        print("\nABORTED: FreeRouting failed. Check logs.")
        sys.exit(2)

    # Step 3: Import SES
    if not import_ses():
        print("\nWARNING: SES import requires KiCad GUI. See instructions above.")

    # Step 4: DRC
    run_drc()

    print("")
    print("=" * 60)
    print("DONE. Next steps:")
    print("  1. Open the routed PCB in KiCad")
    print("  2. Add copper zones (GND on In1.Cu, Power on In2.Cu)")
    print("  3. Review USB diff pair routing (may need manual tuning)")
    print("  4. Run final DRC")
    print("  5. Export Gerbers for JLCPCB")
    print("=" * 60)


# === MANUAL WORKFLOW (if this script can't run pcbnew) ===
#
# Step 1: Export DSN
#   - Open aetherguard-control-board-v2.kicad_pcb in KiCad PCB Editor
#   - File → Export → Specctra DSN...
#   - Save as aetherguard-control-board-v2.dsn in the same directory
#
# Step 2: Run FreeRouting
#   - Open PowerShell and run:
#     $fr = "X:\repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb\tools\freerouting\app\freerouting\freerouting.exe"
#     & $fr -de "X:\repos\Networksafe\hardware\kicad\aetherguard-control-board-v2\aetherguard-control-board-v2.dsn" -do "X:\repos\Networksafe\hardware\kicad\aetherguard-control-board-v2\aetherguard-control-board-v2.ses" -mp 200 -da
#
# Step 3: Import SES
#   - In KiCad PCB Editor: File → Import → Specctra Session...
#   - Select aetherguard-control-board-v2.ses
#
# Step 4: Add Zones
#   - Select In1.Cu layer
#   - Draw zone covering entire board → Net: GND → Fill
#   - Select In2.Cu layer
#   - Draw zone for 3.3V area → Net: +3V3 → Fill
#   - Draw zone for 5V area → Net: +5V → Fill
#
# Step 5: Final DRC
#   - Inspect → Design Rules Checker → Run DRC
#   - Fix any remaining violations
#
# Step 6: Export Gerbers
#   - File → Fabrication Outputs → Gerbers (.gbr)...
#   - Select all copper + mask + silk + edge layers
#   - File → Fabrication Outputs → Drill Files (.drl)...
#   - File → Fabrication Outputs → Component Placement (.pos)...


if __name__ == "__main__":
    main()
