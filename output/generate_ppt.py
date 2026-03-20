#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AetherGuard 雄才杯路演 PPT 生成脚本
使用 python-pptx 库生成专业路演演示文稿
"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import nsmap
from pptx.oxml import parse_xml

# 创建演示文稿
prs = Presentation()
prs.slide_width = Inches(16)  # 16:9 宽屏
prs.slide_height = Inches(9)

# 颜色定义
DARK_BG = RGBColor(0x1a, 0x1a, 0x2e)  # 深蓝黑色背景
ACCENT_GREEN = RGBColor(0x00, 0xd4, 0xaa)  # 强调绿色
WHITE = RGBColor(0xff, 0xff, 0xff)
GRAY = RGBColor(0x99, 0x99, 0x99)

def add_title_slide(prs, title, subtitle, description="", footer=""):
    """添加封面页"""
    slide_layout = prs.slide_layouts[6]  # 空白布局
    slide = prs.slides.add_slide(slide_layout)

    # 添加深色背景
    background = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    background.fill.solid()
    background.fill.fore_color.rgb = DARK_BG
    background.line.fill.background()

    # 主标题
    title_box = slide.shapes.add_textbox(Inches(1), Inches(2.5), Inches(14), Inches(1.5))
    tf = title_box.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(54)
    p.font.bold = True
    p.font.color.rgb = WHITE
    p.alignment = PP_ALIGN.CENTER

    # 副标题
    if subtitle:
        subtitle_box = slide.shapes.add_textbox(Inches(1), Inches(4.2), Inches(14), Inches(0.8))
        tf = subtitle_box.text_frame
        p = tf.paragraphs[0]
        p.text = subtitle
        p.font.size = Pt(32)
        p.font.color.rgb = ACCENT_GREEN
        p.alignment = PP_ALIGN.CENTER

    # 描述
    if description:
        desc_box = slide.shapes.add_textbox(Inches(1), Inches(5.2), Inches(14), Inches(0.6))
        tf = desc_box.text_frame
        p = tf.paragraphs[0]
        p.text = description
        p.font.size = Pt(18)
        p.font.color.rgb = GRAY
        p.alignment = PP_ALIGN.CENTER

    # 页脚
    if footer:
        footer_box = slide.shapes.add_textbox(Inches(1), Inches(8), Inches(14), Inches(0.5))
        tf = footer_box.text_frame
        p = tf.paragraphs[0]
        p.text = footer
        p.font.size = Pt(14)
        p.font.color.rgb = GRAY
        p.alignment = PP_ALIGN.CENTER

    return slide

def add_contents_slide(prs, title, intro, chapters):
    """添加目录页"""
    slide_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(slide_layout)

    # 白色背景
    background = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    background.fill.solid()
    background.fill.fore_color.rgb = WHITE
    background.line.fill.background()

    # 标题
    title_box = slide.shapes.add_textbox(Inches(1), Inches(0.8), Inches(14), Inches(1))
    tf = title_box.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(44)
    p.font.bold = True
    p.font.color.rgb = DARK_BG

    # 简介
    if intro:
        intro_box = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(14), Inches(0.6))
        tf = intro_box.text_frame
        p = tf.paragraphs[0]
        p.text = intro
        p.font.size = Pt(16)
        p.font.color.rgb = GRAY

    # 章节列表
    y_pos = 3
    for i, chapter in enumerate(chapters[:5], 1):
        chapter_box = slide.shapes.add_textbox(Inches(1.5), Inches(y_pos), Inches(12), Inches(0.7))
        tf = chapter_box.text_frame
        p = tf.paragraphs[0]
        p.text = chapter
        p.font.size = Pt(24)
        p.font.color.rgb = DARK_BG if i % 2 == 1 else ACCENT_GREEN
        y_pos += 1

    return slide

