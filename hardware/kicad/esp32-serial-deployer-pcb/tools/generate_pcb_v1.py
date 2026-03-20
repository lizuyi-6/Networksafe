from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path

import pcbnew


ROOT = Path(__file__).resolve().parents[1]
PROJECT_NAME = "esp32-serial-deployer-pcb"
SYM_PATH = ROOT / f"{PROJECT_NAME}.kicad_sym"
SCH_PATH = ROOT / f"{PROJECT_NAME}.kicad_sch"
PCB_PATH = ROOT / f"{PROJECT_NAME}.kicad_pcb"
REPORTS_DIR = ROOT / "reports"
LOCAL_PRETTY = ROOT / f"{PROJECT_NAME}.pretty"
KICAD_FOOTPRINTS = Path(r"C:\Program Files\KiCad\9.0\share\kicad\footprints")
NS = uuid.UUID("0e8be8f7-2ca0-4a0a-b201-d0cdb7b523ba")
EMIT_LOCAL_TRACKS = False
SCH_GRID_MM = 2.54


def uid(name: str) -> str:
    return str(uuid.uuid5(NS, name))


def esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"')


def mm(value: float) -> int:
    return pcbnew.FromMM(value)


def sch(value: float) -> float:
    return round(round(value / SCH_GRID_MM) * SCH_GRID_MM, 4)


@dataclass
class PinDef:
    num: str
    name: str
    x: float
    y: float
    angle: int
    etype: str = "passive"
    hidden: bool = False


@dataclass
class SymbolDef:
    name: str
    ref: str
    value: str
    body: tuple[float, float, float, float]
    pins: list[PinDef]


@dataclass
class Instance:
    ref: str
    symbol: str
    value: str
    footprint: str
    at: tuple[float, float]
    ref_at: tuple[float, float]
    value_at: tuple[float, float]
    connect: dict[str, str] = field(default_factory=dict)
    on_board: bool = True
    in_bom: bool = True

    @property
    def uuid(self) -> str:
        return uid(f"sym:{self.ref}")


def angle_len_to_stub(pin: PinDef, origin: tuple[float, float], step: float = 2.54) -> tuple[tuple[float, float], tuple[float, float]]:
    px = sch(origin[0]) + sch(pin.x)
    py = sch(origin[1]) - sch(pin.y)
    if pin.angle == 0:
        return (px, py), (sch(px - step), py)
    if pin.angle == 180:
        return (px, py), (sch(px + step), py)
    if pin.angle == 90:
        return (px, py), (px, sch(py + step))
    if pin.angle == 270:
        return (px, py), (px, sch(py - step))
    raise ValueError(pin.angle)


def emit_effects(size: float = 1.0, hide: bool = False) -> str:
    hide_text = "\n\t\t\t\t(hide yes)" if hide else ""
    return (
        "\t\t\t(effects\n"
        "\t\t\t\t(font\n"
        f"\t\t\t\t\t(size {size} {size})\n"
        "\t\t\t\t)\n"
        f"{hide_text}\n"
        "\t\t\t)"
    )


def emit_property(name: str, value: str, at: tuple[float, float], hide: bool = False) -> str:
    return (
        f'\t\t(property "{esc(name)}" "{esc(value)}"\n'
        f"\t\t\t(at {sch(at[0])} {sch(at[1])} 0)\n"
        f"{emit_effects(1.0, hide)}\n"
        "\t\t)\n"
    )


def emit_pin(pin: PinDef) -> str:
    hide = "\n\t\t\t\t(hide yes)" if pin.hidden else ""
    pin_x = sch(pin.x)
    pin_y = sch(pin.y)
    return (
        f"\t\t\t(pin {pin.etype} line\n"
        f"\t\t\t\t(at {pin_x} {pin_y} {pin.angle})\n"
        "\t\t\t\t(length 2.54)\n"
        f"{hide}\n"
        f'\t\t\t\t(name "{esc(pin.name)}"\n'
        "\t\t\t\t\t(effects\n"
        "\t\t\t\t\t\t(font\n"
        "\t\t\t\t\t\t\t(size 1.27 1.27)\n"
        "\t\t\t\t\t\t)\n"
        "\t\t\t\t\t)\n"
        "\t\t\t\t)\n"
        f'\t\t\t\t(number "{esc(pin.num)}"\n'
        "\t\t\t\t\t(effects\n"
        "\t\t\t\t\t\t(font\n"
        "\t\t\t\t\t\t\t(size 1.27 1.27)\n"
        "\t\t\t\t\t\t)\n"
        "\t\t\t\t\t)\n"
        "\t\t\t\t)\n"
        "\t\t\t)\n"
    )


def emit_symbol_def(sym: SymbolDef, qualified: bool = True) -> str:
    symbol_name = f"{PROJECT_NAME}:{sym.name}" if qualified else sym.name
    body = (
        "\t\t(symbol "
        f'"{sym.name}_1_1"\n'
        "\t\t\t(rectangle\n"
        f"\t\t\t\t(start {sym.body[0]} {sym.body[1]})\n"
        f"\t\t\t\t(end {sym.body[2]} {sym.body[3]})\n"
        "\t\t\t\t(stroke\n"
        "\t\t\t\t\t(width 0.15)\n"
        "\t\t\t\t\t(type default)\n"
        "\t\t\t\t)\n"
        "\t\t\t\t(fill\n"
        "\t\t\t\t\t(type none)\n"
        "\t\t\t\t)\n"
        "\t\t\t)\n"
    )
    pins = "".join(emit_pin(pin) for pin in sym.pins)
    body += pins + "\t\t)\n"
    return (
        f'\t(symbol "{symbol_name}"\n'
        "\t\t(pin_names)\n"
        "\t\t(exclude_from_sim no)\n"
        "\t\t(in_bom yes)\n"
        "\t\t(on_board yes)\n"
        f'{emit_property("Reference", sym.ref, (sym.body[0], sym.body[1] - 2.5)).rstrip()}\n'
        f'{emit_property("Value", sym.value, (0, sym.body[3] + 2.5)).rstrip()}\n'
        f'{emit_property("Footprint", "", (0, sym.body[3] + 4.5), True).rstrip()}\n'
        f'{emit_property("Datasheet", "", (0, sym.body[3] + 6.5), True).rstrip()}\n'
        f'{emit_property("Description", "", (0, sym.body[3] + 8.5), True).rstrip()}\n'
        f"{body}"
        "\t\t(embedded_fonts no)\n"
        "\t)\n"
    )


def emit_symbol_instance(
    inst: Instance,
    symbol_name: str,
    at: tuple[float, float],
    ref_at: tuple[float, float],
    value_at: tuple[float, float],
) -> str:
    bom = "yes" if inst.in_bom else "no"
    board = "yes" if inst.on_board else "no"
    at_x = sch(at[0])
    at_y = sch(at[1])
    return (
        "\t(symbol\n"
        f'\t\t(lib_id "{PROJECT_NAME}:{symbol_name}")\n'
        f"\t\t(at {at_x} {at_y} 0)\n"
        "\t\t(unit 1)\n"
        "\t\t(exclude_from_sim no)\n"
        f"\t\t(in_bom {bom})\n"
        f"\t\t(on_board {board})\n"
        "\t\t(dnp no)\n"
        f'\t\t(uuid "{inst.uuid}")\n'
        f'{emit_property("Reference", inst.ref, ref_at).rstrip()}\n'
        f'{emit_property("Value", inst.value, value_at).rstrip()}\n'
        f'{emit_property("Footprint", inst.footprint, (value_at[0], value_at[1] + 2), True).rstrip()}\n'
        f'{emit_property("Datasheet", "", (value_at[0], value_at[1] + 4), True).rstrip()}\n'
        f'{emit_property("Description", "", (value_at[0], value_at[1] + 6), True).rstrip()}\n'
        "\t\t(instances\n"
        f'\t\t\t(project "{PROJECT_NAME}"\n'
        f'\t\t\t\t(path "/{uid("schematic-root")}"\n'
        f'\t\t\t\t\t(reference "{inst.ref}")\n'
        "\t\t\t\t\t(unit 1)\n"
        "\t\t\t\t)\n"
        "\t\t\t)\n"
        "\t\t)\n"
        "\t)\n"
    )


