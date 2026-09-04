"""Build an A3 vector industrial blueprint for the AetherGuard enclosure.

The source dimensions mirror hardware/enclosure/parameters.scad. Pages 3 and 4
are true 1:1 templates when the PDF is printed at Actual Size / 100%.
"""

from __future__ import annotations

import math
from pathlib import Path

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "aetherguard-enclosure-industrial-blueprint-a3.pdf"
FONT_REGULAR = Path(r"C:\Windows\Fonts\msyh.ttc")
FONT_BOLD = Path(r"C:\Windows\Fonts\msyhbd.ttc")

PAGE_W_MM = 420.0
PAGE_H_MM = 297.0

INK = HexColor("#17344A")
BLUE = HexColor("#176B9E")
CYAN = HexColor("#1BA6C9")
LIGHT_BLUE = HexColor("#D7EAF3")
GRID = HexColor("#EAF3F7")
GREY = HexColor("#667985")
LIGHT_GREY = HexColor("#F4F7F9")
RED = HexColor("#A23A3A")
WHITE = HexColor("#FFFFFF")

# Canonical dimensions from hardware/enclosure/parameters.scad, millimetres.
ENCLOSURE_W = 320.0
ENCLOSURE_D = 210.0
ENCLOSURE_H = 88.0
WALL = 3.2
FLOOR_T = 3.4
ROOF_T = 3.2
PANEL_W = 313.6
PANEL_H = 81.4
COVER_D = 203.6
SPLIT_X = 160.0

RJ45_W = 18.2
RJ45_H = 15.4
RJ45_Z = 29.0
RJ45_X = (32.0, 76.0, 128.0)
USB_C_W = 12.0
USB_C_H = 7.0
USB_C_X = 168.0
USB_C_Z = 29.0
BUTTON_D = 22.5
ESTOP = (236.0, 27.0)
CONFIRM = (286.0, 27.0)
STATUS = (246.0, 59.0, 120.0, 13.0)
FRONT_SCREW_D = 3.4
FRONT_SCREWS = (
    (10.0, 10.0),
    (10.0, PANEL_H - 10.0),
    (PANEL_W / 2 - 12.0, PANEL_H - 9.0),
    (PANEL_W / 2 + 12.0, PANEL_H - 9.0),
    (PANEL_W - 10.0, 10.0),
    (PANEL_W - 10.0, PANEL_H - 10.0),
)

TOP_SCREW_D = 4.3
TOP_SCREWS = (
    (12.0, 12.0),
    (PANEL_W / 2 - 20.0, 12.0),
    (PANEL_W / 2 + 20.0, 12.0),
    (PANEL_W - 12.0, 12.0),
    (12.0, COVER_D - 12.0),
    (PANEL_W / 2 - 20.0, COVER_D - 12.0),
    (PANEL_W / 2 + 20.0, COVER_D - 12.0),
    (PANEL_W - 12.0, COVER_D - 12.0),
)
STACK_LIGHT = (282.8, 168.8)
STACK_LIGHT_SHAFT_D = 22.5
STACK_LIGHT_BCD = 36.0
STACK_LIGHT_MOUNT_D = 3.4

BOTTOM_MOUNTS = ((22.0, 24.0), (298.0, 24.0), (22.0, 186.0), (298.0, 186.0))


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("MSYH", str(FONT_REGULAR)))
    pdfmetrics.registerFont(TTFont("MSYH-Bold", str(FONT_BOLD)))


def tx(value_mm: float) -> float:
    return value_mm * mm


def set_stroke(c: canvas.Canvas, color=INK, width_mm: float = 0.28) -> None:
    c.setStrokeColor(color)
    c.setLineWidth(tx(width_mm))


def line(c: canvas.Canvas, x1: float, y1: float, x2: float, y2: float) -> None:
    c.line(tx(x1), tx(y1), tx(x2), tx(y2))


def rect(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    stroke: int = 1,
    fill: int = 0,
) -> None:
    c.rect(tx(x), tx(y), tx(w), tx(h), stroke=stroke, fill=fill)


def round_rect(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    radius: float,
    stroke: int = 1,
    fill: int = 0,
) -> None:
    c.roundRect(tx(x), tx(y), tx(w), tx(h), tx(radius), stroke=stroke, fill=fill)


def circle(c: canvas.Canvas, x: float, y: float, diameter: float, fill: int = 0) -> None:
    c.circle(tx(x), tx(y), tx(diameter / 2.0), stroke=1, fill=fill)


