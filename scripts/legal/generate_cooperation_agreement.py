from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "output" / "softcopyright-submit" / "AetherGuard智能服务器安全防御平台V1.0_最终可交版"
DOCX_PATH = OUT_DIR / "AetherGuard智能服务器安全防御平台V1.0-合作开发协议.docx"
PDF_PATH = OUT_DIR / "AetherGuard智能服务器安全防御平台V1.0-合作开发协议.pdf"


TITLE = "AetherGuard智能服务器安全防御平台V1.0 合作开发协议"
PARTY_A = "杭州视界奇点科技有限公司"
PARTY_B = "李祖祎"
SOFTWARE_NAME = "AetherGuard智能服务器安全防御平台"
VERSION = "V1.0"


SECTIONS = [
    (
        "一、合作开发项目",
        [
            f"甲乙双方确认，本协议项下合作开发的软件名称为“{SOFTWARE_NAME}”，版本号为“{VERSION}”。",
            "该软件主要用于服务器安全防御、资产与设备管理、智能体接入、风险扫描、告警处置、修复记录管理以及与硬件确认设备配合的关键操作管控等业务场景。",
            "双方围绕上述软件完成需求分析、架构设计、前后端功能开发、接口联调、运行测试、文档整理及著作权登记材料准备等工作。",
        ],
    ),
    (
        "二、开发分工",
        [
            "甲方负责项目立项、产品方向、业务需求、测试环境、运行资源、公司侧资料提供以及后续运营维护安排。",
            "乙方负责或参与软件架构设计、核心功能实现、界面与交互设计、系统联调、技术文档整理、源代码归集以及登记申请所需技术材料准备。",
            "双方可根据项目进展对具体工作进行调整，但不影响本协议约定的合作开发性质和权利归属安排。",
        ],
    ),
    (
        "三、著作权归属",
        [
            f"双方确认，{SOFTWARE_NAME}{VERSION} 系甲乙双方合作开发完成的软件成果。",
            f"该软件著作权由甲方“{PARTY_A}”与乙方“{PARTY_B}”共同享有。除双方另有书面约定外，双方均不得擅自处分共有著作权中足以影响对方权益的事项。",
            "双方同意以共同著作权人身份申请计算机软件著作权登记，并同意在登记申请、补正、领取证书及后续相关手续中相互配合。",
        ],
    ),
    (
        "四、登记申请授权",
        [
            "双方同意将本协议作为计算机软件著作权登记申请中证明合作开发关系及权利归属的文件之一。",
            "双方同意根据登记平台要求提交软件申请信息、开发信息、功能说明、源程序鉴别材料、用户手册、运行截图及其他必要材料。",
            "如登记机构要求补充说明、修改材料或核验主体信息，双方应及时提供真实、准确、完整的配合材料。",
        ],
    ),
    (
        "五、保密与资料使用",
        [
            "双方对合作开发过程中知悉的源代码、系统设计、业务资料、测试数据、账号信息、登记材料及未公开技术内容负有保密义务。",
            "未经对方书面同意，任何一方不得向无关第三方披露、复制、传播或用于本协议目的之外的用途；法律法规、行政机关或登记机构依法要求披露的除外。",
            "为办理软件著作权登记而向登记机构提交必要材料的行为，不视为违反本条保密义务。",
        ],
    ),
    (
        "六、承诺与保证",
        [
            "双方承诺其在合作开发过程中提供的资料、代码、文档和说明真实、合法，不存在明知侵犯第三方合法权益的情形。",
            "如因一方提供的资料或内容存在权利瑕疵、虚假陈述或违法情形导致争议，由责任方承担相应责任；双方共同原因造成的，由双方依法共同承担。",
            "双方确认，本协议仅用于明确本软件合作开发事实、权利归属和登记申请配合事项，不替代双方可能另行签订的商业合作、劳动、人事、投资或收益分配协议。",
        ],
    ),
    (
        "七、协议生效与其他",
        [
            "本协议自双方签字或盖章之日起生效。",
            "本协议未尽事宜，双方可另行签订书面补充协议；补充协议与本协议具有同等法律效力。",
            "本协议一式两份，甲乙双方各执一份；用于软件著作权登记申请时，可提交签署后的扫描件或平台认可的 PDF 文件。",
        ],
    ),
]


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def style_run(run, font="仿宋", size=12, bold=False):
    run.font.name = font
    run._element.rPr.rFonts.set(qn("w:eastAsia"), font)
    run.font.size = Pt(size)
    run.bold = bold


