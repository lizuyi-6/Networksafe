#!/usr/bin/env python3
"""Build the Chinese AetherGuard technical whitepaper as an editorial PDF."""

from __future__ import annotations

import argparse
import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Flowable,
    Frame,
    HRFlowable,
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.lib.utils import ImageReader


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "docs" / "whitepaper" / "aetherguard-technical-whitepaper-zh.md"
DEFAULT_OUTPUT = ROOT / "output" / "pdf" / "aetherguard-technical-whitepaper-zh.pdf"

FONT_REGULAR = "MicrosoftYaHei"
FONT_BOLD = "MicrosoftYaHeiBold"

CHARCOAL = colors.HexColor("#101820")
INK = colors.HexColor("#17222B")
MUTED = colors.HexColor("#65717B")
HAIRLINE = colors.HexColor("#DDE3E7")
PAPER = colors.HexColor("#F4F7F8")
WHITE = colors.white
CYAN = colors.HexColor("#00A6B8")
CYAN_DARK = colors.HexColor("#007D8A")
CYAN_SOFT = colors.HexColor("#DDF3F5")
GREEN = colors.HexColor("#168761")
GREEN_SOFT = colors.HexColor("#E2F3EC")
RED = colors.HexColor("#C83E3A")
RED_SOFT = colors.HexColor("#FBE7E5")
AMBER = colors.HexColor("#D68A1F")
AMBER_SOFT = colors.HexColor("#FFF1D9")
BLUE = colors.HexColor("#356A9A")
BLUE_SOFT = colors.HexColor("#E7EFF7")

ASSETS = {
    "dashboard": ROOT / "frontend" / "src" / "assets" / "landing-workshop" / "console-dashboard.png",
    "traffic": ROOT / "frontend" / "src" / "assets" / "landing-workshop" / "console-traffic.png",
    "device": ROOT / "frontend" / "src" / "assets" / "landing-workshop" / "console-devices.png",
    "board": ROOT / "frontend" / "src" / "assets" / "landing-workshop" / "console-board-status.png",
    "appliance": ROOT / "frontend" / "src" / "assets" / "landing-workshop" / "appliance-assembly.png",
}


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont(FONT_REGULAR, r"C:\Windows\Fonts\msyh.ttc", subfontIndex=0))
    pdfmetrics.registerFont(TTFont(FONT_BOLD, r"C:\Windows\Fonts\msyhbd.ttc", subfontIndex=0))


def inline_markup(text: str) -> str:
    escaped = html.escape(text.strip())
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"`([^`]+)`", r'<font color="#007D8A">\1</font>', escaped)
    escaped = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"<u>\1</u>", escaped)
    return escaped


def fit_image(path: Path, max_width: float, max_height: float) -> tuple[float, float]:
    reader = ImageReader(str(path))
    width, height = reader.getSize()
    scale = min(max_width / width, max_height / height)
    return width * scale, height * scale


class SectionTitle(Flowable):
    CHAPTERS = {
        1: "01 / 立场与边界",
        5: "02 / 系统与数据",
        9: "03 / 最后防线",
        14: "04 / 部署与验证",
        18: "05 / 不变量与结论",
    }

    def __init__(self, title: str, number: int):
        super().__init__()
        self.title = title
        self.number = number
        self.is_chapter = number in self.CHAPTERS
        self.height = 43 * mm if self.is_chapter else 22 * mm

    def wrap(self, avail_width, avail_height):
        self.width = avail_width
        return avail_width, self.height

    def draw(self):
        c: Canvas = self.canv
        c.saveState()
        if self.is_chapter:
            c.setFillColor(CHARCOAL)
            c.roundRect(0, 0, self.width, self.height, 3 * mm, fill=1, stroke=0)
            c.setFillColor(CYAN)
            c.rect(0, 0, 4 * mm, self.height, fill=1, stroke=0)
            c.setFont(FONT_BOLD, 8.2)
            c.setFillColor(colors.HexColor("#72D7E1"))
            c.drawString(12 * mm, self.height - 12 * mm, self.CHAPTERS[self.number])
            c.setFont(FONT_BOLD, 20)
            c.setFillColor(WHITE)
            c.drawString(12 * mm, 11 * mm, self.title)
            c.setFont(FONT_BOLD, 42)
            c.setFillColor(colors.HexColor("#26343D"))
            c.drawRightString(self.width - 9 * mm, 9 * mm, f"{self.number:02d}")
        else:
            c.setFont(FONT_BOLD, 9)
            c.setFillColor(CYAN_DARK)
            c.drawString(0, self.height - 8 * mm, f"SECTION {self.number:02d}")
            c.setFont(FONT_BOLD, 17)
            c.setFillColor(INK)
            c.drawString(0, 3 * mm, self.title)
            c.setStrokeColor(HAIRLINE)
            c.setLineWidth(0.6)
            c.line(0, 0, self.width, 0)
        c.restoreState()


