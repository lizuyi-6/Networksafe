from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[4]
PAPER_DIR = ROOT / "docs" / "papers" / "fail-closed-gateway-prototype"
SOURCE = PAPER_DIR / "aetherguard-fail-closed-gateway-zh-CN.md"
FIGURE = PAPER_DIR / "figure-architecture.png"
OUTPUT = PAPER_DIR / "aetherguard-fail-closed-gateway-zh-CN.docx"

# narrative_proposal preset, with named academic-CJK overrides.
PAGE_WIDTH_DXA = 12240
PAGE_HEIGHT_DXA = 15840
MARGIN_DXA = 1440
CONTENT_WIDTH_DXA = 9360
TABLE_INDENT_DXA = 120
CELL_MARGIN_DXA = {"top": 90, "bottom": 90, "start": 120, "end": 120}
BODY_FONT_LATIN = "Times New Roman"
BODY_FONT_CJK = "宋体"
HEADING_FONT_LATIN = "Arial"
HEADING_FONT_CJK = "黑体"
MONO_FONT = "Consolas"
NAVY = "1F4D78"
INK = "1F2933"
MUTED = "5B6770"
LIGHT_BLUE = "E8EEF5"
LIGHT_GRAY = "F4F6F9"
GRID = "B8C2CC"
RISK = "9B1C1C"
WHITE = "FFFFFF"

def rgb(hex_color: str) -> RGBColor:
    return RGBColor.from_string(hex_color)


def set_run_font(
    run,
    latin: str = BODY_FONT_LATIN,
    east_asia: str = BODY_FONT_CJK,
    size: float | None = None,
    color: str | None = None,
    bold: bool | None = None,
    italic: bool | None = None,
):
    run.font.name = latin
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.rFonts
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:ascii"), latin)
    rfonts.set(qn("w:hAnsi"), latin)
    rfonts.set(qn("w:eastAsia"), east_asia)
    if size is not None:
        run.font.size = Pt(size)
    if color is not None:
        run.font.color.rgb = rgb(color)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic


def set_cell_shading(cell, fill: str):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for side, value in CELL_MARGIN_DXA.items():
        node = tc_mar.find(qn(f"w:{side}"))
        if node is None:
            node = OxmlElement(f"w:{side}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "true")
    tr_pr.append(header)


def prevent_row_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    cant_split.set(qn("w:val"), "true")
    tr_pr.append(cant_split)


def set_table_borders(table, color: str = GRID, size: int = 4):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        element = borders.find(qn(f"w:{edge}"))
        if element is None:
            element = OxmlElement(f"w:{edge}")
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), str(size))
        element.set(qn("w:color"), color)


def set_table_geometry(table, widths_dxa: list[int]):
    if sum(widths_dxa) != CONTENT_WIDTH_DXA:
        raise ValueError(f"table widths must sum to {CONTENT_WIDTH_DXA}: {widths_dxa}")
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    tbl_pr = table._tbl.tblPr
    layout = tbl_pr.first_child_found_in("w:tblLayout")
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")
    tbl_w = tbl_pr.first_child_found_in("w:tblW")
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(CONTENT_WIDTH_DXA))
    tbl_w.set(qn("w:type"), "dxa")
    tbl_ind = tbl_pr.first_child_found_in("w:tblInd")
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), str(TABLE_INDENT_DXA))
    tbl_ind.set(qn("w:type"), "dxa")

    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths_dxa:
        col = OxmlElement("w:gridCol")
        col.set(qn("w:w"), str(width))
        grid.append(col)

    for row in table.rows:
        for index, cell in enumerate(row.cells):
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_w = tc_pr.first_child_found_in("w:tcW")
            if tc_w is None:
                tc_w = OxmlElement("w:tcW")
                tc_pr.append(tc_w)
            tc_w.set(qn("w:w"), str(widths_dxa[index]))
            tc_w.set(qn("w:type"), "dxa")
            set_cell_margins(cell)


def choose_widths(rows: list[list[str]]) -> list[int]:
    columns = len(rows[0])
    if columns == 2:
        header = " ".join(rows[0]).lower()
        if "sha-256" in header or "文件" in header:
            return [4200, 5160]
        if any(len(row[1]) > 80 for row in rows[1:]):
            return [2700, 6660]
        return [3600, 5760]
    if columns == 3:
        return [2100, 3200, 4060]
    if columns == 4:
        return [1700, 2600, 2960, 2100]
    if columns == 5:
        return [1350, 1900, 2050, 2030, 2030]
    base = CONTENT_WIDTH_DXA // columns
    widths = [base] * columns
    widths[-1] += CONTENT_WIDTH_DXA - sum(widths)
    return widths


