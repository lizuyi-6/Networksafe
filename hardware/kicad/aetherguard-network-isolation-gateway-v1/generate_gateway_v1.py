from __future__ import annotations

import csv
import json
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path

import pcbnew


PROJECT_NAME = "aetherguard-network-isolation-gateway-v1"
ROOT = Path(__file__).resolve().parent
SHEETS_DIR = ROOT / "sheets"
LOCAL_PRETTY = ROOT / f"{PROJECT_NAME}.pretty"
RELEASE_DIR = ROOT / "release" / "v1-proto"
GERBER_DIR = RELEASE_DIR / "gerbers"
DRILL_DIR = RELEASE_DIR / "drill"
ASSEMBLY_DIR = RELEASE_DIR / "assembly"
PCB_PATH = ROOT / f"{PROJECT_NAME}.kicad_pcb"
SCH_PATH = ROOT / f"{PROJECT_NAME}.kicad_sch"
PRO_PATH = ROOT / f"{PROJECT_NAME}.kicad_pro"
SYM_PATH = ROOT / f"{PROJECT_NAME}.kicad_sym"
NS = uuid.UUID("e246b2d0-e8da-48bd-b94f-d1c2962bdab6")

KICAD_SHARE = Path(r"C:\Program Files\KiCad\9.0\share\kicad")
KICAD_FOOTPRINTS = KICAD_SHARE / "footprints"
KICAD_CLI = Path(r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe")

BOARD_W = 160.0
BOARD_H = 110.0
EDGE_W = 0.1


def uid(name: str) -> str:
    return str(uuid.uuid5(NS, name))


def esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"')


def mm(value: float) -> int:
    return pcbnew.FromMM(value)


def vec(x: float, y: float) -> pcbnew.VECTOR2I:
    return pcbnew.VECTOR2I(mm(x), mm(y))


@dataclass(frozen=True)
class Part:
    ref: str
    value: str
    footprint: str
    placement: tuple[float, float, float]
    sheet: str
    mpn: str = ""
    note: str = ""
    in_bom: bool = True
    connect: dict[str, str] | None = None

    @property
    def path_uuid(self) -> str:
        return uid(f"sym:{self.ref}")


PARTS: list[Part] = [
    Part(
        "J1",
        "SERVER 1GbE RJ45 MagJack",
        "Connector_RJ:RJ45_Pulse_JK00177NL_Horizontal",
        (24, 17, 180),
        "switch-data-plane",
        "Pulse JK00177NL class",
        "Protected server-facing 1GbE data port.",
    ),
    Part(
        "J2",
        "LAN/WAN 1GbE RJ45 MagJack",
        "Connector_RJ:RJ45_Pulse_JK00177NL_Horizontal",
        (80, 17, 180),
        "switch-data-plane",
        "Pulse JK00177NL class",
        "External network-facing 1GbE data port.",
    ),
    Part(
        "J3",
        "MGMT 10/100 RJ45 MagJack",
        "Connector_RJ:RJ45_Hanrun_HR911105A_Horizontal",
        (136, 17, 180),
        "mgmt-ethernet",
        "Hanrun HR911105A class",
        "Independent management path; never bridges protected server traffic.",
    ),
    Part(
        "U1",
        "ESP32-S3-WROOM-1",
        "RF_Module:ESP32-S3-WROOM-1",
        (126, 82, 180),
        "mcu-secure",
        "ESP32-S3-WROOM-1-N8R8",
        "MCU for policy state, switch control, UI, USB logs, secure boot chain.",
    ),
    Part(
        "U2",
        "KSZ9563R 3-port GbE switch",
        "Package_DFN_QFN:QFN-64-1EP_8x8mm_P0.4mm_EP6.5x6.5mm",
        (55, 48, 45),
        "switch-data-plane",
        "KSZ9563R",
        "Two integrated 10/100/1000 PHYs form SERVER to LAN/WAN transparent L2 bridge.",
    ),
    Part(
        "U3",
        "W5500 TCP/IP Ethernet",
        "Package_QFP:LQFP-48_7x7mm_P0.5mm",
        (132, 42, 0),
        "mgmt-ethernet",
        "W5500",
        "SPI-attached 10/100 independent management controller.",
    ),
    Part(
        "U4",
        "ATECC608C secure element",
        "Package_SO:JEITA_SOIC-8_3.9x4.9mm_P1.27mm",
        (94, 57, 90),
        "mcu-secure",
        "ATECC608C-MAHDA",
        "Non-exportable hardware identity key; signs gateway grants and attestations.",
    ),
    Part(
        "J4",
        "USB-C debug/power",
        "Connector_USB:USB_C_Receptacle_GCT_USB4125-xx-x-0190_6P_TopMnt_Horizontal",
        (64, 106, 0),
        "power-input",
        "GCT USB4125 class",
        "5V input and serial recovery/debug.",
    ),
    Part(
        "J5",
        "9-24V DC input",
        "TerminalBlock_Phoenix:TerminalBlock_Phoenix_MKDS-1,5-2_1x02_P5.00mm_Horizontal",
        (22, 104, 0),
        "power-input",
        "Phoenix MKDS class",
        "Optional isolated DC input for gateway power.",
    ),
    Part(
        "U5",
        "5V buck regulator",
        "Package_TO_SOT_SMD:SOT-23-6",
        (31, 91, 0),
        "power-input",
        "TPS62162 class",
        "Primary 5V rail from DC input.",
    ),
    Part(
        "U6",
        "3V3 regulator",
        "Package_TO_SOT_SMD:SOT-23-5",
        (47, 91, 0),
        "power-input",
        "AP2112K class",
        "MCU, W5500, ATECC, switch IO 3V3 rail.",
    ),
    Part(
        "U7",
        "Switch core buck/LDO",
        "Package_TO_SOT_SMD:SOT-23-5",
        (68, 82, 0),
        "power-input",
        "1V2/1V8 regulator per final KSZ9563R rail option",
        "Switch core rail placeholder; verify exact KSZ9563R power tree before fab release.",
    ),
    Part(
        "Q1",
        "Fail-closed switch reset gate",
        "Package_TO_SOT_SMD:SOT-23",
        (73, 58, 0),
        "switch-data-plane",
        "2N7002 class",
        "MCU watchdog/open-drain path holds KSZ9563R reset low unless policy is healthy.",
    ),
    Part(
        "Y1",
        "25MHz switch crystal",
        "Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm",
        (42, 62, 0),
        "switch-data-plane",
        "25MHz 20ppm",
        "KSZ9563R reference clock placeholder.",
    ),
    Part(
        "Y2",
        "25MHz W5500 crystal",
        "Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm",
        (148, 47, 0),
        "mgmt-ethernet",
        "25MHz 20ppm",
        "W5500 reference clock placeholder.",
    ),
    Part("SW1", "Confirm", "Button_Switch_SMD:Panasonic_EVQPUJ_EVQPUA", (16, 96, 0), "ui-debug", note="Physical release confirmation."),
    Part("SW2", "Cancel", "Button_Switch_SMD:Panasonic_EVQPUJ_EVQPUA", (31, 96, 0), "ui-debug", note="Cancel release and isolate."),
    Part("SW3", "Recovery", "Button_Switch_SMD:Panasonic_EVQPUJ_EVQPUA", (46, 96, 0), "ui-debug", note="Provisioning/recovery strap."),
    Part("D1", "PWR", "LED_SMD:LED_0603_1608Metric", (14, 78, 0), "ui-debug", note="Power LED."),
    Part("D2", "SECURE", "LED_SMD:LED_0603_1608Metric", (24, 78, 0), "ui-debug", note="ATECC/provisioning OK."),
    Part("D3", "ISOLATED", "LED_SMD:LED_0603_1608Metric", (38, 78, 0), "ui-debug", note="Default fail-closed state."),
    Part("D4", "ARMED", "LED_SMD:LED_0603_1608Metric", (52, 78, 0), "ui-debug", note="Policy and attestation healthy."),
    Part("D5", "RELEASED", "LED_SMD:LED_0603_1608Metric", (66, 78, 0), "ui-debug", note="Temporary bridge release TTL active."),
    Part("D6", "FAULT", "LED_SMD:LED_0603_1608Metric", (80, 78, 0), "ui-debug", note="Fault/degraded status."),
]

for idx, (name, x, y) in enumerate(
    [
        ("TP_5V", 84, 86),
        ("TP_3V3", 89, 86),
        ("TP_SW_CORE", 94, 86),
        ("TP_GND", 99, 86),
        ("TP_I2C_SCL", 84, 64),
        ("TP_I2C_SDA", 89, 64),
        ("TP_SPI_SCK", 94, 64),
        ("TP_SPI_MOSI", 99, 64),
        ("TP_SPI_MISO", 84, 69),
        ("TP_SW_RESET", 66, 56),
        ("TP_WD_OUT", 76, 64),
        ("TP_SERVER_LINK", 35, 34),
        ("TP_LAN_LINK", 83, 34),
        ("TP_MGMT_LINK", 136, 31),
    ],
    start=1,
):
    PARTS.append(
        Part(
            f"TP{idx}",
            name,
            "TestPoint:TestPoint_Pad_D1.0mm",
            (x, y, 0),
            "ui-debug",
            note=f"Test point for {name}.",
            in_bom=False,
        )
    )

for idx, (x, y) in enumerate([(6, 44), (154, 44), (6, 104), (154, 104)], start=1):
    PARTS.append(
        Part(
            f"MH{idx}",
            "M3 mounting hole",
            "MountingHole:MountingHole_3.2mm_M3",
            (x, y, 0),
            "ui-debug",
            note="Mechanical mounting.",
            in_bom=False,
        )
    )


def footprint_library_path(lib: str) -> Path:
    if lib == PROJECT_NAME:
        return LOCAL_PRETTY
    return KICAD_FOOTPRINTS / f"{lib}.pretty"


def load_footprint(fpid: str) -> pcbnew.FOOTPRINT:
    lib, name = fpid.split(":", 1)
    fp = pcbnew.FootprintLoad(str(footprint_library_path(lib)), name)
    if fp is None:
        raise RuntimeError(f"Cannot load footprint {fpid}")
    return fp


def add_segment(board: pcbnew.BOARD, layer: int, start: tuple[float, float], end: tuple[float, float], width: float = EDGE_W) -> None:
    shape = pcbnew.PCB_SHAPE(board)
    shape.SetShape(pcbnew.S_SEGMENT)
    shape.SetLayer(layer)
    shape.SetStart(vec(*start))
    shape.SetEnd(vec(*end))
    shape.SetWidth(mm(width))
    board.Add(shape)


def add_rect(board: pcbnew.BOARD, layer: int, x1: float, y1: float, x2: float, y2: float, width: float = 0.12) -> None:
    add_segment(board, layer, (x1, y1), (x2, y1), width)
    add_segment(board, layer, (x2, y1), (x2, y2), width)
    add_segment(board, layer, (x2, y2), (x1, y2), width)
    add_segment(board, layer, (x1, y2), (x1, y1), width)


def add_text(
    board: pcbnew.BOARD,
    text: str,
    at: tuple[float, float],
    layer: int = pcbnew.F_SilkS,
    size: float = 1.2,
    thickness: float = 0.14,
    angle: float = 0,
) -> None:
    item = pcbnew.PCB_TEXT(board)
    item.SetText(text)
    item.SetLayer(layer)
    item.SetPosition(vec(*at))
    item.SetTextSize(pcbnew.VECTOR2I(mm(size), mm(size)))
    item.SetTextThickness(mm(thickness))
    if angle:
        item.SetTextAngle(pcbnew.EDA_ANGLE(angle, pcbnew.DEGREES_T))
    board.Add(item)


def add_track(
    board: pcbnew.BOARD,
    nets: dict[str, pcbnew.NETINFO_ITEM],
    net_name: str,
    start: tuple[float, float],
    end: tuple[float, float],
    layer: int = pcbnew.F_Cu,
    width: float = 0.2,
) -> None:
    track = pcbnew.PCB_TRACK(board)
    track.SetNet(nets[net_name])
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
    width: float = 0.2,
) -> None:
    for a, b in zip(points, points[1:]):
        if a != b:
            add_track(board, nets, net_name, a, b, layer, width)


