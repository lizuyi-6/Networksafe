from __future__ import annotations

import itertools
import re
import shutil
import subprocess
from pathlib import Path

import pcbnew


ROOT = Path(__file__).resolve().parents[1]
PROJECT = "esp32-serial-deployer-pcb"
BASE_DIR = ROOT / "scratch" / "best_vbus_1drc"
BASE_BOARD = BASE_DIR / f"{PROJECT}.kicad_pcb"
SEARCH_DIR = ROOT / "scratch" / "r18-cluster-search"
BOARD_PATH = SEARCH_DIR / f"{PROJECT}.kicad_pcb"
REPORT_PATH = SEARCH_DIR / "drc.rpt"
KICAD_CLI = Path(r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe")


def ensure_search_shell() -> None:
    SEARCH_DIR.mkdir(parents=True, exist_ok=True)
    for name in [f"{PROJECT}.kicad_pro", "fp-lib-table", "sym-lib-table"]:
        shutil.copy2(ROOT / name, SEARCH_DIR / name)
    pretty_src = ROOT / f"{PROJECT}.pretty"
    pretty_dst = SEARCH_DIR / f"{PROJECT}.pretty"
    if pretty_dst.exists():
        shutil.rmtree(pretty_dst)
    shutil.copytree(pretty_src, pretty_dst)


def mm(value: float) -> int:
    return pcbnew.FromMM(value)


def approx(a: float, b: float, tol: float = 0.02) -> bool:
    return abs(a - b) <= tol


def is_seg(item, sx: float, sy: float, ex: float, ey: float, layer_name: str) -> bool:
    if item.GetClass() != "PCB_TRACK":
        return False
    s = item.GetStart()
    e = item.GetEnd()
    ax, ay = pcbnew.ToMM(s.x), pcbnew.ToMM(s.y)
    bx, by = pcbnew.ToMM(e.x), pcbnew.ToMM(e.y)
    fwd = approx(ax, sx) and approx(ay, sy) and approx(bx, ex) and approx(by, ey)
    rev = approx(ax, ex) and approx(ay, ey) and approx(bx, sx) and approx(by, sy)
    return (fwd or rev) and item.GetLayerName() == layer_name


def remove_matching_tracks(board: pcbnew.BOARD, tracks_snapshot, predicate) -> None:
    doomed = [item for item in tracks_snapshot if predicate(item)]
    for item in doomed:
        board.Remove(item)


def add_track(board: pcbnew.BOARD, net_item, layer: int, sx: float, sy: float, ex: float, ey: float, width: float) -> None:
    track = pcbnew.PCB_TRACK(board)
    track.SetNetCode(net_item.GetNetCode())
    track.SetLayer(layer)
    track.SetStart(pcbnew.VECTOR2I(mm(sx), mm(sy)))
    track.SetEnd(pcbnew.VECTOR2I(mm(ex), mm(ey)))
    track.SetWidth(mm(width))
    board.Add(track)


def add_via(board: pcbnew.BOARD, net_item, x: float, y: float, start_layer: int = pcbnew.F_Cu, end_layer: int = pcbnew.B_Cu) -> None:
    via = pcbnew.PCB_VIA(board)
    via.SetNetCode(net_item.GetNetCode())
    via.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
    via.SetDrill(mm(0.3))
    via.SetWidth(mm(0.5))
    via.SetLayerPair(start_layer, end_layer)
    board.Add(via)


def write_candidate(
    r18_x: float,
    r18_y: float,
    r18_angle: int,
    bend_x: float,
    bend_y: float,
    via_x: float,
    via_y: float,
    pwr_y: float,
) -> None:
    board = pcbnew.LoadBoard(str(BASE_BOARD))
    tracks_snapshot = list(board.GetTracks())

    remove_matching_tracks(board, tracks_snapshot, lambda item: item.GetNetname() == "HOST_CP2102_RST_N")
    remove_matching_tracks(
        board,
        tracks_snapshot,
        lambda item:
            is_seg(item, 67.975, 42.8, 67.975, 42.2229, "B.Cu")
            or is_seg(item, 67.975, 42.2229, 66.4265, 42.2229, "B.Cu"),
    )

    u3 = board.FindFootprintByReference("U3")
    r18 = board.FindFootprintByReference("R18")

    r18.SetPosition(pcbnew.VECTOR2I(mm(r18_x), mm(r18_y)))
    r18.SetOrientationDegrees(r18_angle)
    r18.SetLayerAndFlip(pcbnew.B_Cu)

    pad_u3_9 = u3.FindPadByNumber("9")
    pad_r18_1 = r18.FindPadByNumber("1")
    pad_r18_2 = r18.FindPadByNumber("2")

    net_rst = board.FindNet("HOST_CP2102_RST_N")
    net_3v3 = board.FindNet("3V3")

    u3_9_x = pcbnew.ToMM(pad_u3_9.GetPosition().x)
    u3_9_y = pcbnew.ToMM(pad_u3_9.GetPosition().y)
    r18_1_x = pcbnew.ToMM(pad_r18_1.GetPosition().x)
    r18_1_y = pcbnew.ToMM(pad_r18_1.GetPosition().y)
    r18_2_x = pcbnew.ToMM(pad_r18_2.GetPosition().x)
    r18_2_y = pcbnew.ToMM(pad_r18_2.GetPosition().y)

    add_track(board, net_rst, pcbnew.F_Cu, u3_9_x, u3_9_y, bend_x, bend_y, 0.1)
    add_track(board, net_rst, pcbnew.F_Cu, bend_x, bend_y, via_x, via_y, 0.1)
    add_via(board, net_rst, via_x, via_y)
    add_track(board, net_rst, pcbnew.B_Cu, via_x, via_y, via_x, r18_2_y, 0.2)
    add_track(board, net_rst, pcbnew.B_Cu, via_x, r18_2_y, r18_2_x, r18_2_y, 0.2)

    add_track(board, net_3v3, pcbnew.B_Cu, r18_1_x, r18_1_y, r18_1_x, pwr_y, 0.2)
    add_track(board, net_3v3, pcbnew.B_Cu, r18_1_x, pwr_y, 66.4265, pwr_y, 0.2)
    add_track(board, net_3v3, pcbnew.B_Cu, 66.4265, pwr_y, 66.4265, 42.2229, 0.2)

    pcbnew.SaveBoard(str(BOARD_PATH), board)


def run_drc() -> tuple[int | None, int | None, str]:
    completed = subprocess.run(
        [str(KICAD_CLI), "pcb", "drc", BOARD_PATH.name, "--output", str(REPORT_PATH)],
        cwd=str(SEARCH_DIR),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
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
    ensure_search_shell()
    best: tuple[int | None, int | None, tuple[float, ...]] | None = None
    xs = [round(v, 2) for v in (75.2, 75.6, 76.0)]
    ys = [round(v, 2) for v in (34.8, 35.2, 35.6)]
    bends_y = [round(v, 3) for v in (36.08, 36.14, 36.20)]
    vias_x = [round(v, 2) for v in (74.2, 74.4, 74.6)]
    vias_y = [round(v, 3) for v in (36.20, 36.26, 36.32)]
    power_ys = [round(v, 2) for v in (41.4, 42.2)]

    for r18_x, r18_y, bend_y, via_x, via_y, pwr_y in itertools.product(xs, ys, bends_y, vias_x, vias_y, power_ys):
        bend_x = 71.75
        write_candidate(r18_x, r18_y, 180, bend_x, bend_y, via_x, via_y, pwr_y)
        drc, unc, _ = run_drc()
        params = (r18_x, r18_y, bend_x, bend_y, via_x, via_y, pwr_y)
        print(f"candidate r18=({r18_x:.2f},{r18_y:.2f}) bend=({bend_x:.2f},{bend_y:.3f}) via=({via_x:.2f},{via_y:.3f}) pwr_y={pwr_y:.2f}: drc={drc} unc={unc}")
        if best is None or (drc, unc) < (best[0], best[1]):
            best = (drc, unc, params)
        if drc == 0 and unc == 0:
            print(f"SUCCESS {params}")
            return 0

    if best is not None:
        print(f"BEST drc={best[0]} unc={best[1]} params={best[2]}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
