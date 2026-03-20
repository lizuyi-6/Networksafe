from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pcbnew


ROOT = Path(__file__).resolve().parents[1]
GEN_PATH = ROOT / "tools" / "generate_pcb_v1.py"
BOARD_PATH = ROOT / "esp32-serial-deployer-pcb.kicad_pcb"
SCH_FILENAME = "esp32-serial-deployer-pcb.kicad_sch"


def load_generator():
    spec = importlib.util.spec_from_file_location("genpcb_v1", GEN_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def mm(value: float) -> int:
    return pcbnew.FromMM(value)


def vec(x_mm: float, y_mm: float) -> pcbnew.VECTOR2I:
    return pcbnew.VECTOR2I(mm(x_mm), mm(y_mm))


def add_track(
    board: pcbnew.BOARD,
    net: pcbnew.NETINFO_ITEM,
    layer: int,
    start: tuple[float, float],
    end: tuple[float, float],
    width_mm: float,
) -> None:
    track = pcbnew.PCB_TRACK(board)
    track.SetNet(net)
    track.SetLayer(layer)
    track.SetStart(vec(*start))
    track.SetEnd(vec(*end))
    track.SetWidth(mm(width_mm))
    board.Add(track)


def add_path(
    board: pcbnew.BOARD,
    net: pcbnew.NETINFO_ITEM,
    layer: int,
    points: list[tuple[float, float]],
    width_mm: float,
) -> None:
    for start, end in zip(points, points[1:]):
        add_track(board, net, layer, start, end, width_mm)


def ensure_net(board: pcbnew.BOARD, name: str) -> pcbnew.NETINFO_ITEM:
    net = board.FindNet(name)
    if net is None:
        net = pcbnew.NETINFO_ITEM(board, name)
        board.Add(net)
    return net


def footprint_by_ref(board: pcbnew.BOARD, ref: str):
    return board.FindFootprintByReference(ref)


def set_fp_identity(
    fp: pcbnew.FOOTPRINT,
    ref: str,
    value: str,
    footprint_id: str,
    symbol_uuid: str,
) -> None:
    fp.SetReference(ref)
    fp.SetValue(value)
    fp.SetFPIDAsString(footprint_id)
    fp.Reference().SetVisible(False)
    fp.Value().SetVisible(False)
    fp.SetPath(pcbnew.KIID_PATH(f"/{symbol_uuid}"))
    fp.SetSheetname("/")
    fp.SetSheetfile(SCH_FILENAME)
    fp.SetLink(pcbnew.KIID(symbol_uuid))


def assign_pads(fp: pcbnew.FOOTPRINT, nets_by_name: dict[str, pcbnew.NETINFO_ITEM], mapping: dict[str, str]) -> None:
    for pad in fp.Pads():
        net_name = mapping.get(pad.GetNumber())
        if net_name:
            pad.SetNet(nets_by_name[net_name])


def remove_existing_r18(board: pcbnew.BOARD) -> None:
    fp = footprint_by_ref(board, "R18")
    if fp is not None:
        board.Remove(fp)
    for item in list(board.GetTracks()):
        if item.GetNetname() == "HOST_CP2102_RST_N":
            board.Remove(item)


def main() -> None:
    gen = load_generator()
    gen.write_symbol_library()
    gen.write_schematic()

    board = pcbnew.LoadBoard(str(BOARD_PATH))

    nets_by_name = {name: ensure_net(board, name) for name in set(gen.NETS) | {"HOST_CP2102_RST_N"}}
    inst_by_ref = {inst.ref: inst for inst in gen.INSTANCES if inst.on_board}

    for fp in board.GetFootprints():
        inst = inst_by_ref.get(fp.GetReference())
        if inst is None:
            continue
        set_fp_identity(fp, inst.ref, inst.value, inst.footprint, inst.uuid)

    u3 = footprint_by_ref(board, "U3")
    if u3 is None:
        raise RuntimeError("U3 not found")
    for pad in u3.Pads():
        if pad.GetNumber() == "9":
            pad.SetNet(nets_by_name["HOST_CP2102_RST_N"])
            break
    else:
        raise RuntimeError("U3 pad 9 not found")

    remove_existing_r18(board)
    r18 = pcbnew.FootprintLoad(
        str(gen.KICAD_FOOTPRINTS / "Resistor_SMD.pretty"),
        "R_0603_1608Metric",
    )
    inst = inst_by_ref["R18"]
    set_fp_identity(r18, inst.ref, inst.value, inst.footprint, inst.uuid)
    x_mm, y_mm, rot_deg = gen.PLACEMENTS["R18"]
    r18.SetPosition(vec(x_mm, y_mm))
    r18.SetOrientationDegrees(rot_deg)
    board.Add(r18)
    assign_pads(r18, nets_by_name, inst.connect)

    pad_u3_9 = next(pad for pad in u3.Pads() if pad.GetNumber() == "9")
    pad_r18_1 = next(pad for pad in r18.Pads() if pad.GetNumber() == "1")
    pad_r18_2 = next(pad for pad in r18.Pads() if pad.GetNumber() == "2")

    add_path(
        board,
        nets_by_name["HOST_CP2102_RST_N"],
        pcbnew.F_Cu,
        [
            (pcbnew.ToMM(pad_u3_9.GetPosition().x), pcbnew.ToMM(pad_u3_9.GetPosition().y)),
            (71.75, 36.45),
            (pcbnew.ToMM(pad_r18_2.GetPosition().x), pcbnew.ToMM(pad_r18_2.GetPosition().y)),
        ],
        0.2,
    )
    add_path(
        board,
        nets_by_name["3V3"],
        pcbnew.F_Cu,
        [
            (70.75, 35.9625),
            (70.75, 36.45),
            (pcbnew.ToMM(pad_r18_1.GetPosition().x), pcbnew.ToMM(pad_r18_1.GetPosition().y)),
        ],
        0.2,
    )

    pcbnew.ZONE_FILLER(board).Fill(board.Zones())
    pcbnew.SaveBoard(str(BOARD_PATH), board)


if __name__ == "__main__":
    main()