def add_section_divider(prs, chapter_number, title, subtitle, statement):
    """添加章节分隔页"""
    slide_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(slide_layout)

    # 深色背景
    background = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    background.fill.solid()
    background.fill.fore_color.rgb = DARK_BG
    background.line.fill.background()

    # 章节号
    num_box = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(2), Inches(1))
    tf = num_box.text_frame
    p = tf.paragraphs[0]
    p.text = chapter_number
    p.font.size = Pt(72)
    p.font.bold = True
    p.font.color.rgb = ACCENT_GREEN

    # 标题
    title_box = slide.shapes.add_textbox(Inches(1), Inches(3.2), Inches(10), Inches(1))
    tf = title_box.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(48)
    p.font.bold = True
    p.font.color.rgb = WHITE

    # 副标题
    if subtitle:
        subtitle_box = slide.shapes.add_textbox(Inches(1), Inches(4.3), Inches(10), Inches(0.6))
        tf = subtitle_box.text_frame
        p = tf.paragraphs[0]
        p.text = subtitle
        p.font.size = Pt(20)
        p.font.color.rgb = GRAY

    # 金句
    if statement:
        stmt_box = slide.shapes.add_textbox(Inches(1), Inches(5.5), Inches(10), Inches(1))
        tf = stmt_box.text_frame
        p = tf.paragraphs[0]
        p.text = f'"{statement}"'
        p.font.size = Pt(18)
        p.font.italic = True
        p.font.color.rgb = ACCENT_GREEN

    return slide

def add_content_left_text(prs, title, subtitle, blocks):
    """添加左文右图内容页"""
    slide_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(slide_layout)

    # 白色背景
    background = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    background.fill.solid()
    background.fill.fore_color.rgb = WHITE
    background.line.fill.background()

    # 标题
    title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.6), Inches(14), Inches(0.8))
    tf = title_box.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(36)
    p.font.bold = True
    p.font.color.rgb = DARK_BG

    # 副标题
    if subtitle:
        subtitle_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.3), Inches(14), Inches(0.5))
        tf = subtitle_box.text_frame
        p = tf.paragraphs[0]
        p.text = subtitle
        p.font.size = Pt(16)
        p.font.color.rgb = GRAY

    # 左侧内容块
    y_pos = 2.2
    for heading, copy in blocks:
        # 小标题
        heading_box = slide.shapes.add_textbox(Inches(0.8), Inches(y_pos), Inches(7), Inches(0.5))
        tf = heading_box.text_frame
        p = tf.paragraphs[0]
        p.text = heading
        p.font.size = Pt(20)
        p.font.bold = True
        p.font.color.rgb = ACCENT_GREEN

        # 正文
        copy_box = slide.shapes.add_textbox(Inches(0.8), Inches(y_pos + 0.5), Inches(7), Inches(1))
        tf = copy_box.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = copy
        p.font.size = Pt(14)
        p.font.color.rgb = DARK_BG

        y_pos += 1.8

    # 右侧占位区域（图示）
    right_box = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(8.5), Inches(2), Inches(6.5), Inches(6)
    )
    right_box.fill.solid()
    right_box.fill.fore_color.rgb = RGBColor(0xf0, 0xf0, 0xf5)
    right_box.line.color.rgb = ACCENT_GREEN

    # 添加图标文字
    icon_text = slide.shapes.add_textbox(Inches(8.5), Inches(4.5), Inches(6.5), Inches(1))
    tf = icon_text.text_frame
    p = tf.paragraphs[0]
    p.text = "[配图区域]"
    p.font.size = Pt(16)
    p.font.color.rgb = GRAY
    p.alignment = PP_ALIGN.CENTER

    return slide

def add_three_columns(prs, title, subtitle, blocks):
    """添加三栏内容页"""
    slide_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(slide_layout)

    # 白色背景
    background = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    background.fill.solid()
    background.fill.fore_color.rgb = WHITE
    background.line.fill.background()

    # 标题
    title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.6), Inches(14), Inches(0.8))
    tf = title_box.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(36)
    p.font.bold = True
    p.font.color.rgb = DARK_BG

    # 副标题
    if subtitle:
        subtitle_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.3), Inches(14), Inches(0.5))
        tf = subtitle_box.text_frame
        p = tf.paragraphs[0]
        p.text = subtitle
        p.font.size = Pt(16)
        p.font.color.rgb = GRAY

    # 三栏内容
    col_width = 4.5
    x_positions = [0.8, 5.6, 10.4]

    for i, (icon, heading, copy) in enumerate(blocks[:3]):
        x = x_positions[i]

        # 图标占位
        icon_box = slide.shapes.add_shape(
            MSO_SHAPE.OVAL, Inches(x), Inches(2.3), Inches(0.8), Inches(0.8)
        )
        icon_box.fill.solid()
        icon_box.fill.fore_color.rgb = ACCENT_GREEN
        icon_box.line.fill.background()

        # 小标题
        heading_box = slide.shapes.add_textbox(Inches(x), Inches(3.3), Inches(col_width), Inches(0.5))
        tf = heading_box.text_frame
        p = tf.paragraphs[0]
        p.text = heading
        p.font.size = Pt(18)
        p.font.bold = True
        p.font.color.rgb = DARK_BG

        # 正文
        copy_box = slide.shapes.add_textbox(Inches(x), Inches(3.9), Inches(col_width), Inches(2.5))
        tf = copy_box.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = copy
        p.font.size = Pt(14)
        p.font.color.rgb = GRAY

    return slide

