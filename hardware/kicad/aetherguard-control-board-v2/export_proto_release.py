#!/usr/bin/env python3
"""
Export Gerber + Drill + Position files for JLCPCB fabrication.

Run after routing is complete and DRC passes.

Usage:
  "C:\Program Files\KiCad\9.0\bin\python.exe" export_proto_release.py
  OR from KiCad scripting console
"""

import subprocess
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.resolve()
PCB_FILE = PROJECT_DIR / "aetherguard-control-board-v2.kicad_pcb"
ROUTED_PCB = PROJECT_DIR / "aetherguard-control-board-v2-routed.kicad_pcb"
RELEASE_DIR = PROJECT_DIR / "release"
GERBER_DIR = RELEASE_DIR / "gerbers"
DRILL_DIR = RELEASE_DIR / "drill"

KICAD_CLI = Path(r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe")

# Use routed PCB if available, otherwise base PCB
INPUT_PCB = ROUTED_PCB if ROUTED_PCB.exists() else PCB_FILE

LAYERS = [
    "F.Cu", "In1.Cu", "In2.Cu", "B.Cu",
    "F.Mask", "B.Mask",
    "F.SilkS", "B.SilkS",
    "F.Paste", "B.Paste",
    "Edge.Cuts",
]


def export_gerbers():
    """Export Gerber files for all layers."""
    print(f"[1/4] Exporting Gerbers...")
    GERBER_DIR.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(KICAD_CLI), "pcb", "export", "gerbers",
        str(INPUT_PCB),
        "--output", str(GERBER_DIR) + "/",
        "--layers", ",".join(LAYERS),
        "--subtract-soldermask",
        "--use-drill-file-origin",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        count = len(list(GERBER_DIR.glob("*.g*")))
        print(f"   {count} Gerber files exported to {GERBER_DIR}")
    else:
        print(f"   ERROR: {result.stderr.strip()}")
    return result.returncode == 0


def export_drill():
    """Export Excellon drill files."""
    print(f"[2/4] Exporting drill files...")
    DRILL_DIR.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(KICAD_CLI), "pcb", "export", "drill",
        str(INPUT_PCB),
        "--output", str(DRILL_DIR) + "/",
        "--format", "excellon",
        "--excellon-units", "mm",
        "--generate-map",
        "--map-format", "pdf",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        count = len(list(DRILL_DIR.glob("*")))
        print(f"   {count} drill files exported to {DRILL_DIR}")
    else:
        print(f"   ERROR: {result.stderr.strip()}")
    return result.returncode == 0


def export_position():
    """Export pick-and-place position file."""
    print(f"[3/4] Exporting position file...")
    pos_file = RELEASE_DIR / "pick-and-place-kicad.csv"

    cmd = [
        str(KICAD_CLI), "pcb", "export", "pos",
        str(INPUT_PCB),
        "--output", str(pos_file),
        "--format", "csv",
        "--units", "mm",
        "--side", "both",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        print(f"   Position file: {pos_file}")
    else:
        print(f"   ERROR: {result.stderr.strip()}")
    return result.returncode == 0


def run_drc():
    """Final DRC check."""
    print(f"[4/4] Running final DRC...")
    drc_file = RELEASE_DIR / "drc-release.rpt"

    cmd = [
        str(KICAD_CLI), "pcb", "drc",
        str(INPUT_PCB),
        "--output", str(drc_file),
        "--exit-code-violations",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if drc_file.exists():
        content = drc_file.read_text(encoding="utf-8")
        for line in content.split('\n'):
            if 'Found' in line:
                print(f"   {line.strip()}")
    return result.returncode == 0


def main():
    print("=" * 50)
    print("AetherGuard Control Board v2 — Release Export")
    print("=" * 50)
    print(f"Input: {INPUT_PCB.name}")
    print(f"Output: {RELEASE_DIR}")
    print("")

    RELEASE_DIR.mkdir(parents=True, exist_ok=True)

    ok = True
    ok &= export_gerbers()
    ok &= export_drill()
    ok &= export_position()
    drc_ok = run_drc()

    print("")
    if ok:
        print("Export complete. Upload contents of release/ to JLCPCB.")
        if not drc_ok:
            print("WARNING: DRC has violations — review before ordering.")
    else:
        print("Some exports failed. Check errors above.")


if __name__ == "__main__":
    main()