def label(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    size: float = 7.0,
    color=INK,
    font: str = "MSYH",
    align: str = "left",
) -> None:
    c.setFillColor(color)
    c.setFont(font, size)
    x_pt = tx(x)
    y_pt = tx(y)
    if align == "center":
        c.drawCentredString(x_pt, y_pt, text)
    elif align == "right":
        c.drawRightString(x_pt, y_pt, text)
    else:
        c.drawString(x_pt, y_pt, text)


def wrapped_text(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    max_chars: int,
    leading_mm: float = 4.2,
    size: float = 6.5,
    color=INK,
    bullet: str | None = None,
) -> float:
    words = list(text) if " " not in text else text.split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        separator = "" if " " not in text else (" " if current else "")
        candidate = current + separator + word
        if len(candidate) > max_chars and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    for index, row in enumerate(lines):
        prefix = bullet if index == 0 and bullet else ""
        label(c, prefix + row, x, y - index * leading_mm, size=size, color=color)
    return y - len(lines) * leading_mm


def arrow(c: canvas.Canvas, x: float, y: float, angle_deg: float, size_mm: float = 1.6) -> None:
    angle = math.radians(angle_deg)
    back = angle + math.pi
    left = back + math.radians(24)
    right = back - math.radians(24)
    path = c.beginPath()
    path.moveTo(tx(x), tx(y))
    path.lineTo(tx(x + size_mm * math.cos(left)), tx(y + size_mm * math.sin(left)))
    path.lineTo(tx(x + size_mm * math.cos(right)), tx(y + size_mm * math.sin(right)))
    path.close()
    c.setFillColor(BLUE)
    c.drawPath(path, stroke=0, fill=1)


def dim_h(
    c: canvas.Canvas,
    x1: float,
    x2: float,
    object_y: float,
    dim_y: float,
    text: str,
    color=BLUE,
) -> None:
    set_stroke(c, color, 0.22)
    line(c, x1, object_y, x1, dim_y)
    line(c, x2, object_y, x2, dim_y)
    line(c, x1, dim_y, x2, dim_y)
    arrow(c, x1, dim_y, 0)
    arrow(c, x2, dim_y, 180)
    c.setFillColor(WHITE)
    text_width = max(9.0, len(text) * 1.8)
    rect(c, (x1 + x2) / 2 - text_width / 2, dim_y - 1.8, text_width, 3.6, stroke=0, fill=1)
    label(c, text, (x1 + x2) / 2, dim_y - 1.0, 6.3, color, align="center")


def dim_v(
    c: canvas.Canvas,
    y1: float,
    y2: float,
    object_x: float,
    dim_x: float,
    text: str,
    color=BLUE,
) -> None:
    set_stroke(c, color, 0.22)
    line(c, object_x, y1, dim_x, y1)
    line(c, object_x, y2, dim_x, y2)
    line(c, dim_x, y1, dim_x, y2)
    arrow(c, dim_x, y1, 90)
    arrow(c, dim_x, y2, -90)
    c.saveState()
    c.translate(tx(dim_x - 1.0), tx((y1 + y2) / 2))
    c.rotate(90)
    c.setFillColor(WHITE)
    c.rect(tx(-max(9.0, len(text) * 1.8) / 2), tx(-1.8), tx(max(9.0, len(text) * 1.8)), tx(3.6), stroke=0, fill=1)
    c.setFillColor(color)
    c.setFont("MSYH", 6.3)
    c.drawCentredString(0, tx(-1.0), text)
    c.restoreState()


def center_mark(c: canvas.Canvas, x: float, y: float, size: float = 2.5) -> None:
    set_stroke(c, CYAN, 0.18)
    line(c, x - size, y, x + size, y)
    line(c, x, y - size, x, y + size)


def dashed(c: canvas.Canvas, dash=(2.0, 1.2)) -> None:
    c.setDash(tx(dash[0]), tx(dash[1]))


def solid(c: canvas.Canvas) -> None:
    c.setDash()