def add_four_columns(prs, title, subtitle, blocks):
    """添加四栏内容页"""
    slide_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(slide_layout)

    # 白色背景
    background = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    background.fill.solid()
    background.fill.fore_color.rgb = WHITE
    background.line.fill.background()

    # 标题
    title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.6), Inches(14), Inches(0.8))
    tf = title_box.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(36)
    p.font.bold = True
    p.font.color.rgb = DARK_BG

    # 副标题
    if subtitle:
        subtitle_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.3), Inches(14), Inches(0.5))
        tf = subtitle_box.text_frame
        p = tf.paragraphs[0]
        p.text = subtitle
        p.font.size = Pt(16)
        p.font.color.rgb = GRAY

    # 四栏内容 2x2
    positions = [(0.8, 2.2), (8.3, 2.2), (0.8, 5.2), (8.3, 5.2)]

    for i, (icon, heading, copy) in enumerate(blocks[:4]):
        x, y = positions[i]

        # 图标占位
        icon_box = slide.shapes.add_shape(
            MSO_SHAPE.OVAL, Inches(x), Inches(y), Inches(0.7), Inches(0.7)
        )
        icon_box.fill.solid()
        icon_box.fill.fore_color.rgb = ACCENT_GREEN
        icon_box.line.fill.background()

        # 小标题
        heading_box = slide.shapes.add_textbox(Inches(x + 1), Inches(y), Inches(6), Inches(0.5))
        tf = heading_box.text_frame
        p = tf.paragraphs[0]
        p.text = heading
        p.font.size = Pt(16)
        p.font.bold = True
        p.font.color.rgb = DARK_BG

        # 正文
        copy_box = slide.shapes.add_textbox(Inches(x), Inches(y + 0.9), Inches(7), Inches(2))
        tf = copy_box.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = copy
        p.font.size = Pt(13)
        p.font.color.rgb = GRAY

    return slide

def add_data_highlight(prs, title, subtitle, data_list, slogan=""):
    """添加数据展示页"""
    slide_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(slide_layout)

    # 深色背景
    background = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    background.fill.solid()
    background.fill.fore_color.rgb = DARK_BG
    background.line.fill.background()

    # 标题
    title_box = slide.shapes.add_textbox(Inches(1), Inches(0.8), Inches(14), Inches(0.8))
    tf = title_box.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(40)
    p.font.bold = True
    p.font.color.rgb = WHITE

    # 副标题
    if subtitle:
        subtitle_box = slide.shapes.add_textbox(Inches(1), Inches(1.6), Inches(14), Inches(0.5))
        tf = subtitle_box.text_frame
        p = tf.paragraphs[0]
        p.text = subtitle
        p.font.size = Pt(16)
        p.font.color.rgb = GRAY

    # 数据展示
    col_width = 4.5
    x_positions = [1, 5.8, 10.6]

    for i, (num, desc) in enumerate(data_list[:3]):
        x = x_positions[i]

        # 数字
        num_box = slide.shapes.add_textbox(Inches(x), Inches(3), Inches(col_width), Inches(1.2))
        tf = num_box.text_frame
        p = tf.paragraphs[0]
        p.text = num
        p.font.size = Pt(56)
        p.font.bold = True
        p.font.color.rgb = ACCENT_GREEN

        # 描述
        desc_box = slide.shapes.add_textbox(Inches(x), Inches(4.3), Inches(col_width), Inches(1))
        tf = desc_box.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = desc
        p.font.size = Pt(16)
        p.font.color.rgb = WHITE

    # Slogan
    if slogan:
        slogan_box = slide.shapes.add_textbox(Inches(1), Inches(6.5), Inches(14), Inches(0.8))
        tf = slogan_box.text_frame
        p = tf.paragraphs[0]
        p.text = slogan
        p.font.size = Pt(20)
        p.font.color.rgb = ACCENT_GREEN
        p.alignment = PP_ALIGN.CENTER

    return slide

