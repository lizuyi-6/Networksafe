from __future__ import annotations

import json
from pathlib import Path

import pcbnew

import generate_pcb_v1 as base


BOARD_W = 72.0
BOARD_H = 38.0
EDGE_W = 0.1
SCH_FILENAME = "esp32-serial-deployer-pcb.kicad_sch"
ROUTE_OVERLAY_PATH = Path(__file__).resolve().with_name("ev1_route_overlay.json")
LAYER_BY_NAME = {
    "F.Cu": pcbnew.F_Cu,
    "B.Cu": pcbnew.B_Cu,
    "In1.Cu": pcbnew.In1_Cu,
    "In2.Cu": pcbnew.In2_Cu,
}


EV1_FOOTPRINT_OVERRIDES = {
    "U1": f"{base.PROJECT_NAME}:ESP32-WROOM-32",
    "J1": f"{base.PROJECT_NAME}:USB_C_Receptacle_HRO_TYPE-C-31-M-12",
    "U2": f"{base.PROJECT_NAME}:QFN-24-1EP_4x4mm_P0.5mm_EP2.7x2.7mm",
    "U3": f"{base.PROJECT_NAME}:QFN-24-1EP_4x4mm_P0.5mm_EP2.7x2.7mm",
    "U4": f"{base.PROJECT_NAME}:SOT-23-5",
    "D10": f"{base.PROJECT_NAME}:LED_RGB_CC_PLCC4",
    "BZ1": f"{base.PROJECT_NAME}:BUZZER_SMD_9x9",
    "Q1": f"{base.PROJECT_NAME}:SOT-23",
    "Q2": f"{base.PROJECT_NAME}:SOT-23",
    "Q3": f"{base.PROJECT_NAME}:SOT-23",
    "U5": f"{base.PROJECT_NAME}:SOT-23",
    "U6": f"{base.PROJECT_NAME}:SOT-23",
    "F1": f"{base.PROJECT_NAME}:FUSE_1206_3216Metric",
    "F2": f"{base.PROJECT_NAME}:FUSE_1206_3216Metric",
    "D1": f"{base.PROJECT_NAME}:D_SOD123",
    "D2": f"{base.PROJECT_NAME}:D_SOD123",
    "D3": f"{base.PROJECT_NAME}:LED_0603_1608Metric",
    "SW1": f"{base.PROJECT_NAME}:SW_SPST_4P_4.2x3.2mm",
    "SW2": f"{base.PROJECT_NAME}:SW_SPST_4P_4.2x3.2mm",
    "SW3": f"{base.PROJECT_NAME}:SW_SPST_4P_4.2x3.2mm",
    "SW4": f"{base.PROJECT_NAME}:SW_SPST_4P_4.2x3.2mm",
    "SW5": f"{base.PROJECT_NAME}:SW_SPST_4P_4.2x3.2mm",
    "TP1": f"{base.PROJECT_NAME}:TestPoint_Pad_D1.5mm",
    "TP2": f"{base.PROJECT_NAME}:TestPoint_Pad_D1.5mm",
    "TP3": f"{base.PROJECT_NAME}:TestPoint_Pad_D1.5mm",
    "TP4": f"{base.PROJECT_NAME}:TestPoint_Pad_D1.5mm",
    "TP5": f"{base.PROJECT_NAME}:TestPoint_Pad_D1.5mm",
    "TP6": f"{base.PROJECT_NAME}:TestPoint_Pad_D1.5mm",
    "TP7": f"{base.PROJECT_NAME}:TestPoint_Pad_D1.5mm",
    "TP8": f"{base.PROJECT_NAME}:TestPoint_Pad_D1.5mm",
}

for ref in [f"R{i}" for i in range(1, 19)] + [f"C{i}" for i in range(1, 10)]:
    if ref.startswith("R"):
        EV1_FOOTPRINT_OVERRIDES.setdefault(ref, f"{base.PROJECT_NAME}:R_0603_1608Metric")
    else:
        EV1_FOOTPRINT_OVERRIDES.setdefault(ref, f"{base.PROJECT_NAME}:C_0603_1608Metric")


def apply_ev1_overrides() -> None:
    ensure_mounting_hole_contract()
    for inst in base.INSTANCES:
        override = EV1_FOOTPRINT_OVERRIDES.get(inst.ref)
        if override:
            inst.footprint = override


PLACEMENTS = {
    # The ESP32 antenna courtyard/keepout exits the left board edge. This keeps
    # the active module pads inside the PCB while preserving a no-copper zone.
    "U1": (22.0, 17.0, 90.0),
    "J1": (42.0, 4.6, 180.0),
    "U2": (46.5, 16.4, 0.0),
    "U3": (58.0, 18.4, 0.0),
    "J2": (67.0, 18.8, 0.0),
    "U4": (38.0, 22.6, 0.0),
    "J3": (39.0, 35.8, 0.0),
    "D10": (58.0, 30.0, 0.0),
    "BZ1": (49.5, 25.8, 0.0),
    "U5": (51.5, 11.6, 270.0),
    "U6": (63.0, 25.8, 270.0),
    "F1": (37.0, 12.0, 0.0),
    "F2": (62.8, 9.5, 0.0),
    "D1": (40.6, 14.0, 90.0),
    "D2": (58.0, 12.5, 90.0),
    "D3": (30.0, 4.0, 90.0),
    "R1": (33.0, 14.8, 90.0),
    "R2": (48.8, 7.0, 90.0),
    "R3": (35.0, 29.8, 90.0),
    "R4": (35.0, 33.2, 90.0),
    "R13": (53.6, 30.0, 90.0),
    "R14": (65.6, 28.3, 0.0),
    "R15": (62.0, 32.0, 0.0),
    "R16": (27.0, 4.0, 90.0),
    "R17": (45.0, 30.0, 0.0),
    "R18": (59.2, 24.2, 0.0),
    "Q1": (52.8, 15.0, 90.0),
    "Q2": (42.8, 24.0, 90.0),
    "Q3": (49.0, 33.0, 180.0),
    "C1": (41.0, 18.2, 90.0),
    "C2": (41.0, 22.8, 90.0),
    "C3": (20.0, 31.2, 90.0),
    "C4": (50.2, 12.0, 90.0),
    "C5": (50.2, 16.8, 90.0),
    "C6": (61.8, 15.4, 90.0),
    "C7": (62.0, 21.4, 90.0),
    "C8": (27.2, 19.8, 90.0),
    "C9": (35.0, 23.4, 90.0),
    "SW1": (7.0, 24.0, 90.0),
    "SW2": (7.0, 31.8, 90.0),
    "SW3": (22.0, 34.6, 180.0),
    "SW4": (40.0, 34.6, 180.0),
    "SW5": (58.0, 34.6, 180.0),
    "TP1": (10.0, 4.0, 0.0),
    "TP2": (13.0, 4.0, 0.0),
    "TP3": (16.0, 4.0, 0.0),
    "TP4": (19.0, 4.0, 0.0),
    "TP5": (24.0, 4.0, 0.0),
    "TP6": (49.0, 4.0, 0.0),
    "TP7": (52.0, 4.0, 0.0),
    "TP8": (55.0, 4.0, 0.0),
}