def drawing_frame(c: canvas.Canvas, sheet: str, title: str, scale: str) -> None:
    c.setFillColor(WHITE)
    rect(c, 0, 0, PAGE_W_MM, PAGE_H_MM, stroke=0, fill=1)

    set_stroke(c, GRID, 0.12)
    for x in range(10, 411, 10):
        line(c, x, 34, x, 276)
    for y in range(40, 277, 10):
        line(c, 8, y, 412, y)
    set_stroke(c, LIGHT_BLUE, 0.2)
    for x in range(10, 411, 50):
        line(c, x, 34, x, 276)
    for y in range(50, 277, 50):
        line(c, 8, y, 412, y)

    set_stroke(c, INK, 0.5)
    rect(c, 8, 8, 404, 281)
    rect(c, 10, 10, 400, 277)

    c.setFillColor(INK)
    rect(c, 10, 276, 400, 11, stroke=0, fill=1)
    label(c, "AETHERGUARD // ROOT-RESISTANT GATEWAY", 15, 279.3, 8.5, WHITE, "MSYH-Bold")
    label(c, "工业蓝图 / INDUSTRIAL BLUEPRINT", 405, 279.3, 7.2, WHITE, "MSYH-Bold", "right")

    c.setFillColor(LIGHT_GREY)
    rect(c, 10, 10, 400, 23, stroke=0, fill=1)
    set_stroke(c, INK, 0.25)
    line(c, 10, 33, 410, 33)
    line(c, 250, 10, 250, 33)
    line(c, 320, 10, 320, 33)
    line(c, 365, 10, 365, 33)
    line(c, 250, 21.5, 410, 21.5)

    label(c, title, 15, 24.5, 9.2, INK, "MSYH-Bold")
    label(c, "UNITS: mm   |   THIRD-ANGLE PROJECTION   |   DO NOT SCALE DIMENSIONS", 15, 15.2, 6.2, GREY)
    label(c, "DRAWN", 253, 27.0, 5.3, GREY)
    label(c, "CODEX / PARAMETRIC", 253, 23.0, 6.0, INK)
    label(c, "SCALE", 323, 27.0, 5.3, GREY)
    label(c, scale, 323, 23.0, 7.0, INK, "MSYH-Bold")
    label(c, "REV", 368, 27.0, 5.3, GREY)
    label(c, "P0.6", 368, 23.0, 7.0, INK, "MSYH-Bold")
    label(c, "SHEET", 323, 16.0, 5.3, GREY)
    label(c, f"{sheet} / 4", 342.5, 13.0, 7.0, INK, "MSYH-Bold", "center")
    label(c, "DATE", 368, 16.0, 5.3, GREY)
    label(c, "2026-08-22", 368, 12.2, 5.9, INK)


def view_title(c: canvas.Canvas, text: str, x: float, y: float, scale: str) -> None:
    label(c, text, x, y, 7.2, INK, "MSYH-Bold")
    label(c, scale, x, y - 4.2, 5.7, GREY)


def draw_front_view(c: canvas.Canvas, x: float, y: float, scale: float) -> None:
    w = ENCLOSURE_W * scale
    h = ENCLOSURE_H * scale
    set_stroke(c, INK, 0.35)
    round_rect(c, x, y, w, h, 9 * scale)
    set_stroke(c, BLUE, 0.24)
    round_rect(c, x + WALL * scale, y + FLOOR_T * scale, PANEL_W * scale, PANEL_H * scale, 4.5 * scale)

    px = x + WALL * scale
    py = y + FLOOR_T * scale
    for port_x in RJ45_X:
        rect(c, px + (port_x - RJ45_W / 2) * scale, py + (RJ45_Z - RJ45_H / 2) * scale, RJ45_W * scale, RJ45_H * scale)
    rect(c, px + (USB_C_X - USB_C_W / 2) * scale, py + (USB_C_Z - USB_C_H / 2) * scale, USB_C_W * scale, USB_C_H * scale)
    for bx, bz in (ESTOP, CONFIRM):
        circle(c, px + bx * scale, py + bz * scale, BUTTON_D * scale)
        center_mark(c, px + bx * scale, py + bz * scale, 2.0)
    sx, sz, sw, sh = STATUS
    rect(c, px + (sx - sw / 2) * scale, py + (sz - sh / 2) * scale, sw * scale, sh * scale)
    for divider in range(1, 4):
        dx = px + (sx - sw / 2 + divider * sw / 4) * scale
        line(c, dx, py + (sz - sh / 2) * scale, dx, py + (sz + sh / 2) * scale)
    for hx, hz in FRONT_SCREWS:
        circle(c, px + hx * scale, py + hz * scale, FRONT_SCREW_D * scale)

    set_stroke(c, CYAN, 0.2)
    dashed(c)
    seam_x = px + PANEL_W / 2 * scale
    line(c, seam_x, py, seam_x, py + PANEL_H * scale)
    solid(c)
    label(c, "SPLIT", seam_x, py + PANEL_H * scale + 2, 5.0, CYAN, align="center")
    dim_h(c, x, x + w, y, y - 8, "320")
    dim_v(c, y, y + h, x + w, x + w + 8, "88")