def add_page_field(paragraph):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instr, separate, text, end])
    set_run_font(run, size=9, color=MUTED)


def clear_paragraph(paragraph):
    p = paragraph._p
    for child in list(p):
        if child.tag != qn("w:pPr"):
            p.remove(child)


def set_picture_alt_text(inline_shape, title: str, description: str):
    doc_pr = inline_shape._inline.docPr
    doc_pr.set("title", title)
    doc_pr.set("descr", description)


def create_decimal_numbering(doc: Document) -> int:
    numbering = doc.part.numbering_part.element
    abstract_ids = [
        int(node.get(qn("w:abstractNumId")))
        for node in numbering.findall(qn("w:abstractNum"))
    ]
    num_ids = [int(node.get(qn("w:numId"))) for node in numbering.findall(qn("w:num"))]
    abstract_id = max(abstract_ids, default=-1) + 1
    num_id = max(num_ids, default=0) + 1

    abstract = OxmlElement("w:abstractNum")
    abstract.set(qn("w:abstractNumId"), str(abstract_id))
    multi = OxmlElement("w:multiLevelType")
    multi.set(qn("w:val"), "singleLevel")
    abstract.append(multi)
    level = OxmlElement("w:lvl")
    level.set(qn("w:ilvl"), "0")
    start = OxmlElement("w:start")
    start.set(qn("w:val"), "1")
    num_fmt = OxmlElement("w:numFmt")
    num_fmt.set(qn("w:val"), "decimal")
    lvl_text = OxmlElement("w:lvlText")
    lvl_text.set(qn("w:val"), "%1.")
    suff = OxmlElement("w:suff")
    suff.set(qn("w:val"), "tab")
    p_pr = OxmlElement("w:pPr")
    tabs = OxmlElement("w:tabs")
    tab = OxmlElement("w:tab")
    tab.set(qn("w:val"), "num")
    tab.set(qn("w:pos"), "540")
    tabs.append(tab)
    ind = OxmlElement("w:ind")
    ind.set(qn("w:left"), "540")
    ind.set(qn("w:hanging"), "279")
    spacing = OxmlElement("w:spacing")
    spacing.set(qn("w:after"), "80")
    spacing.set(qn("w:line"), "290")
    spacing.set(qn("w:lineRule"), "auto")
    p_pr.extend([tabs, ind, spacing])
    level.extend([start, num_fmt, lvl_text, suff, p_pr])
    abstract.append(level)
    numbering.append(abstract)

    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(num_id))
    abstract_ref = OxmlElement("w:abstractNumId")
    abstract_ref.set(qn("w:val"), str(abstract_id))
    num.append(abstract_ref)
    numbering.append(num)
    return num_id


def apply_numbering(paragraph, num_id: int):
    p_pr = paragraph._p.get_or_add_pPr()
    num_pr = OxmlElement("w:numPr")
    ilvl = OxmlElement("w:ilvl")
    ilvl.set(qn("w:val"), "0")
    num_id_node = OxmlElement("w:numId")
    num_id_node.set(qn("w:val"), str(num_id))
    num_pr.extend([ilvl, num_id_node])
    p_pr.append(num_pr)


def configure_styles(doc: Document):
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = BODY_FONT_LATIN
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT_CJK)
    normal.font.size = Pt(11)
    normal.font.color.rgb = rgb(INK)
    pf = normal.paragraph_format
    pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    pf.space_before = Pt(0)
    pf.space_after = Pt(8)
    pf.line_spacing = 1.333
    pf.widow_control = True

    heading_tokens = {
        "Heading 1": (16, 18, 10),
        "Heading 2": (13, 12, 6),
        "Heading 3": (12, 8, 4),
    }
    for name, (size, before, after) in heading_tokens.items():
        style = styles[name]
        style.font.name = HEADING_FONT_LATIN
        style._element.rPr.rFonts.set(qn("w:eastAsia"), HEADING_FONT_CJK)
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = rgb(NAVY)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.keep_together = True

    caption = styles["Caption"]
    caption.font.name = BODY_FONT_LATIN
    caption._element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT_CJK)
    caption.font.size = Pt(9)
    caption.font.color.rgb = rgb(MUTED)
    caption.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    caption.paragraph_format.space_before = Pt(4)
    caption.paragraph_format.space_after = Pt(8)
    caption.paragraph_format.keep_with_next = True

    for list_name in ("List Bullet", "List Number"):
        style = styles[list_name]
        style.font.name = BODY_FONT_LATIN
        style._element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT_CJK)
        style.font.size = Pt(11)
        style.paragraph_format.left_indent = Inches(0.375)
        style.paragraph_format.first_line_indent = Inches(-0.194)
        style.paragraph_format.space_after = Pt(4)
        style.paragraph_format.line_spacing = 1.208


