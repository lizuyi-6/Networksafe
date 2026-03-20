from __future__ import annotations

import argparse
import re
import shutil
import subprocess
from pathlib import Path

import pcbnew


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "scratch" / "r18_best2" / "esp32-serial-deployer-pcb.kicad_pcb"
OUT_DIR = ROOT / "scratch" / "u3-vbus-search"
REPORT = OUT_DIR / "drc.rpt"
BOARD_OUT = OUT_DIR / "candidate.kicad_pcb"
KICAD_CLI = Path(r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe")

MM = pcbnew.FromMM
TO_MM = pcbnew.ToMM
F_CU = pcbnew.F_Cu
B_CU = pcbnew.B_Cu


def close_pt(item: pcbnew.PCB_TRACK, sx: float, sy: float, ex: float, ey: float, tol: float = 0.01) -> bool:
    a = (round(TO_MM(item.GetStartX()), 4), round(TO_MM(item.GetStartY()), 4))
    b = (round(TO_MM(item.GetEndX()), 4), round(TO_MM(item.GetEndY()), 4))
    p = (round(sx, 4), round(sy, 4))
    q = (round(ex, 4), round(ey, 4))
    return (abs(a[0] - p[0]) <= tol and abs(a[1] - p[1]) <= tol and abs(b[0] - q[0]) <= tol and abs(b[1] - q[1]) <= tol) or (
        abs(a[0] - q[0]) <= tol and abs(a[1] - q[1]) <= tol and abs(b[0] - p[0]) <= tol and abs(b[1] - p[1]) <= tol
    )


def remove_local_vbus(board: pcbnew.BOARD) -> None:
    doomed: list[pcbnew.PCB_TRACK] = []
    for item in board.GetTracks():
        if not isinstance(item, pcbnew.PCB_TRACK):
            continue
        if item.GetNetname() != "VBUS_HOST_RAW" or item.GetLayer() != F_CU:
            continue
        if close_pt(item, 71.25, 35.9625, 71.25, 36.3905):
            doomed.append(item)
        elif close_pt(item, 71.25, 36.3905, 71.5426, 36.6831):
            doomed.append(item)
        elif close_pt(item, 71.5426, 36.6831, 75.9013, 36.6831):
            doomed.append(item)
    for item in doomed:
        board.Remove(item)


def add_track(board: pcbnew.BOARD, net: int, layer: int, width_mm: float, start: tuple[float, float], end: tuple[float, float]) -> None:
    track = pcbnew.PCB_TRACK(board)
    track.SetNetCode(net)
    track.SetLayer(layer)
    track.SetWidth(MM(width_mm))
    track.SetStart(pcbnew.VECTOR2I(MM(start[0]), MM(start[1])))
    track.SetEnd(pcbnew.VECTOR2I(MM(end[0]), MM(end[1])))
    board.Add(track)


def add_via(board: pcbnew.BOARD, net: int, at: tuple[float, float], drill_mm: float = 0.30, diameter_mm: float = 0.50) -> None:
    via = pcbnew.PCB_VIA(board)
    via.SetNetCode(net)
    via.SetPosition(pcbnew.VECTOR2I(MM(at[0]), MM(at[1])))
    via.SetDrill(MM(drill_mm))
    via.SetWidth(MM(diameter_mm))
    via.SetLayerPair(F_CU, B_CU)
    board.Add(via)


def run_drc(board_path: Path) -> tuple[int | None, int | None]:
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    if REPORT.exists():
        REPORT.unlink()
    result = subprocess.run(
        [str(KICAD_CLI), "pcb", "drc", str(board_path), "--output", str(REPORT)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    text = REPORT.read_text(encoding="utf-8", errors="ignore") if REPORT.exists() else (result.stdout + "\n" + result.stderr)
    m1 = re.search(r"Found\s+(\d+)\s+DRC violations", text)
    m2 = re.search(r"Found\s+(\d+)\s+unconnected pads", text)
    return (int(m1.group(1)) if m1 else None, int(m2.group(1)) if m2 else None)


def candidate(via1: tuple[float, float]) -> tuple[int | None, int | None]:
    shutil.copy2(BASE, BOARD_OUT)
    board = pcbnew.LoadBoard(str(BOARD_OUT))
    remove_local_vbus(board)

    fp = next(x for x in board.GetFootprints() if x.GetReference() == "U3")
    pad8 = next(p for p in fp.Pads() if p.GetNumber() == "8")
    net = pad8.GetNetCode()
    pad8_pt = (round(TO_MM(pad8.GetPosition().x), 4), round(TO_MM(pad8.GetPosition().y), 4))
    endpoint = (75.9013, 36.6831)

    add_track(board, net, F_CU, 0.2, pad8_pt, via1)
    add_via(board, net, via1)
    add_via(board, net, endpoint)
    add_track(board, net, B_CU, 0.2, via1, endpoint)

    pcbnew.SaveBoard(str(BOARD_OUT), board)
    return run_drc(BOARD_OUT)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--x", type=float, required=True)
    parser.add_argument("--y", type=float, required=True)
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    drc, unc = candidate((args.x, args.y))
    print(f"via1=({args.x:.2f},{args.y:.2f}) drc={drc} unc={unc}")


if __name__ == "__main__":
    main()