class EvidenceBand(Flowable):
    def __init__(self, label: str, text: str, tone: str = "info"):
        super().__init__()
        self.label = label
        self.text = text
        self.tone = tone
        self.style = ParagraphStyle(
            "EvidenceBandText",
            fontName=FONT_REGULAR,
            fontSize=8.6,
            leading=13.5,
            textColor=INK,
        )
        self.paragraph = Paragraph(inline_markup(text), self.style)

    def wrap(self, avail_width, avail_height):
        self.width = avail_width
        _, ph = self.paragraph.wrap(avail_width - 34 * mm, avail_height)
        self.height = max(19 * mm, ph + 8 * mm)
        return self.width, self.height

    def draw(self):
        c: Canvas = self.canv
        fill, accent = {
            "risk": (RED_SOFT, RED),
            "safe": (GREEN_SOFT, GREEN),
            "warn": (AMBER_SOFT, AMBER),
        }.get(self.tone, (CYAN_SOFT, CYAN_DARK))
        c.saveState()
        c.setFillColor(fill)
        c.roundRect(0, 0, self.width, self.height, 2 * mm, fill=1, stroke=0)
        c.setFillColor(accent)
        c.roundRect(0, 0, 27 * mm, self.height, 2 * mm, fill=1, stroke=0)
        c.rect(24 * mm, 0, 3 * mm, self.height, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont(FONT_BOLD, 8)
        c.drawCentredString(13.5 * mm, self.height / 2 - 2.5, self.label)
        self.paragraph.drawOn(c, 31 * mm, (self.height - self.paragraph.height) / 2)
        c.restoreState()


class AssetFigure(Flowable):
    def __init__(self, path: Path, caption: str, kind: str = "screen", max_height: float = 118 * mm):
        super().__init__()
        self.path = path
        self.caption = caption
        self.kind = kind
        self.max_height = max_height
        self.caption_style = ParagraphStyle(
            "AssetCaption",
            fontName=FONT_REGULAR,
            fontSize=7.4,
            leading=11,
            textColor=MUTED,
            alignment=TA_LEFT,
        )
        self.caption_p = Paragraph(inline_markup(caption), self.caption_style)

    def wrap(self, avail_width, avail_height):
        self.width = avail_width
        self.image_width, self.image_height = fit_image(self.path, avail_width, self.max_height)
        _, caption_h = self.caption_p.wrap(avail_width - 4 * mm, 30 * mm)
        self.height = self.image_height + caption_h + 8 * mm
        return self.width, self.height

    def draw(self):
        c: Canvas = self.canv
        c.saveState()
        x = (self.width - self.image_width) / 2
        caption_h = self.caption_p.height
        image_y = caption_h + 7 * mm
        if self.kind == "screen":
            c.setFillColor(CHARCOAL)
            c.roundRect(x - 2 * mm, image_y - 2 * mm, self.image_width + 4 * mm, self.image_height + 4 * mm, 2 * mm, fill=1, stroke=0)
        else:
            c.setFillColor(colors.HexColor("#F0F2EE"))
            c.roundRect(x - 2 * mm, image_y - 2 * mm, self.image_width + 4 * mm, self.image_height + 4 * mm, 2 * mm, fill=1, stroke=0)
        c.drawImage(str(self.path), x, image_y, width=self.image_width, height=self.image_height, mask="auto")
        c.setFillColor(CYAN)
        c.rect(0, 0, 1.5 * mm, caption_h + 3 * mm, fill=1, stroke=0)
        self.caption_p.drawOn(c, 4 * mm, 1.5 * mm)
        c.restoreState()


class ArchitectureDiagram(Flowable):
    """Editorial control-chain diagrams, selected by source Mermaid order."""

    def __init__(self, index: int, title: str):
        super().__init__()
        self.index = index
        self.title = title
        self.height = 108 * mm if index in (1, 3, 4, 5) else 92 * mm

    def wrap(self, avail_width, avail_height):
        self.width = avail_width
        return avail_width, self.height

    def _label(self, c, text, x, y, w, h, fill, text_color=INK, index=None):
        c.setFillColor(fill)
        c.roundRect(x, y, w, h, 2 * mm, fill=1, stroke=0)
        if index is not None:
            c.setFillColor(CYAN_DARK)
            c.setFont(FONT_BOLD, 6.8)
            c.drawString(x + 3 * mm, y + h - 5 * mm, f"{index:02d}")
        p = Paragraph(text, ParagraphStyle(
            "DiagramLabel",
            fontName=FONT_BOLD,
            fontSize=7.2,
            leading=10.5,
            textColor=text_color,
            alignment=TA_CENTER,
        ))
        _, ph = p.wrap(w - 5 * mm, h - 4 * mm)
        p.drawOn(c, x + 2.5 * mm, y + (h - ph) / 2 - 0.5 * mm)

    def _arrow(self, c, x1, y1, x2, y2, color=MUTED, dashed=False):
        c.saveState()
        c.setStrokeColor(color)
        c.setFillColor(color)
        c.setLineWidth(0.8)
        if dashed:
            c.setDash(3, 2)
        c.line(x1, y1, x2, y2)
        dx, dy = x2 - x1, y2 - y1
        length = max((dx * dx + dy * dy) ** 0.5, 1)
        ux, uy = dx / length, dy / length
        px, py = -uy, ux
        size = 3.5
        path = c.beginPath()
        path.moveTo(x2, y2)
        path.lineTo(x2 - ux * size + px * 1.7, y2 - uy * size + py * 1.7)
        path.lineTo(x2 - ux * size - px * 1.7, y2 - uy * size - py * 1.7)
        path.close()
        c.drawPath(path, fill=1, stroke=0)
        c.restoreState()

    def _lane(self, c, name, y, color):
        c.setFillColor(color)
        c.roundRect(0, y, 27 * mm, 12 * mm, 2 * mm, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont(FONT_BOLD, 7)
        c.drawCentredString(13.5 * mm, y + 4.2 * mm, name)
        c.setStrokeColor(HAIRLINE)
        c.setLineWidth(0.45)
        c.line(30 * mm, y + 6 * mm, self.width, y + 6 * mm)

    def draw(self):
        c: Canvas = self.canv
        c.saveState()
        c.setFont(FONT_BOLD, 8.5)
        c.setFillColor(INK)
        c.drawString(0, self.height - 6 * mm, self.title)
        c.setFillColor(CYAN)
        c.rect(0, self.height - 9 * mm, 16 * mm, 1.1 * mm, fill=1, stroke=0)
        getattr(self, f"_draw_{self.index}")(c)
        c.restoreState()

    def _draw_0(self, c):
        lanes = [("控制面", 69, CYAN_DARK), ("受管主机", 43, RED), ("硬件信任根", 17, AMBER)]
        for name, y, color in lanes:
            self._lane(c, name, y * mm, color)
        boxes = [
            (35, 68, 27, "浏览器 / 运维", CYAN_SOFT), (68, 68, 31, "React + Node.js", CYAN_SOFT),
            (105, 68, 28, "数据服务", BLUE_SOFT), (139, 68, 29, "Rescue", GREEN_SOFT),
            (35, 42, 37, "Host Agent / root", RED_SOFT), (87, 42, 34, "M1 Gateway", AMBER_SOFT),
            (35, 16, 27, "M2 STM32", AMBER_SOFT), (68, 16, 31, "M3 Secure Element", AMBER_SOFT),
            (105, 16, 34, "M4 Interlock", AMBER_SOFT), (145, 16, 23, "LAN/WAN", BLUE_SOFT),
        ]
        for x, y, w, text, fill in boxes:
            self._label(c, text, x * mm, y * mm, w * mm, 14 * mm, fill)
        for x1, y1, x2, y2 in [(62,75,68,75),(99,75,105,75),(153,68,121,56),(53,68,53,56),(72,49,87,49),(104,42,49,30),(62,23,68,23),(99,23,105,23),(139,23,145,23)]:
            self._arrow(c, x1*mm,y1*mm,x2*mm,y2*mm)
        c.setFont(FONT_REGULAR, 6.5); c.setFillColor(MUTED)
        c.drawRightString(self.width, 8 * mm, "隔离仅阻断 SERVER 与 LAN/WAN；独立 MGMT 仍保留恢复路径")

    def _draw_1(self, c):
        rows = [
            ("体验层", 81, ["React Console", "Nginx :8080", "Socket.IO"]),
            ("控制层", 58, ["Auth / RBAC", "Express API", "Agent / Device Gateway"]),
            ("服务层", 35, ["Security + AI", "Services", "Repositories"]),
            ("运行与硬件", 12, ["PostgreSQL / SQLite", "Redis / MinIO / Fastpath", "Gateway Appliance M1-M4"]),
        ]
        fills = [CYAN_SOFT, CYAN_SOFT, BLUE_SOFT, AMBER_SOFT]
        for row_index, (lane, y, labels) in enumerate(rows):
            self._lane(c, lane, y * mm, [CYAN_DARK, BLUE, GREEN, AMBER][row_index])
            for i, label in enumerate(labels):
                x = (34 + i * 45) * mm
                self._label(c, label, x, y * mm, 39 * mm, 13 * mm, fills[row_index])
                if i < 2:
                    self._arrow(c, x + 39 * mm, (y + 6.5) * mm, x + 45 * mm, (y + 6.5) * mm)
        for x in (53.5, 98.5, 143.5):
            for y1, y2 in ((81,71),(58,48),(35,25)):
                self._arrow(c, x*mm,y1*mm,x*mm,y2*mm)

    def _draw_2(self, c):
        stages = ["Browser", "Nginx", "CORS + Helmet", "Cookie + Timing", "Pre/Post Guard", "Rate Limit", "JWT + Tenant", "Route", "Service", "Repository", "API Envelope"]
        box_w = 29 * mm
        for i, stage in enumerate(stages):
            row, col = divmod(i, 4)
            x = (4 + col * 41) * mm
            y = (65 - row * 24) * mm
            self._label(c, stage, x, y, box_w, 14 * mm, CYAN_SOFT if i < 7 else BLUE_SOFT, index=i+1)
            if col < 3 and i < len(stages)-1:
                self._arrow(c, x + box_w, y + 7 * mm, x + 39 * mm, y + 7 * mm)
            elif i < len(stages)-1:
                nx = 4 * mm
                ny = y - 10 * mm
                self._arrow(c, x + box_w/2, y, nx + box_w/2, ny)
        c.setFillColor(RED_SOFT); c.roundRect(127*mm, 11*mm, 40*mm, 14*mm, 2*mm, fill=1, stroke=0)
        c.setFillColor(RED); c.setFont(FONT_BOLD, 7); c.drawCentredString(147*mm, 17*mm, "异常 -> 统一错误处理")

    def _draw_3(self, c):
        self._label(c, "Service / Repository", 58*mm, 80*mm, 54*mm, 14*mm, CYAN_SOFT, index=1)
        self._label(c, "DB_MODE + 可读性判定", 58*mm, 59*mm, 54*mm, 14*mm, BLUE_SOFT, index=2)
        self._arrow(c, 85*mm,80*mm,85*mm,73*mm)
        self._label(c, "SQLite 主路径 / fallback", 18*mm, 34*mm, 58*mm, 16*mm, BLUE_SOFT, index=3)
        self._label(c, "PostgreSQL ShadowTable", 94*mm, 34*mm, 58*mm, 16*mm, GREEN_SOFT, index=3)
        self._arrow(c, 72*mm,59*mm,47*mm,50*mm)
        self._arrow(c, 98*mm,59*mm,123*mm,50*mm)
        self._arrow(c, 76*mm,42*mm,94*mm,42*mm, color=CYAN_DARK, dashed=True)
        self._label(c, "返回业务结果", 18*mm, 11*mm, 58*mm, 14*mm, GREEN_SOFT, index=4)
        self._label(c, "Fail / Not Ready", 94*mm, 11*mm, 58*mm, 14*mm, RED_SOFT, index=4)
        self._arrow(c, 47*mm,34*mm,47*mm,25*mm)
        self._arrow(c, 123*mm,34*mm,123*mm,25*mm, color=RED)
        c.setFont(FONT_REGULAR, 6.5); c.setFillColor(MUTED)
        c.drawCentredString(85*mm, 53*mm, "生产写路径仍处于混合迁移状态")

    def _draw_4(self, c):
        lanes = [("确定性", 70, GREEN), ("AI 升级", 43, CYAN_DARK), ("治理闭环", 16, BLUE)]
        for name,y,color in lanes: self._lane(c,name,y*mm,color)
        labels = [
            (35,69,"规则 + 启发式",GREEN_SOFT),(78,69,"Risk Score",GREEN_SOFT),(121,69,"Block Rule?",GREEN_SOFT),
            (35,42,"升级条件?",CYAN_SOFT),(78,42,"Primary AI",CYAN_SOFT),(121,42,"Debate + Verdict",CYAN_SOFT),
            (35,15,"Async Review",BLUE_SOFT),(78,15,"Rule Candidate",BLUE_SOFT),(121,15,"人工批准",BLUE_SOFT),
        ]
        for x,y,label,fill in labels: self._label(c,label,x*mm,y*mm,36*mm,14*mm,fill)
        for y in (76,49,22):
            self._arrow(c,71*mm,y*mm,78*mm,y*mm); self._arrow(c,114*mm,y*mm,121*mm,y*mm)
        self._arrow(c,139*mm,69*mm,53*mm,56*mm)
        self._arrow(c,139*mm,42*mm,53*mm,29*mm)
        self._arrow(c,139*mm,15*mm,53*mm,69*mm,color=BLUE,dashed=True)
        c.setFont(FONT_REGULAR, 6.5); c.setFillColor(MUTED)
        c.drawRightString(self.width, 7*mm, "候选规则必须经过人工批准后才能进入启用集合")

    def _draw_5(self, c):
        stages = ["危险请求", "权限 + Policy", "绑定 Digest", "Pending Session", "M1-M4 校验", "Signed ACK"]
        w = 24 * mm
        for i, label in enumerate(stages):
            x = (2 + i * 28) * mm
            self._label(c, label, x, 62*mm, w, 17*mm, RED_SOFT if i == 0 else AMBER_SOFT if i >= 4 else CYAN_SOFT, index=i+1)
            if i < len(stages)-1:
                self._arrow(c, x+w,70.5*mm,x+28*mm,70.5*mm)
        self._label(c,"全部不变量成立?",58*mm,38*mm,54*mm,15*mm,BLUE_SOFT,index=7)
        self._arrow(c,154*mm,62*mm,85*mm,53*mm)
        self._label(c,"Persist Grant + Dispatch",18*mm,13*mm,58*mm,15*mm,GREEN_SOFT,index=8)
        self._label(c,"Fail-Closed: Isolate + Assert",94*mm,13*mm,58*mm,15*mm,RED_SOFT,index=8)
        self._arrow(c,72*mm,38*mm,47*mm,28*mm,color=GREEN)
        self._arrow(c,98*mm,38*mm,123*mm,28*mm,color=RED)
        c.setFont(FONT_BOLD,6.7); c.setFillColor(GREEN); c.drawString(39*mm,31*mm,"YES")
        c.setFillColor(RED); c.drawString(126*mm,31*mm,"NO / UNKNOWN")
        c.setFont(FONT_REGULAR, 6.5); c.setFillColor(MUTED)
        c.drawCentredString(85*mm, 6*mm, "拒绝请求只是表象；失败副作用是主动断桥并驱动物理 interlock")


class WhitepaperDocTemplate(BaseDocTemplate):
    def __init__(self, filename, styles, **kwargs):
        super().__init__(filename, **kwargs)
        self.styles = styles
        normal_frame = Frame(
            self.leftMargin, self.bottomMargin, self.width, self.height,
            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="normal-frame",
        )
        cover_frame = Frame(20*mm, 0, A4[0]-40*mm, A4[1], leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="cover-frame")
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[cover_frame], onPage=self.draw_cover),
            PageTemplate(id="normal", frames=[normal_frame], onPage=self.draw_header_footer),
        ])

    def draw_cover(self, canvas, doc):
        c: Canvas = canvas
        c.saveState()
        c.setFillColor(CHARCOAL)
        c.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
        dashboard = ASSETS["dashboard"]
        image_h = A4[0] * 1080 / 1440
        c.drawImage(str(dashboard), 0, 0, width=A4[0], height=image_h, mask="auto")
        c.setFillColorRGB(16/255, 24/255, 32/255, alpha=0.28)
        c.rect(0, 0, A4[0], image_h, fill=1, stroke=0)
        c.setFillColorRGB(16/255, 24/255, 32/255, alpha=0.76)
        c.rect(0, image_h - 22*mm, A4[0], 34*mm, fill=1, stroke=0)
        c.setFillColor(CYAN)
        c.rect(0, A4[1]-8*mm, A4[0], 8*mm, fill=1, stroke=0)
        c.restoreState()

    def draw_header_footer(self, canvas, doc):
        c: Canvas = canvas
        c.saveState()
        c.setFont(FONT_BOLD, 7)
        c.setFillColor(MUTED)
        c.drawString(self.leftMargin, A4[1] - 11.5*mm, "AETHERGUARD  /  TECHNICAL WHITEPAPER")
        c.setFont(FONT_REGULAR, 7)
        c.drawRightString(A4[0]-self.rightMargin, A4[1]-11.5*mm, "0.9 技术预览版")
        c.setStrokeColor(HAIRLINE)
        c.setLineWidth(0.5)
        c.line(self.leftMargin, A4[1]-15*mm, A4[0]-self.rightMargin, A4[1]-15*mm)
        c.line(self.leftMargin, 14*mm, A4[0]-self.rightMargin, 14*mm)
        c.setFont(FONT_BOLD, 7.5)
        c.setFillColor(CYAN_DARK)
        c.drawString(self.leftMargin, 9.5*mm, f"{doc.page:02d}")
        c.setFont(FONT_REGULAR, 6.8)
        c.setFillColor(MUTED)
        c.drawRightString(A4[0]-self.rightMargin, 9.5*mm, "代码基线说明，不构成第三方认证")
        c.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, SectionTitle):
            key = f"section-{flowable.number}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(flowable.title, key, level=0, closed=False)
            self.notify("TOCEntry", (0, flowable.title, self.page, key))
        elif isinstance(flowable, Paragraph) and flowable.style.name == "WP-H3":
            text = flowable.getPlainText()
            key = f"subsection-{self.seq.nextf('subsection')}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, level=1, closed=False)