def configure_section(section):
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(1)
    section.right_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.header_distance = Inches(0.492)
    section.footer_distance = Inches(0.492)

    header = section.header
    p = header.paragraphs[0]
    clear_paragraph(p)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(0)
    run = p.add_run("AetherGuard Fail-Closed Gateway Prototype · Anonymous Manuscript")
    set_run_font(run, latin=HEADING_FONT_LATIN, east_asia=HEADING_FONT_CJK, size=8.5, color=MUTED)

    footer = section.footer
    p = footer.paragraphs[0]
    clear_paragraph(p)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(0)
    add_page_field(p)


def font(path_candidates: Iterable[str], size: int):
    for candidate in path_candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def draw_arrow(draw: ImageDraw.ImageDraw, start, end, color, width=5, dashed=False):
    x1, y1 = start
    x2, y2 = end
    if dashed:
        segments = 14
        for i in range(0, segments, 2):
            a = i / segments
            b = min(1, (i + 1) / segments)
            draw.line((x1 + (x2 - x1) * a, y1 + (y2 - y1) * a,
                       x1 + (x2 - x1) * b, y1 + (y2 - y1) * b), fill=color, width=width)
    else:
        draw.line((x1, y1, x2, y2), fill=color, width=width)
    angle = __import__("math").atan2(y2 - y1, x2 - x1)
    length = 18
    spread = 0.6
    for delta in (-spread, spread):
        draw.line((x2, y2, x2 - length * __import__("math").cos(angle + delta),
                   y2 - length * __import__("math").sin(angle + delta)), fill=color, width=width)


def draw_box(draw, xy, title, lines, fill, outline, title_font, body_font, status=None, status_font=None):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=14, fill=fill, outline=outline, width=3)
    draw.text((x1 + 18, y1 + 14), title, font=title_font, fill="#17324D")
    y = y1 + 58
    for line in lines:
        draw.text((x1 + 18, y), line, font=body_font, fill="#324B5F")
        y += 32
    if status:
        label, color = status
        label_font = status_font or body_font
        bbox = draw.textbbox((0, 0), label, font=label_font)
        w = bbox[2] - bbox[0] + 22
        draw.rounded_rectangle((x2 - w - 14, y2 - 46, x2 - 14, y2 - 14), radius=10, fill=color)
        draw.text((x2 - w - 3, y2 - 43), label, font=label_font, fill="#FFFFFF")


