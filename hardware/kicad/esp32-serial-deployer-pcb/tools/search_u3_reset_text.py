from __future__ import annotations

import itertools
import re
import shutil
import subprocess
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROJECT = "esp32-serial-deployer-pcb"
BASE_BOARD = ROOT / "scratch" / "r18_best2" / f"{PROJECT}.kicad_pcb"
SEARCH_DIR = ROOT / "scratch" / "u3-reset-search"
BOARD_PATH = SEARCH_DIR / f"{PROJECT}.kicad_pcb"
REPORT_PATH = SEARCH_DIR / "drc.rpt"
KICAD_CLI = Path(r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe")

REMOVE_UUIDS = [
    "7d7c10c2-c7c9-48c1-b705-9f40911314b3",
    "afda9ca8-dfb2-42f5-bd7f-8013a41d40ff",
    "1fe44829-853d-4e4b-9d8d-0f4478e214a2",
    "025ce7de-cfa7-41c7-be2f-120dc479e004",
    "fa69e81e-a917-430f-a700-f8474e12c4cf",
]

REMOVE_VBUS_UUIDS = [
    "789d763a-9b64-4021-848d-362fe4505fad",
    "a85ca2b7-299d-420f-bef9-d4c27ac8c947",
    "c43f7179-b672-4a73-b436-54fc4dfbcb79",
    "62a9afce-e450-49b9-9353-f24b43e8f7aa",
]


def ensure_project_shell() -> None:
    SEARCH_DIR.mkdir(parents=True, exist_ok=True)
    for name in [f"{PROJECT}.kicad_pro", "fp-lib-table", "sym-lib-table"]:
        shutil.copy2(ROOT / name, SEARCH_DIR / name)
    pretty_src = ROOT / f"{PROJECT}.pretty"
    pretty_dst = SEARCH_DIR / f"{PROJECT}.pretty"
    if pretty_dst.exists():
        shutil.rmtree(pretty_dst)
    shutil.copytree(pretty_src, pretty_dst)


def strip_uuid_block(board_text: str, target_uuid: str) -> str:
    uuid_token = f'(uuid "{target_uuid}")'
    idx = board_text.find(uuid_token)
    if idx == -1:
        return board_text
    start = board_text.rfind("\n\t(", 0, idx)
    end = board_text.find("\n\t)\n", idx)
    if start == -1 or end == -1:
        raise ValueError(f"Unable to isolate block for UUID {target_uuid}")
    return board_text[:start] + "\n" + board_text[end + len("\n\t)\n") :]


def candidate_blocks(vx: float, vy: float) -> str:
    def new_uuid(label: str) -> str:
        return str(uuid.uuid5(uuid.UUID("39d3f267-3576-4740-9b1b-f3a21e1d52e8"), f"{label}:{vx:.3f}:{vy:.3f}"))

    return (
        "\t(segment\n"
        "\t\t(start 71.75 35.9625)\n"
        f"\t\t(end {vx:.4f} {vy:.4f})\n"
        "\t\t(width 0.1)\n"
        "\t\t(layer \"F.Cu\")\n"
        "\t\t(net 37)\n"
        f"\t\t(uuid \"{new_uuid('fcu')}\")\n"
        "\t)\n"
        "\t(via\n"
        f"\t\t(at {vx:.4f} {vy:.4f})\n"
        "\t\t(size 0.5)\n"
        "\t\t(drill 0.3)\n"
        "\t\t(layers \"F.Cu\" \"B.Cu\")\n"
        "\t\t(net 37)\n"
        f"\t\t(uuid \"{new_uuid('via')}\")\n"
        "\t)\n"
        "\t(segment\n"
        f"\t\t(start {vx:.4f} {vy:.4f})\n"
        f"\t\t(end {vx:.4f} 42.8000)\n"
        "\t\t(width 0.2)\n"
        "\t\t(layer \"B.Cu\")\n"
        "\t\t(net 37)\n"
        f"\t\t(uuid \"{new_uuid('bcu_v')}\")\n"
        "\t)\n"
        "\t(segment\n"
        f"\t\t(start {vx:.4f} 42.8000)\n"
        "\t\t(end 69.6250 42.8000)\n"
        "\t\t(width 0.2)\n"
        "\t\t(layer \"B.Cu\")\n"
        "\t\t(net 37)\n"
        f"\t\t(uuid \"{new_uuid('bcu_h')}\")\n"
        "\t)\n"
    )


def make_candidate(vx: float, vy: float) -> None:
    board_text = BASE_BOARD.read_text(encoding="utf-8")
    for target_uuid in REMOVE_UUIDS:
        board_text = strip_uuid_block(board_text, target_uuid)
    insertion = board_text.index("\n\t(zone\n")
    board_text = board_text[:insertion] + "\n" + candidate_blocks(vx, vy) + board_text[insertion:]
    BOARD_PATH.write_text(board_text, encoding="utf-8")


def candidate_blocks_two_seg(px: float, py: float, vx: float, vy: float) -> str:
    def new_uuid(label: str) -> str:
        seed = f"{label}:{px:.3f}:{py:.3f}:{vx:.3f}:{vy:.3f}"
        return str(uuid.uuid5(uuid.UUID("18bd1d4c-1152-4f95-a97c-b3fc649f68ac"), seed))

    return (
        "\t(segment\n"
        "\t\t(start 71.75 35.9625)\n"
        f"\t\t(end {px:.4f} {py:.4f})\n"
        "\t\t(width 0.1)\n"
        "\t\t(layer \"F.Cu\")\n"
        "\t\t(net 37)\n"
        f"\t\t(uuid \"{new_uuid('fcu_a')}\")\n"
        "\t)\n"
        "\t(segment\n"
        f"\t\t(start {px:.4f} {py:.4f})\n"
        f"\t\t(end {vx:.4f} {vy:.4f})\n"
        "\t\t(width 0.1)\n"
        "\t\t(layer \"F.Cu\")\n"
        "\t\t(net 37)\n"
        f"\t\t(uuid \"{new_uuid('fcu_b')}\")\n"
        "\t)\n"
        "\t(via\n"
        f"\t\t(at {vx:.4f} {vy:.4f})\n"
        "\t\t(size 0.5)\n"
        "\t\t(drill 0.3)\n"
        "\t\t(layers \"F.Cu\" \"B.Cu\")\n"
        "\t\t(net 37)\n"
        f"\t\t(uuid \"{new_uuid('via')}\")\n"
        "\t)\n"
        "\t(segment\n"
        f"\t\t(start {vx:.4f} {vy:.4f})\n"
        f"\t\t(end {vx:.4f} 42.8000)\n"
        "\t\t(width 0.2)\n"
        "\t\t(layer \"B.Cu\")\n"
        "\t\t(net 37)\n"
        f"\t\t(uuid \"{new_uuid('bcu_v')}\")\n"
        "\t)\n"
        "\t(segment\n"
        f"\t\t(start {vx:.4f} 42.8000)\n"
        "\t\t(end 69.6250 42.8000)\n"
        "\t\t(width 0.2)\n"
        "\t\t(layer \"B.Cu\")\n"
        "\t\t(net 37)\n"
        f"\t\t(uuid \"{new_uuid('bcu_h')}\")\n"
        "\t)\n"
    )


def make_candidate_two_seg(px: float, py: float, vx: float, vy: float) -> None:
    board_text = BASE_BOARD.read_text(encoding="utf-8")
    for target_uuid in REMOVE_UUIDS:
        board_text = strip_uuid_block(board_text, target_uuid)
    insertion = board_text.index("\n\t(zone\n")
    board_text = board_text[:insertion] + "\n" + candidate_blocks_two_seg(px, py, vx, vy) + board_text[insertion:]
    BOARD_PATH.write_text(board_text, encoding="utf-8")


def candidate_blocks_vbus(px: float, py: float, width: float = 0.2) -> str:
    def new_uuid(label: str) -> str:
        seed = f"{label}:{px:.3f}:{py:.3f}:{width:.3f}"
        return str(uuid.uuid5(uuid.UUID("00f77e98-cc95-4400-b0b3-b6d2dfd8784e"), seed))

    return (
        "\t(segment\n"
        "\t\t(start 71.2500 35.9625)\n"
        f"\t\t(end {px:.4f} {py:.4f})\n"
        f"\t\t(width {width:.1f})\n"
        "\t\t(layer \"F.Cu\")\n"
        "\t\t(net 34)\n"
        f"\t\t(uuid \"{new_uuid('seg1')}\")\n"
        "\t)\n"
        "\t(segment\n"
        f"\t\t(start {px:.4f} {py:.4f})\n"
        "\t\t(end 82.0000 30.5844)\n"
        f"\t\t(width {width:.1f})\n"
        "\t\t(layer \"F.Cu\")\n"
        "\t\t(net 34)\n"
        f"\t\t(uuid \"{new_uuid('seg2')}\")\n"
        "\t)\n"
    )


def make_candidate_vbus(px: float, py: float, width: float = 0.2) -> None:
    board_text = BASE_BOARD.read_text(encoding="utf-8")
    for target_uuid in REMOVE_VBUS_UUIDS:
        board_text = strip_uuid_block(board_text, target_uuid)
    insertion = board_text.index("\n\t(zone\n")
    board_text = board_text[:insertion] + "\n" + candidate_blocks_vbus(px, py, width) + board_text[insertion:]
    BOARD_PATH.write_text(board_text, encoding="utf-8")


def candidate_blocks_vbus_three(px: float, py: float, hx: float, width: float = 0.1) -> str:
    def new_uuid(label: str) -> str:
        seed = f"{label}:{px:.3f}:{py:.3f}:{hx:.3f}:{width:.3f}"
        return str(uuid.uuid5(uuid.UUID("fd3ebb97-87f1-4809-8843-3574d79745ad"), seed))

    return (
        "\t(segment\n"
        "\t\t(start 71.2500 35.9625)\n"
        f"\t\t(end {px:.4f} {py:.4f})\n"
        f"\t\t(width {width:.1f})\n"
        "\t\t(layer \"F.Cu\")\n"
        "\t\t(net 34)\n"
        f"\t\t(uuid \"{new_uuid('seg1')}\")\n"
        "\t)\n"
        "\t(segment\n"
        f"\t\t(start {px:.4f} {py:.4f})\n"
        f"\t\t(end {hx:.4f} {py:.4f})\n"
        f"\t\t(width {width:.1f})\n"
        "\t\t(layer \"F.Cu\")\n"
        "\t\t(net 34)\n"
        f"\t\t(uuid \"{new_uuid('seg2')}\")\n"
        "\t)\n"
        "\t(segment\n"
        f"\t\t(start {hx:.4f} {py:.4f})\n"
        "\t\t(end 82.0000 30.5844)\n"
        f"\t\t(width {width:.1f})\n"
        "\t\t(layer \"F.Cu\")\n"
        "\t\t(net 34)\n"
        f"\t\t(uuid \"{new_uuid('seg3')}\")\n"
        "\t)\n"
    )


def make_candidate_vbus_three(px: float, py: float, hx: float, width: float = 0.1) -> None:
    board_text = BASE_BOARD.read_text(encoding="utf-8")
    for target_uuid in REMOVE_VBUS_UUIDS:
        board_text = strip_uuid_block(board_text, target_uuid)
    insertion = board_text.index("\n\t(zone\n")
    board_text = board_text[:insertion] + "\n" + candidate_blocks_vbus_three(px, py, hx, width) + board_text[insertion:]
    BOARD_PATH.write_text(board_text, encoding="utf-8")


def make_candidate_combo(vbus_px: float, vbus_py: float, reset_px: float, reset_py: float, reset_vx: float, reset_vy: float, vbus_width: float = 0.1) -> None:
    board_text = BASE_BOARD.read_text(encoding="utf-8")
    for target_uuid in REMOVE_UUIDS:
        board_text = strip_uuid_block(board_text, target_uuid)
    for target_uuid in REMOVE_VBUS_UUIDS:
        board_text = strip_uuid_block(board_text, target_uuid)
    insertion = board_text.index("\n\t(zone\n")
    board_text = (
        board_text[:insertion]
        + "\n"
        + candidate_blocks_vbus(vbus_px, vbus_py, vbus_width)
        + candidate_blocks_two_seg(reset_px, reset_py, reset_vx, reset_vy)
        + board_text[insertion:]
    )
    BOARD_PATH.write_text(board_text, encoding="utf-8")


def run_drc() -> tuple[int | None, int | None, str]:
    completed = subprocess.run(
        [str(KICAD_CLI), "pcb", "drc", BOARD_PATH.name, "--output", str(REPORT_PATH)],
        cwd=str(SEARCH_DIR),
        capture_output=True,
        text=True,
    )
    report = REPORT_PATH.read_text(encoding="utf-8", errors="replace") if REPORT_PATH.exists() else ""
    drc = None
    unc = None
    m = re.search(r"Found (\d+) DRC violations", report)
    if m:
        drc = int(m.group(1))
    m = re.search(r"Found (\d+) unconnected pads", report)
    if m:
        unc = int(m.group(1))
    return drc, unc, completed.stdout + completed.stderr


def main() -> int:
    ensure_project_shell()
    best: tuple[int | None, int | None, float, float] | None = None
    for vx, vy in itertools.product(
        [round(v, 2) for v in (73.6, 73.8, 74.0, 74.2, 74.4, 74.6, 74.8, 75.0, 75.2, 75.4, 75.6)],
        [round(v, 2) for v in (36.8, 37.0, 37.2, 37.4, 37.6, 37.8, 38.0, 38.2, 38.4, 38.6, 38.8)],
    ):
        make_candidate(vx, vy)
        drc, unc, _ = run_drc()
        if drc is None or unc is None:
            print(f"candidate {vx:.2f},{vy:.2f}: no report")
            continue
        print(f"candidate {vx:.2f},{vy:.2f}: drc={drc} unc={unc}")
        if best is None or (drc, unc) < (best[0], best[1]):
            best = (drc, unc, vx, vy)
        if drc == 0 and unc == 0:
            print(f"SUCCESS {vx:.2f},{vy:.2f}")
            return 0
    if best is not None:
        print(f"BEST drc={best[0]} unc={best[1]} at {best[2]:.2f},{best[3]:.2f}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