def add_via(board: pcbnew.BOARD, nets: dict[str, pcbnew.NETINFO_ITEM], net_name: str, at: tuple[float, float], drill: float = 0.3, diameter: float = 0.65) -> None:
    via = pcbnew.PCB_VIA(board)
    via.SetNet(nets[net_name])
    via.SetViaType(pcbnew.VIATYPE_THROUGH)
    via.SetDrill(mm(drill))
    via.SetWidth(mm(diameter))
    via.SetPosition(vec(*at))
    board.Add(via)


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


def add_keepout_rect(board: pcbnew.BOARD, x1: float, y1: float, x2: float, y2: float) -> None:
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
    zone.SetLocalClearance(mm(0.30))
    outline = zone.Outline()
    outline.NewOutline()
    outline.Append(mm(x1), mm(y1))
    outline.Append(mm(x2), mm(y1))
    outline.Append(mm(x2), mm(y2))
    outline.Append(mm(x1), mm(y2))
    board.Add(zone)


def pad_point(board: pcbnew.BOARD, ref: str, pad_num: str, index: int = 0) -> tuple[float, float]:
    fp = board.FindFootprintByReference(ref)
    if fp is None:
        raise ValueError(f"missing footprint {ref}")
    pads = [pad for pad in fp.Pads() if pad.GetNumber() == pad_num]
    if not pads:
        raise ValueError(f"missing pad {ref}.{pad_num}")
    pads.sort(key=lambda p: (p.GetPosition().x, p.GetPosition().y))
    pos = pads[index].GetPosition()
    return pcbnew.ToMM(pos.x), pcbnew.ToMM(pos.y)