def build_architecture_figure():
    image = Image.new("RGB", (1700, 980), "#FFFFFF")
    draw = ImageDraw.Draw(image)
    title_font = font(["C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/arialbd.ttf"], 24)
    body_font = font(["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/arial.ttf"], 20)
    small_font = font(["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/arial.ttf"], 17)
    status_font = font(["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/arial.ttf"], 16)
    big_font = font(["C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/arialbd.ttf"], 34)
    draw.text((55, 28), "AetherGuard 根抗性网关原型：信任域与证据边界", font=big_font, fill="#17324D")
    draw.text((57, 79), "实线：本轮执行到的软件/模拟路径   虚线：真实硬件部署路径（未验）", font=body_font, fill="#5B6770")

    boxes = {
        "cp": (60, 165, 400, 390),
        "m1": (500, 165, 850, 390),
        "m2": (950, 165, 1290, 390),
        "m34": (1380, 165, 1640, 390),
        "bridge": (950, 525, 1290, 760),
        "server": (1380, 525, 1640, 760),
        "rescue": (500, 525, 850, 760),
    }
    draw_box(draw, boxes["cp"], "控制面", ["策略摘要与确认会话", "审计与动作意图", "Node.js / SQLite"], "#E8EEF5", "#4F6D8A", title_font, body_font, ("焦点测试", "#2E6F95"), status_font)
    draw_box(draw, boxes["m1"], "M1 Gateway Daemon", ["P-256 验签与上下文", "TTL / 心跳 / 高水位", "反馈后提交 ruleset"], "#E7F2F0", "#407A73", title_font, body_font, ("真实代码", "#2F7D6E"), status_font)
    draw_box(draw, boxes["m2"], "M2 Controller", ["challenge / digest / counter", "E-stop 锁存与反馈", "STM32 状态机"], "#FFF4DE", "#B57A16", title_font, body_font, ("host 测试", "#B57A16"), status_font)
    draw_box(draw, boxes["m34"], "M3 + M4", ["Secure Element", "relay + feedback", "物理 interlock"], "#FDECEC", "#B64B4B", title_font, small_font, ("未实机", "#B64B4B"), status_font)
    draw_box(draw, boxes["bridge"], "SERVER 与 LAN/WAN 桥", ["isolated_ruleset 为默认", "released 为有界窗口", "MGMT 通道独立保留"], "#EEF1F4", "#667788", title_font, body_font, ("I/O mock", "#667788"), status_font)
    draw_box(draw, boxes["server"], "受保护服务器", ["假设 OS/root 已失陷", "不能拥有最终 release", "业务流量经外部桥"], "#F4F6F9", "#6B7280", title_font, small_font)
    draw_box(draw, boxes["rescue"], "异构救援面", ["Hello + InterlockAssert", "双字段确认 + 哈希链", "不含 release 构造器"], "#E9F3E5", "#5B8E4A", title_font, body_font, ("Rust 实测", "#5B8E4A"), status_font)

    draw_arrow(draw, (400, 275), (500, 275), "#2E6F95")
    draw.text((414, 235), "grant/session", font=small_font, fill="#2E6F95")
    draw_arrow(draw, (850, 275), (950, 275), "#2F7D6E", dashed=True)
    draw.text((858, 235), "serial grant", font=small_font, fill="#9B1C1C")
    draw_arrow(draw, (1290, 275), (1380, 275), "#B64B4B", dashed=True)
    draw.text((1295, 235), "I2C/GPIO", font=small_font, fill="#9B1C1C")
    draw_arrow(draw, (1120, 390), (1120, 525), "#B57A16", dashed=True)
    draw.text((1137, 446), "relay feedback", font=small_font, fill="#9B1C1C")
    draw_arrow(draw, (1290, 642), (1380, 642), "#667788", dashed=True)
    draw.text((1300, 603), "L2 traffic", font=small_font, fill="#667788")
    draw_arrow(draw, (850, 642), (950, 642), "#5B8E4A")
    draw.text((860, 603), "assert only", font=small_font, fill="#5B8E4A")
    draw_arrow(draw, (675, 525), (675, 390), "#5B8E4A")
    draw.text((690, 449), "repair/restart", font=small_font, fill="#5B8E4A")

    draw.rounded_rectangle((60, 835, 1640, 930), radius=14, fill="#FFF7ED", outline="#D98C24", width=3)
    draw.text((84, 855), "阻断实机结论：部署入口缺 policyDigest；串口 release 帧缺完整 grant；SE 驱动仍为 stub。", font=title_font, fill="#9B1C1C")
    draw.text((84, 894), "因此图中 M1→M2→M3/M4 的部署链使用虚线，模拟结果不得外推为硬件端到端证明。", font=body_font, fill="#7C4A15")
    image.save(FIGURE, quality=95)


def split_inline(text: str):
    pattern = re.compile(r"(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)")
    return [part for part in pattern.split(text) if part]


def add_inline(paragraph, text: str, size: float | None = None, color: str = INK):
    text = text.replace("\\(", "").replace("\\)", "")
    text = text.replace("\\rightarrow", "→").replace("\\land", "∧")
    for part in split_inline(text):
        if part.startswith("`") and part.endswith("`"):
            run = paragraph.add_run(part[1:-1])
            set_run_font(run, latin=MONO_FONT, east_asia=BODY_FONT_CJK, size=size or 10, color="263238")
        elif part.startswith("**") and part.endswith("**"):
            run = paragraph.add_run(part[2:-2])
            set_run_font(run, size=size, color=color, bold=True)
        elif part.startswith("*") and part.endswith("*"):
            run = paragraph.add_run(part[1:-1])
            set_run_font(run, size=size, color=color, italic=True)
        else:
            run = paragraph.add_run(part)
            set_run_font(run, size=size, color=color)


def add_body(doc, text: str, style: str | None = None):
    p = doc.add_paragraph(style=style)
    p.paragraph_format.widow_control = True
    if text.count("`") >= 4 or text.count("/") >= 3 or len(max(text.split(), key=len, default="")) > 34:
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    add_inline(p, text)
    return p