def make_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="WP-Body", fontName=FONT_REGULAR, fontSize=9.6, leading=16.2,
        textColor=INK, alignment=TA_LEFT, spaceAfter=6.5, allowWidows=0, allowOrphans=0,
    ))
    styles.add(ParagraphStyle(
        name="WP-H3", parent=styles["WP-Body"], fontName=FONT_BOLD, fontSize=12.5,
        leading=18, textColor=INK, spaceBefore=9, spaceAfter=5, keepWithNext=True,
    ))
    styles.add(ParagraphStyle(
        name="WP-Code", fontName=FONT_REGULAR, fontSize=7.3, leading=11.2, textColor=INK,
        leftIndent=7, rightIndent=7, borderColor=HAIRLINE, borderWidth=0.6,
        borderPadding=7, backColor=PAPER, spaceBefore=4, spaceAfter=8,
    ))
    styles.add(ParagraphStyle(
        name="WP-Table", parent=styles["WP-Body"], fontSize=7.6, leading=11.5,
        alignment=TA_LEFT, spaceAfter=0,
    ))
    styles.add(ParagraphStyle(
        name="WP-TableHeader", parent=styles["WP-Table"], fontName=FONT_BOLD,
        textColor=WHITE,
    ))
    styles.add(ParagraphStyle(
        name="WP-TOC", parent=styles["WP-Body"], fontSize=9.3, leading=15,
        leftIndent=14, firstLineIndent=-10, textColor=INK,
    ))
    styles.add(ParagraphStyle(
        name="WP-Caption", fontName=FONT_REGULAR, fontSize=7.4, leading=11,
        textColor=MUTED,
    ))
    return styles