def add_quote(prs, quote, subtitle):
    """添加金句页"""
    slide_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(slide_layout)

    # 深色背景
    background = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    background.fill.solid()
    background.fill.fore_color.rgb = DARK_BG
    background.line.fill.background()

    # 引用内容
    quote_box = slide.shapes.add_textbox(Inches(1.5), Inches(2.5), Inches(13), Inches(3))
    tf = quote_box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = f'"{quote}"'
    p.font.size = Pt(28)
    p.font.italic = True
    p.font.color.rgb = ACCENT_GREEN
    p.alignment = PP_ALIGN.CENTER

    # 副标题
    if subtitle:
        subtitle_box = slide.shapes.add_textbox(Inches(1), Inches(6), Inches(14), Inches(0.6))
        tf = subtitle_box.text_frame
        p = tf.paragraphs[0]
        p.text = subtitle
        p.font.size = Pt(16)
        p.font.color.rgb = GRAY
        p.alignment = PP_ALIGN.CENTER

    return slide

def add_timeline(prs, title, subtitle, steps):
    """添加时间轴页"""
    slide_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(slide_layout)

    # 白色背景
    background = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    background.fill.solid()
    background.fill.fore_color.rgb = WHITE
    background.line.fill.background()

    # 标题
    title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.6), Inches(14), Inches(0.8))
    tf = title_box.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(36)
    p.font.bold = True
    p.font.color.rgb = DARK_BG

    # 副标题
    if subtitle:
        subtitle_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.3), Inches(14), Inches(0.5))
        tf = subtitle_box.text_frame
        p = tf.paragraphs[0]
        p.text = subtitle
        p.font.size = Pt(16)
        p.font.color.rgb = GRAY

    # 时间轴
    col_width = 4.5
    x_positions = [0.8, 5.8, 10.8]

    for i, (num, heading, copy) in enumerate(steps[:3]):
        x = x_positions[i]

        # 编号圆圈
        circle = slide.shapes.add_shape(
            MSO_SHAPE.OVAL, Inches(x), Inches(2.5), Inches(0.8), Inches(0.8)
        )
        circle.fill.solid()
        circle.fill.fore_color.rgb = ACCENT_GREEN
        circle.line.fill.background()

        # 编号文字
        num_box = slide.shapes.add_textbox(Inches(x), Inches(2.6), Inches(0.8), Inches(0.6))
        tf = num_box.text_frame
        p = tf.paragraphs[0]
        p.text = num
        p.font.size = Pt(20)
        p.font.bold = True
        p.font.color.rgb = WHITE
        p.alignment = PP_ALIGN.CENTER

        # 小标题
        heading_box = slide.shapes.add_textbox(Inches(x), Inches(3.5), Inches(col_width), Inches(0.6))
        tf = heading_box.text_frame
        p = tf.paragraphs[0]
        p.text = heading
        p.font.size = Pt(20)
        p.font.bold = True
        p.font.color.rgb = DARK_BG

        # 正文
        copy_box = slide.shapes.add_textbox(Inches(x), Inches(4.2), Inches(col_width), Inches(3))
        tf = copy_box.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = copy
        p.font.size = Pt(14)
        p.font.color.rgb = GRAY

    return slide