def add_reference(doc, text: str):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.28)
    p.paragraph_format.first_line_indent = Inches(-0.28)
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.line_spacing = 1.15
    add_inline(p, text, size=9.5)


def add_code_block(doc, lines: list[str]):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.18)
    p.paragraph_format.right_indent = Inches(0.08)
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.line_spacing = 1.0
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p_pr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), LIGHT_GRAY)
    p_pr.append(shd)
    for index, line in enumerate(lines):
        run = p.add_run(line)
        set_run_font(run, latin=MONO_FONT, east_asia="Microsoft YaHei", size=7.4, color="263238")
        if index != len(lines) - 1:
            run.add_break()


def clean_math(lines: list[str]) -> str:
    text = " ".join(line.strip() for line in lines)
    text = text.replace("\\{", "{").replace("\\}", "}")
    text = text.replace("\\land", " ∧ ").replace("\\rightarrow", " → ")
    text = text.replace("\\_", "_")
    text = re.sub(r"\\texttt\{([^}]+)\}", r"\1", text)
    text = re.sub(r"_\{([^}]+)\}", r"_\1", text)
    text = text.replace("\\", " ")
    return re.sub(r"\s+", " ", text).strip()


def add_equation(doc, lines: list[str]):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(5)
    p.paragraph_format.space_after = Pt(7)
    p.paragraph_format.keep_together = True
    run = p.add_run(clean_math(lines))
    set_run_font(run, latin="Cambria Math", east_asia=BODY_FONT_CJK, size=11.5, color="172B4D", italic=True)


def add_table(doc, rows: list[list[str]], number: int):
    captions = {
        1: "实验矩阵、可证伪条件与证据边界",
        2: "四类故障注入的直接状态断言",
        3: "软件微基准结果（三次独立进程）",
        4: "本文原型与相关隔离机制的边界比较",
        5: "关键源码 SHA-256 指纹",
    }
    caption = doc.add_paragraph(style="Caption")
    caption.add_run(f"表 {number}  {captions.get(number, '实验结果')}")
    table = doc.add_table(rows=len(rows), cols=len(rows[0]))
    set_table_geometry(table, choose_widths(rows))
    set_table_borders(table)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    for r_idx, row in enumerate(rows):
        for c_idx, value in enumerate(row):
            cell = table.cell(r_idx, c_idx)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if r_idx == 0:
                set_cell_shading(cell, LIGHT_BLUE)
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER if (r_idx == 0 or len(value) < 18) else WD_ALIGN_PARAGRAPH.LEFT
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.08
            display = value
            if re.fullmatch(r"`?[0-9A-F]{64}`?", value):
                stripped = value.strip("`")
                display = f"`{stripped[:32]}\n{stripped[32:]}`"
            add_inline(p, display, size=7.2 if number == 5 else 8.4)
            if r_idx == 0:
                for run in p.runs:
                    run.bold = True
                    run.font.color.rgb = rgb(NAVY)
        if r_idx == 0:
            set_repeat_table_header(table.rows[0])
        prevent_row_split(table.rows[r_idx])
    after = doc.add_paragraph()
    after.paragraph_format.space_after = Pt(1)
    return table


def parse_table(lines: list[str], start: int):
    rows = []
    index = start
    while index < len(lines) and lines[index].strip().startswith("|"):
        cells = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
        if not all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells):
            rows.append(cells)
        index += 1
    return rows, index


def add_title_block(doc: Document, lines: list[str]):
    title = lines[0].removeprefix("# ").strip()
    subtitle = lines[2].removeprefix("## ").strip()
    english = lines[4].strip("*")
    metadata = lines[6].strip()
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run("RESEARCH ARTICLE · SOFTWARE PROTOTYPE")
    set_run_font(run, latin=HEADING_FONT_LATIN, east_asia=HEADING_FONT_CJK, size=9.5, color=NAVY, bold=True)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(8)
    run = p.add_run(title)
    set_run_font(run, latin=HEADING_FONT_LATIN, east_asia=HEADING_FONT_CJK, size=21, color="17324D", bold=True)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(8)
    run = p.add_run(subtitle)
    set_run_font(run, latin=HEADING_FONT_LATIN, east_asia=HEADING_FONT_CJK, size=13.5, color=NAVY, bold=True)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(16)
    run = p.add_run(english)
    set_run_font(run, size=11, color=MUTED, italic=True)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(14)
    run = p.add_run(metadata)
    set_run_font(run, latin=HEADING_FONT_LATIN, east_asia=HEADING_FONT_CJK, size=10, color=MUTED)

    rule = doc.add_paragraph()
    rule.paragraph_format.space_after = Pt(12)
    p_pr = rule._p.get_or_add_pPr()
    p_bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "10")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), NAVY)
    p_bdr.append(bottom)
    p_pr.append(p_bdr)