def parse_table(lines, styles):
    rows = []
    for source_row, line in enumerate(lines):
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        style = styles["WP-TableHeader"] if not rows else styles["WP-Table"]
        rows.append([Paragraph(inline_markup(cell), style) for cell in cells])
    if not rows:
        return None
    col_count = len(rows[0])
    weights = [1.1] + [1.6] * (col_count - 1)
    total = sum(weights)
    widths = [170 * mm * weight / total for weight in weights]
    table = Table(rows, repeatRows=1, hAlign="LEFT", colWidths=widths)
    commands = [
        ("FONTNAME", (0, 0), (-1, -1), FONT_REGULAR),
        ("BACKGROUND", (0, 0), (-1, 0), CHARCOAL),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("LINEBELOW", (0, 0), (-1, 0), 1.1, CYAN),
        ("LINEBELOW", (0, 1), (-1, -1), 0.35, HAIRLINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for row in range(1, len(rows)):
        if row % 2 == 0:
            commands.append(("BACKGROUND", (0, row), (-1, row), PAPER))
    table.setStyle(TableStyle(commands))
    return table


DIAGRAM_TITLES = [
    "图 1  信任边界与硬件根",
    "图 2  系统组件与控制路径",
    "图 3  HTTP 请求生命周期",
    "图 4  PostgreSQL 与 SQLite 一致性路径",
    "图 5  规则、AI 与学习闭环",
    "图 6  Final Defense 硬件授权闭环",
]

FIGURES_AFTER_SECTION = {
    5: ("dashboard", "产品控制面概念界面：统一呈现检测、运行指标与治理入口。截图来自仓库前端资产，不构成生产环境实测证据。", "screen", 111*mm),
    8: ("traffic", "流量拦截器概念界面：协议分布、威胁检测与活跃连接在同一工作面中呈现。", "screen", 111*mm),
    10: ("appliance", "Root-Resistant Gateway Appliance 工程概念渲染：三网口、急停、物理控制与状态塔灯。该图不是已量产实物照片。", "hardware", 104*mm),
    13: ("board", "设备可观测性概念界面：遥测、事件流与设备身份视图。界面中的示例设备数据不构成真实硬件 HIL 证据。", "screen", 111*mm),
}


def markdown_story(markdown_text: str, styles):
    start = markdown_text.find("## 1. 执行摘要")
    if start < 0:
        raise ValueError("Whitepaper body start not found")
    lines = markdown_text[start:].splitlines()
    story = []
    paragraph_lines = []
    diagram_index = 0

    def flush_paragraph():
        if paragraph_lines:
            text = " ".join(line.strip() for line in paragraph_lines)
            story.append(Paragraph(inline_markup(text), styles["WP-Body"]))
            paragraph_lines.clear()

    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        if not stripped:
            flush_paragraph()
            i += 1
            continue
        if stripped == "---":
            flush_paragraph()
            story.extend([Spacer(1, 2), HRFlowable(width="100%", thickness=0.5, color=HAIRLINE), Spacer(1, 5)])
            i += 1
            continue
        if stripped.startswith("## "):
            flush_paragraph()
            match = re.match(r"##\s+(\d+)\.\s+(.+)", stripped)
            if not match:
                i += 1
                continue
            number, title = int(match.group(1)), match.group(2)
            if number in SectionTitle.CHAPTERS and story:
                story.append(PageBreak())
            else:
                story.append(CondPageBreak(62 * mm))
            story.extend([SectionTitle(title, number), Spacer(1, 6 * mm if number in SectionTitle.CHAPTERS else 3 * mm)])
            if number in FIGURES_AFTER_SECTION:
                key, caption, kind, max_height = FIGURES_AFTER_SECTION[number]
                story.extend([AssetFigure(ASSETS[key], caption, kind=kind, max_height=max_height), Spacer(1, 6*mm)])
            if number == 1:
                story.append(EvidenceBand("阅读口径", "本文描述当前代码基线与软件验证结果；真实硬件 HIL 尚未形成可复现证据，因此仍是发布阻断项。", "warn"))
                story.append(Spacer(1, 5*mm))
            i += 1
            continue
        if stripped.startswith("### "):
            flush_paragraph()
            story.append(CondPageBreak(35 * mm))
            story.append(Paragraph(inline_markup(stripped[4:]), styles["WP-H3"]))
            i += 1
            continue
        if stripped.startswith("> "):
            flush_paragraph()
            quote = []
            while i < len(lines) and lines[i].strip().startswith("> "):
                quote.append(lines[i].strip()[2:])
                i += 1
            quote_text = " ".join(quote)
            tone = "risk" if any(word in quote_text for word in ("阻断", "失败", "不得", "未验证")) else "info"
            story.extend([EvidenceBand("关键结论", quote_text, tone), Spacer(1, 5*mm)])
            continue
        if stripped.startswith("```mermaid"):
            flush_paragraph()
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                i += 1
            i += 1
            if diagram_index >= len(DIAGRAM_TITLES):
                raise ValueError("More Mermaid blocks than diagram definitions")
            story.extend([CondPageBreak(112*mm), ArchitectureDiagram(diagram_index, DIAGRAM_TITLES[diagram_index]), Spacer(1, 7*mm)])
            diagram_index += 1
            continue
        if stripped.startswith("```"):
            flush_paragraph()
            i += 1
            code = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i].replace("\t", "    "))
                i += 1
            i += 1
            story.append(Preformatted("\n".join(code), styles["WP-Code"], maxLineLength=92))
            continue
        if stripped.startswith("|"):
            flush_paragraph()
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1
            table = parse_table(table_lines, styles)
            if table:
                story.extend([table, Spacer(1, 8)])
            continue
        if re.match(r"^- ", stripped):
            flush_paragraph()
            items = []
            while i < len(lines) and re.match(r"^- ", lines[i].strip()):
                p = Paragraph(inline_markup(lines[i].strip()[2:]), styles["WP-Body"])
                items.append(ListItem(p, leftIndent=11, bulletColor=CYAN_DARK))
                i += 1
            story.append(ListFlowable(items, bulletType="bullet", start="circle", leftIndent=17, bulletFontName=FONT_BOLD, bulletFontSize=6.5, bulletColor=CYAN_DARK, spaceAfter=6))
            continue
        numbered = re.match(r"^(\d+)\.\s+(.+)", stripped)
        if numbered:
            flush_paragraph()
            items = []
            start_number = int(numbered.group(1))
            while i < len(lines):
                match = re.match(r"^(\d+)\.\s+(.+)", lines[i].strip())
                if not match:
                    break
                items.append(ListItem(Paragraph(inline_markup(match.group(2)), styles["WP-Body"]), leftIndent=13))
                i += 1
            story.append(ListFlowable(items, bulletType="1", start=start_number, leftIndent=21, bulletFontName=FONT_BOLD, bulletFontSize=8, bulletColor=CYAN_DARK, spaceAfter=6))
            continue
        paragraph_lines.append(stripped)
        i += 1

    flush_paragraph()
    if diagram_index != len(DIAGRAM_TITLES):
        raise ValueError(f"Expected {len(DIAGRAM_TITLES)} diagrams, consumed {diagram_index}")
    return story