def add_para(doc: Document, text: str, font="仿宋", size=12, bold=False, align=None, first_line=True):
    p = doc.add_paragraph()
    p.paragraph_format.line_spacing = 1.5
    p.paragraph_format.space_after = Pt(4)
    if first_line:
        p.paragraph_format.first_line_indent = Cm(0.74)
    if align is not None:
        p.alignment = align
    run = p.add_run(text)
    style_run(run, font=font, size=size, bold=bold)
    return p


def build_docx() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Cm(21)
    sec.page_height = Cm(29.7)
    sec.top_margin = Cm(2.6)
    sec.bottom_margin = Cm(2.4)
    sec.left_margin = Cm(2.8)
    sec.right_margin = Cm(2.8)

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "仿宋"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "仿宋")
    normal.font.size = Pt(12)

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.paragraph_format.space_after = Pt(18)
    r = title.add_run(TITLE)
    style_run(r, font="黑体", size=16, bold=True)

    meta = doc.add_table(rows=4, cols=2)
    meta.style = "Table Grid"
    labels = ["甲方", "乙方", "软件名称", "版本号"]
    vals = [PARTY_A, PARTY_B, SOFTWARE_NAME, VERSION]
    for i, (label, val) in enumerate(zip(labels, vals)):
        meta.cell(i, 0).text = label
        meta.cell(i, 1).text = val
        set_cell_shading(meta.cell(i, 0), "F2F4F7")
        for c in range(2):
            for p in meta.cell(i, c).paragraphs:
                p.paragraph_format.line_spacing = 1.25
                for run in p.runs:
                    style_run(run, font="仿宋", size=11.5, bold=(c == 0))
    doc.add_paragraph()

    add_para(doc, "甲乙双方依据《中华人民共和国民法典》《中华人民共和国著作权法》《计算机软件保护条例》等相关规定，就本协议项下软件合作开发及著作权登记事宜，经协商一致，订立本协议。")

    for heading, paras in SECTIONS:
        add_para(doc, heading, font="黑体", size=12.5, bold=True, first_line=False)
        for para in paras:
            add_para(doc, para)

    add_para(doc, "以下无正文，为签署页。", first_line=False)
    doc.add_page_break()

    title2 = doc.add_paragraph()
    title2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r2 = title2.add_run("签署页")
    style_run(r2, font="黑体", size=15, bold=True)
    doc.add_paragraph()

    sig = doc.add_table(rows=8, cols=2)
    sig.style = "Table Grid"
    sig_data = [
        ("甲方（盖章）：", "乙方（签字）："),
        (PARTY_A, PARTY_B),
        ("统一社会信用代码：____________________________", "身份证号：____________________________"),
        ("法定代表人/授权代表：________________________", "联系电话：____________________________"),
        ("联系地址：__________________________________", "联系地址：____________________________"),
        ("签署日期：______年____月____日", "签署日期：______年____月____日"),
        ("", ""),
        ("说明：本页签署后可扫描为 PDF 上传至登记平台。", "说明：签署信息请以实际主体证照信息为准。"),
    ]
    for i, row in enumerate(sig_data):
        for j, text in enumerate(row):
            cell = sig.cell(i, j)
            cell.text = text
            if i in (0, 1):
                set_cell_shading(cell, "F2F4F7")
            for p in cell.paragraphs:
                p.paragraph_format.line_spacing = 1.4
                for run in p.runs:
                    style_run(run, font="仿宋", size=11.5, bold=i == 0)

    doc.save(DOCX_PATH)


