import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "docs", "generated");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "AetherGuard-雄才杯决赛版.pptx");
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, "frontend", "public", "pitch");

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

const COLORS = {
  deepCover: "080E1C",
  deepSection: "0F1E3A",
  panelNavy: "162B52",
  lightBg: "F0F6FF",
  cyan: "00BFFF",
  purple: "7C4DFF",
  hardwareAmber: "FF8C00",
  successGreen: "00E5A0",
  darkText: "0F1E3A",
  mutedDark: "6B8BAD",
  mutedLight: "C5D8F0",
  white: "FFFFFF",
  hardwareDark: "120B05",
};

const ACCENTS = {
  cyan: COLORS.cyan,
  purple: COLORS.purple,
  amber: COLORS.hardwareAmber,
  green: COLORS.successGreen,
};

const FONTS = {
  heading: "Microsoft YaHei",
  body: "Microsoft YaHei",
  mono: "Consolas",
};

const evidenceMap = {
  repo: { label: "已有证据", color: COLORS.successGreen },
  inferred: { label: "推导表达", color: COLORS.hardwareAmber },
  placeholder: { label: "待补材料", color: COLORS.mutedDark },
};

const SHAPES = {
  rect: "rect",
  roundRect: "roundRect",
  ellipse: "ellipse",
  line: "line",
};

const iconLabels = ["技", "产", "AI", "硬", "商", "景", "队", "OK"];

function shot(name) {
  return path.join(SCREENSHOT_DIR, name);
}