def add_comparison(prs, title, subtitle, left_label, left_items, right_label, right_items):
    """添加对比页"""
    slide_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(slide_layout)

    # 白色背景
    background = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    background.fill.solid()
    background.fill.fore_color.rgb = WHITE
    background.line.fill.background()

    # 标题
    title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.6), Inches(14), Inches(0.8))
    tf = title_box.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(36)
    p.font.bold = True
    p.font.color.rgb = DARK_BG

    # 副标题
    if subtitle:
        subtitle_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.3), Inches(14), Inches(0.5))
        tf = subtitle_box.text_frame
        p = tf.paragraphs[0]
        p.text = subtitle
        p.font.size = Pt(16)
        p.font.color.rgb = GRAY

    # 左侧对比栏（灰色）
    left_bg = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(2), Inches(7), Inches(6)
    )
    left_bg.fill.solid()
    left_bg.fill.fore_color.rgb = RGBColor(0xf5, 0xf5, 0xf5)
    left_bg.line.fill.background()

    # 左侧标签
    left_label_box = slide.shapes.add_textbox(Inches(1), Inches(2.3), Inches(6), Inches(0.6))
    tf = left_label_box.text_frame
    p = tf.paragraphs[0]
    p.text = left_label
    p.font.size = Pt(18)
    p.font.bold = True
    p.font.color.rgb = GRAY

    # 左侧条目
    y_pos = 3.2
    for item in left_items[:4]:
        item_box = slide.shapes.add_textbox(Inches(1.2), Inches(y_pos), Inches(6), Inches(0.6))
        tf = item_box.text_frame
        p = tf.paragraphs[0]
        p.text = f"• {item}"
        p.font.size = Pt(14)
        p.font.color.rgb = DARK_BG
        y_pos += 1.1

    # 右侧对比栏（绿色）
    right_bg = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(8.2), Inches(2), Inches(7), Inches(6)
    )
    right_bg.fill.solid()
    right_bg.fill.fore_color.rgb = RGBColor(0xe8, 0xf8, 0xf4)
    right_bg.line.color.rgb = ACCENT_GREEN

    # 右侧标签
    right_label_box = slide.shapes.add_textbox(Inches(8.4), Inches(2.3), Inches(6), Inches(0.6))
    tf = right_label_box.text_frame
    p = tf.paragraphs[0]
    p.text = right_label
    p.font.size = Pt(18)
    p.font.bold = True
    p.font.color.rgb = ACCENT_GREEN

    # 右侧条目
    y_pos = 3.2
    for item in right_items[:4]:
        item_box = slide.shapes.add_textbox(Inches(8.6), Inches(y_pos), Inches(6), Inches(0.6))
        tf = item_box.text_frame
        p = tf.paragraphs[0]
        p.text = f"✓ {item}"
        p.font.size = Pt(14)
        p.font.color.rgb = DARK_BG
        y_pos += 1.1

    return slide

def add_full_image(prs, statement, subtitle, tag):
    """添加全图声明页"""
    slide_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(slide_layout)

    # 深色背景
    background = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    background.fill.solid()
    background.fill.fore_color.rgb = DARK_BG
    background.line.fill.background()

    # 主声明
    stmt_box = slide.shapes.add_textbox(Inches(1), Inches(3), Inches(14), Inches(1.5))
    tf = stmt_box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = statement
    p.font.size = Pt(44)
    p.font.bold = True
    p.font.color.rgb = WHITE
    p.alignment = PP_ALIGN.CENTER

    # 副标题
    if subtitle:
        subtitle_box = slide.shapes.add_textbox(Inches(1), Inches(4.8), Inches(14), Inches(0.6))
        tf = subtitle_box.text_frame
        p = tf.paragraphs[0]
        p.text = subtitle
        p.font.size = Pt(20)
        p.font.color.rgb = ACCENT_GREEN
        p.alignment = PP_ALIGN.CENTER

    # 标签
    if tag:
        tag_box = slide.shapes.add_textbox(Inches(13), Inches(7.5), Inches(2), Inches(0.5))
        tf = tag_box.text_frame
        p = tf.paragraphs[0]
        p.text = tag
        p.font.size = Pt(14)
        p.font.color.rgb = GRAY
        p.alignment = PP_ALIGN.RIGHT

    return slide