def find_font() -> str:
    candidates = [
        Path("C:/Windows/Fonts/simfang.ttf"),
        Path("C:/Windows/Fonts/simsun.ttc"),
        Path("C:/Windows/Fonts/msyh.ttc"),
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    raise FileNotFoundError("No Chinese font found")


def build_pdf() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    font_path = find_font()
    pdfmetrics.registerFont(TTFont("CN", font_path))
    pdfmetrics.registerFont(TTFont("CN-Bold", font_path))

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        rightMargin=2.4 * cm,
        leftMargin=2.4 * cm,
        topMargin=2.4 * cm,
        bottomMargin=2.2 * cm,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "TitleCN",
        parent=styles["Title"],
        fontName="CN-Bold",
        fontSize=18,
        leading=24,
        alignment=TA_CENTER,
        spaceAfter=18,
    )
    heading_style = ParagraphStyle(
        "HeadingCN",
        parent=styles["Heading2"],
        fontName="CN-Bold",
        fontSize=12.5,
        leading=18,
        spaceBefore=8,
        spaceAfter=4,
    )
    body_style = ParagraphStyle(
        "BodyCN",
        parent=styles["BodyText"],
        fontName="CN",
        fontSize=11.5,
        leading=19,
        firstLineIndent=22,
        spaceAfter=4,
        alignment=TA_LEFT,
    )
    normal_style = ParagraphStyle(
        "NormalCN",
        parent=body_style,
        firstLineIndent=0,
    )

    story = [Paragraph(TITLE, title_style)]
    meta_data = [
        ["甲方", PARTY_A],
        ["乙方", PARTY_B],
        ["软件名称", SOFTWARE_NAME],
        ["版本号", VERSION],
    ]
    meta = Table(meta_data, colWidths=[3.0 * cm, 11.8 * cm])
    meta.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "CN"),
        ("FONTSIZE", (0, 0), (-1, -1), 10.5),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F2F4F7")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#999999")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story += [meta, Spacer(1, 14)]
    story.append(Paragraph("甲乙双方依据《中华人民共和国民法典》《中华人民共和国著作权法》《计算机软件保护条例》等相关规定，就本协议项下软件合作开发及著作权登记事宜，经协商一致，订立本协议。", body_style))

    for heading, paras in SECTIONS:
        story.append(Paragraph(heading, heading_style))
        for para in paras:
            story.append(Paragraph(para, body_style))

    story.append(Paragraph("以下无正文，为签署页。", normal_style))
    story.append(PageBreak())
    story.append(Paragraph("签署页", title_style))
    sig_data = [
        ["甲方（盖章）：", "乙方（签字）："],
        [PARTY_A, PARTY_B],
        ["统一社会信用代码：____________________________", "身份证号：____________________________"],
        ["法定代表人/授权代表：________________________", "联系电话：____________________________"],
        ["联系地址：__________________________________", "联系地址：____________________________"],
        ["签署日期：______年____月____日", "签署日期：______年____月____日"],
        ["", ""],
        ["说明：本页签署后可扫描为 PDF 上传至登记平台。", "说明：签署信息请以实际主体证照信息为准。"],
    ]
    sig = Table(sig_data, colWidths=[7.4 * cm, 7.4 * cm], rowHeights=[1.0 * cm, 1.0 * cm, 1.1 * cm, 1.1 * cm, 1.1 * cm, 1.1 * cm, 2.0 * cm, 1.0 * cm])
    sig.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "CN"),
        ("FONTSIZE", (0, 0), (-1, -1), 10.5),
        ("BACKGROUND", (0, 0), (-1, 1), colors.HexColor("#F2F4F7")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#999999")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(sig)

    doc.build(story)


if __name__ == "__main__":
    build_docx()
    build_pdf()
    print(DOCX_PATH)
    print(PDF_PATH)