MOUNTING_HOLES = {
    "MH1": (4.5, 4.5),
    "MH2": (67.5, 4.5),
    "MH3": (13.0, 33.5),
    "MH4": (67.5, 33.5),
}

for ref, (x, y) in MOUNTING_HOLES.items():
    PLACEMENTS[ref] = (x, y, 0.0)


def ensure_mounting_hole_contract() -> None:
    """Expose M2 holes to schematic parity without adding them to the BOM."""
    if not any(sym.name == "MOUNTING_HOLE_M2" for sym in base.SYMBOLS):
        base.SYMBOLS.append(
            base.SymbolDef("MOUNTING_HOLE_M2", "MH", "M2 Mount", (-3, -3, 3, 3), [])
        )

    existing_refs = {inst.ref for inst in base.INSTANCES}
    for ref in MOUNTING_HOLES:
        if ref not in existing_refs:
            base.INSTANCES.append(
                base.Instance(
                    ref,
                    "MOUNTING_HOLE_M2",
                    "M2 NPTH",
                    f"{base.PROJECT_NAME}:MountingHole_2.2mm_M2",
                    (0, 0),
                    (0, 0),
                    (0, 0),
                    {},
                    on_board=True,
                    in_bom=False,
                )
            )


def unconnected_net_name(ref: str, pin: base.PinDef) -> str:
    return f"unconnected-({ref}-{pin.name}-Pad{pin.num})"


def schematic_only_nets() -> set[str]:
    smap = base.symbol_map()
    names: set[str] = set()
    for inst in base.INSTANCES:
        sym = smap[inst.symbol]
        for pin in sym.pins:
            if pin.etype == "no_connect" and pin.num not in inst.connect:
                names.add(unconnected_net_name(inst.ref, pin))
    return names


def mm(value: float) -> int:
    return pcbnew.FromMM(value)


def vec(x: float, y: float) -> pcbnew.VECTOR2I:
    return pcbnew.VECTOR2I(mm(x), mm(y))


def add_segment(
    board: pcbnew.BOARD,
    layer: int,
    start: tuple[float, float],
    end: tuple[float, float],
    width: float,
) -> None:
    shape = pcbnew.PCB_SHAPE(board)
    shape.SetShape(pcbnew.S_SEGMENT)
    shape.SetLayer(layer)
    shape.SetStart(vec(*start))
    shape.SetEnd(vec(*end))
    shape.SetWidth(mm(width))
    board.Add(shape)


def add_text(
    board: pcbnew.BOARD,
    text: str,
    at: tuple[float, float],
    layer: int = pcbnew.F_SilkS,
    size: float = 1.0,
) -> None:
    item = pcbnew.PCB_TEXT(board)
    item.SetText(text)
    item.SetLayer(layer)
    item.SetPosition(vec(*at))
    item.SetTextSize(pcbnew.VECTOR2I(mm(size), mm(size)))
    item.SetTextThickness(mm(0.12))
    board.Add(item)


def add_rect(
    board: pcbnew.BOARD,
    layer: int,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    width: float = 0.1,
) -> None:
    add_segment(board, layer, (x1, y1), (x2, y1), width)
    add_segment(board, layer, (x2, y1), (x2, y2), width)
    add_segment(board, layer, (x2, y2), (x1, y2), width)
    add_segment(board, layer, (x1, y2), (x1, y1), width)


def add_track(
    board: pcbnew.BOARD,
    net: pcbnew.NETINFO_ITEM,
    layer: int,
    start: tuple[float, float],
    end: tuple[float, float],
    width: float,
) -> None:
    track = pcbnew.PCB_TRACK(board)
    track.SetNet(net)
    track.SetLayer(layer)
    track.SetStart(vec(*start))
    track.SetEnd(vec(*end))
    track.SetWidth(mm(width))
    board.Add(track)


def add_path(
    board: pcbnew.BOARD,
    nets: dict[str, pcbnew.NETINFO_ITEM],
    net_name: str,
    points: list[tuple[float, float]],
    layer: int = pcbnew.F_Cu,
    width: float = 0.25,
) -> None:
    if len(points) < 2:
        return
    for start, end in zip(points, points[1:]):
        if start != end:
            add_track(board, nets[net_name], layer, start, end, width)


def add_via(
    board: pcbnew.BOARD,
    nets: dict[str, pcbnew.NETINFO_ITEM],
    net_name: str,
    at: tuple[float, float],
    drill: float = 0.3,
    diameter: float = 0.65,
) -> None:
    via = pcbnew.PCB_VIA(board)
    via.SetNet(nets[net_name])
    via.SetViaType(pcbnew.VIATYPE_THROUGH)
    via.SetDrill(mm(drill))
    via.SetWidth(mm(diameter))
    via.SetPosition(vec(*at))
    board.Add(via)


def clear_copper_routes(board: pcbnew.BOARD) -> None:
    for track in list(board.GetTracks()):
        board.Remove(track)