def build_pdf(source: Path, output: Path) -> None:
    register_fonts()
    styles = make_styles()
    output.parent.mkdir(parents=True, exist_ok=True)
    text = source.read_text(encoding="utf-8")

    doc = WhitepaperDocTemplate(
        str(output), styles, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm, topMargin=21*mm, bottomMargin=20*mm,
        title="AetherGuard 技术白皮书",
        author="AetherGuard Engineering",
        subject="面向服务器安全的软硬件协同 Fail-Closed 防御体系",
    )

    cover_kicker = ParagraphStyle("CoverKicker", fontName=FONT_BOLD, fontSize=8.5, leading=12, textColor=colors.HexColor("#72D7E1"), alignment=TA_LEFT)
    cover_title = ParagraphStyle("CoverTitle", fontName=FONT_BOLD, fontSize=31, leading=42, textColor=WHITE, alignment=TA_LEFT)
    cover_subtitle = ParagraphStyle("CoverSubtitle", fontName=FONT_REGULAR, fontSize=13.5, leading=22, textColor=colors.HexColor("#D6E1E6"), alignment=TA_LEFT)
    cover_meta = ParagraphStyle("CoverMeta", fontName=FONT_REGULAR, fontSize=8.2, leading=13, textColor=colors.HexColor("#9FB0BA"), alignment=TA_LEFT)
    cover_status = ParagraphStyle("CoverStatus", fontName=FONT_REGULAR, fontSize=8.2, leading=13.5, textColor=WHITE, alignment=TA_LEFT)
    toc_title = ParagraphStyle("TOCTitle", fontName=FONT_BOLD, fontSize=24, leading=30, textColor=INK, alignment=TA_LEFT)
    toc_kicker = ParagraphStyle("TOCKicker", fontName=FONT_BOLD, fontSize=8, leading=12, textColor=CYAN_DARK, alignment=TA_LEFT)

    story = [
        Spacer(1, 24*mm),
        Table([[Paragraph("AETHERGUARD", cover_kicker), Paragraph("0.9 / TECH PREVIEW", cover_meta)]], colWidths=[105*mm, 65*mm], style=TableStyle([
            ("VALIGN", (0,0),(-1,-1),"MIDDLE"), ("ALIGN", (1,0),(1,0),"RIGHT"),
            ("LINEBELOW", (0,0),(-1,-1),0.8,colors.HexColor("#35505E")),
            ("BOTTOMPADDING", (0,0),(-1,-1),5*mm),
        ])),
        Spacer(1, 17*mm),
        Paragraph("技术白皮书", cover_title),
        Spacer(1, 4*mm),
        Paragraph("面向服务器安全的软硬件协同<br/>Fail-Closed 防御体系", cover_subtitle),
        Spacer(1, 10*mm),
        Table([[Paragraph("2026-07-17", cover_meta), Paragraph("代码基线  /  b3adb5c", cover_meta)]], colWidths=[42*mm, 85*mm], style=TableStyle([
            ("VALIGN", (0,0),(-1,-1),"MIDDLE"), ("LINEAFTER", (0,0),(0,0),0.8,CYAN_DARK),
            ("LEFTPADDING", (0,0),(0,0),0), ("LEFTPADDING", (1,0),(1,0),5*mm),
        ])),
        Spacer(1, 18*mm),
        Table([[Paragraph("证据状态", cover_kicker), Paragraph("软件门禁有可复现证据；真实硬件 HIL 尚未形成验证闭环", cover_status)]], colWidths=[29*mm, 125*mm], style=TableStyle([
            ("BACKGROUND", (0,0),(-1,-1),colors.HexColor("#1B2A33")),
            ("BOX", (0,0),(-1,-1),0.7,colors.HexColor("#35505E")),
            ("VALIGN", (0,0),(-1,-1),"MIDDLE"),
            ("LEFTPADDING", (0,0),(-1,-1),6), ("RIGHTPADDING", (0,0),(-1,-1),6),
            ("TOPPADDING", (0,0),(-1,-1),7), ("BOTTOMPADDING", (0,0),(-1,-1),7),
        ])),
        NextPageTemplate("normal"), PageBreak(),
        Paragraph("CONTENTS / DOCUMENT MAP", toc_kicker), Spacer(1, 4*mm),
        Paragraph("目录", toc_title), Spacer(1, 2*mm),
        HRFlowable(width="100%", thickness=1.2, color=CYAN), Spacer(1, 7*mm),
    ]

    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("TOC0", parent=styles["WP-TOC"], fontName=FONT_BOLD, fontSize=9.5, leftIndent=10, firstLineIndent=-8, spaceBefore=4, textColor=INK),
        ParagraphStyle("TOC1", parent=styles["WP-TOC"], leftIndent=25, firstLineIndent=-8, textColor=MUTED),
    ]
    story.extend([toc, PageBreak()])
    story.extend(markdown_story(text, styles))
    doc.multiBuild(story)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    build_pdf(args.source.resolve(), args.output.resolve())
    print(f"pdf={args.output.resolve()}")


if __name__ == "__main__":
    main()