def draw_top_view(c: canvas.Canvas, x: float, y: float, scale: float) -> None:
    w = ENCLOSURE_W * scale
    d = ENCLOSURE_D * scale
    set_stroke(c, INK, 0.35)
    round_rect(c, x, y, w, d, 9 * scale)
    set_stroke(c, BLUE, 0.24)
    round_rect(c, x + WALL * scale, y + WALL * scale, PANEL_W * scale, COVER_D * scale, 5.8 * scale)
    for hx, hy in TOP_SCREWS:
        gx = x + (WALL + hx) * scale
        gy = y + (WALL + hy) * scale
        circle(c, gx, gy, TOP_SCREW_D * scale)
        center_mark(c, gx, gy, 1.6)
    lx = x + (WALL + STACK_LIGHT[0]) * scale
    ly = y + (WALL + STACK_LIGHT[1]) * scale
    circle(c, lx, ly, STACK_LIGHT_SHAFT_D * scale)
    circle(c, lx, ly, 48.0 * scale)
    center_mark(c, lx, ly, 2.3)
    for angle in (0, 120, 240):
        mx = lx + math.cos(math.radians(angle)) * STACK_LIGHT_BCD / 2 * scale
        my = ly + math.sin(math.radians(angle)) * STACK_LIGHT_BCD / 2 * scale
        circle(c, mx, my, STACK_LIGHT_MOUNT_D * scale)
    set_stroke(c, CYAN, 0.2)
    dashed(c)
    seam_x = x + SPLIT_X * scale
    line(c, seam_x, y, seam_x, y + d)
    solid(c)
    dim_h(c, x, x + w, y, y - 8, "320")
    dim_v(c, y, y + d, x + w, x + w + 8, "210")


def draw_side_view(c: canvas.Canvas, x: float, y: float, scale: float) -> None:
    d = ENCLOSURE_D * scale
    h = ENCLOSURE_H * scale
    set_stroke(c, INK, 0.35)
    round_rect(c, x, y, d, h, 7 * scale)
    line(c, x, y + FLOOR_T * scale, x + d, y + FLOOR_T * scale)
    line(c, x, y + (ENCLOSURE_H - ROOF_T) * scale, x + d, y + (ENCLOSURE_H - ROOF_T) * scale)
    set_stroke(c, CYAN, 0.25)
    dashed(c)
    part_x = x + 145.0 * scale
    line(c, part_x, y + FLOOR_T * scale, part_x, y + 76.0 * scale)
    solid(c)
    label(c, "POWER PARTITION Y=145", part_x + 2, y + 25, 5.2, CYAN)
    dim_h(c, x, x + d, y, y - 8, "210")
    dim_v(c, y, y + h, x + d, x + d + 8, "88")


def draw_internal_plan(c: canvas.Canvas, x: float, y: float, scale: float) -> None:
    w = ENCLOSURE_W * scale
    d = ENCLOSURE_D * scale
    c.setFillColor(LIGHT_GREY)
    round_rect(c, x, y, w, d, 6 * scale, stroke=0, fill=1)
    set_stroke(c, INK, 0.35)
    round_rect(c, x, y, w, d, 9 * scale)
    ix = x
    iy = y

    c.setFillColor(Color(0.10, 0.42, 0.62, alpha=0.12))
    rect(c, ix + 10 * scale, iy + 11 * scale, 145 * scale, 128 * scale, stroke=1, fill=1)
    label(c, "M1 GATEWAY", ix + (10 + 72.5) * scale, iy + (11 + 64) * scale + 2.0, 6.0, BLUE, "MSYH-Bold", "center")
    label(c, "145×128", ix + (10 + 72.5) * scale, iy + (11 + 64) * scale - 2.5, 5.3, GREY, align="center")

    c.setFillColor(Color(0.10, 0.65, 0.70, alpha=0.12))
    rect(c, ix + 168 * scale, iy + 35 * scale, 122 * scale, 108 * scale, stroke=1, fill=1)
    label(c, "M2 STM32", ix + (168 + 61) * scale, iy + (35 + 54) * scale + 2.0, 6.0, CYAN, "MSYH-Bold", "center")
    label(c, "122×108", ix + (168 + 61) * scale, iy + (35 + 54) * scale - 2.5, 5.3, GREY, align="center")

    c.setFillColor(Color(0.63, 0.25, 0.22, alpha=0.12))
    rect(c, ix + 266 * scale, iy + 8 * scale, 24 * scale, 24 * scale, stroke=1, fill=1)
    label(c, "M3", ix + 278 * scale, iy + 18 * scale, 5.5, RED, "MSYH-Bold", "center")

    c.setFillColor(Color(0.20, 0.25, 0.30, alpha=0.12))
    rect(c, ix + 16 * scale, iy + 160 * scale, 288 * scale, 35 * scale, stroke=1, fill=1)
    label(c, "M4 INTERLOCK / DIN 35×288", ix + 160 * scale, iy + 175 * scale, 6.0, INK, "MSYH-Bold", "center")

    set_stroke(c, RED, 0.35)
    line(c, ix + WALL * scale, iy + 145 * scale, ix + (ENCLOSURE_W - WALL) * scale, iy + 145 * scale)
    label(c, "SOLID TRUST / POWER PARTITION", ix + 160 * scale, iy + 148 * scale, 5.0, RED, "MSYH-Bold", "center")
    label(c, "LOGIC / TRUST ZONE", ix + 80 * scale, iy + 140 * scale, 5.0, BLUE, "MSYH-Bold", "center")
    label(c, "INTERLOCK / POWER ZONE", ix + 160 * scale, iy + 198 * scale, 5.0, INK, "MSYH-Bold", "center")