def apply_route_overlay(board: pcbnew.BOARD, nets: dict[str, pcbnew.NETINFO_ITEM]) -> None:
    """Replay the validated EV1 copper route set used for prototype exports."""
    data = json.loads(ROUTE_OVERLAY_PATH.read_text(encoding="utf-8"))
    if data.get("format") != "aetherguard-ev1-route-overlay-v1":
        raise RuntimeError(f"Unsupported EV1 route overlay format: {data.get('format')}")
    clear_copper_routes(board)
    for item in data["items"]:
        net_name = item["net"]
        if net_name not in nets:
            raise RuntimeError(f"Route overlay references unknown net: {net_name}")
        if item["type"] == "segment":
            add_track(
                board,
                nets[net_name],
                LAYER_BY_NAME[item["layer"]],
                tuple(item["start"]),
                tuple(item["end"]),
                item["width"],
            )
        elif item["type"] == "via":
            via = pcbnew.PCB_VIA(board)
            via.SetNet(nets[net_name])
            via.SetViaType(pcbnew.VIATYPE_THROUGH)
            via.SetDrill(mm(item["drill"]))
            via.SetWidth(mm(item["diameter"]))
            via.SetPosition(vec(*item["at"]))
            via.SetLayerPair(LAYER_BY_NAME[item["layers"][0]], LAYER_BY_NAME[item["layers"][1]])
            board.Add(via)
        else:
            raise RuntimeError(f"Unsupported route overlay item type: {item['type']}")


def add_micro_escape_via(
    board: pcbnew.BOARD,
    nets: dict[str, pcbnew.NETINFO_ITEM],
    net_name: str,
    at: tuple[float, float],
) -> None:
    add_via(board, nets, net_name, at, 0.20, 0.35)


def add_filled_via(
    board: pcbnew.BOARD,
    nets: dict[str, pcbnew.NETINFO_ITEM],
    net_name: str,
    at: tuple[float, float],
    drill: float = 0.20,
    diameter: float = 0.35,
) -> None:
    add_via(board, nets, net_name, at, drill, diameter)


def add_rect_zone(
    board: pcbnew.BOARD,
    nets: dict[str, pcbnew.NETINFO_ITEM],
    net_name: str,
    layer: int,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    priority: int = 0,
) -> None:
    zone = pcbnew.ZONE(board)
    zone.SetLayer(layer)
    layer_set = pcbnew.LSET()
    layer_set.AddLayer(layer)
    zone.SetLayerSet(layer_set)
    zone.SetNetCode(nets[net_name].GetNetCode())
    zone.SetPadConnection(pcbnew.ZONE_CONNECTION_FULL)
    zone.SetLocalClearance(mm(0.22))
    zone.SetMinThickness(mm(0.20))
    zone.SetAssignedPriority(priority)
    outline = zone.Outline()
    outline.NewOutline()
    outline.Append(mm(x1), mm(y1))
    outline.Append(mm(x2), mm(y1))
    outline.Append(mm(x2), mm(y2))
    outline.Append(mm(x1), mm(y2))
    board.Add(zone)


def add_keepout_rect(
    board: pcbnew.BOARD,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
) -> None:
    zone = pcbnew.ZONE(board)
    zone.SetIsRuleArea(True)
    zone.SetDoNotAllowTracks(True)
    zone.SetDoNotAllowVias(True)
    zone.SetDoNotAllowPads(True)
    zone.SetDoNotAllowCopperPour(True)
    zone.SetDoNotAllowFootprints(False)
    layer_set = pcbnew.LSET()
    for layer in (pcbnew.F_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu, pcbnew.B_Cu):
        layer_set.AddLayer(layer)
    zone.SetLayerSet(layer_set)
    zone.SetLocalClearance(mm(0.25))
    outline = zone.Outline()
    outline.NewOutline()
    outline.Append(mm(x1), mm(y1))
    outline.Append(mm(x2), mm(y1))
    outline.Append(mm(x2), mm(y2))
    outline.Append(mm(x1), mm(y2))
    board.Add(zone)


def pad_lookup(board: pcbnew.BOARD, ref: str, pad_num: str) -> list[pcbnew.PAD]:
    fp = board.FindFootprintByReference(ref)
    if fp is None:
        raise ValueError(f"missing footprint {ref}")
    pads = [pad for pad in fp.Pads() if pad.GetNumber() == str(pad_num)]
    if not pads:
        raise ValueError(f"missing pad {ref}.{pad_num}")
    pads.sort(key=lambda pad: (pad.GetPosition().x, pad.GetPosition().y))
    return pads


def pp(board: pcbnew.BOARD, ref: str, pad_num: str, index: int = 0) -> tuple[float, float]:
    pad = pad_lookup(board, ref, pad_num)[index]
    pos = pad.GetPosition()
    return pcbnew.ToMM(pos.x), pcbnew.ToMM(pos.y)


def route_manhattan(
    board: pcbnew.BOARD,
    nets: dict[str, pcbnew.NETINFO_ITEM],
    net_name: str,
    a: tuple[float, float],
    b: tuple[float, float],
    layer: int = pcbnew.F_Cu,
    width: float = 0.25,
    mid: tuple[float, float] | None = None,
) -> None:
    if mid is None:
        mid = (a[0], b[1])
    add_path(board, nets, net_name, [a, mid, b], layer, width)


def route_chain(
    board: pcbnew.BOARD,
    nets: dict[str, pcbnew.NETINFO_ITEM],
    net_name: str,
    pads: list[tuple[str, str] | tuple[str, str, int]],
    layer: int = pcbnew.F_Cu,
    width: float = 0.25,
) -> None:
    points = []
    for item in pads:
        if len(item) == 2:
            points.append(pp(board, item[0], item[1]))
        else:
            points.append(pp(board, item[0], item[1], item[2]))
    for a, b in zip(points, points[1:]):
        route_manhattan(board, nets, net_name, a, b, layer, width)


def bridge_duplicate_pads(
    board: pcbnew.BOARD,
    nets: dict[str, pcbnew.NETINFO_ITEM],
    ref: str,
    pad_num: str,
    layer: int = pcbnew.F_Cu,
    width: float = 0.35,
) -> None:
    pads = pad_lookup(board, ref, pad_num)
    if len(pads) < 2:
        return
    net_name = pads[0].GetNetname()
    points = []
    for pad in pads:
        pos = pad.GetPosition()
        points.append((pcbnew.ToMM(pos.x), pcbnew.ToMM(pos.y)))
    add_path(board, nets, net_name, points, layer, width)


def net_pads(board: pcbnew.BOARD, net_name: str) -> list[pcbnew.PAD]:
    pads: list[pcbnew.PAD] = []
    for fp in board.GetFootprints():
        for pad in fp.Pads():
            if pad.GetNetname() == net_name:
                pads.append(pad)
    pads.sort(key=lambda pad: (pad.GetPosition().x, pad.GetPosition().y))
    return pads


def pad_xy(pad: pcbnew.PAD) -> tuple[float, float]:
    pos = pad.GetPosition()
    return pcbnew.ToMM(pos.x), pcbnew.ToMM(pos.y)


