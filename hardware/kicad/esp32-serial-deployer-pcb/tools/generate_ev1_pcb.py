from __future__ import annotations

from pathlib import Path

import pcbnew

import generate_pcb_v1 as base


BOARD_W = 72.0
BOARD_H = 38.0
EDGE_W = 0.1
SCH_FILENAME = "esp32-serial-deployer-pcb.kicad_sch"


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


def add_ev1_fabrication_layers(board: pcbnew.BOARD) -> None:
    add_rect(board, pcbnew.F_Fab, 0.5, 0.5, BOARD_W - 0.5, BOARD_H - 0.5, 0.08)
    add_rect(board, pcbnew.F_Fab, 0.5, 10.0, 18.0, 38.0, 0.08)
    add_text(board, "ANTENNA KEEP-OUT", (1.8, 12.0), pcbnew.F_Fab, 0.8)
    add_text(board, "OLED HEADER/TOP WINDOW", (27.0, 27.2), pcbnew.F_Fab, 0.75)
    add_text(board, "FRONT BUTTON LINE", (27.0, 33.0), pcbnew.F_Fab, 0.75)
    add_text(board, "USB-A PIGTAIL STRAIN RELIEF", (51.5, 24.8), pcbnew.F_Fab, 0.65)


def build_board() -> pcbnew.BOARD:
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


def main() -> None:
    base.REPORTS_DIR.mkdir(exist_ok=True)
    apply_ev1_overrides()
    base.write_symbol_library()
    base.write_schematic()
    pcbnew.SaveBoard(str(base.PCB_PATH), build_board())


if __name__ == "__main__":
    main()