def page_general_arrangement(c: canvas.Canvas) -> None:
    drawing_frame(c, "1", "总装三视图与内部布局 / GENERAL ARRANGEMENT", "1:2 (NTS DETAILS)")
    view_title(c, "正视图 / FRONT", 18, 267, "SCALE 1:2")
    draw_front_view(c, 18, 208, 0.55)
    view_title(c, "俯视图 / TOP", 18, 190, "SCALE 1:2")
    draw_top_view(c, 18, 55, 0.55)
    view_title(c, "右视图 / RIGHT SIDE", 225, 267, "SCALE 1:2")
    draw_side_view(c, 225, 208, 0.55)
    view_title(c, "开盖内部平面 / INTERNAL PLAN", 225, 190, "SCALE 1:2")
    draw_internal_plan(c, 225, 55, 0.55)
    label(c, "A", 303, 204, 7, RED, "MSYH-Bold", "center")
    label(c, "A", 303, 185, 7, RED, "MSYH-Bold", "center")
    set_stroke(c, RED, 0.3)
    dashed(c)
    line(c, 303, 191, 303, 202)
    solid(c)
    c.showPage()


def table_row(c: canvas.Canvas, x: float, y: float, widths: list[float], values: list[str], height: float, header: bool = False) -> None:
    if header:
        c.setFillColor(INK)
        rect(c, x, y, sum(widths), height, stroke=0, fill=1)
    else:
        c.setFillColor(WHITE)
        rect(c, x, y, sum(widths), height, stroke=0, fill=1)
    set_stroke(c, INK, 0.18)
    offset = x
    for width in widths:
        rect(c, offset, y, width, height)
        offset += width
    offset = x
    for value, width in zip(values, widths):
        label(c, value, offset + 2, y + height / 2 - 1.1, 5.7, WHITE if header else INK, "MSYH-Bold" if header else "MSYH")
        offset += width


def footprint(c: canvas.Canvas, x: float, y: float, w: float, h: float, scale: float, name: str, z: float, accent=BLUE) -> None:
    c.setFillColor(Color(accent.red, accent.green, accent.blue, alpha=0.08))
    set_stroke(c, accent, 0.3)
    round_rect(c, x, y, w * scale, h * scale, min(4.0, 5 * scale), stroke=1, fill=1)
    label(c, name, x + w * scale / 2, y + h * scale / 2 + 1.5, 6.0, accent, "MSYH-Bold", "center")
    label(c, f"{w:g} × {h:g} × {z:g} mm", x + w * scale / 2, y + h * scale / 2 - 3.5, 5.2, GREY, align="center")
    set_stroke(c, CYAN, 0.18)
    dashed(c)
    line(c, x + w * scale / 2, y, x + w * scale / 2, y + h * scale)
    solid(c)


def draw_seam_detail(c: canvas.Canvas, x: float, y: float) -> None:
    c.setFillColor(LIGHT_GREY)
    rect(c, x, y, 90, 48, stroke=0, fill=1)
    set_stroke(c, INK, 0.35)
    rect(c, x + 10, y + 9, 29, 25)
    rect(c, x + 51, y + 9, 29, 25)
    c.setFillColor(Color(CYAN.red, CYAN.green, CYAN.blue, alpha=0.18))
    rect(c, x + 32, y + 14, 10.5, 8, stroke=1, fill=1)
    set_stroke(c, BLUE, 0.3)
    dashed(c)
    rect(c, x + 48.5, y + 13.5, 11.5, 9)
    solid(c)
    line(c, x + 45.5, y + 7, x + 45.5, y + 37)
    label(c, "LEFT ANTI-SHEAR LIP", x + 10, y + 39, 5.4, CYAN, "MSYH-Bold")
    label(c, "RIGHT CLEARANCE SOCKET", x + 48, y + 39, 5.4, BLUE, "MSYH-Bold")
    label(c, "0.25 nominal clearance", x + 45, y + 3, 5.2, GREY, align="center")