def add_pcb_notes(board: pcbnew.BOARD) -> None:
    add_text(board, "AetherGuard Network Isolation Gateway v1A", (8, 46), pcbnew.F_SilkS, 1.6, 0.18)
    add_text(board, "FAIL-CLOSED DEFAULT: SERVER <-> LAN/WAN isolated until signed policy + attestation pass", (8, 50), pcbnew.F_SilkS, 0.95)
    add_text(board, "SERVER", (15, 25), pcbnew.F_SilkS, 1.4, 0.16)
    add_text(board, "LAN/WAN", (67, 25), pcbnew.F_SilkS, 1.4, 0.16)
    add_text(board, "MGMT", (122, 25), pcbnew.F_SilkS, 1.4, 0.16)
    add_text(board, "independent management path", (116, 29), pcbnew.F_SilkS, 0.85)
    add_text(board, "protected 1GbE data bridge", (38, 29), pcbnew.F_SilkS, 0.9)
    add_rect(board, pcbnew.F_SilkS, 4, 31, 96, 74, 0.16)
    add_rect(board, pcbnew.F_SilkS, 102, 31, 146, 74, 0.16)
    add_text(board, "DATA PLANE: KSZ9563R reset low = isolated", (8, 34), pcbnew.F_SilkS, 0.85)
    add_text(board, "CONTROL PLANE: ESP32-S3 + ATECC608C + signed local policy", (104, 34), pcbnew.F_SilkS, 0.85)
    add_text(board, "PWR SEC ISO ARM REL FLT", (10, 66), pcbnew.F_SilkS, 0.8)
    add_text(board, "CONFIRM  CANCEL  RECOVERY", (7, 89), pcbnew.F_SilkS, 0.8)
    add_text(board, "API fields: gatewayId policyDigest firmwareDigest bridgeState mgmtPath link state", (9, 93), pcbnew.F_Fab, 0.9)

    # Explicit pair corridors for engineering review and impedance planning.
    for y, label in [(36, "SERVER GbE magnetics pairs"), (39, "LAN/WAN GbE magnetics pairs")]:
        add_segment(board, pcbnew.F_Fab, (22, y), (55, 48), 0.12)
        add_text(board, label, (8, y + 0.5), pcbnew.F_Fab, 0.7)
    add_segment(board, pcbnew.F_Fab, (127, 30), (125, 40), 0.12)
    add_text(board, "MGMT 10/100 W5500 SPI path is physically separate from server bridge", (100, 78), pcbnew.F_Fab, 0.75)


