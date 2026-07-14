#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
import sys


PROJECT_DIR = Path(__file__).resolve().parent
BOARD_PATH = PROJECT_DIR / "aetherguard-control-board-v1.kicad_pcb"
RELEASE_DIR = PROJECT_DIR / "release" / "v1-proto"
GERBER_DIR = RELEASE_DIR / "gerbers"
DRILL_DIR = RELEASE_DIR / "drill"
ASSEMBLY_DIR = RELEASE_DIR / "assembly"
POS_PATH = RELEASE_DIR / "pick-and-place.csv"
README_PATH = RELEASE_DIR / "README.md"
KICAD_CLI = Path(r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe")


def run(*args: str) -> None:
    cmd = [str(KICAD_CLI), *args]
    subprocess.run(cmd, check=True, cwd=PROJECT_DIR)


def write_release_readme() -> None:
    timestamp = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
    README_PATH.write_text(
        "\n".join(
            [
                "# AetherGuard Control Board v1 Proto Release",
                "",
                f"Generated: {timestamp}",
                "",
                "Contents:",
                "- `bom-proto.csv`: grouped prototype BOM generated from the sheet sources",
                "- `pick-and-place.csv`: current PCB position export",
                "- `gerbers/`: Gerber plots for the routed board file currently in the repo",
                "- `drill/`: Excellon drill output and drill map",
                "- `assembly/`: front/back assembly PDFs",
                "",
                "Source files:",
                f"- Board: `{BOARD_PATH.name}`",
                "- BOM script: `generate_release_bom.py`",
                "- Export script: `export_proto_release.py`",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> int:
    if not KICAD_CLI.exists():
        raise SystemExit(f"Missing KiCad CLI: {KICAD_CLI}")

    for path in [GERBER_DIR, DRILL_DIR, ASSEMBLY_DIR]:
        if path.exists():
            shutil.rmtree(path)
        path.mkdir(parents=True, exist_ok=True)

    RELEASE_DIR.mkdir(parents=True, exist_ok=True)

    subprocess.run([sys.executable, str(PROJECT_DIR / "generate_release_bom.py")], check=True, cwd=PROJECT_DIR)

    layers = "F.Cu,In1.Cu,In2.Cu,B.Cu,F.Mask,B.Mask,F.SilkS,B.SilkS,Edge.Cuts"
    run("pcb", "export", "gerbers", str(BOARD_PATH), "--output", str(GERBER_DIR), "--layers", layers)
    run(
        "pcb",
        "export",
        "drill",
        str(BOARD_PATH),
        "--output",
        str(DRILL_DIR),
        "--format",
        "excellon",
        "--excellon-units",
        "mm",
        "--generate-map",
        "--map-format",
        "pdf",
    )
    run(
        "pcb",
        "export",
        "pos",
        str(BOARD_PATH),
        "--output",
        str(POS_PATH),
        "--format",
        "csv",
        "--units",
        "mm",
        "--side",
        "both",
    )
    run(
        "pcb",
        "export",
        "pdf",
        str(BOARD_PATH),
        "--output",
        str(ASSEMBLY_DIR / "top-assembly.pdf"),
        "--layers",
        "F.Fab,F.SilkS,Edge.Cuts",
        "--mode-single",
    )
    run(
        "pcb",
        "export",
        "pdf",
        str(BOARD_PATH),
        "--output",
        str(ASSEMBLY_DIR / "bottom-assembly.pdf"),
        "--layers",
        "B.Fab,B.SilkS,Edge.Cuts",
        "--mirror",
        "--mode-single",
    )

    write_release_readme()
    print(f"Wrote {RELEASE_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