SYMBOLS: list[SymbolDef] = [
    SymbolDef(
        "ESP32_WROOM_32E_PCB",
        "U",
        "ESP32_WROOM_32E_PCB",
        (-12, -20, 12, 20),
        [
            PinDef("2", "VDD", -14.54, -17.78, 0, "power_in"),
            PinDef("3", "EN", -14.54, -15.24, 0, "input"),
            PinDef("1", "GND", -14.54, -12.70, 0, "power_in"),
            PinDef("15", "GND", -14.54, -12.70, 0, "passive", True),
            PinDef("38", "GND", -14.54, -12.70, 0, "passive", True),
            PinDef("39", "GND", -14.54, -12.70, 0, "passive", True),
            PinDef("25", "IO0", -14.54, -10.16, 0, "bidirectional"),
            PinDef("34", "U0RXD/IO3", -14.54, -7.62, 0, "bidirectional"),
            PinDef("35", "U0TXD/IO1", -14.54, -5.08, 0, "bidirectional"),
            PinDef("27", "IO16", -14.54, -2.54, 0, "bidirectional"),
            PinDef("28", "IO17", -14.54, 0.0, 0, "bidirectional"),
            PinDef("30", "IO18", 14.54, -17.78, 180, "bidirectional"),
            PinDef("31", "IO19", 14.54, -15.24, 180, "bidirectional"),
            PinDef("33", "IO21", 14.54, -12.70, 180, "bidirectional"),
            PinDef("36", "IO22", 14.54, -10.16, 180, "bidirectional"),
            PinDef("37", "IO23", 14.54, -7.62, 180, "bidirectional"),
            PinDef("10", "IO25", 14.54, -5.08, 180, "bidirectional"),
            PinDef("11", "IO26", 14.54, -2.54, 180, "bidirectional"),
            PinDef("12", "IO27", 14.54, 0.0, 180, "bidirectional"),
            PinDef("13", "IO14", 14.54, 2.54, 180, "bidirectional"),
            PinDef("4", "NC", -14.54, 5.08, 0, "no_connect", True),
            PinDef("5", "NC", -14.54, 7.62, 0, "no_connect", True),
            PinDef("6", "NC", -14.54, 10.16, 0, "no_connect", True),
            PinDef("7", "NC", -14.54, 12.70, 0, "no_connect", True),
            PinDef("8", "NC", -14.54, 15.24, 0, "no_connect", True),
            PinDef("9", "NC", -14.54, 17.78, 0, "no_connect", True),
            PinDef("14", "NC", 14.54, 5.08, 180, "no_connect", True),
            PinDef("16", "NC", 14.54, 7.62, 180, "no_connect", True),
            PinDef("17", "NC", 14.54, 10.16, 180, "no_connect", True),
            PinDef("18", "NC", 14.54, 12.70, 180, "no_connect", True),
            PinDef("19", "NC", 14.54, 15.24, 180, "no_connect", True),
            PinDef("20", "NC", 14.54, 17.78, 180, "no_connect", True),
            PinDef("21", "NC", 0.0, 22.54, 270, "no_connect", True),
            PinDef("22", "NC", 2.54, 22.54, 270, "no_connect", True),
            PinDef("23", "NC", 5.08, 22.54, 270, "no_connect", True),
            PinDef("24", "NC", 7.62, 22.54, 270, "no_connect", True),
            PinDef("26", "NC", 10.16, 22.54, 270, "no_connect", True),
            PinDef("29", "NC", 12.70, 22.54, 270, "no_connect", True),
            PinDef("32", "NC", -2.54, 22.54, 270, "no_connect", True),
        ],
    ),
    SymbolDef(
        "CP2102N_QFN24_SERVICE",
        "U",
        "CP2102N_QFN24_SERVICE",
        (-10, -16, 10, 16),
        [
            PinDef("7", "VREGIN", -12.54, -13.97, 0, "power_in"),
            PinDef("6", "VDD", -12.54, -11.43, 0, "power_in"),
            PinDef("5", "VIO", -12.54, -8.89, 0, "power_in"),
            PinDef("2", "GND", -12.54, -6.35, 0, "power_in"),
            PinDef("25", "GND", -12.54, -6.35, 0, "passive", True),
            PinDef("8", "VBUS", -12.54, -3.81, 0, "input"),
            PinDef("3", "D+", -12.54, -1.27, 0, "bidirectional"),
            PinDef("4", "D-", -12.54, 1.27, 0, "bidirectional"),
            PinDef("9", "~RST", -12.54, 3.81, 0, "input"),
            PinDef("21", "TXD", 12.54, -8.89, 180, "output"),
            PinDef("20", "RXD", 12.54, -6.35, 180, "input"),
            PinDef("19", "~RTS", 12.54, -3.81, 180, "output"),
            PinDef("23", "~DTR", 12.54, -1.27, 180, "output"),
            PinDef("1", "NC", 12.54, 1.27, 180, "no_connect", True),
            PinDef("10", "NC", 12.54, 3.81, 180, "no_connect", True),
            PinDef("11", "NC", 12.54, 6.35, 180, "no_connect", True),
            PinDef("12", "NC", 12.54, 8.89, 180, "no_connect", True),
            PinDef("13", "NC", 12.54, 11.43, 180, "no_connect", True),
            PinDef("14", "NC", 12.54, 13.97, 180, "no_connect", True),
            PinDef("15", "NC", 0.0, 18.54, 270, "no_connect", True),
            PinDef("16", "NC", 2.54, 18.54, 270, "no_connect", True),
            PinDef("17", "NC", 5.08, 18.54, 270, "no_connect", True),
            PinDef("18", "NC", 7.62, 18.54, 270, "no_connect", True),
            PinDef("22", "NC", 10.16, 18.54, 270, "no_connect", True),
            PinDef("24", "NC", -2.54, 18.54, 270, "no_connect", True),
        ],
    ),
    SymbolDef(
        "CP2102N_QFN24_HOST",
        "U",
        "CP2102N_QFN24_HOST",
        (-10, -16, 10, 16),
        [
            PinDef("7", "VREGIN", -12.54, -13.97, 0, "power_in"),
            PinDef("6", "VDD", -12.54, -11.43, 0, "power_in"),
            PinDef("5", "VIO", -12.54, -8.89, 0, "power_in"),
            PinDef("2", "GND", -12.54, -6.35, 0, "power_in"),
            PinDef("25", "GND", -12.54, -6.35, 0, "passive", True),
            PinDef("8", "VBUS", -12.54, -3.81, 0, "input"),
            PinDef("3", "D+", -12.54, -1.27, 0, "bidirectional"),
            PinDef("4", "D-", -12.54, 1.27, 0, "bidirectional"),
            PinDef("9", "~RST", -12.54, 3.81, 0, "input"),
            PinDef("21", "TXD", 12.54, -8.89, 180, "output"),
            PinDef("20", "RXD", 12.54, -6.35, 180, "input"),
            PinDef("1", "NC", 12.54, -3.81, 180, "no_connect", True),
            PinDef("10", "NC", 12.54, -1.27, 180, "no_connect", True),
            PinDef("11", "NC", 12.54, 1.27, 180, "no_connect", True),
            PinDef("12", "NC", 12.54, 3.81, 180, "no_connect", True),
            PinDef("13", "NC", 12.54, 6.35, 180, "no_connect", True),
            PinDef("14", "NC", 12.54, 8.89, 180, "no_connect", True),
            PinDef("15", "NC", 12.54, 11.43, 180, "no_connect", True),
            PinDef("16", "NC", 12.54, 13.97, 180, "no_connect", True),
            PinDef("17", "NC", 0.0, 18.54, 270, "no_connect", True),
            PinDef("18", "NC", 2.54, 18.54, 270, "no_connect", True),
            PinDef("19", "NC", 5.08, 18.54, 270, "no_connect", True),
            PinDef("22", "NC", 7.62, 18.54, 270, "no_connect", True),
            PinDef("23", "NC", 10.16, 18.54, 270, "no_connect", True),
            PinDef("24", "NC", -2.54, 18.54, 270, "no_connect", True),
        ],
    ),
    SymbolDef(
        "USB_C_SERVICE_16P",
        "J",
        "USB_C_SERVICE_16P",
        (-8, -12, 8, 12),
        [
            PinDef("A4", "VBUS", -10.54, -8.89, 0, "passive"),
            PinDef("A9", "VBUS", -10.54, -8.89, 0, "passive", True),
            PinDef("B4", "VBUS", -10.54, -8.89, 0, "passive", True),
            PinDef("B9", "VBUS", -10.54, -8.89, 0, "passive", True),
            PinDef("A6", "D+", -10.54, -3.81, 0, "bidirectional"),
            PinDef("B6", "D+", -10.54, -3.81, 0, "passive", True),
            PinDef("A7", "D-", -10.54, -1.27, 0, "bidirectional"),
            PinDef("B7", "D-", -10.54, -1.27, 0, "passive", True),
            PinDef("A5", "CC1", 10.54, -3.81, 180, "bidirectional"),
            PinDef("B5", "CC2", 10.54, -1.27, 180, "bidirectional"),
            PinDef("A1", "GND", 10.54, 3.81, 180, "passive"),
            PinDef("A12", "GND", 10.54, 3.81, 180, "passive", True),
            PinDef("B1", "GND", 10.54, 3.81, 180, "passive", True),
            PinDef("B12", "GND", 10.54, 3.81, 180, "passive", True),
            PinDef("S1", "SHIELD", 10.54, 6.35, 180, "passive"),
            PinDef("A8", "NC", -10.54, 6.35, 0, "no_connect", True),
            PinDef("B8", "NC", -10.54, 8.89, 0, "no_connect", True),
        ],
    ),
    SymbolDef(
        "USB_A_PIGTAIL_1X4",
        "J",
        "USB_A_PIGTAIL_1X4",
        (-8, -6, 8, 6),
        [
            PinDef("1", "VBUS", -10.54, -3.81, 0, "passive"),
            PinDef("2", "D-", -10.54, -1.27, 0, "bidirectional"),
            PinDef("3", "D+", -10.54, 1.27, 0, "bidirectional"),
            PinDef("4", "GND", 10.54, 0.0, 180, "passive"),
        ],
    ),
    SymbolDef(
        "AP2112K_33",
        "U",
        "AP2112K_33",
        (-7, -6, 7, 6),
        [
            PinDef("1", "VIN", -9.54, -2.54, 0, "power_in"),
            PinDef("2", "GND", -9.54, 0.0, 0, "power_in"),
            PinDef("3", "EN", -9.54, 2.54, 0, "input"),
            PinDef("5", "VOUT", 9.54, 0.0, 180, "power_out"),
            PinDef("4", "NC", 0.0, 8.54, 270, "no_connect", True),
        ],
    ),
    SymbolDef(
        "OLED_I2C_HDR_1x4",
        "J",
        "OLED_I2C_HDR_1x4",
        (-7, -6, 7, 6),
        [
            PinDef("1", "VCC", -9.54, -2.54, 0, "passive"),
            PinDef("2", "GND", -9.54, 2.54, 0, "passive"),
            PinDef("3", "SCL", 9.54, -2.54, 180, "bidirectional"),
            PinDef("4", "SDA", 9.54, 2.54, 180, "bidirectional"),
        ],
    ),
    SymbolDef("R_GENERIC", "R", "R_GENERIC", (-4, -2, 4, 2), [PinDef("1", "1", -6.54, 0.0, 0), PinDef("2", "2", 6.54, 0.0, 180)]),
    SymbolDef("C_GENERIC", "C", "C_GENERIC", (-4, -2, 4, 2), [PinDef("1", "1", -6.54, 0.0, 0), PinDef("2", "2", 6.54, 0.0, 180)]),
    SymbolDef("FUSE_GENERIC", "F", "FUSE_GENERIC", (-4, -2, 4, 2), [PinDef("1", "1", -6.54, 0.0, 0), PinDef("2", "2", 6.54, 0.0, 180)]),
    SymbolDef("DIODE_GENERIC", "D", "DIODE_GENERIC", (-4, -2, 4, 2), [PinDef("1", "A", -6.54, 0.0, 0), PinDef("2", "K", 6.54, 0.0, 180)]),
    SymbolDef("LED_GENERIC", "D", "LED_GENERIC", (-4, -2, 4, 2), [PinDef("1", "A", -6.54, 0.0, 0), PinDef("2", "K", 6.54, 0.0, 180)]),
    SymbolDef("BUZZER_GENERIC", "BZ", "BUZZER_GENERIC", (-4, -2, 4, 2), [PinDef("1", "1", -6.54, 0.0, 0), PinDef("2", "2", 6.54, 0.0, 180)]),
    SymbolDef("TP_GENERIC", "TP", "TP_GENERIC", (-3, -2, 3, 2), [PinDef("1", "1", -5.54, 0.0, 0)]),
    SymbolDef("PWR_FLAG", "#FLG", "PWR_FLAG", (-3, -2, 3, 2), [PinDef("1", "pwr", -5.54, 0.0, 0, "power_out")]),
    SymbolDef(
        "NPN_SOT23",
        "Q",
        "NPN_SOT23",
        (-5, -4, 5, 4),
        [PinDef("1", "B", -7.54, -1.27, 0, "input"), PinDef("2", "E", -7.54, 1.27, 0, "passive"), PinDef("3", "C", 7.54, 0.0, 180, "passive")],
    ),
    SymbolDef("SW_SPST_NO", "SW", "SW_SPST_NO", (-4, -3, 4, 3), [PinDef("1", "1", -6.54, 0.0, 0), PinDef("2", "2", 6.54, 0.0, 180)]),
    SymbolDef(
        "RGB_LED_CC",
        "D",
        "RGB_LED_CC",
        (-6, -5, 6, 5),
        [
            PinDef("1", "R", -8.54, -1.27, 0, "bidirectional"),
            PinDef("2", "K", -8.54, 1.27, 0, "passive"),
            PinDef("3", "G", 8.54, -1.27, 180, "bidirectional"),
            PinDef("4", "B", 8.54, 1.27, 180, "bidirectional"),
        ],
    ),
    SymbolDef(
        "USB_ESD_2CH",
        "U",
        "USB_ESD_2CH",
        (-5, -4, 5, 4),
        [PinDef("1", "D+", -7.54, -1.27, 0, "bidirectional"), PinDef("2", "GND", 7.54, 0.0, 180, "power_in"), PinDef("3", "D-", -7.54, 1.27, 0, "bidirectional")],
    ),
]