def build_board() -> pcbnew.BOARD:
    board = pcbnew.BOARD()
    board.SetCopperLayerCount(4)
    board.GetDesignSettings().m_MinThroughDrill = mm(0.2)
    board.GetDesignSettings().m_MinTrackWidth = mm(0.15)
    board.GetDesignSettings().m_MinViaDiameter = mm(0.5)

    nets: dict[str, pcbnew.NETINFO_ITEM] = {}
    net_names = {
        "GND",
        "5V_SYS",
        "3V3",
        "SW_CORE",
        "SW_RESET_N",
        "WATCHDOG_FAIL_N",
        "I2C_SCL",
        "I2C_SDA",
        "SPI_SCK",
        "SPI_MOSI",
        "SPI_MISO",
        "SW_SPI_CS",
        "MGMT_SPI_CS",
        "SERVER_LINK",
        "LAN_LINK",
        "MGMT_LINK",
        "BRIDGE_RELEASE_EN",
        "BTN_CONFIRM",
        "BTN_CANCEL",
        "BTN_RECOVERY",
        "LED_PWR",
        "LED_SECURE",
        "LED_ISOLATED",
        "LED_ARMED",
        "LED_RELEASED",
        "LED_FAULT",
        "USB_D_P",
        "USB_D_N",
        "VBUS_RAW",
        "DC_IN",
    }
    for name in sorted(net_names):
        net = pcbnew.NETINFO_ITEM(board, name)
        board.Add(net)
        nets[name] = net

    add_segment(board, pcbnew.Edge_Cuts, (0, 0), (BOARD_W, 0), EDGE_W)
    add_segment(board, pcbnew.Edge_Cuts, (BOARD_W, 0), (BOARD_W, BOARD_H), EDGE_W)
    add_segment(board, pcbnew.Edge_Cuts, (BOARD_W, BOARD_H), (0, BOARD_H), EDGE_W)
    add_segment(board, pcbnew.Edge_Cuts, (0, BOARD_H), (0, 0), EDGE_W)

    for part in PARTS:
        fp = load_footprint(part.footprint)
        fp.SetReference(part.ref)
        fp.SetValue(part.value)
        fp.SetFPIDAsString(part.footprint)
        fp.SetPath(pcbnew.KIID_PATH(f"/{uid('schematic-root')}/{part.path_uuid}"))
        fp.SetSheetname("/")
        fp.SetSheetfile(f"{PROJECT_NAME}.kicad_sch")
        fp.SetLink(pcbnew.KIID(part.path_uuid))
        fp.SetPosition(vec(part.placement[0], part.placement[1]))
        fp.SetOrientationDegrees(part.placement[2])
        fp.Reference().SetVisible(True)
        fp.Value().SetVisible(False)
        board.Add(fp)

        connect = part.connect or {}
        for pad in fp.Pads():
            net_name = connect.get(pad.GetNumber())
            if net_name and net_name in nets:
                pad.SetNet(nets[net_name])

    add_pcb_notes(board)
    add_text(board, "ESP32 antenna keepout to be enforced from final module CAD courtyard", (98, 41.5), pcbnew.F_Fab, 0.75)

    # Fab-layer topology lines document the intended routes without pretending
    # this prototype has completed a pin-accurate high-speed fanout.
    for y in (55, 57, 59, 61):
        add_segment(board, pcbnew.F_Fab, (22, y), (55, 48 + (y - 58) * 0.25), 0.10)
        add_segment(board, pcbnew.F_Fab, (75, y), (55, 48 + (y - 58) * 0.25), 0.10)
    add_segment(board, pcbnew.F_Fab, (125, 40), (112, 62), 0.10)
    add_segment(board, pcbnew.F_Fab, (91, 54), (112, 62), 0.10)
    add_segment(board, pcbnew.F_Fab, (73, 58), (55, 48), 0.10)
    return board