def add_thank_you(prs, description):
    """添加致谢页"""
    slide_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(slide_layout)

    # 深色背景
    background = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    background.fill.solid()
    background.fill.fore_color.rgb = DARK_BG
    background.line.fill.background()

    # 感谢文字
    thanks_box = slide.shapes.add_textbox(Inches(1), Inches(3), Inches(14), Inches(1.5))
    tf = thanks_box.text_frame
    p = tf.paragraphs[0]
    p.text = "感谢聆听"
    p.font.size = Pt(60)
    p.font.bold = True
    p.font.color.rgb = WHITE
    p.alignment = PP_ALIGN.CENTER

    # 描述
    if description:
        desc_box = slide.shapes.add_textbox(Inches(1), Inches(5), Inches(14), Inches(0.8))
        tf = desc_box.text_frame
        p = tf.paragraphs[0]
        p.text = description
        p.font.size = Pt(18)
        p.font.color.rgb = GRAY
        p.alignment = PP_ALIGN.CENTER

    return slide

# ==================== 开始生成PPT内容 ====================

# 1. 封面
add_title_slide(prs,
    "AetherGuard 智能服务器安全防御平台",
    "雄才杯路演",
    "基于 Agent 的分布式安全防御系统",
    "让服务器安全更简单"
)

# 2. 目录
add_contents_slide(prs,
    "目录",
    "本次路演将为您展示 AetherGuard 的创新技术与商业价值",
    ["01 项目概述", "02 技术架构", "03 核心功能", "04 竞争优势", "05 商业模式", "06 发展规划"]
)

# 3. 章节 1 分隔页
add_section_divider(prs, "01", "项目概述", "Project Overview", "重新定义服务器安全防护")

# 4. 项目背景与痛点
add_content_left_text(prs,
    "项目背景与痛点",
    "传统安全方案的局限",
    [
        ("攻击手段日益复杂", "APT 攻击、0day 漏洞、内部威胁层出不穷，传统防御手段难以应对"),
        ("响应速度严重不足", "从发现攻击到响应平均需要 280 天，给企业造成巨大损失"),
        ("运维成本居高不下", "需要大量安全专家进行 7×24 小时监控，中小企业难以承受")
    ]
)

# 5. 解决方案
add_three_columns(prs,
    "解决方案",
    "AetherGuard 三大核心创新",
    [
        ("shield", "实时检测", "毫秒级攻击检测，基于 AI 的行为分析和模式识别"),
        ("zap", "自动响应", "发现威胁立即自动阻断，无需人工干预"),
        ("grid", "分布式架构", "Agent 分布式部署，中心化统一管控")
    ]
)

# 6. 市场机遇
add_data_highlight(prs,
    "市场机遇",
    "巨大的市场潜力",
    [
        ("¥2000亿", "2025年中国网络安全市场规模"),
        ("15.6%", "年复合增长率 CAGR"),
        ("300万+", "潜在企业客户数量")
    ],
    "服务器安全市场正处于爆发前夜"
)

# 7. 章节 2 分隔页
add_section_divider(prs, "02", "技术架构", "Technical Architecture", "7层 AI Agent 智能决策系统")

# 8. 系统架构
add_content_left_text(prs,
    "系统架构",
    "中心化控制 + 分布式执行",
    [
        ("控制平面", "Backend API + PostgreSQL + Redis，统一策略管理和数据分析"),
        ("分布式 Agent", "Node.js 轻量级 Agent，部署在服务器端执行安全策略"),
        ("Rust 高性能通道", "可选 Rust Fastpath 组件，处理高吞吐量流量")
    ]
)

# 9. 核心技术栈
add_four_columns(prs,
    "核心技术栈",
    "全栈自研，技术领先",
    [
        ("brain", "AI Agent 系统", "7层架构，Socrates/Plato/Aristotle 多 Agent 协同决策"),
        ("cpu", "Rust 高性能", "流量处理性能提升 10 倍，资源占用降低 60%"),
        ("wifi", "WebSocket 实时通信", "双向实时通信，毫秒级命令下发和事件上报"),
        ("lock", "安全加固", "HMAC 命令签名、JWT 认证、审计日志防篡改")
    ]
)

# 10. 技术理念引用
add_quote(prs,
    "我们构建了业界首个 7 层 AI Agent 安全决策系统，将传统安全运营的响应时间从天级缩短到毫秒级，这是安全领域的一次范式革命。",
    "—— AetherGuard 技术理念"
)

# 11. 章节 3 分隔页
add_section_divider(prs, "03", "核心功能", "Core Features", "全方位服务器安全防护")