def page_fabrication_schedule(c: canvas.Canvas) -> None:
    drawing_frame(c, "2", "分体打印件与装配计划 / FABRICATION SCHEDULE", "NTS")
    view_title(c, "七件式 220×220 mm FDM 打印包", 16, 268, "FOOTPRINTS SHOWN AT 1:3")

    footprint(c, 18, 190, 161.35, 209.8, 0.34, "CHASSIS LEFT", 88, BLUE)
    footprint(c, 82, 190, 160.35, 209.8, 0.34, "CHASSIS RIGHT", 88, CYAN)
    footprint(c, 148, 190, 158.15, 203.6, 0.34, "TOP LEFT", 9.1, BLUE)
    footprint(c, 212, 190, 157.15, 200.0, 0.34, "TOP RIGHT", 10, CYAN)
    footprint(c, 278, 226, 158.15, 81.4, 0.34, "FRONT LEFT", 4.9, INK)
    footprint(c, 278, 190, 157.15, 81.4, 0.34, "FRONT RIGHT", 6.2, GREY)
    footprint(c, 337, 190, 205.0, 64.0, 0.34, "DIN CLIP", 16, RED)

    widths = [42, 48, 35, 35, 45]
    table_row(c, 18, 167, widths, ["PART", "FOOTPRINT", "Z", "SUPPORT", "JOIN / FIX"], 8, True)
    rows = [
        ("Chassis L/R", "161×210 max", "88", "NO*", "M3 + weld"),
        ("Front L/R", "158×82 max", "6.2", "GUARD", "M3 inserts"),
        ("Top L/R", "158×204 max", "10", "NO", "lap + M4"),
        ("Rear DIN", "205×64", "16", "YES", "4× M4"),
    ]
    y = 159
    for row in rows:
        table_row(c, 18, y, widths, list(row), 8)
        y -= 8

    view_title(c, "中心接缝剖面 / SEAM DETAIL", 245, 168, "ENLARGED - NTS")
    draw_seam_detail(c, 245, 112)

    view_title(c, "打印与装配说明 / PRINT + ASSEMBLY NOTES", 18, 115, "CONTROLLED NOTES")
    notes = [
        "材料：PETG 为最低原型基线；ABS/ASA 更适合温升与长期服役评估。",
        "0.4 mm 喷嘴，0.2 mm 层高，4 圈墙，5 层顶底，30% gyroid/cubic。",
        "底壳使用 5-8 mm brim；按钮护圈与 DIN 卡扣启用支撑。",
        "左右底壳先用防剪切舌定位，再用螺钉或塑料焊连接；不得只依赖胶粘。",
        "前面板、顶盖和 DIN 卡扣必须逐件切片；禁止把 Blender 审阅场景合并导出。",
        "24 V 继电器端子需另加绝缘内罩；本图不构成阻燃、EMC、IP 或安全认证。",
    ]
    note_y = 106
    for index, note in enumerate(notes, start=1):
        note_y = wrapped_text(c, note, 18, note_y, 47, 4.6, 6.0, INK, f"{index}. ") - 1.2

    view_title(c, "关键接口坐标 / DATUM COORDINATES", 245, 102, "DATUM: FRONT PANEL LOWER-LEFT")
    coord_widths = [42, 30, 30, 43]
    table_row(c, 245, 88, coord_widths, ["FEATURE", "X", "Z/Y", "SIZE"], 8, True)
    coord_rows = [
        ("SERVER RJ45", "32", "29", "18.2×15.4"),
        ("LAN/WAN RJ45", "76", "29", "18.2×15.4"),
        ("MGMT RJ45", "128", "29", "18.2×15.4"),
        ("SERVICE USB-C", "168", "29", "12×7"),
        ("E-STOP", "236", "27", "Ø22.5"),
        ("CONFIRM", "286", "27", "Ø22.5"),
        ("STATUS WINDOW", "246", "59", "120×13"),
    ]
    y = 80
    for row in coord_rows:
        table_row(c, 245, y, coord_widths, list(row), 8)
        y -= 8
    c.showPage()


