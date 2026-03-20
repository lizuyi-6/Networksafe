import re
import shutil
import subprocess
from pathlib import Path


ROOT = Path(r"X:\github-repos\Networksafe\hardware\kicad\esp32-serial-deployer-pcb")
SCRATCH = ROOT / "scratch" / "item2-probe"
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
    tgt = workdir / "esp32-serial-deployer-pcb.pretty"
    if tgt.exists():
        shutil.rmtree(tgt)
    shutil.copytree(ROOT / "esp32-serial-deployer-pcb.pretty", tgt)
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
        "keepout": count("items_not_allowed"),
        "dangling": count("track_dangling"),
    }


def extra_real(parsed: dict[str, int]) -> int:
    return (
        parsed["clearance"]
        + parsed["shorting"]
        + parsed["crossing"]
        + parsed["mask"]
        + parsed["keepout"]
        + parsed["dangling"]
    )


def build_script(spec: dict) -> str:
    lines = [
        "import pcbnew",
        f'board = pcbnew.LoadBoard(r"{spec["board_file"]}")',
        'net = board.FindNet("GND")',
        "def pt(x, y):",
        "    return pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y))",
    ]
    if "via" in spec:
        vx, vy = spec["via"]
        lines.extend(
            [
                "via = pcbnew.PCB_VIA(board)",
                "via.SetNet(net)",
                f"via.SetPosition(pt({vx}, {vy}))",
                "via.SetDrill(pcbnew.FromMM(0.3))",
                "via.SetWidth(pcbnew.FromMM(0.6))",
                "via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)",
                "board.Add(via)",
            ]
        )
    for layer_name, pts in spec["paths"]:
        coords = ", ".join(f"({x}, {y})" for x, y in pts)
        lines.extend(
            [
                f"for a, b in zip([{coords}], [{coords}][1:]):",
                "    t = pcbnew.PCB_TRACK(board)",
                "    t.SetNet(net)",
                f"    t.SetLayer(pcbnew.{layer_name})",
                "    t.SetStart(pt(*a))",
                "    t.SetEnd(pt(*b))",
                "    t.SetWidth(pcbnew.FromMM(0.2))",
                "    board.Add(t)",
            ]
        )
    lines.extend(
        [
            "pcbnew.ZONE_FILLER(board).Fill(board.Zones())",
            f'pcbnew.SaveBoard(r"{spec["board_file"]}", board)',
        ]
    )
    return "\n".join(lines)


def run_candidate(name: str, spec: dict) -> tuple[int, dict[str, int], Path]:
    workdir = SCRATCH / name
    board_file = prepare_project(workdir)
    spec = dict(spec)
    spec["board_file"] = str(board_file)
    subprocess.run([str(KIPY), "-c", build_script(spec)], check=True)
    report_file = workdir / "drc.rpt"
    subprocess.run(
        [str(KICAD), "pcb", "drc", str(board_file), "--output", str(report_file)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    parsed = parse_report(report_file.read_text(encoding="utf-8", errors="ignore"))
    return extra_real(parsed), parsed, report_file


CANDIDATES = {
    "fcu_a": {
        "paths": [
            ("F_Cu", [(41.2393, 26.0), (41.3, 27.2), (43.2, 27.2), (43.876, 27.8396)])
        ]
    },
    "fcu_b": {
        "paths": [
            ("F_Cu", [(41.2393, 26.0), (41.1, 27.4), (43.0, 27.4), (43.876, 27.8396)])
        ]
    },
    "fcu_c": {
        "paths": [
            ("F_Cu", [(41.2393, 26.0), (41.0, 27.6), (42.8, 27.6), (43.876, 27.8396)])
        ]
    },
    "via_l1": {
        "via": (40.8, 26.2),
        "paths": [
            ("F_Cu", [(41.2393, 26.0), (40.8, 26.2)]),
            ("B_Cu", [(40.8, 26.2), (39.6, 28.6), (38.8682, 29.3475)]),
        ],
    },
    "via_l2": {
        "via": (40.8, 26.0),
        "paths": [
            ("F_Cu", [(41.2393, 26.0), (40.8, 26.0)]),
            ("B_Cu", [(40.8, 26.0), (39.4, 28.8), (38.8682, 29.3475)]),
        ],
    },
    "via_l3": {
        "via": (41.0, 26.2),
        "paths": [
            ("F_Cu", [(41.2393, 26.0), (41.0, 26.2)]),
            ("B_Cu", [(41.0, 26.2), (39.8, 28.8), (38.8682, 29.3475)]),
        ],
    },
    "via_l4": {
        "via": (40.6, 25.8),
        "paths": [
            ("F_Cu", [(41.2393, 26.0), (40.6, 25.8)]),
            ("B_Cu", [(40.6, 25.8), (39.4, 28.4), (38.8682, 29.3475)]),
        ],
    },
}


for name, spec in CANDIDATES.items():
    extra, parsed, rpt = run_candidate(name, spec)
    print(name, f"extra={extra}", parsed, rpt)