def pad_is_smd(pad: pcbnew.PAD) -> bool:
    return pad.GetAttribute() == pcbnew.PAD_ATTRIB_SMD


def route_net_bus(
    board: pcbnew.BOARD,
    nets: dict[str, pcbnew.NETINFO_ITEM],
    net_name: str,
    lane_y: float,
    horizontal_layer: int = pcbnew.B_Cu,
    vertical_layer: int = pcbnew.In2_Cu,
    width: float = 0.15,
    via_drill: float = 0.20,
    via_diameter: float = 0.45,
) -> None:
    pads = net_pads(board, net_name)
    if len(pads) < 2:
        return

    lane_points: list[tuple[float, float]] = []
    for pad in pads:
        x, y = pad_xy(pad)
        lane = (x, lane_y)
        if pad_is_smd(pad):
            add_via(board, nets, net_name, (x, y), via_drill, via_diameter)
        if horizontal_layer != vertical_layer:
            add_via(board, nets, net_name, lane, via_drill, via_diameter)
        add_track(board, nets[net_name], vertical_layer, (x, y), lane, width)
        lane_points.append(lane)

    trunk: list[tuple[float, float]] = []
    for point in sorted(lane_points):
        if point not in trunk:
            trunk.append(point)
    add_path(board, nets, net_name, trunk, horizontal_layer, width)


def stitch_net_pads(
    board: pcbnew.BOARD,
    nets: dict[str, pcbnew.NETINFO_ITEM],
    net_name: str,
    drill: float = 0.20,
    diameter: float = 0.35,
) -> None:
    for pad in net_pads(board, net_name):
        if pad_is_smd(pad):
            add_filled_via(board, nets, net_name, pad_xy(pad), drill, diameter)


def add_plane_stitch_vias(
    board: pcbnew.BOARD,
    nets: dict[str, pcbnew.NETINFO_ITEM],
) -> None:
    """Fan power/ground SMD pads into the right-side copper planes.

    The ESP32 antenna keepout occupies the left side of the EV1 board.  Vias
    inside that region become dangling, so only stitch pads inside the routed
    electronics area where GND/3V3 pours exist.
    """
    existing = {
        (track.GetNetname(), round(pcbnew.ToMM(track.GetPosition().x), 3), round(pcbnew.ToMM(track.GetPosition().y), 3))
        for track in board.GetTracks()
        if isinstance(track, pcbnew.PCB_VIA)
    }
    qfn_escape_exclusions = {
        ("U2", "2"),
        ("U2", "5"),
        ("U2", "6"),
        ("U2", "7"),
        ("U2", "9"),
        ("U2", "25"),
        ("U3", "2"),
        ("U3", "5"),
        ("U3", "6"),
        ("U3", "7"),
        ("U3", "25"),
    }
    for pad in net_pads(board, "3V3") + net_pads(board, "GND"):
        if not pad_is_smd(pad):
            continue
        if (pad.GetParentFootprint().GetReference(), pad.GetNumber()) in qfn_escape_exclusions:
            continue
        x, y = pad_xy(pad)
        if x < 18.5:
            continue
        key = (pad.GetNetname(), round(x, 3), round(y, 3))
        if key not in existing:
            add_filled_via(board, nets, pad.GetNetname(), (x, y), 0.20, 0.45)
            existing.add(key)


def clear_component_silkscreen(fp: pcbnew.FOOTPRINT) -> None:
    for item in list(fp.GraphicalItems()):
        if item.GetLayer() == pcbnew.F_SilkS:
            fp.Remove(item)


def add_board_outline(board: pcbnew.BOARD) -> None:
    add_segment(board, pcbnew.Edge_Cuts, (0, 0), (BOARD_W, 0), EDGE_W)
    add_segment(board, pcbnew.Edge_Cuts, (BOARD_W, 0), (BOARD_W, BOARD_H), EDGE_W)
    add_segment(board, pcbnew.Edge_Cuts, (BOARD_W, BOARD_H), (0, BOARD_H), EDGE_W)
    add_segment(board, pcbnew.Edge_Cuts, (0, BOARD_H), (0, 0), EDGE_W)


def add_mounting_holes(board: pcbnew.BOARD) -> None:
    # Mounting holes are emitted through base.INSTANCES so KiCad schematic
    # parity can match them.  Keep this as a no-op compatibility hook.
    return


def stamp_footprint_identity(fp: pcbnew.FOOTPRINT, inst: base.Instance) -> None:
    fp.SetReference(inst.ref)
    fp.SetValue(inst.value)
    fp.SetLink(pcbnew.KIID(inst.uuid))
    # KiCad 9 schematic parity matches footprints against the full schematic
    # instance path, not just the symbol UUID.  The generated EV1 schematic is
    # a single-root sheet, so the PCB path must be /<root-sheet>/<symbol>.
    fp.SetPath(pcbnew.KIID_PATH(f"/{base.uid('schematic-root')}/{inst.uuid}"))
    fp.SetSheetname("/")
    fp.SetSheetfile(SCH_FILENAME)
    fp.SetFPIDAsString(inst.footprint)


def add_footprints(board: pcbnew.BOARD, nets: dict[str, pcbnew.NETINFO_ITEM]) -> None:
    smap = base.symbol_map()
    pad_alias_nets = {
        "J1": {
            "A1": "GND",
            "A4": "VBUS_USB_C_RAW",
            "A5": "USB_CC1",
            "A6": "USB_C_DP",
            "A7": "USB_C_DN",
            "A9": "VBUS_USB_C_RAW",
            "A12": "GND",
            "B1": "GND",
            "B4": "VBUS_USB_C_RAW",
            "B5": "USB_CC2",
            "B6": "USB_C_DP",
            "B7": "USB_C_DN",
            "B9": "VBUS_USB_C_RAW",
            "B12": "GND",
            "S1": "GND",
        },
    }
    for inst in base.INSTANCES:
        if not inst.on_board:
            continue
        fp_path, name = base.fp_path(inst.footprint)
        fp = pcbnew.FootprintLoad(str(fp_path), name)
        stamp_footprint_identity(fp, inst)
        fp.Reference().SetVisible(False)
        fp.Value().SetVisible(False)
        if inst.ref in {"U1", "D1", "D2"}:
            clear_component_silkscreen(fp)
        x, y, angle = PLACEMENTS[inst.ref]
        fp.SetPosition(vec(x, y))
        fp.SetOrientationDegrees(angle)
        if inst.ref in MOUNTING_HOLES:
            fp.SetLocked(True)
            fp.SetExcludedFromBOM(True)
            fp.SetExcludedFromPosFiles(True)
        board.Add(fp)
        pins_by_num = {pin.num: pin for pin in smap[inst.symbol].pins}
        for pad in fp.Pads():
            net_name = inst.connect.get(pad.GetNumber())
            if not net_name:
                net_name = pad_alias_nets.get(inst.ref, {}).get(pad.GetNumber())
            if not net_name:
                pin = pins_by_num.get(pad.GetNumber())
                if pin and pin.etype == "no_connect":
                    net_name = unconnected_net_name(inst.ref, pin)
            if net_name:
                pad.SetNet(nets[net_name])


