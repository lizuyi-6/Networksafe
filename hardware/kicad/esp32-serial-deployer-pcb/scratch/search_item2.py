import re
import shutil
import subprocess
from pathlib import Path


ROOT = Path(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb")
SCRATCH = ROOT / "scratch" / "item2-search"
SCRATCH.mkdir(parents=True, exist_ok=True)
KICAD = Path(r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe")
KIPY = Path(r"C:\Program Files\KiCad\9.0\bin\python.exe")


def prepare_project(workdir: Path) -> Path:
    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    for name in [
        "esp32-serial-deployer-pcb.kicad_pro",
        "esp32-serial-deployer-pcb.kicad_pcb",
        "fp-lib-table",
        "sym-lib-table",
        "esp32-serial-deployer-pcb.kicad_sym",
    ]:
        shutil.copy2(ROOT / name, workdir / name)
    if (workdir / "esp32-serial-deployer-pcb.pretty").exists():
        shutil.rmtree(workdir / "esp32-serial-deployer-pcb.pretty")
    shutil.copytree(
        ROOT / "esp32-serial-deployer-pcb.pretty",
        workdir / "esp32-serial-deployer-pcb.pretty",
    )
    return workdir / "esp32-serial-deployer-pcb.kicad_pcb"


def parse_report(text: str) -> dict[str, int]:
    def count(tag: str) -> int:
        return len(re.findall(rf"^\[{re.escape(tag)}\]:", text, flags=re.M))

    return {
        "unconnected": count("unconnected_items"),
        "clearance": count("clearance"),
        "shorting": count("shorting_items"),
        "crossing": count("tracks_crossing"),
        "mask": count("solder_mask_bridge"),
        "hole": count("hole_clearance"),
        "keepout": count("items_not_allowed"),
        "dangling": count("track_dangling"),
        "drill": count("drill_out_of_range"),
        "lib": count("lib_footprint_issues"),
    }


def extra_real(parsed: dict[str, int]) -> int:
    return (
        parsed["clearance"]
        + parsed["shorting"]
        + parsed["crossing"]
        + parsed["mask"]
        + parsed["hole"]
        + parsed["keepout"]
        + parsed["dangling"]
    )


def run_candidate(
    label: str,
    via_x: float,
    via_y: float,
    y_mid: float,
) -> tuple[int, int, dict[str, int]]:
    workdir = SCRATCH / label
    board_file = prepare_project(workdir)
    patch_code = f"""
import pcbnew
board = pcbnew.LoadBoard(r"{board_file}")
gnd = board.FindNet("GND")

def pt(x, y):
    return pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y))

via = pcbnew.PCB_VIA(board)
via.SetNet(gnd)
via.SetPosition(pt({via_x}, {via_y}))
via.SetDrill(pcbnew.FromMM(0.3))
via.SetWidth(pcbnew.FromMM(0.6))
via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
board.Add(via)

segments = [
    (pcbnew.F_Cu, (41.2393, 26.0000), ({via_x}, {via_y})),
    (pcbnew.B_Cu, ({via_x}, {via_y}), ({via_x}, {y_mid})),
    (pcbnew.B_Cu, ({via_x}, {y_mid}), (43.8760, {y_mid})),
    (pcbnew.B_Cu, (43.8760, {y_mid}), (43.8760, 27.8396)),
]
for layer, a, b in segments:
    t = pcbnew.PCB_TRACK(board)
    t.SetNet(gnd)
    t.SetLayer(layer)
    t.SetStart(pt(*a))
    t.SetEnd(pt(*b))
    t.SetWidth(pcbnew.FromMM(0.2))
    board.Add(t)

pcbnew.ZONE_FILLER(board).Fill(board.Zones())
pcbnew.SaveBoard(r"{board_file}", board)
"""
    subprocess.run([str(KIPY), "-c", patch_code], check=True)
    report_file = workdir / "drc.rpt"
    subprocess.run(
        [str(KICAD), "pcb", "drc", str(board_file), "--output", str(report_file)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    parsed = parse_report(report_file.read_text(encoding="utf-8", errors="ignore"))
    return extra_real(parsed), parsed["unconnected"], parsed


results: list[tuple[int, int, str, dict[str, int]]] = []
for via_x in [round(v, 2) for v in [41.2, 41.4, 41.6, 41.8, 42.0, 42.2]]:
    for via_y in [round(v, 2) for v in [26.2, 26.4, 26.6, 26.8, 27.0, 27.2]]:
        for y_mid in [round(v, 2) for v in [27.2, 27.4, 27.6, 27.8, 28.0, 28.2, 28.4, 28.6]]:
            label = f"vx{via_x:.2f}_vy{via_y:.2f}_ym{y_mid:.2f}"
            extra, unconnected, parsed = run_candidate(label, via_x, via_y, y_mid)
            results.append((extra, unconnected, label, parsed))

results.sort(key=lambda item: (item[0], item[1], item[2]))
for extra, unconnected, label, parsed in results[:40]:
    print(
        f"{label} extra={extra} unconnected={unconnected} "
        f"clear={parsed['clearance']} short={parsed['shorting']} "
        f"cross={parsed['crossing']} mask={parsed['mask']} "
        f"keepout={parsed['keepout']} dangling={parsed['dangling']}"
    )