def normalize_symbol_geometry(symbols: list[SymbolDef]) -> None:
    step = SCH_GRID_MM
    for sym in symbols:
        left, top, right, bottom = sym.body
        sym.body = (left, -top, right, -bottom)
        by_angle: dict[int, list[PinDef]] = {}
        for pin in sym.pins:
            by_angle.setdefault(pin.angle, []).append(pin)

        for angle, pins in by_angle.items():
            if angle in (0, 180):
                ordered = sorted(pins, key=lambda pin: (pin.y, pin.x, pin.num))
                top_y = step * (len(ordered) // 2)
                x = sym.body[0] - step if angle == 0 else sym.body[2] + step
                for idx, pin in enumerate(ordered):
                    pin.x = x
                    pin.y = top_y - idx * step
            elif angle in (90, 270):
                ordered = sorted(pins, key=lambda pin: (pin.x, pin.y, pin.num))
                left_x = -step * (len(ordered) // 2)
                y = sym.body[3] - step if angle == 90 else sym.body[1] + step
                for idx, pin in enumerate(ordered):
                    pin.x = left_x + idx * step
                    pin.y = y


normalize_symbol_geometry(SYMBOLS)


INSTANCES: list[Instance] = [
    Instance("U1", "ESP32_WROOM_32E_PCB", "ESP32-WROOM-32E", "RF_Module:ESP32-WROOM-32E", (78, 106), (72, 84), (78, 129),
             {"2": "3V3", "3": "ESP_EN", "1": "GND", "15": "GND", "38": "GND", "39": "GND", "25": "ESP_IO0", "34": "UART0_RX", "35": "UART0_TX", "27": "UART2_RX",
              "28": "UART2_TX", "30": "BTN_OK", "31": "BTN_NEXT", "33": "OLED_SDA", "36": "OLED_SCL", "37": "BTN_BACK",
              "10": "LED_R_DRV", "11": "LED_G_DRV", "12": "LED_B_DRV", "13": "BUZZER_CTRL"}),
    Instance("U2", "CP2102N_QFN24_SERVICE", "CP2102N Service", "Package_DFN_QFN:QFN-24-1EP_4x4mm_P0.5mm_EP2.7x2.7mm", (154, 44),
             (148, 22), (154, 66), {"7": "3V3", "6": "3V3", "5": "3V3", "2": "GND", "25": "GND", "8": "VBUS_USB_C_RAW",
                                      "3": "USB_C_DP", "4": "USB_C_DN", "9": "3V3", "21": "UART0_TX", "20": "UART0_RX",
                                      "19": "USB_RTS", "23": "USB_DTR"}),
    Instance("U3", "CP2102N_QFN24_HOST", "CP2102N Host", "Package_DFN_QFN:QFN-24-1EP_4x4mm_P0.5mm_EP2.7x2.7mm", (154, 122),
             (148, 100), (154, 144), {"7": "3V3", "6": "3V3", "5": "3V3", "2": "GND", "25": "GND", "8": "VBUS_HOST_RAW",
                                       "3": "HOST_DP", "4": "HOST_DN", "9": "HOST_CP2102_RST_N", "21": "UART2_TX", "20": "UART2_RX"}),
    Instance("J1", "USB_C_SERVICE_16P", "Service USB-C", "Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12", (196, 40),
             (190, 20), (196, 62), {"A4": "VBUS_USB_C_RAW", "A9": "VBUS_USB_C_RAW", "B4": "VBUS_USB_C_RAW", "B9": "VBUS_USB_C_RAW",
                                     "A6": "USB_C_DP", "B6": "USB_C_DP", "A7": "USB_C_DN", "B7": "USB_C_DN", "A5": "USB_CC1", "B5": "USB_CC2",
                                     "A1": "GND", "A12": "GND", "B1": "GND", "B12": "GND", "S1": "GND"}),
    Instance("J2", "USB_A_PIGTAIL_1X4", "USB-A Pigtail", f"{PROJECT_NAME}:USB_A_Pigtail_Pads_1x4_Edge", (196, 118),
             (190, 98), (196, 136), {"1": "VBUS_HOST_RAW", "2": "HOST_DN", "3": "HOST_DP", "4": "GND"}),
    Instance("U4", "AP2112K_33", "AP2112K-3.3", "Package_TO_SOT_SMD:SOT-23-5", (60, 28), (54, 16), (60, 40),
             {"1": "5V_SYS", "2": "GND", "3": "5V_SYS", "5": "3V3"}),
    Instance("J3", "OLED_I2C_HDR_1x4", "OLED 0.96in I2C", f"{PROJECT_NAME}:OLED_096_I2C_Module_1x4", (116, 78),
             (110, 66), (116, 92), {"1": "3V3", "2": "GND", "3": "OLED_SCL", "4": "OLED_SDA"}),
    Instance("D10", "RGB_LED_CC", "RGB LED", "LED_SMD:LED_RGB_Wuerth-PLCC4_3.2x2.8mm_150141M173100", (118, 104), (112, 92), (118, 116),
             {"1": "LED_R", "2": "GND", "3": "LED_G", "4": "LED_B"}),
    Instance("BZ1", "BUZZER_GENERIC", "Buzzer", "Buzzer_Beeper:Buzzer_Murata_PKMCS0909E", (118, 132), (112, 120), (118, 144),
             {"1": "3V3", "2": "BUZZER_SW"}),
    Instance("Q1", "NPN_SOT23", "MMBT3904", "Package_TO_SOT_SMD:SOT-23", (48, 54), (42, 42), (48, 66),
             {"1": "USB_RTS", "2": "GND", "3": "ESP_EN"}),
    Instance("Q2", "NPN_SOT23", "MMBT3904", "Package_TO_SOT_SMD:SOT-23", (48, 66), (42, 54), (48, 78),
             {"1": "USB_DTR", "2": "GND", "3": "ESP_IO0"}),
    Instance("Q3", "NPN_SOT23", "MMBT3904", "Package_TO_SOT_SMD:SOT-23", (94, 132), (88, 120), (94, 144),
             {"1": "BUZZER_CTRL_DRV", "2": "GND", "3": "BUZZER_SW"}),
    Instance("U5", "USB_ESD_2CH", "USB ESD", "Package_TO_SOT_SMD:SOT-23", (176, 40), (170, 28), (176, 52),
             {"1": "USB_C_DP", "2": "GND", "3": "USB_C_DN"}),
    Instance("U6", "USB_ESD_2CH", "USB ESD", "Package_TO_SOT_SMD:SOT-23", (176, 118), (170, 106), (176, 130),
             {"1": "HOST_DP", "2": "GND", "3": "HOST_DN"}),
    Instance("F1", "FUSE_GENERIC", "PTC500mA", "Fuse:Fuse_1206_3216Metric", (24, 28), (18, 16), (24, 40),
             {"1": "VBUS_USB_C_RAW", "2": "VBUS_USB_C_PROT"}),
    Instance("F2", "FUSE_GENERIC", "PTC500mA", "Fuse:Fuse_1206_3216Metric", (24, 52), (18, 40), (24, 64),
             {"1": "VBUS_HOST_RAW", "2": "VBUS_HOST_PROT"}),
    Instance("D1", "DIODE_GENERIC", "B5819W", "Diode_SMD:D_SOD-123", (44, 28), (38, 16), (44, 40),
             {"1": "VBUS_USB_C_PROT", "2": "5V_SYS"}),
    Instance("D2", "DIODE_GENERIC", "B5819W", "Diode_SMD:D_SOD-123", (44, 52), (38, 40), (44, 64),
             {"1": "VBUS_HOST_PROT", "2": "5V_SYS"}),
    Instance("D3", "LED_GENERIC", "PWR LED", "LED_SMD:LED_0603_1608Metric", (24, 18), (18, 6), (24, 30),
             {"1": "GND", "2": "PWR_LED_N"}),
    Instance("R1", "R_GENERIC", "5.1k", "Resistor_SMD:R_0603_1608Metric", (164, 28), (158, 16), (164, 40),
             {"1": "USB_CC1", "2": "GND"}),
    Instance("R2", "R_GENERIC", "5.1k", "Resistor_SMD:R_0603_1608Metric", (164, 34), (158, 22), (164, 46),
             {"1": "USB_CC2", "2": "GND"}),
    Instance("R3", "R_GENERIC", "10k", "Resistor_SMD:R_0603_1608Metric", (48, 82), (42, 70), (48, 94),
             {"1": "3V3", "2": "ESP_EN"}),
    Instance("R4", "R_GENERIC", "10k", "Resistor_SMD:R_0603_1608Metric", (48, 90), (42, 78), (48, 102),
             {"1": "3V3", "2": "ESP_IO0"}),
    Instance("R5", "R_GENERIC", "DNP", "Resistor_SMD:R_0603_1608Metric", (134, 28), (128, 16), (134, 40),
             {"1": "3V3", "2": "USB_CC1"}, on_board=False, in_bom=False),
    Instance("R6", "R_GENERIC", "DNP", "Resistor_SMD:R_0603_1608Metric", (134, 34), (128, 22), (134, 46),
             {"1": "3V3", "2": "USB_CC2"}, on_board=False, in_bom=False),
    Instance("R7", "R_GENERIC", "DNP", "Resistor_SMD:R_0603_1608Metric", (58, 54), (52, 42), (58, 66),
             {"1": "USB_RTS", "2": "USB_RTS"}, on_board=False, in_bom=False),
    Instance("R8", "R_GENERIC", "DNP", "Resistor_SMD:R_0603_1608Metric", (58, 66), (52, 54), (58, 78),
             {"1": "USB_DTR", "2": "USB_DTR"}, on_board=False, in_bom=False),
    Instance("R9", "R_GENERIC", "DNP", "Resistor_SMD:R_0603_1608Metric", (132, 52), (126, 40), (132, 64),
             {"1": "VBUS_USB_C_RAW", "2": "USB_C_VBUS_SENSE"}, on_board=False, in_bom=False),
    Instance("R10", "R_GENERIC", "DNP", "Resistor_SMD:R_0603_1608Metric", (132, 60), (126, 48), (132, 72),
             {"1": "USB_C_VBUS_SENSE", "2": "GND"}, on_board=False, in_bom=False),
    Instance("R11", "R_GENERIC", "DNP", "Resistor_SMD:R_0603_1608Metric", (132, 126), (126, 114), (132, 138),
             {"1": "VBUS_HOST_RAW", "2": "HOST_VBUS_SENSE"}, on_board=False, in_bom=False),
    Instance("R12", "R_GENERIC", "DNP", "Resistor_SMD:R_0603_1608Metric", (132, 134), (126, 122), (132, 146),
             {"1": "HOST_VBUS_SENSE", "2": "GND"}, on_board=False, in_bom=False),
    Instance("R13", "R_GENERIC", "330", "Resistor_SMD:R_0603_1608Metric", (96, 96), (90, 84), (96, 108),
             {"1": "LED_R", "2": "LED_R_DRV"}),
    Instance("R14", "R_GENERIC", "330", "Resistor_SMD:R_0603_1608Metric", (96, 104), (90, 92), (96, 116),
             {"1": "LED_G", "2": "LED_G_DRV"}),
    Instance("R15", "R_GENERIC", "330", "Resistor_SMD:R_0603_1608Metric", (96, 112), (90, 100), (96, 124),
             {"1": "LED_B", "2": "LED_B_DRV"}),
    Instance("R16", "R_GENERIC", "1k", "Resistor_SMD:R_0603_1608Metric", (14, 18), (8, 6), (14, 30),
             {"1": "3V3", "2": "PWR_LED_N"}),
    Instance("R17", "R_GENERIC", "4.7k", "Resistor_SMD:R_0603_1608Metric", (82, 132), (76, 120), (82, 144),
             {"1": "BUZZER_CTRL", "2": "BUZZER_CTRL_DRV"}),
    Instance("R18", "R_GENERIC", "1k", "Resistor_SMD:R_0603_1608Metric", (136, 122), (130, 110), (136, 134),
             {"1": "3V3", "2": "HOST_CP2102_RST_N"}),
    Instance("C1", "C_GENERIC", "10u", "Capacitor_SMD:C_0603_1608Metric", (74, 24), (68, 12), (74, 36),
             {"1": "5V_SYS", "2": "GND"}),
    Instance("C2", "C_GENERIC", "10u", "Capacitor_SMD:C_0603_1608Metric", (74, 32), (68, 20), (74, 44),
             {"1": "3V3", "2": "GND"}),
    Instance("C3", "C_GENERIC", "1u", "Capacitor_SMD:C_0603_1608Metric", (62, 86), (56, 74), (62, 98),
             {"1": "ESP_EN", "2": "GND"}),
    Instance("C4", "C_GENERIC", "0.1u", "Capacitor_SMD:C_0603_1608Metric", (144, 28), (138, 16), (144, 40),
             {"1": "3V3", "2": "GND"}),
    Instance("C5", "C_GENERIC", "4.7u", "Capacitor_SMD:C_0603_1608Metric", (144, 34), (138, 22), (144, 46),
             {"1": "3V3", "2": "GND"}),
    Instance("C6", "C_GENERIC", "0.1u", "Capacitor_SMD:C_0603_1608Metric", (144, 118), (138, 106), (144, 130),
             {"1": "3V3", "2": "GND"}),
    Instance("C7", "C_GENERIC", "4.7u", "Capacitor_SMD:C_0603_1608Metric", (144, 124), (138, 112), (144, 136),
             {"1": "3V3", "2": "GND"}),
    Instance("C8", "C_GENERIC", "0.1u", "Capacitor_SMD:C_0603_1608Metric", (62, 98), (56, 86), (62, 110),
             {"1": "3V3", "2": "GND"}),
    Instance("C9", "C_GENERIC", "10u", "Capacitor_SMD:C_0603_1608Metric", (62, 106), (56, 94), (62, 118),
             {"1": "3V3", "2": "GND"}),
    Instance("SW1", "SW_SPST_NO", "BOOT", "Button_Switch_SMD:SW_Push_1P1T_NO_CK_PTS125Sx43SMTR", (26, 86), (20, 74), (26, 98),
             {"1": "ESP_IO0", "2": "GND"}),
    Instance("SW2", "SW_SPST_NO", "RESET", "Button_Switch_SMD:SW_Push_1P1T_NO_CK_PTS125Sx43SMTR", (26, 98), (20, 86), (26, 110),
             {"1": "ESP_EN", "2": "GND"}),
    Instance("SW3", "SW_SPST_NO", "OK", "Button_Switch_SMD:SW_Push_1P1T_NO_CK_PTS125Sx43SMTR", (144, 160), (138, 148), (144, 172),
             {"1": "BTN_OK", "2": "GND"}),
    Instance("SW4", "SW_SPST_NO", "NEXT", "Button_Switch_SMD:SW_Push_1P1T_NO_CK_PTS125Sx43SMTR", (164, 160), (158, 148), (164, 172),
             {"1": "BTN_NEXT", "2": "GND"}),
    Instance("SW5", "SW_SPST_NO", "BACK", "Button_Switch_SMD:SW_Push_1P1T_NO_CK_PTS125Sx43SMTR", (184, 160), (178, 148), (184, 172),
             {"1": "BTN_BACK", "2": "GND"}),
    Instance("TP1", "TP_GENERIC", "3V3", "TestPoint:TestPoint_Pad_D1.5mm", (18, 146), (12, 134), (18, 158), {"1": "3V3"}),
    Instance("TP2", "TP_GENERIC", "GND", "TestPoint:TestPoint_Pad_D1.5mm", (18, 154), (12, 142), (18, 166), {"1": "GND"}),
    Instance("TP3", "TP_GENERIC", "EN", "TestPoint:TestPoint_Pad_D1.5mm", (18, 162), (12, 150), (18, 174), {"1": "ESP_EN"}),
    Instance("TP4", "TP_GENERIC", "IO0", "TestPoint:TestPoint_Pad_D1.5mm", (18, 170), (12, 158), (18, 182), {"1": "ESP_IO0"}),
    Instance("TP5", "TP_GENERIC", "TX0", "TestPoint:TestPoint_Pad_D1.5mm", (36, 146), (30, 134), (36, 158), {"1": "UART0_TX"}),
    Instance("TP6", "TP_GENERIC", "RX0", "TestPoint:TestPoint_Pad_D1.5mm", (36, 154), (30, 142), (36, 166), {"1": "UART0_RX"}),
    Instance("TP7", "TP_GENERIC", "TX2", "TestPoint:TestPoint_Pad_D1.5mm", (36, 162), (30, 150), (36, 174), {"1": "UART2_TX"}),
    Instance("TP8", "TP_GENERIC", "RX2", "TestPoint:TestPoint_Pad_D1.5mm", (36, 170), (30, 158), (36, 182), {"1": "UART2_RX"}),
    Instance("FLG1", "PWR_FLAG", "PWR_FLAG", "", (20, 18), (14, 6), (20, 30), {"1": "5V_SYS"}, on_board=False, in_bom=False),
    Instance("FLG2", "PWR_FLAG", "PWR_FLAG", "", (20, 26), (14, 14), (20, 38), {"1": "GND"}, on_board=False, in_bom=False),
]


NETS = sorted({net for inst in INSTANCES for net in inst.connect.values()} | {"VBUS_USB_C_RAW", "VBUS_HOST_RAW", "VBUS_USB_C_PROT", "VBUS_HOST_PROT", "5V_SYS", "3V3", "GND"})


def symbol_map() -> dict[str, SymbolDef]:
    return {sym.name: sym for sym in SYMBOLS}


def write_symbol_library() -> None:
    content = "(kicad_symbol_lib\n\t(version 20241209)\n\t(generator \"kicad_symbol_editor\")\n\t(generator_version \"9.0\")\n"
    for sym in SYMBOLS:
        content += emit_symbol_def(sym, qualified=False)
    content += "\t(embedded_fonts no)\n)\n"
    SYM_PATH.write_text(content, encoding="utf-8")


def emit_wire(p1: tuple[float, float], p2: tuple[float, float], key: str) -> str:
    return (
        "\t(wire\n"
        "\t\t(pts\n"
        f"\t\t\t(xy {p1[0]} {p1[1]}) (xy {p2[0]} {p2[1]})\n"
        "\t\t)\n"
        "\t\t(stroke\n"
        "\t\t\t(width 0)\n"
        "\t\t\t(type solid)\n"
        "\t\t)\n"
        f'\t\t(uuid "{uid("wire:" + key)}")\n'
        "\t)\n"
    )


def emit_label(name: str, at: tuple[float, float], key: str) -> str:
    return (
        f'\t(global_label "{esc(name)}"\n'
        "\t\t(shape bidirectional)\n"
        f"\t\t(at {at[0]} {at[1]} 0)\n"
        "\t\t(fields_autoplaced yes)\n"
        "\t\t(effects\n"
        "\t\t\t(font\n"
        "\t\t\t\t(size 1.0 1.0)\n"
        "\t\t\t)\n"
        "\t\t\t(justify left)\n"
        "\t\t)\n"
        f'\t\t(uuid "{uid("label:" + key)}")\n'
        "\t)\n"
    )


def schematic_layout(instances: list[Instance], symdefs: dict[str, SymbolDef]) -> dict[str, tuple[tuple[float, float], tuple[float, float], tuple[float, float]]]:
    placements: dict[str, tuple[tuple[float, float], tuple[float, float], tuple[float, float]]] = {}
    cols = 6
    x0 = 40.0
    y0 = 40.0
    x_step = 70.0
    y_step = 60.0
    for idx, inst in enumerate(instances):
        if inst.ref in symdefs:
            sym = symdefs[inst.ref]
        else:
            sym = symdefs[inst.symbol]
        col = idx % cols
        row = idx // cols
        at = (x0 + col * x_step, y0 + row * y_step)
        ref_at = (at[0] + sym.body[0], at[1] + sym.body[1] - 4.0)
        value_at = (at[0], at[1] + sym.body[3] + 4.0)
        placements[inst.ref] = (at, ref_at, value_at)
    return placements


def pin_sort_key(pin: PinDef) -> tuple[int, str]:
    try:
        return (0, f"{int(pin.num):04d}")
    except ValueError:
        return (1, pin.num)


def build_instance_symbols(instances: list[Instance], smap: dict[str, SymbolDef]) -> dict[str, SymbolDef]:
    result: dict[str, SymbolDef] = {}
    for inst in instances:
        base = smap[inst.symbol]
        body = tuple(base.body)
        pins = [
            PinDef(pin.num, pin.name, pin.x, pin.y, pin.angle, pin.etype, pin.hidden)
            for pin in base.pins
        ]
        result[inst.ref] = SymbolDef(
            f"{inst.ref}_SYM",
            base.ref,
            inst.value,
            body,
            pins,
        )
    return result


def write_schematic() -> None:
    smap = symbol_map()
    lib_body = "".join(emit_symbol_def(sym) for sym in SYMBOLS)
    layout = schematic_layout(INSTANCES, smap)
    conn_objects: list[str] = []
    for inst in INSTANCES:
        sym = smap[inst.symbol]
        inst_at, _, _ = layout[inst.ref]
        pins_by_num = {pin.num: pin for pin in sym.pins}
        for pin_num, net_name in inst.connect.items():
            pin = pins_by_num[pin_num]
            p1, p2 = angle_len_to_stub(pin, inst_at)
            key = f"{inst.ref}:{pin_num}:{net_name}"
            conn_objects.append(emit_wire(p1, p2, key))
            conn_objects.append(emit_label(net_name, p2, key))

    inst_text = "".join(
        emit_symbol_instance(inst, inst.symbol, *layout[inst.ref])
        for inst in INSTANCES
    )
    header = (
        "(kicad_sch\n"
        "\t(version 20250114)\n"
        "\t(generator \"eeschema\")\n"
        "\t(generator_version \"9.0\")\n"
        f'\t(uuid "{uid("schematic-root")}")\n'
        '\t(paper "A0")\n'
        "\t(title_block\n"
        '\t\t(title "ESP32 Serial Deployer PCB v1")\n'
        '\t\t(date "2026-03-15")\n'
        "\t)\n"
        "\t(lib_symbols\n"
    )
    tail = (
        "\t(sheet_instances\n"
        '\t\t(path "/"\n'
        '\t\t\t(page "1")\n'
        "\t\t)\n"
        "\t)\n"
        "\t(embedded_fonts no)\n"
        ")\n"
    )
    SCH_PATH.write_text(header + lib_body + "\t)\n" + "".join(conn_objects) + inst_text + tail, encoding="utf-8")


OFFICIAL_LIBS = {
    "RF_Module": KICAD_FOOTPRINTS / "RF_Module.pretty",
    "Package_DFN_QFN": KICAD_FOOTPRINTS / "Package_DFN_QFN.pretty",
    "Connector_USB": KICAD_FOOTPRINTS / "Connector_USB.pretty",
    "Package_TO_SOT_SMD": KICAD_FOOTPRINTS / "Package_TO_SOT_SMD.pretty",
    "Buzzer_Beeper": KICAD_FOOTPRINTS / "Buzzer_Beeper.pretty",
    "LED_SMD": KICAD_FOOTPRINTS / "LED_SMD.pretty",
    "Fuse": KICAD_FOOTPRINTS / "Fuse.pretty",
    "Diode_SMD": KICAD_FOOTPRINTS / "Diode_SMD.pretty",
    "Resistor_SMD": KICAD_FOOTPRINTS / "Resistor_SMD.pretty",
    "Capacitor_SMD": KICAD_FOOTPRINTS / "Capacitor_SMD.pretty",
    "Button_Switch_SMD": KICAD_FOOTPRINTS / "Button_Switch_SMD.pretty",
    "TestPoint": KICAD_FOOTPRINTS / "TestPoint.pretty",
}


PLACEMENTS = {
    "U1": (12.0, 30.0, 0.0),
    "J1": (55.0, 5.0, 180.0),
    "U2": (73.0, 14.0, 0.0),
    "F1": (40.0, 18.0, 0.0),
    "D1": (46.0, 18.0, 0.0),
    "U5": (61.0, 13.0, 90.0),
    "R1": (50.0, 23.0, 90.0),
    "R2": (53.0, 23.0, 90.0),
    "R9": (61.0, 8.0, 0.0),
    "R10": (61.0, 10.0, 0.0),
    "R5": (64.0, 12.0, 90.0),
    "C4": (66.0, 12.0, 90.0),
    "C5": (68.0, 12.0, 90.0),
    "Q1": (60.0, 22.0, 180.0),
    "Q2": (60.0, 26.0, 180.0),
    "R7": (65.0, 22.0, 0.0),
    "R8": (65.0, 26.0, 0.0),
    "J3": (88.0, 16.0, 0.0),
    "U4": (43.0, 26.0, 0.0),
    "C1": (38.0, 25.0, 90.0),
    "C2": (48.0, 25.0, 90.0),
    "SW1": (18.0, 53.0, 180.0),
    "SW2": (36.0, 53.0, 180.0),
    "R3": (28.0, 40.0, 90.0),
    "R4": (31.0, 40.0, 90.0),
    "C3": (34.0, 40.0, 90.0),
    "U3": (72.0, 34.0, 0.0),
    "J2": (94.0, 33.0, 0.0),
    "U6": (86.0, 32.0, 270.0),
    "F2": (82.0, 24.0, 90.0),
    "D2": (78.0, 24.0, 90.0),
    "R11": (84.0, 27.0, 0.0),
    "R12": (84.0, 29.0, 0.0),
    "R6": (64.0, 24.0, 90.0),
    "C6": (66.0, 30.0, 90.0),
    "C7": (66.0, 40.0, 90.0),
    "C8": (40.0, 30.0, 90.0),
    "C9": (44.0, 30.0, 90.0),
    "D10": (62.0, 34.0, 0.0),
    "R13": (50.0, 34.0, 90.0),
    "R14": (53.0, 34.0, 90.0),
    "R15": (56.0, 34.0, 90.0),
    "Q3": (46.0, 38.0, 180.0),
    "R17": (42.0, 43.0, 0.0),
    "R18": (71.25, 37.0, 0.0),
    "BZ1": (56.0, 46.0, 0.0),
    "SW3": (56.0, 60.0, 180.0),
    "SW4": (73.0, 60.0, 180.0),
    "SW5": (90.0, 60.0, 180.0),
    "D3": (38.0, 6.0, 90.0),
    "R16": (42.0, 6.0, 90.0),
    "TP1": (52.0, 68.0, 0.0),
    "TP2": (56.0, 68.0, 0.0),
    "TP3": (60.0, 68.0, 0.0),
    "TP4": (64.0, 68.0, 0.0),
    "TP5": (68.0, 68.0, 0.0),
    "TP6": (72.0, 68.0, 0.0),
    "TP7": (76.0, 68.0, 0.0),
    "TP8": (80.0, 68.0, 0.0),
}


def fp_path(footprint_id: str) -> tuple[Path, str]:
    lib, name = footprint_id.split(":", 1)
    if lib == PROJECT_NAME:
        return LOCAL_PRETTY, name
    return OFFICIAL_LIBS[lib], name


def pad_lookup(board: pcbnew.BOARD, ref: str, pad_num: str) -> list[pcbnew.PAD]:
    fp = board.FindFootprintByReference(ref)
    if fp is None:
        raise ValueError(f"missing footprint {ref}")
    pads = [pad for pad in fp.Pads() if pad.GetNumber() == str(pad_num)]
    if not pads:
        raise ValueError(f"missing pad {ref}.{pad_num}")
    pads.sort(key=lambda pad: (pad.GetPosition().x, pad.GetPosition().y))
    return pads


def pad_point(board: pcbnew.BOARD, ref: str, pad_num: str, index: int = 0) -> tuple[float, float]:
    pad = pad_lookup(board, ref, pad_num)[index]
    pos = pad.GetPosition()
    return pcbnew.ToMM(pos.x), pcbnew.ToMM(pos.y)


def add_track(board: pcbnew.BOARD, net: pcbnew.NETINFO_ITEM, layer: int, start: tuple[float, float], end: tuple[float, float], width: float) -> None:
    track = pcbnew.PCB_TRACK(board)
    track.SetNet(net)
    track.SetLayer(layer)
    track.SetWidth(mm(width))
    track.SetStart(pcbnew.VECTOR2I(mm(start[0]), mm(start[1])))
    track.SetEnd(pcbnew.VECTOR2I(mm(end[0]), mm(end[1])))
    board.Add(track)


def add_path(board: pcbnew.BOARD, nets: dict[str, pcbnew.NETINFO_ITEM], net_name: str, points: list[tuple[float, float]], layer: int = pcbnew.F_Cu, width: float = 0.25) -> None:
    for start, end in zip(points, points[1:]):
        add_track(board, nets[net_name], layer, start, end, width)


def add_via(board: pcbnew.BOARD, nets: dict[str, pcbnew.NETINFO_ITEM], net_name: str, point: tuple[float, float], drill: float = 0.3, diameter: float = 0.6) -> None:
    via = pcbnew.PCB_VIA(board)
    via.SetNet(nets[net_name])
    via.SetViaType(pcbnew.VIATYPE_THROUGH)
    via.SetDrill(mm(drill))
    via.SetWidth(mm(diameter))
    via.SetPosition(pcbnew.VECTOR2I(mm(point[0]), mm(point[1])))
    board.Add(via)


def bridge_duplicate_pads(board: pcbnew.BOARD, nets: dict[str, pcbnew.NETINFO_ITEM], ref: str, pad_num: str, layer: int = pcbnew.F_Cu, width: float = 0.35) -> None:
    pads = pad_lookup(board, ref, pad_num)
    if len(pads) < 2:
        return
    points = []
    for pad in pads:
        pos = pad.GetPosition()
        points.append((pcbnew.ToMM(pos.x), pcbnew.ToMM(pos.y)))
    add_path(board, nets, pads[0].GetNetname(), points, layer, width)


def add_rect_zone(board: pcbnew.BOARD, nets: dict[str, pcbnew.NETINFO_ITEM], net_name: str, layer: int, x1: float, y1: float, x2: float, y2: float) -> None:
    zone = pcbnew.ZONE(board)
    zone.SetIsRuleArea(False)
    zone.SetDoNotAllowTracks(False)
    zone.SetDoNotAllowVias(False)
    zone.SetDoNotAllowPads(False)
    zone.SetDoNotAllowCopperPour(False)
    zone.SetDoNotAllowFootprints(False)
    zone.SetLayer(layer)
    layer_set = pcbnew.LSET()
    layer_set.AddLayer(layer)
    zone.SetLayerSet(layer_set)
    zone.SetNetCode(nets[net_name].GetNetCode())
    zone.SetPadConnection(pcbnew.ZONE_CONNECTION_FULL)
    outline = zone.Outline()
    outline.NewOutline()
    outline.Append(mm(x1), mm(y1))
    outline.Append(mm(x2), mm(y1))
    outline.Append(mm(x2), mm(y2))
    outline.Append(mm(x1), mm(y2))
    board.Add(zone)


def build_board() -> pcbnew.BOARD:
    board = pcbnew.BOARD()
    board.SetCopperLayerCount(4)
    board.GetDesignSettings().m_MinThroughDrill = mm(0.2)

    nets: dict[str, pcbnew.NETINFO_ITEM] = {}
    for name in sorted(set(NETS) | {"USB_C_VBUS_SENSE", "HOST_VBUS_SENSE", "LED_R_DRV", "LED_G_DRV", "LED_B_DRV", "BUZZER_CTRL_DRV"}):
        net = pcbnew.NETINFO_ITEM(board, name)
        board.Add(net)
        nets[name] = net

    def add_edge_segment(x1: float, y1: float, x2: float, y2: float) -> None:
        shape = pcbnew.PCB_SHAPE(board)
        shape.SetShape(pcbnew.S_SEGMENT)
        shape.SetLayer(pcbnew.Edge_Cuts)
        shape.SetStart(pcbnew.VECTOR2I(mm(x1), mm(y1)))
        shape.SetEnd(pcbnew.VECTOR2I(mm(x2), mm(y2)))
        shape.SetWidth(mm(0.1))
        board.Add(shape)

    add_edge_segment(0, 0, 100, 0)
    add_edge_segment(100, 0, 100, 72)
    add_edge_segment(100, 72, 0, 72)
    add_edge_segment(0, 72, 0, 0)

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

    for inst in INSTANCES:
        if not inst.on_board:
            continue
        lib_path, name = fp_path(inst.footprint)
        fp = pcbnew.FootprintLoad(str(lib_path), name)
        fp.SetReference(inst.ref)
        fp.SetValue(inst.value)
        fp.SetLink(pcbnew.KIID(inst.uuid))
        fp.SetFPIDAsString(inst.footprint)
        fp.Reference().SetVisible(False)
        fp.Value().SetVisible(False)
        x, y, a = PLACEMENTS[inst.ref]
        fp.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
        fp.SetOrientationDegrees(a)
        board.Add(fp)
        for pad in fp.Pads():
            net_name = inst.connect.get(pad.GetNumber())
            if not net_name:
                net_name = pad_alias_nets.get(inst.ref, {}).get(pad.GetNumber())
            if net_name:
                pad.SetNet(nets[net_name])

    pp = lambda ref, pad_num, index=0: pad_point(board, ref, pad_num, index)

    if EMIT_LOCAL_TRACKS:
        # Keep only the short, placement-sensitive local routes here.
        # Long board-spanning traces are intentionally left for DSN -> SES autorouting.
        add_path(board, nets, "USB_C_DP", [pp("J1", "B6"), (55.25, 12.0), pp("J1", "A6")], pcbnew.F_Cu, 0.22)
        add_path(board, nets, "USB_C_DN", [pp("J1", "A7"), (55.25, 12.5), pp("J1", "B7")], pcbnew.F_Cu, 0.22)
        add_path(board, nets, "VBUS_USB_C_RAW", [pp("J1", "A9"), (52.55, 10.6), (57.45, 10.6), pp("J1", "A4")], pcbnew.F_Cu, 0.5)

        add_path(board, nets, "USB_C_DP", [pp("J1", "A6"), (55.25, 12.0), pp("U5", "1"), pp("U2", "3")], pcbnew.F_Cu, 0.22)
        add_path(board, nets, "USB_C_DN", [pp("J1", "A7"), (54.75, 12.0), pp("U5", "3"), pp("U2", "4")], pcbnew.F_Cu, 0.22)
        add_path(board, nets, "HOST_DP", [pp("J2", "3"), (86.95, 31.75), pp("U6", "1"), (70.037, 31.75), pp("U3", "3")], pcbnew.F_Cu, 0.22)
        add_path(board, nets, "HOST_DN", [pp("J2", "2"), (86.0, 34.25), pp("U6", "3"), (70.037, 34.25), pp("U3", "4")], pcbnew.F_Cu, 0.22)

        add_path(board, nets, "USB_CC1", [pp("J1", "A5"), pp("R1", "1")], pcbnew.F_Cu, 0.22)
        add_path(board, nets, "USB_CC2", [pp("J1", "B5"), pp("R2", "1")], pcbnew.F_Cu, 0.22)

        add_path(board, nets, "VBUS_USB_C_RAW", [pp("J1", "A4"), (57.45, 12.2), (38.6, 12.2), pp("F1", "1")], pcbnew.F_Cu, 0.5)
        add_path(board, nets, "VBUS_USB_C_PROT", [pp("F1", "2"), pp("D1", "1")], pcbnew.F_Cu, 0.5)
        add_path(board, nets, "VBUS_HOST_RAW", [pp("J2", "1"), (92.2, 25.4), pp("F2", "1")], pcbnew.F_Cu, 0.5)
        add_path(board, nets, "VBUS_HOST_PROT", [pp("F2", "2"), pp("D2", "1")], pcbnew.F_Cu, 0.5)
        add_path(board, nets, "5V_SYS", [pp("D1", "2"), (47.65, 22.35), pp("D2", "2")], pcbnew.F_Cu, 0.5)
        add_path(board, nets, "5V_SYS", [pp("D1", "2"), (47.65, 25.05), pp("U4", "1"), pp("U4", "3")], pcbnew.F_Cu, 0.5)
        add_path(board, nets, "5V_SYS", [pp("U4", "1"), pp("C1", "1")], pcbnew.F_Cu, 0.5)
        add_path(board, nets, "3V3", [pp("U4", "5"), pp("C2", "1"), pp("C9", "1"), pp("C8", "1")], pcbnew.F_Cu, 0.5)
        add_path(board, nets, "3V3", [pp("U2", "5"), (68.0, 14.75), pp("C5", "1"), pp("C4", "1")], pcbnew.F_Cu, 0.25)
        add_path(board, nets, "3V3", [pp("U3", "5"), (66.0, 34.75), pp("C6", "1"), pp("C7", "1")], pcbnew.F_Cu, 0.25)
        add_path(board, nets, "VBUS_USB_C_RAW", [pp("U2", "8"), (72.25, 10.6), (57.45, 10.6)], pcbnew.F_Cu, 0.3)
        add_path(board, nets, "VBUS_HOST_RAW", [pp("U3", "8"), (71.25, 38.0), (92.2, 38.0), pp("J2", "1")], pcbnew.F_Cu, 0.5)

        add_path(board, nets, "LED_R", [pp("R13", "1"), (64.5, 34.825), (64.5, 33.3), pp("D10", "1")], pcbnew.F_Cu, 0.22)
        add_path(board, nets, "LED_G", [pp("R14", "1"), (59.0, 34.825), (59.0, 33.3), pp("D10", "3")], pcbnew.F_Cu, 0.22)
        add_path(board, nets, "LED_B", [pp("R15", "1"), (61.5, 34.825), (61.5, 34.7), pp("D10", "4")], pcbnew.F_Cu, 0.22)
        add_path(board, nets, "BUZZER_CTRL_DRV", [pp("R17", "2"), pp("Q3", "1")], pcbnew.F_Cu, 0.22)
        add_path(board, nets, "BUZZER_SW", [pp("Q3", "3"), (pp("BZ1", "2")[0], 38.0), pp("BZ1", "2")], pcbnew.F_Cu, 0.35)
        add_path(board, nets, "PWR_LED_N", [pp("R16", "2"), pp("D3", "2")], pcbnew.F_Cu, 0.22)

    add_rect_zone(board, nets, "GND", pcbnew.In1_Cu, 0.5, 0.5, 99.5, 71.5)

    return board


def save_board(board: pcbnew.BOARD) -> None:
    pcbnew.SaveBoard(str(PCB_PATH), board)


def main() -> None:
    REPORTS_DIR.mkdir(exist_ok=True)
    write_symbol_library()
    write_schematic()
    save_board(build_board())


if __name__ == "__main__":
    main()