def add_ev1_routes(board: pcbnew.BOARD, nets: dict[str, pcbnew.NETINFO_ITEM]) -> None:
    for ref in ("SW1", "SW2", "SW3", "SW4", "SW5"):
        for pad_num in ("1", "2"):
            try:
                bridge_duplicate_pads(board, nets, ref, pad_num, pcbnew.F_Cu, 0.22)
            except ValueError:
                continue

    # Keep only DRC-safe local routes in the deterministic baseline.  Global
    # routing is exported through DSN and must pass DRC before Gerbers are gated
    # open in the factory package.
    add_path(board, nets, "PWR_LED_N", [pp(board, "R16", "2"), pp(board, "D3", "2")], pcbnew.F_Cu, 0.16)
    add_path(board, nets, "USB_C_DP", [(41.25, 8.645), (41.25, 7.45), (42.25, 7.45), (42.25, 8.645)], pcbnew.F_Cu, 0.15)
    add_path(board, nets, "USB_C_DN", [(41.75, 8.645), (41.75, 9.85), (42.75, 9.85), (42.75, 8.645)], pcbnew.F_Cu, 0.15)
    add_path(board, nets, "LED_R", [(53.6, 30.85), (56.85, 29.05)], pcbnew.F_Cu, 0.12)
    add_path(board, nets, "LED_G", [(64.75, 28.3), (59.15, 30.95)], pcbnew.F_Cu, 0.12)
    add_via(board, nets, "LED_B", (61.15, 32.0), 0.20, 0.45)
    add_via(board, nets, "LED_B", (59.15, 29.05), 0.20, 0.45)
    add_path(board, nets, "LED_B", [(61.15, 32.0), (59.15, 29.05)], pcbnew.In2_Cu, 0.12)
    add_path(board, nets, "BUZZER_CTRL_DRV", [(45.85, 30.0), (50.35, 33.95)], pcbnew.F_Cu, 0.12)
    add_via(board, nets, "BUZZER_SW", (47.65, 33.0), 0.20, 0.45)
    add_via(board, nets, "BUZZER_SW", (52.75, 25.8), 0.20, 0.45)
    add_path(board, nets, "BUZZER_SW", [(47.65, 33.0), (52.75, 25.8)], pcbnew.In2_Cu, 0.18)
    add_path(board, nets, "3V3", [(44.5375, 17.149999), (44.5375, 17.649999)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "3V3", [(56.0375, 19.65), (56.0375, 19.15)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "3V3", [(44.5375, 17.649999), (45.25, 18.362499)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "3V3", [(56.75, 20.3625), (56.0375, 19.65)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(37.68, 7.73), (38.75, 8.645)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(46.32, 7.73), (45.25, 8.645)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(35.0, 22.55), (36.65, 22.6)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "3V3", [(41.0, 23.65), (39.35, 21.65)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(56.0, 33.5), (56.85, 30.95)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(46.32, 7.73), (48.8, 6.15)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "3V3", [(35.0, 24.25), (35.19, 27.3)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(61.8, 14.55), (65.2, 15.05)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(48.8, 6.15), (46.32, 3.55)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(31.255, 22.715), (35.0, 22.55)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(8.1, 26.0), (8.1, 29.8)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(37.68, 7.73), (37.68, 3.55)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "VBUS_USB_C_PROT", [(38.45, 12.0), (40.6, 15.8)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(41.0, 21.95), (43.75, 25.35)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(13.0, 4.0), (13.745, 8.5)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "5V_SYS", [(41.0, 19.05), (36.65, 21.65)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(50.55, 10.25), (46.32, 7.73)], pcbnew.F_Cu, 0.18)
    add_path(board, nets, "GND", [(8.1, 26.0), (13.745, 25.5)], pcbnew.F_Cu, 0.16)
    add_path(board, nets, "GND", [(56.0, 33.5), (50.35, 32.05)], pcbnew.F_Cu, 0.16)
    add_path(board, nets, "GND", [(27.2, 18.95), (21.245, 18.0)], pcbnew.F_Cu, 0.16)
    add_path(board, nets, "3V3", [(50.2, 17.65), (56.0375, 19.65)], pcbnew.F_Cu, 0.16)
    add_path(board, nets, "GND", [(37.73, 27.3), (38.0, 33.5)], pcbnew.F_Cu, 0.16)
    add_path(board, nets, "3V3", [(44.5375, 17.649999), (39.35, 21.65)], pcbnew.F_Cu, 0.16)
    add_path(board, nets, "VBUS_HOST_PROT", [(58.0, 14.3), (64.25, 9.5)], pcbnew.F_Cu, 0.16)
    add_path(board, nets, "GND", [(30.0, 4.85), (37.68, 7.73)], pcbnew.F_Cu, 0.16)
    add_path(board, nets, "GND", [(13.745, 8.5), (13.745, 18.0), (21.245, 18.0)], pcbnew.F_Cu, 0.16)
    add_path(board, nets, "GND", [(13.745, 25.5), (13.745, 18.0)], pcbnew.F_Cu, 0.16)
    add_path(board, nets, "HOST_CP2102_RST_N", [(57.75, 20.3625), (57.75, 22.2), (60.05, 22.2), (60.05, 24.2)], pcbnew.F_Cu, 0.15)
    add_path(board, nets, "USB_RTS", [(47.75, 14.4375), (47.75, 13.7375)], pcbnew.F_Cu, 0.12)
    add_via(board, nets, "USB_RTS", (47.75, 13.7375), 0.20, 0.45)
    add_via(board, nets, "USB_RTS", (51.85, 17.05), 0.20, 0.45)
    add_path(board, nets, "USB_RTS", [(47.75, 13.7375), (47.75, 7.0), (51.85, 7.0), (51.85, 17.05)], pcbnew.In1_Cu, 0.12)
    add_path(board, nets, "USB_RTS", [(51.85, 17.05), (51.85, 16.35)], pcbnew.F_Cu, 0.12)
    add_path(board, nets, "USB_DTR", [(41.85, 25.35), (41.85, 24.65)], pcbnew.F_Cu, 0.12)
    add_via(board, nets, "USB_DTR", (41.85, 24.65), 0.20, 0.45)
    add_via(board, nets, "USB_DTR", (45.75, 13.737499), 0.20, 0.45)
    add_path(board, nets, "USB_DTR", [(41.85, 24.65), (41.85, 13.737499), (45.75, 13.737499)], pcbnew.In1_Cu, 0.12)
    add_path(board, nets, "USB_DTR", [(45.75, 13.737499), (45.75, 14.437499)], pcbnew.F_Cu, 0.12)
    add_path(board, nets, "HOST_DN", [(63.0, 27.15), (63.0, 26.45)], pcbnew.F_Cu, 0.12)
    add_via(board, nets, "HOST_DN", (63.0, 26.45), 0.20, 0.45)
    add_via(board, nets, "HOST_DN", (65.2, 19.35), 0.20, 0.45)
    add_path(board, nets, "HOST_DN", [(63.0, 26.45), (63.0, 19.35), (65.2, 19.35)], pcbnew.In2_Cu, 0.12)
    add_path(board, nets, "HOST_DN", [(65.2, 19.35), (65.2, 20.05)], pcbnew.F_Cu, 0.12)
    add_path(board, nets, "HOST_DP", [(56.0375, 18.15), (55.3375, 18.15)], pcbnew.F_Cu, 0.12)
    add_via(board, nets, "HOST_DP", (55.3375, 18.15), 0.20, 0.45)
    add_via(board, nets, "HOST_DP", (65.2, 16.85), 0.20, 0.45)
    add_path(board, nets, "HOST_DP", [(55.3375, 18.15), (55.3375, 16.85), (65.2, 16.85)], pcbnew.In1_Cu, 0.12)
    add_path(board, nets, "HOST_DP", [(65.2, 16.85), (65.2, 17.55)], pcbnew.F_Cu, 0.12)
    add_path(board, nets, "HOST_DP", [(63.95, 24.45), (64.65, 24.45)], pcbnew.F_Cu, 0.12)
    add_via(board, nets, "HOST_DP", (64.65, 24.45), 0.20, 0.45)
    add_via(board, nets, "HOST_DP", (65.9, 17.55), 0.20, 0.45)
    add_path(board, nets, "HOST_DP", [(64.65, 24.45), (65.9, 24.45), (65.9, 17.55)], pcbnew.B_Cu, 0.12)
    add_path(board, nets, "HOST_DP", [(65.9, 17.55), (65.2, 17.55)], pcbnew.F_Cu, 0.12)
    add_path(board, nets, "HOST_DN", [(56.0375, 18.65), (54.7, 18.65)], pcbnew.F_Cu, 0.10)
    add_via(board, nets, "HOST_DN", (54.7, 18.65), 0.20, 0.45)
    add_path(board, nets, "HOST_DN", [(54.7, 18.65), (54.7, 27.2), (63.0, 27.2), (63.0, 26.45)], pcbnew.B_Cu, 0.12)
    add_path(board, nets, "USB_C_DN", [(44.5375, 16.65), (43.75, 16.65)], pcbnew.F_Cu, 0.09)
    add_micro_escape_via(board, nets, "USB_C_DN", (43.75, 16.65))
    add_micro_escape_via(board, nets, "USB_C_DN", (41.75, 10.55))
    add_path(board, nets, "USB_C_DN", [(43.75, 16.65), (43.75, 10.55), (41.75, 10.55)], pcbnew.B_Cu, 0.10)
    add_path(board, nets, "USB_C_DN", [(41.75, 10.55), (41.75, 9.85)], pcbnew.F_Cu, 0.10)
    add_micro_escape_via(board, nets, "USB_C_DN", (51.15, 13.65))
    add_path(board, nets, "USB_C_DN", [(43.75, 16.65), (51.15, 16.65), (51.15, 13.65)], pcbnew.B_Cu, 0.10)
    add_path(board, nets, "USB_C_DN", [(51.15, 13.65), (51.5, 12.95)], pcbnew.F_Cu, 0.10)
    add_path(board, nets, "USB_C_DP", [(44.5375, 16.15), (43.2, 16.15)], pcbnew.F_Cu, 0.09)
    add_micro_escape_via(board, nets, "USB_C_DP", (43.2, 16.15))
    add_micro_escape_via(board, nets, "USB_C_DP", (42.25, 7.95))
    add_path(board, nets, "USB_C_DP", [(43.2, 16.15), (43.2, 7.95), (42.25, 7.95)], pcbnew.In2_Cu, 0.10)
    add_path(board, nets, "USB_C_DP", [(42.25, 7.95), (42.25, 7.45)], pcbnew.F_Cu, 0.10)
    add_micro_escape_via(board, nets, "USB_C_DP", (52.8, 9.55))
    add_path(board, nets, "USB_C_DP", [(43.2, 16.15), (43.2, 12.2), (52.8, 12.2), (52.8, 9.55)], pcbnew.In2_Cu, 0.10)
    add_path(board, nets, "USB_C_DP", [(52.8, 9.55), (52.45, 10.25)], pcbnew.F_Cu, 0.10)
    add_path(board, nets, "UART2_RX", [(58.75, 16.4375), (58.75, 15.7375)], pcbnew.F_Cu, 0.10)
    add_micro_escape_via(board, nets, "UART2_RX", (58.75, 15.7375))
    add_micro_escape_via(board, nets, "UART2_RX", (55.0, 4.7))
    add_path(board, nets, "UART2_RX", [(58.75, 15.7375), (58.75, 4.7), (55.0, 4.7)], pcbnew.B_Cu, 0.10)
    add_path(board, nets, "UART2_RX", [(55.0, 4.7), (55.0, 4.0)], pcbnew.F_Cu, 0.10)
    add_path(board, nets, "UART2_TX", [(58.25, 16.4375), (58.25, 15.45)], pcbnew.F_Cu, 0.10)
    add_micro_escape_via(board, nets, "UART2_TX", (58.25, 15.45))
    add_micro_escape_via(board, nets, "UART2_TX", (52.0, 5.25))
    add_path(board, nets, "UART2_TX", [(58.25, 15.45), (58.25, 5.25), (52.0, 5.25)], pcbnew.In1_Cu, 0.10)
    add_path(board, nets, "UART2_TX", [(52.0, 5.25), (52.0, 4.0)], pcbnew.F_Cu, 0.10)
    add_path(board, nets, "UART0_RX", [(47.25, 14.4375), (47.25, 13.35)], pcbnew.F_Cu, 0.10)
    add_micro_escape_via(board, nets, "UART0_RX", (47.25, 13.35))
    add_micro_escape_via(board, nets, "UART0_RX", (49.0, 4.7))
    add_path(board, nets, "UART0_RX", [(47.25, 13.35), (47.25, 4.7), (49.0, 4.7)], pcbnew.B_Cu, 0.10)
    add_path(board, nets, "UART0_RX", [(49.0, 4.7), (49.0, 4.0)], pcbnew.F_Cu, 0.10)
    add_micro_escape_via(board, nets, "BUZZER_CTRL", (28.985, 25.5))
    add_micro_escape_via(board, nets, "BUZZER_CTRL", (44.15, 30.0))
    add_path(board, nets, "BUZZER_CTRL", [(28.985, 25.5), (28.985, 30.0), (44.15, 30.0)], pcbnew.B_Cu, 0.10)
    add_micro_escape_via(board, nets, "BTN_NEXT", (22.635, 8.5))
    add_micro_escape_via(board, nets, "BTN_NEXT", (38.0, 35.7))
    add_path(board, nets, "BTN_NEXT", [(22.635, 8.5), (22.635, 36.2), (38.0, 36.2), (38.0, 35.7)], pcbnew.In1_Cu, 0.10)
    add_micro_escape_via(board, nets, "BTN_OK", (23.905, 8.5))
    add_micro_escape_via(board, nets, "BTN_OK", (24.0, 35.7))
    add_path(board, nets, "BTN_OK", [(23.905, 8.5), (23.905, 31.0), (25.6, 31.0), (25.6, 35.7), (24.0, 35.7)], pcbnew.B_Cu, 0.10)
    add_micro_escape_via(board, nets, "BTN_BACK", (15.015, 8.5))
    add_micro_escape_via(board, nets, "BTN_BACK", (60.0, 35.7))
    add_path(board, nets, "BTN_BACK", [(15.015, 8.5), (15.015, 1.0), (63.0, 1.0), (63.0, 15.8), (66.6, 15.8), (66.6, 20.0), (64.0, 20.0), (64.0, 35.7), (60.0, 35.7)], pcbnew.In1_Cu, 0.10)
    add_micro_escape_via(board, nets, "LED_R_DRV", (25.175, 25.5))
    add_micro_escape_via(board, nets, "LED_R_DRV", (53.6, 29.15))
    add_path(board, nets, "LED_R_DRV", [(25.175, 25.5), (25.175, 29.15), (53.6, 29.15)], pcbnew.In1_Cu, 0.10)
    add_micro_escape_via(board, nets, "LED_B_DRV", (27.715, 25.5))
    add_micro_escape_via(board, nets, "LED_B_DRV", (62.85, 32.0))
    add_path(board, nets, "LED_B_DRV", [(27.715, 25.5), (27.715, 36.4), (62.85, 36.4), (62.85, 32.0)], pcbnew.B_Cu, 0.10)
    add_micro_escape_via(board, nets, "LED_G_DRV", (26.445, 25.5))
    add_micro_escape_via(board, nets, "LED_G_DRV", (66.45, 28.3))
    add_path(board, nets, "LED_G_DRV", [(26.445, 25.5), (26.445, 36.9), (65.0, 36.9), (65.0, 28.3), (66.45, 28.3)], pcbnew.B_Cu, 0.10)
    add_micro_escape_via(board, nets, "3V3", (15.015, 25.5))
    add_path(board, nets, "3V3", [(15.015, 25.5), (15.015, 20.65), (27.2, 20.65)], pcbnew.In2_Cu, 0.16)
    add_micro_escape_via(board, nets, "3V3", (10.0, 4.0))
    add_path(board, nets, "3V3", [(10.0, 4.0), (10.0, 2.8), (27.0, 2.8), (27.0, 4.85)], pcbnew.In2_Cu, 0.16)
    add_micro_escape_via(board, nets, "3V3", (46.25, 18.3625))
    add_path(board, nets, "3V3", [(46.25, 18.3625), (46.25, 17.65), (50.2, 17.65)], pcbnew.In2_Cu, 0.14)
    add_micro_escape_via(board, nets, "5V_SYS", (36.65, 21.65))
    add_micro_escape_via(board, nets, "5V_SYS", (36.65, 23.55))
    add_path(board, nets, "5V_SYS", [(36.65, 21.65), (35.6, 21.65), (35.6, 23.55), (36.65, 23.55)], pcbnew.B_Cu, 0.16)
    add_path(board, nets, "5V_SYS", [(40.6, 12.2), (42.0, 13.4), (42.0, 19.05), (41.0, 19.05)], pcbnew.F_Cu, 0.16)
    add_path(board, nets, "5V_SYS", [(40.6, 12.2), (49.3, 12.2), (58.0, 10.7)], pcbnew.F_Cu, 0.20)
    add_micro_escape_via(board, nets, "OLED_SCL", (16.285, 8.5))
    add_path(board, nets, "OLED_SCL", [(16.285, 8.5), (16.285, 2.0), (40.27, 2.0), (40.27, 27.3)], pcbnew.B_Cu, 0.10)
    add_micro_escape_via(board, nets, "OLED_SDA", (20.095, 8.5))
    add_micro_escape_via(board, nets, "OLED_SDA", (18.4, 1.6))
    add_path(board, nets, "OLED_SDA", [(20.095, 8.5), (20.095, 10.0), (18.4, 10.0), (18.4, 1.6)], pcbnew.In1_Cu, 0.10)
    add_path(board, nets, "OLED_SDA", [(18.4, 1.6), (41.2, 1.6), (41.2, 12.0), (42.3, 12.0), (42.3, 27.3), (42.81, 27.3)], pcbnew.B_Cu, 0.10)
    add_micro_escape_via(board, nets, "UART0_RX", (18.825, 8.5))
    add_path(board, nets, "UART0_RX", [(18.825, 8.5), (18.825, 2.2), (47.25, 2.2), (47.25, 13.35)], pcbnew.In1_Cu, 0.10)
    add_micro_escape_via(board, nets, "UART2_RX", (27.715, 8.5))
    add_path(board, nets, "UART2_RX", [(27.715, 8.5), (27.715, 1.8), (55.0, 1.8), (55.0, 4.7)], pcbnew.In2_Cu, 0.10)
    add_micro_escape_via(board, nets, "UART0_TX", (17.555, 8.5))
    add_micro_escape_via(board, nets, "UART0_TX", (24.0, 4.0))
    add_path(board, nets, "UART0_TX", [(17.555, 8.5), (17.555, 4.0), (24.0, 4.0)], pcbnew.B_Cu, 0.10)


def add_ev1_fabrication_layers(board: pcbnew.BOARD) -> None:
    add_rect(board, pcbnew.F_Fab, 0.5, 0.5, BOARD_W - 0.5, BOARD_H - 0.5, 0.08)
    add_rect(board, pcbnew.F_Fab, 0.5, 10.0, 18.0, 38.0, 0.08)
    add_text(board, "ANTENNA KEEP-OUT", (1.8, 12.0), pcbnew.F_Fab, 0.8)
    add_text(board, "OLED HEADER/TOP WINDOW", (27.0, 27.2), pcbnew.F_Fab, 0.75)
    add_text(board, "FRONT BUTTON LINE", (27.0, 33.0), pcbnew.F_Fab, 0.75)
    add_text(board, "USB-A PIGTAIL STRAIN RELIEF", (51.5, 24.8), pcbnew.F_Fab, 0.65)


def build_board() -> pcbnew.BOARD:
    apply_ev1_overrides()
    board = pcbnew.BOARD()
    board.SetCopperLayerCount(4)
    settings = board.GetDesignSettings()
    settings.m_MinThroughDrill = mm(0.2)
    settings.m_MinTrackWidth = mm(0.15)
    settings.m_MinClearance = mm(0.15)
    settings.m_CopperEdgeClearance = mm(0.25)
    settings.m_ViasMinSize = mm(0.35)
    settings.m_ViasMinAnnularWidth = mm(0.075)
    settings.m_AllowSoldermaskBridgesInFPs = True

    nets: dict[str, pcbnew.NETINFO_ITEM] = {}
    for name in sorted(set(base.NETS) | schematic_only_nets() | {"USB_C_VBUS_SENSE", "HOST_VBUS_SENSE"}):
        net = pcbnew.NETINFO_ITEM(board, name)
        board.Add(net)
        nets[name] = net

    add_board_outline(board)
    add_footprints(board, nets)
    add_mounting_holes(board)
    add_ev1_routes(board, nets)
    add_plane_stitch_vias(board, nets)
    apply_route_overlay(board, nets)

    add_rect_zone(board, nets, "GND", pcbnew.F_Cu, 18.5, 0.5, BOARD_W - 0.5, BOARD_H - 0.5, 0)
    add_rect_zone(board, nets, "GND", pcbnew.In1_Cu, 18.5, 0.5, BOARD_W - 0.5, BOARD_H - 0.5, 0)
    add_rect_zone(board, nets, "GND", pcbnew.B_Cu, 18.5, 0.5, BOARD_W - 0.5, BOARD_H - 0.5, 0)
    add_rect_zone(board, nets, "3V3", pcbnew.In2_Cu, 19.0, 0.8, BOARD_W - 0.8, BOARD_H - 0.8, 1)

    add_text(board, "AetherGuard EV1", (2.0, 36.5), pcbnew.F_Fab, 0.9)
    add_text(board, "USB-C SERVICE", (28.0, 2.0), pcbnew.F_Fab, 0.8)
    add_text(board, "TARGET PIGTAIL", (58.0, 9.0), pcbnew.F_Fab, 0.8)
    add_text(board, "ESP32 antenna keepout: no copper under module antenna", (3.0, 3.0), pcbnew.F_Fab, 0.8)
    add_ev1_fabrication_layers(board)

    return board


def fill_zones(board: pcbnew.BOARD) -> None:
    """Persist copper pours so KiCad DRC sees the same planes sent to fabrication."""
    filler = pcbnew.ZONE_FILLER(board)
    filler.Fill(board.Zones())


def ensure_saved_zone_fills() -> None:
    """KiCad can silently leave zones unfilled in scripted saves; guard that."""
    pcb_text = base.PCB_PATH.read_text(encoding="utf-8")
    if "(filled_polygon" in pcb_text:
        return
    board = pcbnew.LoadBoard(str(base.PCB_PATH))
    fill_zones(board)
    pcbnew.SaveBoard(str(base.PCB_PATH), board)
    pcb_text = base.PCB_PATH.read_text(encoding="utf-8")
    if "(filled_polygon" not in pcb_text:
        raise RuntimeError("EV1 PCB generation failed to persist filled copper zones")


def normalize_project_settings() -> None:
    """Keep KiCad project netclass aligned with EV1 manufacturing constraints."""
    project_path = base.ROOT / f"{base.PROJECT_NAME}.kicad_pro"
    text = project_path.read_text(encoding="utf-8")
    replacements = {
        '"clearance": 0.2': '"clearance": 0.15',
        '"diff_pair_gap": 0.25': '"diff_pair_gap": 0.15',
        '"diff_pair_via_gap": 0.25': '"diff_pair_via_gap": 0.15',
        '"diff_pair_width": 0.2': '"diff_pair_width": 0.15',
        '"track_width": 0.2': '"track_width": 0.15',
        '"via_diameter": 0.6': '"via_diameter": 0.45',
        '"via_drill": 0.3': '"via_drill": 0.2',
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    project_path.write_text(text, encoding="utf-8")


def main() -> None:
    base.REPORTS_DIR.mkdir(exist_ok=True)
    apply_ev1_overrides()
    base.write_symbol_library()
    base.write_schematic()
    board = build_board()
    pcbnew.SaveBoard(str(base.PCB_PATH), board)
    # KiCad's zone filler only persists filled polygons reliably after the
    # freshly generated board has been saved and reloaded with project context.
    board = pcbnew.LoadBoard(str(base.PCB_PATH))
    fill_zones(board)
    pcbnew.SaveBoard(str(base.PCB_PATH), board)
    ensure_saved_zone_fills()
    normalize_project_settings()


if __name__ == "__main__":
    main()