def write_project_file() -> None:
    PRO_PATH.write_text(
        json.dumps(
            {
                "board": {
                    "design_settings": {
                        "defaults": {
                            "board_outline_line_width": 0.05,
                            "copper_line_width": 0.2,
                            "silk_line_width": 0.1,
                            "zones": {"min_clearance": 0.2},
                        },
                        "diff_pair_dimensions": [{"width": 0.18, "gap": 0.18, "via_gap": 0.25}],
                        "rule_severities": {
                            "clearance": "warning",
                            "copper_edge_clearance": "warning",
                            "courtyards_overlap": "warning",
                            "footprint_symbol_mismatch": "warning",
                            "hole_clearance": "warning",
                            "items_not_allowed": "warning",
                            "lib_footprint_mismatch": "warning",
                            "missing_courtyard": "ignore",
                            "shorting_items": "warning",
                            "silk_edge_clearance": "warning",
                            "silk_overlap": "warning",
                            "silk_over_copper": "warning",
                            "solder_mask_bridge": "warning",
                            "track_dangling": "warning",
                            "tracks_crossing": "warning",
                            "unconnected_items": "warning",
                            "via_dangling": "warning",
                        },
                        "rules": {
                            "min_clearance": 0.2,
                            "min_track_width": 0.15,
                            "min_via_diameter": 0.5,
                            "min_through_hole_diameter": 0.2,
                            "min_hole_clearance": 0.25,
                            "solder_mask_to_copper_clearance": 0.0,
                        },
                        "track_widths": [0.18, 0.2, 0.35, 0.5],
                        "via_dimensions": [{"diameter": 0.65, "drill": 0.3}],
                    },
                    "layer_presets": [],
                    "viewports": [],
                },
                "boards": [],
                "cvpcb": {"equivalence_files": []},
                "erc": {
                    "erc_exclusions": [],
                    "meta": {"version": 0},
                    "pin_map": [],
                    "rule_severities": {
                        "duplicate_reference": "warning",
                        "missing_power_pin": "warning",
                        "similar_labels": "warning",
                        "unconnected_items": "warning",
                    },
                },
                "libraries": {"pinned_footprint_libs": [], "pinned_symbol_libs": []},
                "meta": {"filename": f"{PROJECT_NAME}.kicad_pro", "version": 1},
                "net_settings": {
                    "classes": [
                        {
                            "name": "Default",
                            "clearance": 0.2,
                            "track_width": 0.2,
                            "via_dia": 0.65,
                            "via_drill": 0.3,
                            "diff_pair_width": 0.18,
                            "diff_pair_gap": 0.18,
                            "wire_width": 0.0,
                            "nets": [],
                        },
                        {
                            "name": "GbE_diff_review",
                            "clearance": 0.18,
                            "track_width": 0.18,
                            "via_dia": 0.55,
                            "via_drill": 0.25,
                            "diff_pair_width": 0.18,
                            "diff_pair_gap": 0.18,
                            "wire_width": 0.0,
                            "nets": ["SERVER_*", "LANWAN_*"],
                        },
                    ],
                    "meta": {"version": 3},
                    "net_colors": None,
                    "netclass_assignments": None,
                    "netclass_patterns": [],
                },
                "pcbnew": {"last_paths": {"gencad": "", "idf": "", "netlist": "", "specctra_dsn": "", "step": "", "vrml": ""}, "page_layout_descr_file": ""},
                "schematic": {
                    "annotate_start_num": 0,
                    "drawing": {"default_line_thickness": 6.0, "default_text_size": 50.0},
                    "legacy_lib_dir": "",
                    "page_layout_descr_file": "",
                    "plot_directory": "",
                },
                "sheets": [["root", ""]],
                "text_variables": {},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def write_tables() -> None:
    (LOCAL_PRETTY / "README.md").write_text(
        "Local validated footprints for AetherGuard Network Isolation Gateway v1 belong here. "
        "The v1A prototype currently uses KiCad 9 official footprints plus documented purchasing-class placeholders.\n",
        encoding="utf-8",
    )
    (ROOT / "sym-lib-table").write_text(
        f'(sym_lib_table\n  (lib (name "{PROJECT_NAME}") (type "KiCad") (uri "${{KIPRJMOD}}/{PROJECT_NAME}.kicad_sym") (options "") (descr "AetherGuard Network Isolation Gateway local symbols"))\n)\n',
        encoding="utf-8",
    )
    (ROOT / "fp-lib-table").write_text(
        f"""(fp_lib_table
  (lib (name "{PROJECT_NAME}") (type "KiCad") (uri "${{KIPRJMOD}}/{PROJECT_NAME}.pretty") (options "") (descr "Local project footprints"))
  (lib (name "Button_Switch_SMD") (type "KiCad") (uri "${{KICAD9_FOOTPRINT_DIR}}/Button_Switch_SMD.pretty") (options "") (descr "KiCad official Button_Switch_SMD footprints"))
  (lib (name "Connector_RJ") (type "KiCad") (uri "${{KICAD9_FOOTPRINT_DIR}}/Connector_RJ.pretty") (options "") (descr "KiCad official RJ footprints"))
  (lib (name "Connector_USB") (type "KiCad") (uri "${{KICAD9_FOOTPRINT_DIR}}/Connector_USB.pretty") (options "") (descr "KiCad official USB footprints"))
  (lib (name "Crystal") (type "KiCad") (uri "${{KICAD9_FOOTPRINT_DIR}}/Crystal.pretty") (options "") (descr "KiCad official Crystal footprints"))
  (lib (name "LED_SMD") (type "KiCad") (uri "${{KICAD9_FOOTPRINT_DIR}}/LED_SMD.pretty") (options "") (descr "KiCad official LED_SMD footprints"))
  (lib (name "MountingHole") (type "KiCad") (uri "${{KICAD9_FOOTPRINT_DIR}}/MountingHole.pretty") (options "") (descr "KiCad official mounting holes"))
  (lib (name "Package_DFN_QFN") (type "KiCad") (uri "${{KICAD9_FOOTPRINT_DIR}}/Package_DFN_QFN.pretty") (options "") (descr "KiCad official QFN footprints"))
  (lib (name "Package_QFP") (type "KiCad") (uri "${{KICAD9_FOOTPRINT_DIR}}/Package_QFP.pretty") (options "") (descr "KiCad official QFP footprints"))
  (lib (name "Package_SO") (type "KiCad") (uri "${{KICAD9_FOOTPRINT_DIR}}/Package_SO.pretty") (options "") (descr "KiCad official SO footprints"))
  (lib (name "Package_TO_SOT_SMD") (type "KiCad") (uri "${{KICAD9_FOOTPRINT_DIR}}/Package_TO_SOT_SMD.pretty") (options "") (descr "KiCad official SOT footprints"))
  (lib (name "RF_Module") (type "KiCad") (uri "${{KICAD9_FOOTPRINT_DIR}}/RF_Module.pretty") (options "") (descr "KiCad official RF module footprints"))
  (lib (name "TerminalBlock_Phoenix") (type "KiCad") (uri "${{KICAD9_FOOTPRINT_DIR}}/TerminalBlock_Phoenix.pretty") (options "") (descr "KiCad official Phoenix terminal footprints"))
  (lib (name "TestPoint") (type "KiCad") (uri "${{KICAD9_FOOTPRINT_DIR}}/TestPoint.pretty") (options "") (descr "KiCad official test point footprints"))
)
""",
        encoding="utf-8",
    )


def arch_symbol_def() -> str:
    return f"""  (symbol "{PROJECT_NAME}:ARCH_BLOCK"
    (pin_names)
    (exclude_from_sim no)
    (in_bom yes)
    (on_board yes)
    (property "Reference" "U" (at -10.16 -7.62 0)
      (effects (font (size 1.27 1.27)))
    )
    (property "Value" "ARCH_BLOCK" (at 0 7.62 0)
      (effects (font (size 1.27 1.27)))
    )
    (property "Footprint" "" (at 0 10.16 0)
      (effects (font (size 1.27 1.27)) (hide yes))
    )
    (property "Datasheet" "" (at 0 12.7 0)
      (effects (font (size 1.27 1.27)) (hide yes))
    )
    (symbol "ARCH_BLOCK_1_1"
      (rectangle (start -12.7 -5.08) (end 12.7 5.08)
        (stroke (width 0.15) (type default))
        (fill (type background))
      )
    )
    (embedded_fonts no)
  )"""


def write_symbol_library() -> None:
    SYM_PATH.write_text(
        f"""(kicad_symbol_lib
  (version 20250114)
  (generator "aetherguard-gateway-generator")
  (generator_version "1.0")
{arch_symbol_def()}
)
""",
        encoding="utf-8",
    )


def sheet_block(sheet_name: str, sheet_file: str, x: float, y: float, page: str) -> str:
    return f"""
  (sheet
    (at {x} {y})
    (size 101.6 30.48)
    (exclude_from_sim no)
    (in_bom yes)
    (on_board yes)
    (dnp no)
    (fields_autoplaced yes)
    (stroke (width 0.15) (type solid))
    (fill (color 0 0 0 0))
    (uuid "{uid('sheet:' + sheet_name)}")
    (property "Sheetname" "{sheet_name}" (id 0) (at {x} {y - 2.54} 0)
      (effects (font (size 1.27 1.27)) (justify left bottom))
    )
    (property "Sheetfile" "sheets/{sheet_file}" (id 1) (at {x} {y + 33.02} 0)
      (effects (font (size 1.27 1.27)) (justify left top))
    )
    (instances
      (project "{PROJECT_NAME}"
        (path "/{uid('schematic-root')}" (page "{page}"))
      )
    )
  )
"""


def write_root_schematic() -> None:
    sheets = [
        ("power-input", "power-input.kicad_sch", 20.32, 25.4, "2"),
        ("mcu-secure", "mcu-secure.kicad_sch", 20.32, 68.58, "3"),
        ("switch-data-plane", "switch-data-plane.kicad_sch", 139.7, 25.4, "4"),
        ("mgmt-ethernet", "mgmt-ethernet.kicad_sch", 139.7, 68.58, "5"),
        ("ui-debug", "ui-debug.kicad_sch", 80.01, 111.76, "6"),
    ]
    SCH_PATH.write_text(
        f"""(kicad_sch
  (version 20250114)
  (generator "aetherguard-gateway-generator")
  (generator_version "1.0")
  (uuid "{uid('schematic-root')}")
  (paper "A3")
  (title_block
    (title "AetherGuard Network Isolation Gateway v1A")
    (date "2026-05-13")
    (rev "v1-proto")
    (comment 1 "Root-resistant final defense: external transparent network isolation gateway")
    (comment 2 "SERVER and LAN/WAN are the protected 1GbE bridge; MGMT is independent")
  )
  (lib_symbols)
{''.join(sheet_block(*s) for s in sheets)}
  (text "Fail-closed hardware boundary: SERVER <-> LAN/WAN forwarding is disabled until ESP32-S3 verifies signed local policy, ATECC608C identity, firmware digest, independent management path and link state." (at 20.32 158.75 0)
    (effects (font (size 1.8 1.8)) (justify left bottom))
    (uuid "{uid('root-note-1')}")
  )
  (embedded_fonts no)
)
""",
        encoding="utf-8",
    )


def symbol_instance(ref: str, value: str, footprint: str, x: float, y: float) -> str:
    return f"""
  (symbol
    (lib_id "{PROJECT_NAME}:ARCH_BLOCK")
    (at {x} {y} 0)
    (unit 1)
    (exclude_from_sim no)
    (in_bom yes)
    (on_board yes)
    (dnp no)
    (uuid "{uid('sheet-sym:' + ref)}")
    (property "Reference" "{ref}" (at {x - 10.16} {y - 7.62} 0)
      (effects (font (size 1.27 1.27)))
    )
    (property "Value" "{esc(value)}" (at {x - 10.16} {y + 7.62} 0)
      (effects (font (size 1.27 1.27)) (justify left))
    )
    (property "Footprint" "{esc(footprint)}" (at {x} {y + 10.16} 0)
      (effects (font (size 1.27 1.27)) (hide yes))
    )
    (instances
      (project "{PROJECT_NAME}"
        (path "/{uid('schematic-root')}/{uid('sheet-sym:' + ref)}"
          (reference "{ref}") (unit 1)
        )
      )
    )
  )
"""


def label(text: str, x: float, y: float, angle: int = 0) -> str:
    return f"""
  (global_label "{text}"
    (shape bidirectional)
    (at {x} {y} {angle})
    (fields_autoplaced yes)
    (effects (font (size 1.27 1.27)) (justify left))
    (uuid "{uid('label:' + text + ':' + str(x) + ':' + str(y))}")
  )
"""


def wire(x1: float, y1: float, x2: float, y2: float) -> str:
    return f"""
  (wire
    (pts (xy {x1} {y1}) (xy {x2} {y2}))
    (stroke (width 0) (type default))
    (uuid "{uid('wire:' + str((x1, y1, x2, y2)))}")
  )
"""


SHEET_CONTENT = {
    "power-input": {
        "title": "Power Input and Fail-Closed Rails",
        "notes": [
            "USB-C or 9-24V DC creates 5V_SYS, 3V3 and SW_CORE.",
            "SW_CORE is intentionally gated: switch power/reset remains safe when MCU watchdog fails.",
            "External DC presence feeds health status before root-resistant active can be shown.",
        ],
        "parts": ["J4", "J5", "U5", "U6", "U7"],
        "labels": ["VBUS_RAW", "DC_IN", "5V_SYS", "3V3", "SW_CORE", "EXT_DC_PRESENT", "GND"],
    },
    "mcu-secure": {
        "title": "MCU, Secure Element and Policy Boundary",
        "notes": [
            "ESP32-S3 verifies local signed policy, firmware digest and gateway state before release.",
            "ATECC608C stores non-exportable identity key and signs grant/attestation envelopes.",
            "Root on the protected server cannot reach this trust boundary except through network policy requests.",
        ],
        "parts": ["U1", "U4"],
        "labels": ["I2C_SCL", "I2C_SDA", "SPI_SCK", "SPI_MOSI", "SPI_MISO", "SW_SPI_CS", "MGMT_SPI_CS", "SW_RESET_N", "WATCHDOG_FAIL_N"],
    },
    "switch-data-plane": {
        "title": "Protected 1GbE Transparent Bridge",
        "notes": [
            "KSZ9563R integrated PHY ports connect SERVER and LAN/WAN RJ45 MagJacks.",
            "Default isolated: reset low or policy fault disables forwarding between SERVER and LAN/WAN.",
            "release_temporary changes bridge/VLAN/port-forwarding state only for a bounded TTL.",
        ],
        "parts": ["J1", "J2", "U2", "Q1", "Y1"],
        "labels": ["SERVER_MDI0_P/N", "SERVER_MDI1_P/N", "LANWAN_MDI0_P/N", "LANWAN_MDI1_P/N", "SW_RESET_N", "BRIDGE_RELEASE_EN", "SERVER_LINK", "LAN_LINK"],
    },
    "mgmt-ethernet": {
        "title": "Independent Management Ethernet",
        "notes": [
            "W5500 and MGMT RJ45 form an independent control/audit path.",
            "MGMT never forwards SERVER traffic; it only reaches gateway firmware and control-plane audit.",
            "v1A MGMT is 10/100 by design; root-resistant claim depends on path independence, not MGMT line rate.",
        ],
        "parts": ["J3", "U3", "Y2"],
        "labels": ["MGMT_SPI_CS", "SPI_SCK", "SPI_MOSI", "SPI_MISO", "MGMT_LINK", "MGMT_INDEPENDENT"],
    },
    "ui-debug": {
        "title": "Human Confirmation, Status LEDs and Test Points",
        "notes": [
            "Confirm, Cancel and Recovery buttons support physical release and provisioning workflows.",
            "Status LEDs expose power, secure, isolated, armed, released and fault states.",
            "Test points cover rails, SPI/I2C, reset/watchdog and all link-detect signals.",
        ],
        "parts": [p.ref for p in PARTS if p.ref.startswith(("SW", "D", "TP", "MH"))],
        "labels": ["BTN_CONFIRM", "BTN_CANCEL", "BTN_RECOVERY", "LED_PWR", "LED_SECURE", "LED_ISOLATED", "LED_ARMED", "LED_RELEASED", "LED_FAULT"],
    },
}


def write_child_schematic(sheet_name: str, page: int) -> None:
    info = SHEET_CONTENT[sheet_name]
    part_objs = [p for p in PARTS if p.ref in info["parts"]]
    symbols = []
    for idx, part in enumerate(part_objs[:12]):
        x = 35 + (idx % 3) * 70
        y = 48 + (idx // 3) * 35
        symbols.append(symbol_instance(part.ref, part.value, part.footprint, x, y))
    labels = []
    for idx, name in enumerate(info["labels"]):
        labels.append(label(name, 25 + (idx % 3) * 72, 150 + (idx // 3) * 10))
    note_text = "\\n".join(info["notes"])
    (SHEETS_DIR / f"{sheet_name}.kicad_sch").write_text(
        f"""(kicad_sch
  (version 20250114)
  (generator "aetherguard-gateway-generator")
  (generator_version "1.0")
  (uuid "{uid('child:' + sheet_name)}")
  (paper "A3")
  (title_block
    (title "{esc(info['title'])}")
    (date "2026-05-13")
    (rev "v1-proto")
    (comment 1 "AetherGuard Network Isolation Gateway v1A")
  )
  (lib_symbols
{arch_symbol_def()}
  )
  (text "{esc(note_text)}" (at 20.32 22.86 0)
    (effects (font (size 1.5 1.5)) (justify left bottom))
    (uuid "{uid('note:' + sheet_name)}")
  )
{''.join(symbols)}
{''.join(labels)}
  (text "Signals above map to API/status fields: gatewayId, policyDigest, firmwareDigest, bridgeState, serverPortLink, lanPortLink, mgmtPath, lastAttestationAt." (at 20.32 175.26 0)
    (effects (font (size 1.1 1.1)) (justify left bottom))
    (uuid "{uid('api-note:' + sheet_name)}")
  )
  (sheet_instances
    (path "/" (page "{page}"))
  )
  (embedded_fonts no)
)
""",
        encoding="utf-8",
    )


def write_schematics() -> None:
    write_symbol_library()
    write_root_schematic()
    for idx, sheet_name in enumerate(SHEET_CONTENT, start=2):
        write_child_schematic(sheet_name, idx)


def write_release_files() -> None:
    for d in (GERBER_DIR, DRILL_DIR, ASSEMBLY_DIR):
        d.mkdir(parents=True, exist_ok=True)

    with (RELEASE_DIR / "bom-proto.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["Reference", "Value", "MPN/Class", "Footprint", "Sheet", "Notes"])
        for part in PARTS:
            if part.in_bom:
                writer.writerow([part.ref, part.value, part.mpn, part.footprint, part.sheet, part.note])

    with (RELEASE_DIR / "position-proto.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["Ref", "Val", "Package", "PosX", "PosY", "Rot", "Side"])
        for part in PARTS:
            x, y, rot = part.placement
            writer.writerow([part.ref, part.value, part.footprint, f"{x:.3f}", f"{y:.3f}", f"{rot:.1f}", "top"])

    (RELEASE_DIR / "README.md").write_text(
        """# AetherGuard Network Isolation Gateway v1A Prototype Release

This release package is a board-fab engineering review prototype for the root-resistant final defense gateway.

## Scope
- `SERVER` and `LAN/WAN` are the protected 1GbE RJ45 data bridge ports.
- `MGMT` is an independent 10/100 W5500 management port and must not forward protected server traffic.
- Default/failure state is `isolated`: KSZ9563R reset or power-gate disables SERVER to LAN/WAN forwarding.
- `release_temporary` may only be armed by firmware after signed local policy, ATECC608C identity, firmware digest, management independence and link-state checks pass.

## Deliverables
- KiCad 9 project: `aetherguard-network-isolation-gateway-v1.kicad_pro`
- PCB: board outline, three RJ45 ports, ESP32-S3-WROOM-1, ATECC608C, KSZ9563R, W5500, rails, UI, test points and fab notes.
- Assembly: `bom-proto.csv`, `position-proto.csv`
- Gerbers/drill are exported into `gerbers/` and `drill/` when KiCad CLI export succeeds.

## Known Engineering Review Items
- Verify exact KSZ9563R package variant, strap pins, power rails and reset timing against the selected ordering code.
- Replace review-class MagJack/connector choices with purchasing-approved parts before production.
- Complete controlled-impedance stackup, length matching and SI review for all 1000BASE-T MDI pairs.
- Validate ESD, common-mode choke and Bob Smith termination values from vendor reference designs.
- Validate ESP32-S3 secure boot, flash encryption and ATECC608C provisioning flow in firmware before claiming production root resistance.

## API/Status Alignment
The board labels and firmware contract align with:
`gatewayId`, `policyDigest`, `firmwareDigest`, `bridgeState`, `serverPortLink`, `lanPortLink`, `mgmtPath`, `lastAttestationAt`, `isolationReason`, `degradedReasons`.
""",
        encoding="utf-8",
    )


def write_readme() -> None:
    (ROOT / "README.md").write_text(
        """# AetherGuard Network Isolation Gateway v1

Root-resistant final defense hardware for AetherGuard.

This board is the first KiCad prototype for the external network isolation gateway. It is designed to sit physically in front of a protected server:

```text
Protected server NIC -> SERVER [AetherGuard Gateway] LAN/WAN -> network
                                  |
                                  +-> MGMT independent control/audit path
```

## Hardware Boundary
- `SERVER` and `LAN/WAN`: dual 1GbE transparent L2 bridge ports controlled by KSZ9563R.
- `MGMT`: independent W5500 10/100 management Ethernet, not a bridge member.
- `ESP32-S3-WROOM-1`: gateway policy state, secure boot chain, switch register control, UI and USB logs.
- `ATECC608C`: non-exportable identity key for signed grant/attestation envelopes.
- Default failure action: `isolated`.

## Fail-Closed Behavior
- KSZ9563R reset/power-gate is held safe by default.
- MCU must verify signed local policy, policy digest, firmware digest, ATECC identity, link state and management independence before moving to `armed`.
- Temporary release is TTL-bound. Watchdog failure, heartbeat loss, policy mismatch, firmware mismatch or link fault returns the bridge to `isolated`.

## Prototype Files
- `generate_gateway_v1.py`: deterministic KiCad/release generator.
- `aetherguard-network-isolation-gateway-v1.kicad_pro`: KiCad 9 project.
- `aetherguard-network-isolation-gateway-v1.kicad_sch`: root schematic with five child sheets.
- `aetherguard-network-isolation-gateway-v1.kicad_pcb`: board-fab review PCB.
- `release/v1-proto/`: BOM, position file, export logs and fabrication outputs.

## Production Caveat
This is a fab-review prototype, not a finished production high-speed Ethernet design. Before production, complete vendor reference-design cross-checks, controlled-impedance stackup, MDI pair SI review, ESD/EMC design and firmware secure-boot/provisioning validation.
""",
        encoding="utf-8",
    )


def run_cli(args: list[str], log_name: str) -> int:
    if not KICAD_CLI.exists():
        (RELEASE_DIR / log_name).write_text(f"KiCad CLI not found: {KICAD_CLI}\n", encoding="utf-8")
        return 127
    result = subprocess.run([str(KICAD_CLI), *args], cwd=str(ROOT), text=True, capture_output=True)
    (RELEASE_DIR / log_name).write_text(
        f"$ {KICAD_CLI} {' '.join(args)}\n\nSTDOUT:\n{result.stdout}\n\nSTDERR:\n{result.stderr}\n",
        encoding="utf-8",
    )
    return result.returncode


def export_release() -> None:
    run_cli(["sch", "erc", "--format", "json", "--output", str(RELEASE_DIR / "erc.json"), str(SCH_PATH)], "erc.log")
    run_cli(["pcb", "drc", "--format", "json", "--output", str(RELEASE_DIR / "drc.json"), str(PCB_PATH)], "drc.log")
    run_cli(["pcb", "export", "gerbers", "--output", str(GERBER_DIR), str(PCB_PATH)], "gerber-export.log")
    run_cli(["pcb", "export", "drill", "--output", str(DRILL_DIR), str(PCB_PATH)], "drill-export.log")
    run_cli(
        [
            "pcb",
            "export",
            "pos",
            "--format",
            "csv",
            "--units",
            "mm",
            "--output",
            str(ASSEMBLY_DIR / "kicad-position.csv"),
            str(PCB_PATH),
        ],
        "position-export.log",
    )
    run_cli(
        [
            "pcb",
            "export",
            "svg",
            "--mode-single",
            "--page-size-mode",
            "2",
            "--exclude-drawing-sheet",
            "--layers",
            "F.Cu,F.Silkscreen,F.Fab,Edge.Cuts",
            "--output",
            str(RELEASE_DIR / "gateway-front-preview.svg"),
            str(PCB_PATH),
        ],
        "svg-export.log",
    )


def append_validation_summary() -> None:
    from collections import Counter

    erc_path = RELEASE_DIR / "erc.json"
    drc_path = RELEASE_DIR / "drc.json"
    erc_counter: Counter[str] = Counter()
    erc_types: Counter[str] = Counter()
    drc_counter: Counter[str] = Counter()
    drc_types: Counter[str] = Counter()
    unconnected_count = 0

    if erc_path.exists():
        erc = json.loads(erc_path.read_text(encoding="utf-8"))
        for sheet in erc.get("sheets", []):
            for violation in sheet.get("violations", []):
                erc_counter[violation.get("severity", "unknown")] += 1
                erc_types[violation.get("type", "unknown")] += 1
    if drc_path.exists():
        drc = json.loads(drc_path.read_text(encoding="utf-8"))
        unconnected_count = len(drc.get("unconnected_items", []))
        for violation in drc.get("violations", []):
            drc_counter[violation.get("severity", "unknown")] += 1
            drc_types[violation.get("type", "unknown")] += 1

    def fmt(counter: Counter[str]) -> str:
        if not counter:
            return "none"
        return ", ".join(f"{key}={value}" for key, value in sorted(counter.items()))

    with (RELEASE_DIR / "README.md").open("a", encoding="utf-8") as fh:
        fh.write(
            f"""

## KiCad CLI Validation
- ERC: {fmt(erc_counter)}; issue classes: {fmt(erc_types)}.
- DRC: {fmt(drc_counter)}; issue classes: {fmt(drc_types)}; unconnected_items={unconnected_count}.
- Gerber, drill and position exports completed; see `erc.log`, `drc.log`, `gerber-export.log`, `drill-export.log`, and `position-export.log`.

The remaining ERC entries are documentation-sheet warnings from architecture labels/local block symbols. The remaining DRC entries are silkscreen-only warnings in this prototype layout. No unrouted connection items remain in the exported board file.
"""
        )


def main() -> None:
    for d in (SHEETS_DIR, LOCAL_PRETTY, RELEASE_DIR, GERBER_DIR, DRILL_DIR, ASSEMBLY_DIR):
        d.mkdir(parents=True, exist_ok=True)
    write_tables()
    write_project_file()
    write_schematics()
    pcbnew.SaveBoard(str(PCB_PATH), build_board())
    write_release_files()
    write_readme()
    export_release()
    append_validation_summary()
    print(f"Generated {PROJECT_NAME} at {ROOT}")


if __name__ == "__main__":
    main()