# 12. 实时攻击检测
add_content_left_text(prs,
    "实时攻击检测",
    "基于 AI 的智能分析",
    [
        ("行为分析引擎", "基于机器学习的异常行为检测，识别未知威胁"),
        ("多维度检测", "流量、日志、进程、文件多维数据关联分析"),
        ("低误报率", "AI 智能降噪，误报率低于 0.1%")
    ]
)

# 13. 自动化响应能力
add_three_columns(prs,
    "自动化响应能力",
    "从检测到阻断的全自动闭环",
    [
        ("ban", "自动防火墙", "发现攻击自动阻断 IP，支持 iptables/nftables"),
        ("warning", "威胁隔离", "自动隔离可疑进程和文件，防止横向移动"),
        ("bell", "智能告警", "分级告警机制，关键事件实时通知")
    ]
)

# 14. 部署流程
add_timeline(prs,
    "部署流程",
    "三步完成安全加固",
    [
        ("01", "Agent 部署", "通过 ESP32 硬件狗或脚本一键部署，5 分钟完成安装"),
        ("02", "策略配置", "可视化策略管理，预设模板开箱即用"),
        ("03", "智能防护", "系统自动学习业务特征，7×24 小时智能防护")
    ]
)

# 15. 章节 4 分隔页
add_section_divider(prs, "04", "竞争优势", "Competitive Advantages", "技术驱动，差异化竞争")

# 16. 对比页
add_comparison(prs,
    "传统方案 vs AetherGuard",
    "全面的技术代差优势",
    "传统安全产品",
    ["基于规则的静态防御", "人工响应，耗时数小时", "单点部署，难以扩展", "高昂的专业服务费用"],
    "AetherGuard",
    ["AI 驱动的动态防御", "毫秒级自动响应", "分布式架构，弹性扩展", "SaaS 模式，按需付费"]
)

# 17. 核心壁垒
add_three_columns(prs,
    "核心壁垒",
    "构建难以复制的竞争优势",
    [
        ("code", "技术壁垒", "7层 AI Agent 架构、Rust 高性能引擎，核心代码全自研"),
        ("users", "数据壁垒", "持续积累攻击样本库，AI 模型越用越聪明"),
        ("plug", "生态壁垒", "ESP32 硬件生态，形成软硬一体化解决方案")
    ]
)

# 18. 章节 5 分隔页
add_section_divider(prs, "05", "商业模式", "Business Model", "可持续的盈利路径")

# 19. 营收预测
add_data_highlight(prs,
    "营收预测",
    "三年发展规划",
    [
        ("¥500万", "2025年营收目标"),
        ("¥3000万", "2026年营收目标"),
        ("¥1亿", "2027年营收目标")
    ],
    "快速增长，规模效应显著"
)

# 20. 盈利模式
add_three_columns(prs,
    "盈利模式",
    "多元化收入来源",
    [
        ("card", "SaaS 订阅", "按服务器数量订阅，基础版 ¥99/月/台，企业版 ¥299/月/台"),
        ("support", "专业服务", "安全咨询、渗透测试、应急响应等增值服务"),
        ("hardware", "硬件销售", "ESP32 部署狗、安全网关等硬件产品")
    ]
)

# 21. 章节 6 分隔页
add_section_divider(prs, "06", "发展规划", "Roadmap", "清晰的战略路径")

# 22. 里程碑规划
add_timeline(prs,
    "里程碑规划",
    "从 MVP 到行业领先",
    [
        ("01", "产品完善期（2025）", "完成核心功能开发，获取首批 50+ 种子客户，验证产品市场契合度"),
        ("02", "规模扩张期（2026）", "拓展销售渠道，服务 500+ 企业客户，实现盈亏平衡"),
        ("03", "生态建设期（2027）", "构建安全生态，推出开放平台，成为行业领导者")
    ]
)

# 23. 愿景页
add_full_image(prs,
    "让每一台服务器都拥有 AI 安全大脑",
    "AetherGuard 愿景",
    "2025 Vision"
)

# 24. 致谢页
add_thank_you(prs, "感谢聆听，期待与您共建安全的数字世界")

# 保存PPT
output_path = "output/AetherGuard_XiongCai_Cup_Presentation.pptx"
prs.save(output_path)
print(f"PPT generated successfully: {output_path}")
print(f"Total slides: {len(prs.slides)}")