def build_document():
    build_architecture_figure()
    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    doc = Document()
    configure_styles(doc)
    configure_section(doc.sections[0])
    core = doc.core_properties
    core.title = "宿主失陷条件下的故障闭锁服务器网络隔离"
    core.subject = "AetherGuard root-resistant gateway software prototype"
    core.author = "Anonymous"
    core.keywords = "fail-closed, network isolation, host compromise, interlock"
    core.comments = "Anonymous submission manuscript; software prototype evidence only."

    add_title_block(doc, lines)
    index = 7
    table_number = 0
    in_code = False
    code_lines: list[str] = []
    in_math = False
    math_lines: list[str] = []
    skip_figure_caption = False
    ordered_num_id: int | None = None
    previous_was_ordered = False

    while index < len(lines):
        raw = lines[index]
        line = raw.rstrip()
        stripped = line.strip()

        if in_code:
            if stripped.startswith("```"):
                add_code_block(doc, code_lines)
                code_lines = []
                in_code = False
            else:
                code_lines.append(line)
            index += 1
            continue
        if stripped.startswith("```"):
            in_code = True
            index += 1
            continue

        if in_math:
            if stripped == "\\]":
                add_equation(doc, math_lines)
                math_lines = []
                in_math = False
            else:
                math_lines.append(stripped)
            index += 1
            continue
        if stripped == "\\[":
            in_math = True
            index += 1
            continue

        if not stripped:
            previous_was_ordered = False
            index += 1
            continue
        if skip_figure_caption and stripped.startswith("图 1"):
            skip_figure_caption = False
            index += 1
            continue
        if stripped.startswith("!["):
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.keep_with_next = True
            picture = p.add_run().add_picture(str(FIGURE), width=Inches(6.42))
            set_picture_alt_text(
                picture,
                "AetherGuard 原型架构",
                "控制面将上下文绑定的临时 release grant 发送到外部网关；"
                "网关、控制器、Secure Element 和物理 interlock 逐层校验并反馈，"
                "任一校验失败、超时或状态不确定都回到 isolated；"
                "异构救援面只能查询或断言隔离，不能构造 release。",
            )
            cap = doc.add_paragraph(style="Caption")
            cap.add_run("图 1  AetherGuard 原型的信任域、控制流与证据边界")
            skip_figure_caption = True
            index += 1
            continue
        if stripped.startswith("|"):
            rows, next_index = parse_table(lines, index)
            table_number += 1
            add_table(doc, rows, table_number)
            index = next_index
            continue
        if stripped.startswith("### "):
            heading_text = stripped[4:]
            p = doc.add_paragraph(style="Heading 2")
            add_inline(p, heading_text)
        elif stripped.startswith("## "):
            heading_text = stripped[3:]
            p = doc.add_paragraph(style="Heading 1")
            add_inline(p, heading_text)
        elif stripped.startswith("# "):
            p = doc.add_paragraph(style="Heading 1")
            add_inline(p, stripped[2:])
        elif re.match(r"^\d+\. \*\*", stripped):
            content = re.sub(r"^\d+\. ", "", stripped)
            source_number = int(stripped.split(".", 1)[0])
            if source_number == 1 or not previous_was_ordered or ordered_num_id is None:
                ordered_num_id = create_decimal_numbering(doc)
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.line_spacing = 1.208
            apply_numbering(p, ordered_num_id)
            add_inline(p, content)
            previous_was_ordered = True
        elif stripped.startswith("- "):
            p = doc.add_paragraph(style="List Bullet")
            add_inline(p, stripped[2:])
            previous_was_ordered = False
        elif re.match(r"^\[\d+\]", stripped):
            add_reference(doc, stripped)
            previous_was_ordered = False
        else:
            add_body(doc, stripped)
            previous_was_ordered = False
        index += 1

    if in_code and code_lines:
        add_code_block(doc, code_lines)
    if in_math and math_lines:
        add_equation(doc, math_lines)

    # Keep the document single-section and stable across Word/LibreOffice.
    for section in doc.sections:
        configure_section(section)
    doc.save(OUTPUT)
    print(f"WROTE {OUTPUT}")
    print(f"FIGURE {FIGURE}")


if __name__ == "__main__":
    build_document()