def draw_calibration_bar(c: canvas.Canvas, x: float, y: float, length: float = 100.0) -> None:
    set_stroke(c, INK, 0.45)
    line(c, x, y, x + length, y)
    for tick in range(0, int(length) + 1, 10):
        height = 5 if tick % 50 == 0 else 3
        line(c, x + tick, y - height / 2, x + tick, y + height / 2)
        label(c, str(tick), x + tick, y - 5, 5.0, GREY, align="center")
    label(c, f"{length:g} mm CALIBRATION BAR - MEASURE AFTER PRINTING", x + length / 2, y + 5, 5.7, INK, "MSYH-Bold", "center")


def draw_front_template(c: canvas.Canvas, x: float, y: float) -> None:
    set_stroke(c, INK, 0.4)
    round_rect(c, x, y, PANEL_W, PANEL_H, 4.5)
    set_stroke(c, BLUE, 0.3)
    for port_x in RJ45_X:
        rect(c, x + port_x - RJ45_W / 2, y + RJ45_Z - RJ45_H / 2, RJ45_W, RJ45_H)
        center_mark(c, x + port_x, y + RJ45_Z)
    rect(c, x + USB_C_X - USB_C_W / 2, y + USB_C_Z - USB_C_H / 2, USB_C_W, USB_C_H)
    center_mark(c, x + USB_C_X, y + USB_C_Z)
    for bx, bz in (ESTOP, CONFIRM):
        circle(c, x + bx, y + bz, BUTTON_D)
        center_mark(c, x + bx, y + bz, 4)
    sx, sz, sw, sh = STATUS
    rect(c, x + sx - sw / 2, y + sz - sh / 2, sw, sh)
    for divider in range(1, 4):
        line(c, x + sx - sw / 2 + divider * sw / 4, y + sz - sh / 2, x + sx - sw / 2 + divider * sw / 4, y + sz + sh / 2)
    center_mark(c, x + sx, y + sz, 4)
    for hx, hz in FRONT_SCREWS:
        circle(c, x + hx, y + hz, FRONT_SCREW_D)
        center_mark(c, x + hx, y + hz, 3)

    set_stroke(c, CYAN, 0.25)
    dashed(c)
    line(c, x + PANEL_W / 2, y, x + PANEL_W / 2, y + PANEL_H)
    solid(c)
    label(c, "SPLIT DATUM X=156.8", x + PANEL_W / 2, y + PANEL_H + 3, 5.5, CYAN, "MSYH-Bold", "center")
    label(c, "DATUM A", x - 2, y - 5, 5.5, RED, "MSYH-Bold")
    dim_h(c, x, x + PANEL_W, y, y - 12, "313.6")
    dim_v(c, y, y + PANEL_H, x, x - 12, "81.4")


def page_front_template(c: canvas.Canvas) -> None:
    drawing_frame(c, "3", "前面板 1:1 开孔检查模板 / FRONT PANEL TEMPLATE", "1:1 - PRINT ACTUAL SIZE")
    c.setFillColor(LIGHT_BLUE)
    rect(c, 14, 261, 392, 10, stroke=0, fill=1)
    label(c, "打印设置：A3 横向 / Actual Size / 100% / 禁止 Fit-to-page。打印后先测量 100 mm 校准条。", 18, 264.1, 7.0, INK, "MSYH-Bold")
    draw_front_template(c, 24, 143)
    draw_calibration_bar(c, 30, 84, 100)

    view_title(c, "开孔表 / CUTOUT SCHEDULE", 155, 105, "ALL CENTRES FROM PANEL LOWER-LEFT DATUM")
    widths = [42, 24, 24, 38, 38]
    table_row(c, 155, 91, widths, ["FEATURE", "X", "Z", "CUTOUT", "TOL."], 8, True)
    rows = [
        ("SERVER", "32", "29", "18.2×15.4", "+0.3/0"),
        ("LAN/WAN", "76", "29", "18.2×15.4", "+0.3/0"),
        ("MGMT", "128", "29", "18.2×15.4", "+0.3/0"),
        ("USB-C", "168", "29", "12×7", "+0.3/0"),
        ("E-STOP", "236", "27", "Ø22.5", "+0.3/0"),
        ("CONFIRM", "286", "27", "Ø22.5", "+0.3/0"),
        ("STATUS", "246", "59", "120×13", "+0.3/0"),
    ]
    y = 83
    for row in rows:
        table_row(c, 155, y, widths, list(row), 8)
        y -= 8

    c.setFillColor(Color(0.64, 0.23, 0.23, alpha=0.08))
    rect(c, 344, 143, 62, 99, stroke=0, fill=1)
    label(c, "SHOP NOTES", 348, 233, 7.0, RED, "MSYH-Bold")
    notes = [
        "此页用于纸面定位与首件核对，不替代 STL。",
        "真实面板耦合器、按钮和灯窗必须用实物量规确认。",
        "所有尺寸单位 mm；中心坐标来自可追踪参数源。",
        "分体接缝位于 X=156.8；左右 STL 含 0.35 mm 切割重叠。",
    ]
    note_y = 224
    for note in notes:
        note_y = wrapped_text(c, note, 348, note_y, 13, 4.4, 5.7, INK, "• ") - 2
    c.showPage()