function ensureAsset(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing asset: ${filePath}`);
  const stat = fs.statSync(filePath);
  if (stat.size === 0) throw new Error(`Empty asset: ${filePath}`);
  return filePath;
}

function noHash(color) {
  return String(color).replace(/^#/, "");
}

function darkTone(slide) {
  return slide.tone === "dark" || slide.tone === "hardware";
}

function accentOf(slide) {
  return ACCENTS[slide.accent] || COLORS.cyan;
}

function addText(slide, text, options) {
  slide.addText(text, {
    margin: 0,
    fit: "shrink",
    fontFace: FONTS.body,
    breakLine: false,
    ...options,
    color: noHash(options.color || COLORS.darkText),
  });
}

function addRect(slide, options) {
  const { fill = COLORS.white, transparency = 0, lineColor, linePt = 0, lineTransparency = 0, ...rest } = options;
  slide.addShape(SHAPES.rect, {
    ...rest,
    line: { color: noHash(lineColor || fill || COLORS.panelNavy), pt: linePt, transparency: lineTransparency },
    fill: { color: noHash(fill), transparency },
  });
}

function addRoundRect(slide, options) {
  const {
    fill = COLORS.white,
    transparency = 0,
    lineColor = COLORS.panelNavy,
    linePt = 1,
    lineTransparency = 0,
    rectRadius = 0.04,
    shadow,
    ...rest
  } = options;
  slide.addShape(SHAPES.roundRect, {
    ...rest,
    rectRadius,
    line: { color: noHash(lineColor), pt: linePt, transparency: lineTransparency },
    fill: { color: noHash(fill), transparency },
    shadow,
  });
}

function addCircle(slide, options) {
  const { fill = COLORS.cyan, transparency = 0, lineColor, linePt = 0, lineTransparency = 0, ...rest } = options;
  slide.addShape(SHAPES.ellipse, {
    ...rest,
    line: { color: noHash(lineColor || fill || COLORS.cyan), pt: linePt, transparency: lineTransparency },
    fill: { color: noHash(fill), transparency },
  });
}

function addLine(slide, x1, y1, x2, y2, color, opts = {}) {
  slide.addShape(SHAPES.line, {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    line: {
      color: noHash(color),
      pt: opts.pt ?? 1,
      transparency: opts.transparency ?? 0,
      beginArrowType: opts.beginArrowType,
      endArrowType: opts.endArrowType,
      dash: opts.dash,
    },
  });
}

function addBackground(slide, deckSlide) {
  const accent = accentOf(deckSlide);
  if (deckSlide.tone === "hardware") {
    slide.background = { color: COLORS.hardwareDark };
    addRect(slide, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: COLORS.deepCover, transparency: 9 });
    addCircle(slide, { x: 9.2, y: -0.7, w: 4.5, h: 4.5, fill: COLORS.hardwareAmber, transparency: 78 });
  } else if (deckSlide.tone === "dark") {
    slide.background = { color: COLORS.deepCover };
    addRect(slide, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: COLORS.deepSection, transparency: 17 });
    addCircle(slide, { x: 9.1, y: -0.75, w: 4.8, h: 4.8, fill: accent, transparency: 82 });
  } else {
    slide.background = { color: COLORS.lightBg };
    addRect(slide, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: COLORS.white, transparency: 34 });
    addCircle(slide, { x: 9.7, y: -0.6, w: 4.0, h: 4.0, fill: accent, transparency: 90 });
  }

  const gridColor = darkTone(deckSlide) ? COLORS.white : COLORS.panelNavy;
  for (let x = 0; x <= SLIDE_W; x += 0.48) addLine(slide, x, 0, x, SLIDE_H, gridColor, { pt: 0.25, transparency: darkTone(deckSlide) ? 88 : 93 });
  for (let y = 0; y <= SLIDE_H; y += 0.48) addLine(slide, 0, y, SLIDE_W, y, gridColor, { pt: 0.25, transparency: darkTone(deckSlide) ? 88 : 93 });

  addLine(slide, 0, 0.04, SLIDE_W, 0.04, accent, { pt: 4.5 });
  addCircle(slide, { x: 11.35, y: -0.75, w: 2.4, h: 2.4, fill: COLORS.white, transparency: 100, lineColor: accent, linePt: 1.0, lineTransparency: 35 });
  addCircle(slide, { x: 0.68, y: 5.95, w: 1.3, h: 1.3, fill: COLORS.white, transparency: 100, lineColor: darkTone(deckSlide) ? COLORS.mutedLight : COLORS.panelNavy, linePt: 1.0, lineTransparency: 65 });
}

function addEvidenceBadge(slide, level, dark) {
  const badge = evidenceMap[level];
  addRoundRect(slide, {
    x: 1.52,
    y: 0.34,
    w: 1.22,
    h: 0.28,
    fill: dark ? COLORS.deepCover : COLORS.white,
    transparency: dark ? 20 : 0,
    lineColor: badge.color,
    linePt: 0.8,
  });
  addText(slide, badge.label, {
    x: 1.62,
    y: 0.405,
    w: 1.02,
    h: 0.11,
    fontSize: 6.6,
    bold: true,
    align: "center",
    color: dark ? COLORS.white : badge.color,
  });
}

function addHeader(slide, deckSlide, index, total) {
  const dark = darkTone(deckSlide);
  const accent = accentOf(deckSlide);
  const textColor = dark ? COLORS.white : COLORS.darkText;
  addRoundRect(slide, {
    x: 0.55,
    y: 0.33,
    w: 0.78,
    h: 0.29,
    fill: dark ? COLORS.deepCover : COLORS.white,
    transparency: dark ? 18 : 0,
    lineColor: dark ? accent : COLORS.panelNavy,
    lineTransparency: dark ? 35 : 55,
    linePt: 0.8,
  });
  addText(slide, `${String(index + 1).padStart(2, "0")} / ${total}`, {
    x: 0.62,
    y: 0.405,
    w: 0.64,
    h: 0.1,
    fontFace: FONTS.mono,
    fontSize: 6.4,
    bold: true,
    align: "center",
    color: textColor,
  });
  addEvidenceBadge(slide, deckSlide.evidenceLevel, dark);
  addText(slide, deckSlide.kicker, {
    x: 0.55,
    y: 0.86,
    w: 6.5,
    h: 0.19,
    fontFace: FONTS.heading,
    fontSize: 8.8,
    bold: true,
    charSpace: 1.1,
    color: accent,
  });
  addRoundRect(slide, {
    x: 9.35,
    y: 0.35,
    w: 3.28,
    h: 0.34,
    fill: dark ? COLORS.deepCover : COLORS.white,
    transparency: dark ? 24 : 0,
    lineColor: dark ? accent : COLORS.panelNavy,
    lineTransparency: 45,
    linePt: 0.8,
  });
  addText(slide, "雄才杯2026决赛 · 聚雄才 创未来", {
    x: 9.5,
    y: 0.435,
    w: 2.98,
    h: 0.12,
    fontFace: FONTS.heading,
    fontSize: 7.4,
    bold: true,
    align: "center",
    color: textColor,
  });
}

function addFooter(slide, deckSlide, index, total) {
  const dark = darkTone(deckSlide);
  const accent = accentOf(deckSlide);
  const y = 6.94;
  addLine(slide, 0.55, y - 0.12, 12.8, y - 0.12, dark ? COLORS.mutedLight : COLORS.panelNavy, { pt: 0.75, transparency: dark ? 78 : 82 });
  addCircle(slide, { x: 0.55, y: y - 0.02, w: 0.13, h: 0.13, fill: accent });
  addText(slide, deckSlide.footerCue ?? "雄安落地价值", {
    x: 0.78,
    y,
    w: 9.85,
    h: 0.2,
    fontSize: 7.2,
    color: dark ? COLORS.mutedLight : COLORS.mutedDark,
  });
  addText(slide, `AetherGuard · 雄安落地价值  ·  ${String(index + 1).padStart(2, "0")} / ${total}`, {
    x: 10.45,
    y,
    w: 2.35,
    h: 0.2,
    fontSize: 7.2,
    bold: true,
    align: "right",
    color: dark ? COLORS.white : COLORS.darkText,
  });
}

function addTitleAndBullets(slide, deckSlide) {
  const dark = darkTone(deckSlide);
  const accent = accentOf(deckSlide);
  const textColor = dark ? COLORS.white : COLORS.darkText;
  const muted = dark ? COLORS.mutedLight : COLORS.darkText;
  addText(slide, deckSlide.title, {
    x: 0.55,
    y: 1.3,
    w: 5.22,
    h: 0.9,
    fontFace: FONTS.heading,
    fontSize: deckSlide.title.length <= 12 ? 29 : 23.5,
    bold: true,
    color: textColor,
  });
  addText(slide, deckSlide.claim, {
    x: 0.58,
    y: 2.2,
    w: 5.35,
    h: 0.64,
    fontSize: 12,
    color: muted,
  });
  deckSlide.bullets.forEach((bullet, idx) => {
    const y = 3.03 + idx * 0.54;
    addRoundRect(slide, {
      x: 0.58,
      y,
      w: 5.45,
      h: 0.42,
      fill: dark ? COLORS.panelNavy : COLORS.white,
      transparency: dark ? 31 : 12,
      lineColor: dark ? accent : COLORS.panelNavy,
      lineTransparency: dark ? 60 : 82,
      linePt: 0.75,
    });
    addCircle(slide, { x: 0.78, y: y + 0.15, w: 0.1, h: 0.1, fill: accent });
    addText(slide, bullet, {
      x: 0.98,
      y: y + 0.1,
      w: 4.78,
      h: 0.19,
      fontSize: 8.65,
      color: textColor,
    });
  });
}

function addStatPoster(slide, stat, deckSlide, frame) {
  if (!stat) return;
  const accent = accentOf(deckSlide);
  const dark = darkTone(deckSlide);
  addRoundRect(slide, {
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    fill: dark ? COLORS.deepCover : COLORS.white,
    transparency: dark ? 24 : 0,
    lineColor: accent,
    lineTransparency: 38,
    linePt: 1,
  });
  addText(slide, stat.value, {
    x: frame.x + 0.22,
    y: frame.y + 0.22,
    w: frame.w - 0.44,
    h: 0.58,
    fontFace: FONTS.mono,
    fontSize: stat.value.length > 6 ? 22 : 30,
    bold: true,
    color: accent,
  });
  addText(slide, stat.label, {
    x: frame.x + 0.24,
    y: frame.y + 0.96,
    w: frame.w - 0.48,
    h: 0.24,
    fontFace: FONTS.heading,
    fontSize: 10,
    bold: true,
    color: dark ? COLORS.white : COLORS.darkText,
  });
  addText(slide, stat.note, {
    x: frame.x + 0.24,
    y: frame.y + 1.28,
    w: frame.w - 0.48,
    h: 0.24,
    fontSize: 7.6,
    color: dark ? COLORS.mutedLight : COLORS.mutedDark,
  });
}

function addScreenshotFrame(slide, imagePath, caption, frame, deckSlide) {
  const dark = darkTone(deckSlide);
  const accent = accentOf(deckSlide);
  addRoundRect(slide, {
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    fill: dark ? COLORS.panelNavy : COLORS.white,
    transparency: dark ? 20 : 0,
    lineColor: COLORS.panelNavy,
    linePt: 1,
    shadow: { type: "outer", color: "000000", opacity: 0.22, blur: 2, offset: 1.4, angle: 45 },
  });
  addRoundRect(slide, {
    x: frame.x + 0.13,
    y: frame.y + 0.13,
    w: frame.w - 0.26,
    h: 0.24,
    fill: dark ? COLORS.deepCover : COLORS.panelNavy,
    transparency: dark ? 8 : 0,
    lineColor: dark ? COLORS.deepCover : COLORS.panelNavy,
    linePt: 0,
  });
  [0, 1, 2].forEach((idx) => {
    addCircle(slide, { x: frame.x + 0.3 + idx * 0.18, y: frame.y + 0.205, w: 0.07, h: 0.07, fill: idx === 0 ? COLORS.hardwareAmber : idx === 1 ? COLORS.cyan : COLORS.successGreen });
  });
  slide.addImage({
    path: ensureAsset(imagePath),
    x: frame.x + 0.13,
    y: frame.y + 0.45,
    w: frame.w - 0.26,
    h: frame.h - 0.82,
    sizingCrop: true,
  });
  addText(slide, caption, {
    x: frame.x + 0.18,
    y: frame.y + frame.h - 0.28,
    w: frame.w - 0.36,
    h: 0.12,
    fontSize: 7,
    bold: true,
    color: dark ? COLORS.mutedLight : COLORS.mutedDark,
  });
  addLine(slide, frame.x + 0.13, frame.y + 0.42, frame.x + frame.w - 0.13, frame.y + 0.42, accent, { pt: 1, transparency: 50 });
}

function addFlowDiagram(slide, visual, deckSlide, frame) {
  const dark = darkTone(deckSlide);
  const accent = accentOf(deckSlide);
  const count = visual.steps.length;
  const cardW = Math.min(1.28, (frame.w - 0.4) / count - 0.08);
  const gap = (frame.w - cardW * count) / Math.max(1, count - 1);
  const y = frame.y + frame.h * 0.35;
  addRoundRect(slide, {
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    fill: dark ? COLORS.panelNavy : COLORS.white,
    transparency: dark ? 26 : 5,
    lineColor: dark ? accent : COLORS.panelNavy,
    lineTransparency: dark ? 55 : 82,
  });
  visual.steps.forEach((step, idx) => {
    const x = frame.x + 0.22 + idx * (cardW + gap);
    const semantic = idx === 1 ? COLORS.cyan : idx === 2 ? COLORS.purple : idx === 3 ? COLORS.hardwareAmber : idx === count - 1 ? COLORS.successGreen : accent;
    addCircle(slide, { x: x + cardW / 2 - 0.18, y: y - 0.52, w: 0.36, h: 0.36, fill: semantic });
    addText(slide, String(idx + 1), {
      x: x + cardW / 2 - 0.14,
      y: y - 0.425,
      w: 0.28,
      h: 0.1,
      fontFace: FONTS.mono,
      fontSize: 6.8,
      bold: true,
      align: "center",
      color: COLORS.white,
    });
    addRoundRect(slide, {
      x,
      y,
      w: cardW,
      h: 0.9,
      fill: dark ? COLORS.deepCover : COLORS.lightBg,
      transparency: dark ? 18 : 0,
      lineColor: semantic,
      lineTransparency: 22,
      linePt: 1,
    });
    addText(slide, step, {
      x: x + 0.1,
      y: y + 0.18,
      w: cardW - 0.2,
      h: 0.38,
      fontFace: FONTS.heading,
      fontSize: 8.2,
      bold: true,
      align: "center",
      color: dark ? COLORS.white : COLORS.darkText,
    });
    if (idx < count - 1) addLine(slide, x + cardW + 0.05, y + 0.45, x + cardW + gap - 0.08, y + 0.45, semantic, { pt: 1.2, endArrowType: "triangle" });
  });
}

function addMetricsGrid(slide, visual, deckSlide, frame) {
  const dark = darkTone(deckSlide);
  const cols = 2;
  const rows = Math.ceil(visual.items.length / cols);
  const gap = 0.22;
  const cardW = (frame.w - gap * (cols - 1)) / cols;
  const cardH = (frame.h - gap * (rows - 1)) / rows;
  visual.items.forEach((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = frame.x + col * (cardW + gap);
    const y = frame.y + row * (cardH + gap);
    const itemAccent = [COLORS.cyan, COLORS.purple, COLORS.hardwareAmber, COLORS.successGreen][idx % 4];
    addRoundRect(slide, {
      x,
      y,
      w: cardW,
      h: cardH,
      fill: dark ? COLORS.panelNavy : COLORS.white,
      transparency: dark ? 22 : 0,
      lineColor: itemAccent,
      lineTransparency: 45,
      linePt: 0.9,
      shadow: !dark ? { type: "outer", color: "94A3B8", opacity: 0.14, blur: 2, offset: 1.0, angle: 45 } : undefined,
    });
    addCircle(slide, { x: x + 0.22, y: y + 0.22, w: 0.42, h: 0.42, fill: itemAccent });
    addText(slide, iconLabels[idx % iconLabels.length], {
      x: x + 0.22,
      y: y + 0.335,
      w: 0.42,
      h: 0.1,
      fontFace: FONTS.heading,
      fontSize: 6.8,
      bold: true,
      align: "center",
      color: COLORS.white,
    });
    addText(slide, item.label, {
      x: x + 0.84,
      y: y + 0.29,
      w: cardW - 1.04,
      h: 0.16,
      fontSize: 7,
      bold: true,
      charSpace: 0.6,
      color: dark ? COLORS.mutedLight : COLORS.mutedDark,
      align: "right",
    });
    addText(slide, item.value, {
      x: x + 0.22,
      y: y + 0.94,
      w: cardW - 0.44,
      h: 0.38,
      fontFace: FONTS.heading,
      fontSize: item.value.length > 6 ? 17.5 : 23.5,
      bold: true,
      color: itemAccent,
    });
    addText(slide, item.note, {
      x: x + 0.22,
      y: y + 1.46,
      w: cardW - 0.44,
      h: 0.28,
      fontSize: 7.2,
      color: dark ? COLORS.mutedLight : COLORS.mutedDark,
    });
  });
}

function addTimeline(slide, visual, deckSlide, frame) {
  const dark = darkTone(deckSlide);
  addRoundRect(slide, {
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    fill: dark ? COLORS.panelNavy : COLORS.white,
    transparency: dark ? 24 : 8,
    lineColor: accentOf(deckSlide),
    lineTransparency: 55,
    linePt: 1,
  });
  const lineX = frame.x + 0.65;
  addLine(slide, lineX, frame.y + 0.62, lineX, frame.y + frame.h - 0.62, COLORS.cyan, { pt: 1.4 });
  visual.items.forEach((item, idx) => {
    const y = frame.y + 0.62 + idx * ((frame.h - 1.24) / Math.max(1, visual.items.length - 1));
    const itemAccent = [COLORS.cyan, COLORS.purple, COLORS.hardwareAmber, COLORS.successGreen][idx % 4];
    addCircle(slide, { x: lineX - 0.17, y: y - 0.17, w: 0.34, h: 0.34, fill: itemAccent });
    addText(slide, String(idx + 1), {
      x: lineX - 0.15,
      y: y - 0.075,
      w: 0.3,
      h: 0.1,
      fontFace: FONTS.mono,
      fontSize: 6.4,
      bold: true,
      align: "center",
      color: COLORS.white,
    });
    addRoundRect(slide, {
      x: lineX + 0.35,
      y: y - 0.29,
      w: frame.w - 1.25,
      h: 0.58,
      fill: dark ? COLORS.deepCover : COLORS.lightBg,
      transparency: dark ? 18 : 0,
      lineColor: itemAccent,
      lineTransparency: 40,
      linePt: 0.8,
    });
    addText(slide, item.title, {
      x: lineX + 0.55,
      y: y - 0.16,
      w: 1.18,
      h: 0.13,
      fontFace: FONTS.heading,
      fontSize: 8.8,
      bold: true,
      color: itemAccent,
    });
    addText(slide, item.text, {
      x: lineX + 1.78,
      y: y - 0.16,
      w: frame.w - 2.82,
      h: 0.14,
      fontSize: 8,
      color: dark ? COLORS.white : COLORS.darkText,
    });
  });
}

function addImageGrid(slide, visual, deckSlide, frame) {
  const gap = 0.17;
  const cols = 3;
  const rows = 2;
  const cardW = (frame.w - gap * (cols - 1)) / cols;
  const cardH = (frame.h - gap * (rows - 1)) / rows;
  visual.images.forEach((image, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    addScreenshotFrame(slide, shot(path.basename(image.src)), image.caption, {
      x: frame.x + col * (cardW + gap),
      y: frame.y + row * (cardH + gap),
      w: cardW,
      h: cardH,
    }, deckSlide);
  });
}

function addVisual(slide, deckSlide) {
  const visual = deckSlide.visual;
  const frame = { x: 6.45, y: 1.42, w: 6.22, h: 4.82 };
  if (visual.type === "image") {
    addScreenshotFrame(slide, shot(path.basename(visual.src)), visual.caption, frame, deckSlide);
    addStatPoster(slide, deckSlide.stat, deckSlide, { x: 6.45, y: 5.18, w: 2.25, h: 1.1 });
    return;
  }
  if (visual.type === "imageGrid") {
    addImageGrid(slide, visual, deckSlide, frame);
    addStatPoster(slide, deckSlide.stat, deckSlide, { x: 0.58, y: 5.15, w: 2.45, h: 1.18 });
    return;
  }
  if (visual.type === "flow") {
    addFlowDiagram(slide, visual, deckSlide, frame);
    addStatPoster(slide, deckSlide.stat, deckSlide, { x: 10.38, y: 5.18, w: 2.28, h: 1.05 });
    return;
  }
  if (visual.type === "metrics") {
    addMetricsGrid(slide, visual, deckSlide, frame);
    return;
  }
  if (visual.type === "timeline") {
    addTimeline(slide, visual, deckSlide, frame);
    return;
  }
  throw new Error(`Unsupported visual type: ${visual.type}`);
}

function addSlide(deck, deckSlide, index, total) {
  const slide = deck.addSlide();
  addBackground(slide, deckSlide);
  addHeader(slide, deckSlide, index, total);
  addTitleAndBullets(slide, deckSlide);
  addVisual(slide, deckSlide);
  addFooter(slide, deckSlide, index, total);
  slide.addNotes(deckSlide.speakerNote);
}

const slides = [
  {
    title: "AetherGuard",
    kicker: "雄才杯2026决赛 · 聚雄才 创未来",
    claim: "面向雄安数字基础设施的智能服务器安全防御平台。",
    bullets: ["新一代信息技术", "人工智能软件与系统服务", "服务器安全", "ESP32 物理确认门"],
    visual: { type: "image", src: "/pitch/02-dashboard.png", caption: "已有控制台界面，可用于决赛现场连续演示" },
    speakerNote: "开场先点明赛题匹配：AetherGuard 面向雄安数字基础设施安全，用 Agent、AI 和 ESP32 补上高危操作可信确认断点。",
    evidenceLevel: "repo",
    tone: "dark",
    accent: "cyan",
    stat: { value: "4", label: "层防护闭环", note: "控制平面 + Agent + AI + ESP32" },
  },
  {
    title: "补上可信确认断点",
    kicker: "一句话价值",
    claim: "我们不是多做一个安全控制台，而是补上关键服务器高危操作的可信确认断点。",
    bullets: [
      "远程账号或服务器权限失守时，纯软件确认容易被绕过",
      "AetherGuard 把危险动作接入串口硬件确认，要求人到现场按键",
      "0 远程绕过只作为物理确认机制的设计目标，不写成性能承诺",
    ],
    visual: { type: "flow", steps: ["高危动作", "平台请求", "ESP32 显示", "现场按键", "审计执行"] },
    speakerNote: "这一页给评委留下核心记忆点：安全确认从远程软件权限回到物理现场。",
    evidenceLevel: "repo",
    tone: "dark",
    accent: "cyan",
    stat: { value: "0", label: "远程绕过目标", note: "危险动作必须现场确认" },
  },
  {
    title: "雄安场景需要可控安全",
    kicker: "雄安痛点",
    claim: "数字城市、园区平台、信创环境和 AI 应用安全，都需要可控、可审计、可私有化的服务器防护。",
    bullets: [
      "园区和创新企业服务器数量增长，安全运营能力容易碎片化",
      "关键运维动作缺少独立可信确认，事前阻断弱，事后追责难",
      "政企、信创和数字城市场景对本地化、私有化和审计链路要求更高",
      "AI 应用安全需要持续监控、攻击演练和策略复盘闭环",
    ],
    visual: {
      type: "metrics",
      items: [
        { value: "数字城市", label: "基础设施", note: "服务器和应用链路需要持续保护" },
        { value: "园区企业", label: "落地入口", note: "从可试点场景开始验证" },
        { value: "信创安全", label: "本地部署", note: "敏感日志留在本地边界" },
        { value: "AI 应用", label: "智能治理", note: "监控、演练、复盘闭环" },
      ],
    },
    speakerNote: "把痛点拉回雄安，不讲泛安全大市场，讲新区数字基础设施和园区企业的采用障碍。",
    evidenceLevel: "inferred",
    tone: "light",
    accent: "cyan",
  },
  {
    title: "一条闭环承接防护",
    kicker: "解决方案",
    claim: "控制平面、Agent、AI 和 ESP32 共同组成从发现、判断到确认、执行的主动防御闭环。",
    bullets: [
      "控制台统一承接节点、设备、扫描、告警、部署和审计",
      "Agent 贴近业务服务器现场，降低只依赖边界设备的盲区",
      "AI 用于监控、攻击演练和策略复盘，不夸大为完全自动替代专家",
      "ESP32 串口硬件门承接高危操作的物理确认和证据留痕",
    ],
    visual: { type: "flow", steps: ["控制台", "Agent", "AI 判断", "ESP32 确认", "审计证据"] },
    speakerNote: "这一页讲系统结构，承接后面三页核心技术，不要展开过多实现细节。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "cyan",
  },
  {
    title: "Agent 让防护前移",
    kicker: "核心技术一",
    claim: "Agent-Inside 不是边界工具拼接，而是把防护位置前移到业务服务器运行现场。",
    bullets: [
      "统一查看 Agent 心跳、资源状态、风险事件和节点详情",
      "适合覆盖多站点、多服务器实例和分布式业务节点",
      "与扫描、告警、审计联动，避免安全信息停留在孤立列表",
    ],
    visual: { type: "image", src: "/pitch/03-agents.png", caption: "Agent 管理界面：节点状态和运行信息已纳入平台" },
    speakerNote: "对应评审重点中的核心技术和可实现性：主机侧防护已有产品界面支撑。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "cyan",
    stat: { value: "Agent", label: "主机侧内生防护", note: "防护贴近业务运行现场" },
  },
  {
    title: "ESP32 拉回物理现场",
    kicker: "核心技术二 · 最大差异化",
    claim: "ESP32 把安全确认从远程软件权限拉回物理现场，形成不可远程伪造的确认门。",
    bullets: [
      "ESP32 只通过 USB-TTL 串口通信，不暴露网络控制面",
      "协议采用 allow-list：AG:REQ 到 AG:BEGIN / STEP / OK / ERR",
      "适用于安装/卸载 Agent、擦除数据、关键配置变更等危险动作",
      "当前表述为硬件原型和链路设计，不夸大为量产硬件",
    ],
    visual: { type: "image", src: "/pitch/07-devices.png", caption: "设备管理界面：硬件节点被纳入安全闭环" },
    speakerNote: "这是决赛重点页。用琥珀橙形成视觉停顿，强调原创性和物理可信。",
    evidenceLevel: "repo",
    tone: "hardware",
    accent: "amber",
    stat: { value: "ESP32", label: "物理可信确认", note: "串口硬件门，现场按键确认" },
  },
  {
    title: "AI 让判断可验证",
    kicker: "核心技术三",
    claim: "AI 不是替代安全专家，而是把可配置、可演练、可复盘的分析路径放进平台。",
    bullets: [
      "Agent Monitor、模型配置和攻击模拟器形成智能分析入口",
      "攻击演练用于验证防护策略，而不是只做静态展示",
      "本地化与私有化模型路径有利于敏感安全日志留在企业边界内",
      "匹配新一代信息技术和人工智能软件与系统服务方向",
    ],
    visual: { type: "image", src: "/pitch/05-agent-monitor.png", caption: "AI 与 Agent 监控界面：为持续优化提供入口" },
    speakerNote: "承接雄才杯赛道方向，避免把 AI 讲成口号，讲成可配置、可验证的工程闭环。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "purple",
    stat: { value: "AI", label: "可配置决策", note: "监控、演练、复盘闭环" },
  },
  {
    title: "已有连续产品链路",
    kicker: "产品与原型证据",
    claim: "AetherGuard 已有可连续演示的控制台、设备、部署、扫描、告警和后台页面，不停留在概念图。",
    bullets: [
      "已有 React 前端、Node/TypeScript 后端、Socket.IO 实时链路和硬件目录",
      "页面覆盖 Dashboard、Agents、Devices、Deployment、Scanner、Alerts、Admin",
      "截图、方案文档、硬件说明和生成脚本可支撑现场演示与后续打磨",
    ],
    visual: {
      type: "imageGrid",
      images: [
        { src: "/pitch/02-dashboard.png", caption: "总览" },
        { src: "/pitch/11-deployment.png", caption: "部署" },
        { src: "/pitch/12-scanner.png", caption: "扫描" },
        { src: "/pitch/14-alerts.png", caption: "告警" },
        { src: "/pitch/17-admin.png", caption: "后台" },
        { src: "/pitch/07-devices.png", caption: "设备" },
      ],
    },
    speakerNote: "这页回答评委的可实现性问题：不是只讲概念，已有产品链路可演示。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "green",
    stat: { value: "6+", label: "产品界面", note: "已有运行截图" },
  },
  {
    title: "从原型走向试点",
    kicker: "成果转化路径",
    claim: "下一步不是扩张叙事，而是把原型演示链路打磨成可在雄安场景试点的交付包。",
    bullets: [
      "短期：打磨部署、硬件确认、审计证据和现场演示链路",
      "中期：选择 1-2 个服务器场景做小规模试点验证",
      "长期：沉淀私有化交付包、行业案例和安全运营服务能力",
      "争取对接雄安创新创业支持政策、产业资源和场景机会",
    ],
    visual: {
      type: "timeline",
      items: [
        { title: "现在", text: "可演示平台与硬件原型" },
        { title: "决赛后", text: "打磨部署、确认、审计闭环" },
        { title: "试点期", text: "接入真实服务器场景" },
        { title: "复制期", text: "沉淀交付包和行业案例" },
      ],
    },
    speakerNote: "路线图不要贪大，成果转化重点是从演示走向雄安试点。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "green",
  },
  {
    title: "商业模式可持续",
    kicker: "商业模式与市场前景",
    claim: "软件订阅建立持续收入，硬件确认门形成差异化，私有化交付和安全服务承接高价值场景。",
    bullets: [
      "软件订阅：按节点、站点或企业版本提供持续防护与运营能力",
      "硬件配套：ESP32 确认门作为部署包和高危操作安全配件",
      "私有化交付：面向政企、园区、信创和合规敏感场景",
      "增值服务：安全配置、演练验证、合规材料和响应支持",
    ],
    visual: {
      type: "metrics",
      items: [
        { value: "订阅", label: "软件平台", note: "持续运营与升级" },
        { value: "硬件", label: "物理确认", note: "强化差异化和客单价" },
        { value: "交付", label: "私有化部署", note: "适配敏感行业" },
        { value: "服务", label: "安全运营", note: "试点后沉淀案例" },
      ],
    },
    speakerNote: "商业模式只写方向性表达，不承诺未经验证的收入数字。",
    evidenceLevel: "inferred",
    tone: "light",
    accent: "green",
  },
  {
    title: "落地雄安有四类入口",
    kicker: "雄安落地计划",
    claim: "项目可优先从园区企业服务器、数字城市基础设施、信创安全和 AI 应用安全四类场景切入。",
    bullets: [
      "园区企业：从中小团队服务器安全运营切入，降低落地门槛",
      "数字城市：服务关键系统的高危运维确认和审计留痕",
      "信创安全：支持本地化、私有化和数据不外发的部署诉求",
      "AI 应用安全：用监控与演练闭环服务智能应用治理",
    ],
    visual: {
      type: "metrics",
      items: [
        { value: "园区企业", label: "试点入口", note: "服务器和应用链路保护" },
        { value: "数字城市", label: "基础设施", note: "高危操作确认与审计" },
        { value: "信创安全", label: "私有化", note: "数据留在本地边界" },
        { value: "AI 安全", label: "智能应用", note: "监控、演练、复盘闭环" },
      ],
    },
    speakerNote: "这一页明确回到雄安，回答为什么值得新区支持和对接资源。",
    evidenceLevel: "inferred",
    tone: "light",
    accent: "purple",
  },
  {
    title: "值得支持的四个答案",
    kicker: "决赛收束",
    claim: "AetherGuard 的决赛答案是：技术有差异、产品可演示、场景能落地、团队可推进。",
    bullets: [
      "核心技术：Agent、AI 和 ESP32 串口确认协议形成差异化闭环",
      "成果转化：已有原型、截图、硬件链路和试点路径",
      "商业前景：订阅、硬件、私有化交付和安全服务组合",
      "团队实力：真实材料未补齐前保留占位，不虚构成果",
    ],
    visual: { type: "flow", steps: ["核心技术", "产品证据", "成果转化", "商业模式", "雄安落地"] },
    speakerNote: "最后回到评委关心的问题：为什么值得支持，答案是差异化明确且能继续转化。",
    evidenceLevel: "inferred",
    tone: "dark",
    accent: "cyan",
    stat: { value: "4", label: "个决赛答案", note: "技术、产品、转化、团队" },
  },
  {
    title: "备用：技术架构详解",
    kicker: "附录页 · 评委追问时打开",
    claim: "系统由访问层、控制平面、支撑层和受管对象层组成，支持从发现到执行的安全闭环。",
    bullets: [
      "访问层：React 控制台负责展示、操作和演示入口",
      "控制平面：Express、Socket.IO、业务模块和服务编排",
      "支撑层：SQLite / Postgres shadow writes、Redis、审计与配置",
      "受管对象层：Agent、站点、ESP32 串口确认设备和 Rust fastpath",
    ],
    visual: { type: "flow", steps: ["React 控制台", "Node 控制平面", "数据与缓存", "Agent / Site / ESP32", "审计证据"] },
    speakerNote: "只在评委追问架构时打开，不进入默认 8-10 分钟主线。",
    evidenceLevel: "repo",
    tone: "dark",
    accent: "purple",
  },
  {
    title: "备用：团队与知识产权",
    kicker: "附录页 · 待补真实材料",
    claim: "团队信息和知识产权状态需要按真实材料补齐，当前版本保留占位，避免虚构参赛主体。",
    bullets: [
      "团队名称 / 项目负责人 / 学校或公司：待补充",
      "成员分工：前后端、安全、AI、硬件、展示材料待补充",
      "软著编号 / 专利状态 / 奖项经历：待补充",
      "试点单位或合作意向：待补充",
    ],
    visual: {
      type: "metrics",
      items: [
        { value: "待补", label: "团队名称", note: "不虚构参赛主体" },
        { value: "待补", label: "负责人", note: "按真实报名信息填写" },
        { value: "待补", label: "知识产权", note: "只填已申请或已授权状态" },
        { value: "待补", label: "试点", note: "有材料后再写具体单位" },
      ],
    },
    speakerNote: "这页只服务问答和材料补充，不默认展示。",
    evidenceLevel: "placeholder",
    tone: "light",
    accent: "green",
  },
];

function buildPresentation() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const deck = new PptxGenJS();
  deck.author = "OpenAI Codex";
  deck.company = "杭州视界奇点科技有限公司";
  deck.subject = "AetherGuard 雄才杯2026决赛";
  deck.title = "AetherGuard 雄才杯决赛版";
  deck.lang = "zh-CN";
  deck.theme = {
    headFontFace: FONTS.heading,
    bodyFontFace: FONTS.body,
    lang: "zh-CN",
  };
  deck.defineLayout({ name: "AETHER_WIDE", width: SLIDE_W, height: SLIDE_H });
  deck.layout = "AETHER_WIDE";
  slides.forEach((slide, index) => addSlide(deck, slide, index, slides.length));
  return deck.writeFile({ fileName: OUTPUT_FILE, compression: true });
}

buildPresentation()
  .then(() => {
    console.log(`Generated PPTX: ${OUTPUT_FILE}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