def draw_top_template(c: canvas.Canvas, x: float, y: float) -> None:
    set_stroke(c, INK, 0.4)
    round_rect(c, x, y, PANEL_W, COVER_D, 5.8)
    for hx, hy in TOP_SCREWS:
        circle(c, x + hx, y + hy, TOP_SCREW_D)
        center_mark(c, x + hx, y + hy, 3)
    lx = x + STACK_LIGHT[0]
    ly = y + STACK_LIGHT[1]
    set_stroke(c, BLUE, 0.35)
    circle(c, lx, ly, STACK_LIGHT_SHAFT_D)
    center_mark(c, lx, ly, 5)
    dashed(c)
    circle(c, lx, ly, STACK_LIGHT_BCD)
    solid(c)
    for angle in (0, 120, 240):
        mx = lx + math.cos(math.radians(angle)) * STACK_LIGHT_BCD / 2
        my = ly + math.sin(math.radians(angle)) * STACK_LIGHT_BCD / 2
        circle(c, mx, my, STACK_LIGHT_MOUNT_D)
        center_mark(c, mx, my, 2.2)
    set_stroke(c, CYAN, 0.25)
    dashed(c)
    line(c, x + PANEL_W / 2, y, x + PANEL_W / 2, y + COVER_D)
    solid(c)
    label(c, "SPLIT DATUM X=156.8", x + PANEL_W / 2, y + COVER_D + 3, 5.5, CYAN, "MSYH-Bold", "center")
    dim_h(c, x, x + PANEL_W, y, y - 10, "313.6")
    dim_v(c, y, y + COVER_D, x, x - 10, "203.6")


def page_top_template(c: canvas.Canvas) -> None:
    drawing_frame(c, "4", "顶盖 1:1 孔位检查模板 / TOP COVER TEMPLATE", "1:1 - PRINT ACTUAL SIZE")
    c.setFillColor(LIGHT_BLUE)
    rect(c, 14, 261, 392, 10, stroke=0, fill=1)
    label(c, "打印设置：A3 横向 / Actual Size / 100% / 禁止 Fit-to-page。外轮廓应测得 313.6 × 203.6 mm。", 18, 264.1, 7.0, INK, "MSYH-Bold")
    draw_top_template(c, 23, 49)

    c.setFillColor(Color(0.09, 0.42, 0.62, alpha=0.08))
    rect(c, 346, 49, 60, 202, stroke=0, fill=1)
    label(c, "HOLE NOTES", 350, 241, 7.0, BLUE, "MSYH-Bold")
    notes = [
        "8× top-cover holes: Ø4.3 with Ø8.5 countersink.",
        "Stack-light shaft: Ø22.5 at X282.8 / Y168.8 from cover datum.",
        "Mounts: 3× Ø3.4 equally spaced on Ø36 bolt circle.",
        "The cover datum is its own lower-left corner; installed global centre is X286 / Y172.",
        "Dashed vertical line is the printable split seam, not a cut instruction for an assembled cover.",
    ]
    note_y = 231
    for note in notes:
        note_y = wrapped_text(c, note, 350, note_y, 18, 4.2, 5.6, INK, "• ") - 2.2

    label(c, "TOP FASTENER COORDINATES", 350, 128, 5.8, INK, "MSYH-Bold")
    coords = ["(12,12)", "(136.8,12)", "(176.8,12)", "(301.6,12)", "(12,191.6)", "(136.8,191.6)", "(176.8,191.6)", "(301.6,191.6)"]
    y = 120
    for index, value in enumerate(coords, start=1):
        label(c, f"H{index}: {value}", 350, y, 5.3, GREY)
        y -= 6.2

    draw_calibration_bar(c, 270, 39, 100)
    c.showPage()


def build() -> None:
    register_fonts()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=landscape(A3), pageCompression=1)
    c.setTitle("AetherGuard Enclosure Industrial Blueprint - A3")
    c.setAuthor("Codex / AetherGuard")
    c.setSubject("A3 printable industrial drawing and 1:1 enclosure templates")
    page_general_arrangement(c)
    page_fabrication_schedule(c)
    page_front_template(c)
    page_top_template(c)
    c.save()
    print(f"blueprint_pdf={OUTPUT}")


if __name__ == "__main__":
    build()
