import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "docs", "generated");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "AetherGuard-双创答辩.pptx");
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, "docs", "screenshots");

const PPT_W = 13.333;

const COLORS = {
  bg: "F7F9FC",
  white: "FFFFFF",
  text: "0F172A",
  muted: "475569",
  faint: "64748B",
  line: "D8E1EB",
  green: "22C55E",
  greenDark: "15803D",
  greenSoft: "EAF8EF",
  blue: "1D4ED8",
  blueSoft: "EAF0FF",
  amber: "F59E0B",
  amberSoft: "FFF6DF",
  redSoft: "FDECEC",
  slateSoft: "EEF3F8",
};

const FONTS = {
  heading: "Microsoft YaHei",
  body: "Microsoft YaHei",
};

const SOFT_SHADOW = {
  type: "outer",
  color: "94A3B8",
  opacity: 0.16,
  blur: 2,
  offset: 1.3,
  angle: 45,
};

function shot(name) {
  return path.join(SCREENSHOT_DIR, name);
}

function ensurePath(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing asset: ${filePath}`);
  }
  return filePath;
}

function addFooter(slide, pageNum) {
  slide.addShape("line", {
    x: 0.6,
    y: 7.02,
    w: 12.1,
    h: 0,
    line: { color: COLORS.line, pt: 1 },
  });
  slide.addText("AetherGuard 双创答辩演示稿", {
    x: 0.6,
    y: 7.06,
    w: 3.8,
    h: 0.18,
    fontFace: FONTS.body,
    fontSize: 8.5,
    color: COLORS.faint,
    margin: 0,
  });
  slide.addText(`${String(pageNum).padStart(2, "0")} / 14`, {
    x: 11.6,
    y: 7.04,
    w: 1.1,
    h: 0.18,
    fontFace: FONTS.body,
    fontSize: 8.5,
    color: COLORS.faint,
    align: "right",
    margin: 0,
  });
}

function addSectionTag(slide, text) {
  slide.addShape("roundRect", {
    x: 0.6,
    y: 0.28,
    w: 1.28,
    h: 0.28,
    rectRadius: 0.03,
    fill: { color: COLORS.greenSoft },
    line: { color: COLORS.green, pt: 1 },
  });
  slide.addText(text, {
    x: 0.68,
    y: 0.315,
    w: 1.1,
    h: 0.16,
    fontFace: FONTS.body,
    fontSize: 8.5,
    color: COLORS.greenDark,
    bold: true,
    margin: 0,
    align: "center",
  });
}

function addEvidenceBadge(slide, label) {
  let fill = COLORS.greenSoft;
  let text = COLORS.greenDark;
  let line = COLORS.green;
  if (label === "推导表达") {
    fill = COLORS.amberSoft;
    text = "9A6700";
    line = COLORS.amber;
  } else if (label === "用户待补充") {
    fill = COLORS.slateSoft;
    text = COLORS.muted;
    line = "94A3B8";
  }
  slide.addShape("roundRect", {
    x: 10.75,
    y: 0.28,
    w: 1.95,
    h: 0.28,
    fill: { color: fill },
    line: { color: line, pt: 1 },
  });
  slide.addText(label, {
    x: 10.85,
    y: 0.315,
    w: 1.75,
    h: 0.16,
    fontFace: FONTS.body,
    fontSize: 8.5,
    bold: true,
    color: text,
    align: "center",
    margin: 0,
  });
}

function addTitleBlock(slide, title, conclusion) {
  slide.addText(title, {
    x: 0.6,
    y: 0.62,
    w: 8.9,
    h: 0.42,
    fontFace: FONTS.heading,
    fontSize: 21,
    bold: true,
    color: COLORS.text,
    margin: 0,
    fit: "shrink",
  });
  slide.addText(conclusion, {
    x: 0.6,
    y: 1.08,
    w: 12.1,
    h: 0.58,
    fontFace: FONTS.body,
    fontSize: 12.5,
    bold: true,
    color: COLORS.text,
    fill: { color: COLORS.greenSoft },
    line: { color: "B7E6C4", pt: 1 },
    margin: 0.12,
    valign: "middle",
    fit: "shrink",
    shape: "roundRect",
  });
}

function createContentSlide(pptx, { pageNum, section, badge, title, conclusion }) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.bg };
  slide.color = COLORS.text;
  addSectionTag(slide, section);
  addEvidenceBadge(slide, badge);
  addTitleBlock(slide, title, conclusion);
  addFooter(slide, pageNum);
  return slide;
}

function addBulletList(slide, items, x, y, w, { fontSize = 11.5, gap = 0.42, color = COLORS.text } = {}) {
  items.forEach((item, idx) => {
    slide.addText(`• ${item}`, {
      x,
      y: y + idx * gap,
      w,
      h: 0.32,
      fontFace: FONTS.body,
      fontSize,
      color,
      margin: 0,
      fit: "shrink",
    });
  });
}

function addPanel(slide, { x, y, w, h, title, fill = COLORS.white, line = COLORS.line, titleColor = COLORS.text }) {
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h,
    fill: { color: fill },
    line: { color: line, pt: 1 },
    shadow: SOFT_SHADOW,
  });
  if (title) {
    slide.addText(title, {
      x: x + 0.18,
      y: y + 0.12,
      w: w - 0.36,
      h: 0.22,
      fontFace: FONTS.body,
      fontSize: 10.5,
      bold: true,
      color: titleColor,
      margin: 0,
    });
  }
}

function addImageCard(slide, { x, y, w, h, label, imagePath }) {
  addPanel(slide, { x, y, w, h, title: label });
  slide.addImage({
    path: ensurePath(imagePath),
    x: x + 0.12,
    y: y + 0.42,
    w: w - 0.24,
    h: h - 0.54,
    rounding: true,
  });
}

function addPill(slide, text, x, y, w, { fill = COLORS.slateSoft, color = COLORS.muted, line = COLORS.line } = {}) {
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h: 0.3,
    fill: { color: fill },
    line: { color: line, pt: 1 },
  });
  slide.addText(text, {
    x: x + 0.05,
    y: y + 0.06,
    w: w - 0.1,
    h: 0.16,
    fontFace: FONTS.body,
    fontSize: 8.5,
    color,
    align: "center",
    margin: 0,
    bold: true,
  });
}

function addMetricCard(slide, { x, y, w, h, number, label, note, fill = COLORS.white, accent = COLORS.green }) {
  addPanel(slide, { x, y, w, h, fill });
  slide.addText(number, {
    x: x + 0.18,
    y: y + 0.16,
    w: w - 0.36,
    h: 0.42,
    fontFace: FONTS.heading,
    fontSize: 20,
    bold: true,
    color: accent,
    margin: 0,
    fit: "shrink",
  });
  slide.addText(label, {
    x: x + 0.18,
    y: y + 0.64,
    w: w - 0.36,
    h: 0.22,
    fontFace: FONTS.body,
    fontSize: 10,
    bold: true,
    color: COLORS.text,
    margin: 0,
    fit: "shrink",
  });
  if (note) {
    slide.addText(note, {
      x: x + 0.18,
      y: y + 0.92,
      w: w - 0.36,
      h: 0.28,
      fontFace: FONTS.body,
      fontSize: 8.5,
      color: COLORS.faint,
      margin: 0,
      fit: "shrink",
    });
  }
}

function addPlaceholderField(slide, label, x, y, w) {
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h: 0.42,
    fill: { color: COLORS.white },
    line: { color: COLORS.line, pt: 1 },
  });
  slide.addText(label, {
    x: x + 0.14,
    y: y + 0.11,
    w: w - 0.28,
    h: 0.18,
    fontFace: FONTS.body,
    fontSize: 9.5,
    color: COLORS.faint,
    margin: 0,
    fit: "shrink",
  });
}

function addArrowLine(slide, x1, y1, x2, y2, color = COLORS.blue) {
  slide.addShape("line", {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    line: {
      color,
      pt: 1.2,
      endArrowType: "triangle",
    },
  });
}

function addStepChip(slide, x, y, w, title, fill = COLORS.white, line = COLORS.line) {
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h: 0.42,
    fill: { color: fill },
    line: { color: line, pt: 1 },
  });
  slide.addText(title, {
    x: x + 0.06,
    y: y + 0.1,
    w: w - 0.12,
    h: 0.18,
    fontFace: FONTS.body,
    fontSize: 9.5,
    bold: true,
    color: COLORS.text,
    align: "center",
    margin: 0,
    fit: "shrink",
  });
}

function addBar(slide, { label, valueLabel, ratio, x, y, w, color }) {
  slide.addText(label, {
    x,
    y,
    w: 1.9,
    h: 0.22,
    fontFace: FONTS.body,
    fontSize: 9.5,
    color: COLORS.text,
    margin: 0,
    fit: "shrink",
  });
  slide.addShape("roundRect", {
    x: x + 2.0,
    y: y + 0.02,
    w,
    h: 0.22,
    fill: { color: "E9EEF5" },
    line: { color: "E9EEF5", pt: 0.5 },
  });
  slide.addShape("roundRect", {
    x: x + 2.0,
    y: y + 0.02,
    w: Math.max(0.5, w * ratio),
    h: 0.22,
    fill: { color },
    line: { color, pt: 0.5 },
  });
  slide.addText(valueLabel, {
    x: x + 2.0 + w + 0.12,
    y,
    w: 1.0,
    h: 0.22,
    fontFace: FONTS.body,
    fontSize: 9.5,
    color: COLORS.faint,
    margin: 0,
    fit: "shrink",
  });
}

function coverSlide(pptx) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.bg };

  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: PPT_W,
    h: 0.1,
    fill: { color: COLORS.green },
    line: { color: COLORS.green, pt: 0 },
  });
  slide.addShape("ellipse", {
    x: 8.7,
    y: -0.4,
    w: 4.6,
    h: 4.6,
    fill: { color: COLORS.greenSoft, transparency: 25 },
    line: { color: COLORS.greenSoft, pt: 0 },
  });
  slide.addShape("ellipse", {
    x: 10.7,
    y: 0.6,
    w: 2.1,
    h: 2.1,
    fill: { color: COLORS.blueSoft, transparency: 30 },
    line: { color: COLORS.blueSoft, pt: 0 },
  });

  addPill(slide, "创新创业大赛答辩", 0.6, 0.46, 1.62, {
    fill: COLORS.greenSoft,
    color: COLORS.greenDark,
    line: COLORS.green,
  });
  slide.addText("AetherGuard", {
    x: 0.6,
    y: 1.0,
    w: 4.8,
    h: 0.55,
    fontFace: FONTS.heading,
    fontSize: 28,
    bold: true,
    color: COLORS.text,
    margin: 0,
  });
  slide.addText("面向服务器场景的智能安全防御平台", {
    x: 0.6,
    y: 1.58,
    w: 5.8,
    h: 0.38,
    fontFace: FONTS.body,
    fontSize: 16,
    color: COLORS.muted,
    bold: true,
    margin: 0,
  });
  slide.addText("我们要展示的不是一个单点安全工具，而是一套可落地、可演示、可持续演进的服务器安全平台。", {
    x: 0.6,
    y: 2.0,
    w: 5.7,
    h: 0.68,
    fontFace: FONTS.body,
    fontSize: 13,
    color: COLORS.text,
    fill: { color: COLORS.white },
    line: { color: COLORS.line, pt: 1 },
    shape: "roundRect",
    margin: 0.12,
    fit: "shrink",
  });

  addPill(slide, "服务器安全", 0.6, 2.9, 1.1, { fill: COLORS.white });
  addPill(slide, "分布式 Agent", 1.82, 2.9, 1.22, { fill: COLORS.white });
  addPill(slide, "AI 辅助分析", 3.16, 2.9, 1.16, { fill: COLORS.white });
  addPill(slide, "ESP32 联动", 4.44, 2.9, 1.1, { fill: COLORS.white });

  addPanel(slide, {
    x: 0.6,
    y: 3.38,
    w: 5.7,
    h: 2.45,
    title: "参赛信息占位",
    fill: COLORS.white,
  });
  addPlaceholderField(slide, "团队名称 / 项目组名称待补", 0.82, 3.82, 5.26);
  addPlaceholderField(slide, "项目负责人待补", 0.82, 4.3, 2.5);
  addPlaceholderField(slide, "指导老师待补", 3.58, 4.3, 2.5);
  addPlaceholderField(slide, "学校 / 学院信息待补", 0.82, 4.78, 5.26);
  addPlaceholderField(slide, "比赛名称与组别待补", 0.82, 5.26, 5.26);

  addImageCard(slide, {
    x: 6.68,
    y: 0.95,
    w: 6.1,
    h: 4.95,
    label: "平台主界面",
    imagePath: shot("02-dashboard.png"),
  });

  slide.addText("口径说明：团队、导师、学院、软著编号等信息先保留可编辑占位，不虚构未提供信息。", {
    x: 6.85,
    y: 6.05,
    w: 5.8,
    h: 0.38,
    fontFace: FONTS.body,
    fontSize: 8.8,
    color: COLORS.faint,
    margin: 0,
    fit: "shrink",
  });

  addFooter(slide, 1);
}

function painSlide(pptx) {
  const slide = createContentSlide(pptx, {
    pageNum: 2,
    section: "P02 / 痛点",
    badge: "推导表达",
    title: "为什么服务器安全需要新的做法",
    conclusion: "企业面临的难点已经不只是“有没有防火墙”，而是“是否能低门槛、低延迟、可私有化地持续防护”。",
  });

  const cards = [
    ["部署复杂", "方案分散、门槛高，日常运维难形成统一入口。"],
    ["响应滞后", "扫描、告警、处置链条分离，真正形成闭环的速度慢。"],
    ["数据顾虑", "高敏感场景不愿把安全日志与分析过程全部外发到云端。"],
    ["工具割裂", "站点、设备、节点、审计往往分属多套系统，切换成本高。"],
  ];
  const positions = [
    [0.6, 2.0],
    [3.45, 2.0],
    [0.6, 3.82],
    [3.45, 3.82],
  ];
  cards.forEach(([title, body], idx) => {
    const [x, y] = positions[idx];
    addPanel(slide, { x, y, w: 2.55, h: 1.48, title, fill: COLORS.white });
    slide.addText(body, {
      x: x + 0.18,
      y: y + 0.45,
      w: 2.19,
      h: 0.82,
      fontFace: FONTS.body,
      fontSize: 9.5,
      color: COLORS.muted,
      margin: 0,
      fit: "shrink",
    });
  });

  addPanel(slide, {
    x: 6.35,
    y: 2.0,
    w: 6.38,
    h: 3.3,
    title: "机会判断",
    fill: COLORS.white,
    line: "B7E6C4",
  });
  slide.addText("从“多工具堆叠”转向“统一平台运营”", {
    x: 6.58,
    y: 2.38,
    w: 5.9,
    h: 0.42,
    fontFace: FONTS.heading,
    fontSize: 18,
    bold: true,
    color: COLORS.text,
    margin: 0,
    fit: "shrink",
  });
  addBulletList(slide, [
    "把节点、站点、设备、扫描、告警和审计放进同一平台视角。",
    "把部署、分析和留痕做成可被非专职安全人员使用的流程。",
    "把私有化与本地智能分析作为高敏感场景的设计前提。",
  ], 6.58, 2.96, 5.76, { gap: 0.48 });
  slide.addText("双创项目的切入点不在于复述市场有多大，而在于证明我们找到了一个真实且尚未被低成本解决的问题。", {
    x: 6.58,
    y: 4.55,
    w: 5.84,
    h: 0.48,
    fontFace: FONTS.body,
    fontSize: 9.5,
    color: COLORS.faint,
    fill: { color: COLORS.slateSoft },
    line: { color: COLORS.line, pt: 1 },
    shape: "roundRect",
    margin: 0.1,
    fit: "shrink",
  });
}

function definitionSlide(pptx) {
  const slide = createContentSlide(pptx, {
    pageNum: 3,
    section: "P03 / 定义",
    badge: "仓库可证实",
    title: "AetherGuard 是什么",
    conclusion: "AetherGuard 已经形成了面向节点、站点、设备、扫描、告警和审计的一体化控制平台。",
  });

  addPanel(slide, { x: 0.6, y: 1.95, w: 4.25, h: 3.9, title: "项目定义" });
  addBulletList(slide, [
    "前端控制台已覆盖登录、总览、Agent、设备、站点、扫描、告警和历史等模块。",
    "后端控制平面承接认证、状态同步、业务模块和实时通信。",
    "目标是把“看见风险、判断风险、处理风险、留存记录”收束到同一个平台。",
    "价值主张：让服务器安全从分散工具堆叠，变成可视、可管、可追溯的主动防御系统。",
  ], 0.8, 2.36, 3.86, { gap: 0.48 });

  addPill(slide, "统一入口", 0.8, 5.2, 1.0, { fill: COLORS.greenSoft, color: COLORS.greenDark, line: COLORS.green });
  addPill(slide, "控制平面", 1.92, 5.2, 1.05, { fill: COLORS.blueSoft, color: COLORS.blue, line: COLORS.blue });
  addPill(slide, "受管对象", 3.1, 5.2, 1.0, { fill: COLORS.slateSoft, color: COLORS.muted, line: COLORS.line });

  addImageCard(slide, {
    x: 5.05,
    y: 1.95,
    w: 7.68,
    h: 3.9,
    label: "Dashboard 总览界面",
    imagePath: shot("02-dashboard.png"),
  });
}

function agentSlide(pptx) {
  const slide = createContentSlide(pptx, {
    pageNum: 4,
    section: "P04 / 创新一",
    badge: "仓库可证实",
    title: "创新一：防护前移到业务服务器侧",
    conclusion: "AetherGuard 选择把 Agent 部署到业务服务器侧，使防护更接近真实运行上下文，而不只依赖单一边界节点。",
  });

  addPanel(slide, { x: 0.6, y: 1.95, w: 4.0, h: 4.0, title: "为什么这是创新点" });
  addBulletList(slide, [
    "平台已提供 Agent 列表页与详情页，可统一管理节点状态、资源占用和心跳信息。",
    "这种设计更适合覆盖站点、服务实例和分布式节点，而不是只守在入口边界。",
    "当节点数增加时，平台能力可以随节点一起扩展，具备天然的分布式管理形态。",
    "这体现的是把安全能力嵌入业务侧，而不是只做外围阻断。",
  ], 0.8, 2.36, 3.62, { gap: 0.48 });

  addImageCard(slide, {
    x: 4.85,
    y: 1.95,
    w: 4.05,
    h: 2.65,
    label: "Agents 列表页",
    imagePath: shot("03-agents.png"),
  });
  addImageCard(slide, {
    x: 9.1,
    y: 1.95,
    w: 3.63,
    h: 2.65,
    label: "Agent 详情页",
    imagePath: shot("04-agent-detail.png"),
  });

  addPanel(slide, { x: 4.85, y: 4.86, w: 7.88, h: 1.05, title: "架构对比理解" });
  addStepChip(slide, 5.12, 5.3, 1.88, "边界式单点防护", COLORS.redSoft, "F3B5B5");
  addArrowLine(slide, 7.12, 5.5, 7.95, 5.5, COLORS.blue);
  addStepChip(slide, 8.02, 5.3, 1.98, "节点内生防护", COLORS.greenSoft, COLORS.green);
  addArrowLine(slide, 10.08, 5.5, 10.92, 5.5, COLORS.blue);
  addStepChip(slide, 11.0, 5.3, 1.46, "统一管理", COLORS.blueSoft, COLORS.blue);
}

function esp32Slide(pptx) {
  const slide = createContentSlide(pptx, {
    pageNum: 5,
    section: "P05 / 创新二",
    badge: "仓库可证实",
    title: "创新二：把设备节点纳入安全闭环",
    conclusion: "项目不是单纯的软件平台，而是尝试把 ESP32 设备作为部署、状态感知和高风险动作承载节点纳入系统。",
  });

  addPill(slide, "设备接入", 0.6, 1.76, 0.92, { fill: COLORS.greenSoft, color: COLORS.greenDark, line: COLORS.green });
  addPill(slide, "状态回传", 1.68, 1.76, 0.92, { fill: COLORS.blueSoft, color: COLORS.blue, line: COLORS.blue });
  addPill(slide, "平台联动", 2.76, 1.76, 0.92, { fill: COLORS.slateSoft, color: COLORS.muted, line: COLORS.line });

  addImageCard(slide, {
    x: 0.6,
    y: 2.05,
    w: 5.35,
    h: 3.95,
    label: "Devices 列表页",
    imagePath: shot("07-devices.png"),
  });
  addImageCard(slide, {
    x: 6.15,
    y: 2.05,
    w: 6.58,
    h: 2.38,
    label: "Board Status 状态页",
    imagePath: shot("08-board-status.png"),
  });
  addPanel(slide, { x: 6.15, y: 4.66, w: 6.58, h: 1.34, title: "答辩表达重点", fill: COLORS.white });
  addBulletList(slide, [
    "已有设备页与板卡状态页，说明硬件对象已纳入统一管理视角。",
    "设备联动的价值在于增加物理确认、状态可见和动作承载能力。",
    "这让项目区别于只停留在纯软件层的常见安全展示方案。",
  ], 6.38, 5.02, 6.08, { fontSize: 9.8, gap: 0.34 });
}

function aiSlide(pptx) {
  const slide = createContentSlide(pptx, {
    pageNum: 6,
    section: "P06 / 创新三",
    badge: "推导表达",
    title: "创新三：AI 监控、模型配置与演练闭环",
    conclusion: "项目在方案层面把多 Agent AI 决策、模型切换和攻击演练连接起来，形成持续优化的智能防御路径。",
  });

  addStepChip(slide, 0.6, 1.78, 1.7, "检测", COLORS.greenSoft, COLORS.green);
  addArrowLine(slide, 2.33, 1.99, 2.88, 1.99, COLORS.blue);
  addStepChip(slide, 2.92, 1.78, 1.7, "判断", COLORS.blueSoft, COLORS.blue);
  addArrowLine(slide, 4.66, 1.99, 5.21, 1.99, COLORS.blue);
  addStepChip(slide, 5.25, 1.78, 1.7, "演练", COLORS.amberSoft, COLORS.amber);
  addArrowLine(slide, 6.99, 1.99, 7.54, 1.99, COLORS.blue);
  addStepChip(slide, 7.58, 1.78, 1.9, "回写优化", COLORS.slateSoft, COLORS.line);

  addPanel(slide, { x: 0.6, y: 2.16, w: 4.3, h: 3.68, title: "当前可讲的事实与边界" });
  addBulletList(slide, [
    "平台已包含 Agent Monitor、Settings、Attack Simulator 等相关模块入口。",
    "现有文档将 AI 描述为多层协作式分析，而不是单模型单结论。",
    "模型配置页支持本地与云端模型组合，符合隐私优先、按场景切换的思路。",
    "答辩时应表述为“智能分析路径已被纳入平台”，而不是宣称已完全替代安全专家。",
  ], 0.8, 2.56, 3.95, { gap: 0.46 });

  addImageCard(slide, {
    x: 5.15,
    y: 2.16,
    w: 3.55,
    h: 2.36,
    label: "Agent Monitor",
    imagePath: shot("05-agent-monitor.png"),
  });
  addImageCard(slide, {
    x: 9.0,
    y: 2.16,
    w: 3.73,
    h: 2.36,
    label: "模型配置",
    imagePath: shot("16-settings.png"),
  });
  slide.addText("补充说明：当前演示重点是“平台中预留并组织了智能分析与验证路径”，不把未提供的真实模型案例写成既成事实。", {
    x: 5.15,
    y: 4.84,
    w: 7.58,
    h: 0.78,
    fontFace: FONTS.body,
    fontSize: 9.2,
    color: COLORS.faint,
    fill: { color: COLORS.amberSoft },
    line: { color: "F4D48A", pt: 1 },
    shape: "roundRect",
    margin: 0.1,
    fit: "shrink",
  });
}

function architectureSlide(pptx) {
  const slide = createContentSlide(pptx, {
    pageNum: 7,
    section: "P07 / 架构",
    badge: "仓库可证实",
    title: "系统如何真正运行起来",
    conclusion: "AetherGuard 已具备前端控制台、后端控制平面、数据库/缓存和受管对象层组成的完整系统架构。",
  });

  const bands = [
    { y: 1.95, h: 0.9, label: "访问层", fill: COLORS.blueSoft },
    { y: 2.98, h: 1.2, label: "控制平面", fill: COLORS.greenSoft },
    { y: 4.35, h: 0.85, label: "支撑层", fill: COLORS.slateSoft },
    { y: 5.35, h: 0.95, label: "受管对象层", fill: COLORS.amberSoft },
  ];

  bands.forEach((band) => {
    slide.addShape("roundRect", {
      x: 0.6,
      y: band.y,
      w: 12.12,
      h: band.h,
      fill: { color: band.fill },
      line: { color: COLORS.line, pt: 1 },
    });
    slide.addText(band.label, {
      x: 0.78,
      y: band.y + 0.12,
      w: 1.15,
      h: 0.2,
      fontFace: FONTS.body,
      fontSize: 10,
      bold: true,
      color: COLORS.text,
      margin: 0,
    });
  });

  const node = (x, y, w, h, text, fill = COLORS.white, line = COLORS.line) => {
    slide.addShape("roundRect", {
      x,
      y,
      w,
      h,
      fill: { color: fill },
      line: { color: line, pt: 1 },
      shadow: SOFT_SHADOW,
    });
    slide.addText(text, {
      x: x + 0.08,
      y: y + 0.09,
      w: w - 0.16,
      h: h - 0.18,
      fontFace: FONTS.body,
      fontSize: 9,
      color: COLORS.text,
      bold: true,
      align: "center",
      valign: "middle",
      margin: 0,
      fit: "shrink",
    });
  };

  node(2.1, 2.14, 1.55, 0.42, "浏览器入口");
  node(4.0, 2.14, 2.15, 0.42, "前端控制台\nReact + Vite");
  node(6.55, 2.14, 2.15, 0.42, "登录 / 导航 / 总览");
  addArrowLine(slide, 3.7, 2.35, 4.0, 2.35);
  addArrowLine(slide, 6.15, 2.35, 6.55, 2.35);

  node(2.05, 3.28, 2.0, 0.56, "后端控制平面\nNode + Express", COLORS.white, "B7E6C4");
  node(4.35, 3.28, 1.65, 0.56, "认证与权限");
  node(6.25, 3.28, 1.75, 0.56, "实时通信");
  node(8.25, 3.28, 1.85, 0.56, "业务模块");
  node(10.35, 3.28, 1.75, 0.56, "任务处理");
  addArrowLine(slide, 4.05, 3.56, 4.35, 3.56, COLORS.greenDark);
  addArrowLine(slide, 6.0, 3.56, 6.25, 3.56, COLORS.greenDark);
  addArrowLine(slide, 8.0, 3.56, 8.25, 3.56, COLORS.greenDark);
  addArrowLine(slide, 10.1, 3.56, 10.35, 3.56, COLORS.greenDark);

  node(3.2, 4.56, 1.75, 0.38, "Redis");
  node(5.35, 4.56, 1.75, 0.38, "SQLite / PostgreSQL");
  node(7.55, 4.56, 1.75, 0.38, "数据卷 / 产物");
  addArrowLine(slide, 5.0, 3.86, 4.1, 4.56, COLORS.blue);
  addArrowLine(slide, 6.95, 3.86, 6.2, 4.56, COLORS.blue);
  addArrowLine(slide, 9.15, 3.86, 8.4, 4.56, COLORS.blue);

  node(2.0, 5.67, 2.15, 0.42, "部署向导");
  node(4.55, 5.67, 2.15, 0.42, "分布式 Agent");
  node(7.1, 5.67, 2.15, 0.42, "受保护站点");
  node(9.65, 5.67, 2.15, 0.42, "ESP32 设备");
  addArrowLine(slide, 3.08, 2.56, 3.08, 5.67, COLORS.blue);
  addArrowLine(slide, 5.62, 3.84, 5.62, 5.67, COLORS.blue);
  addArrowLine(slide, 10.72, 3.84, 10.72, 5.67, COLORS.blue);
}

function evidenceGridSlide(pptx) {
  const slide = createContentSlide(pptx, {
    pageNum: 8,
    section: "P08 / 演示证据",
    badge: "仓库可证实",
    title: "不是概念页，而是已有连续产品界面",
    conclusion: "从首页总览到对象详情、从部署接入到扫描告警，项目已经形成可连续演示的产品链路。",
  });

  const cards = [
    ["Dashboard", "02-dashboard.png"],
    ["Deployment", "11-deployment.png"],
    ["Scanner", "12-scanner.png"],
    ["Alerts", "14-alerts.png"],
    ["History", "15-history.png"],
    ["Admin", "17-admin.png"],
  ];

  addMetricCard(slide, {
    x: 0.6,
    y: 1.82,
    w: 2.0,
    h: 0.9,
    number: "27",
    label: "页面组件",
    note: "覆盖总览、列表、详情与后台页",
    accent: COLORS.greenDark,
  });
  addMetricCard(slide, {
    x: 2.8,
    y: 1.82,
    w: 2.0,
    h: 0.9,
    number: "22",
    label: "运行截图",
    note: "可直接作为答辩视觉证据",
    accent: COLORS.blue,
  });

  const cardW = 3.85;
  const cardH = 1.58;
  cards.forEach(([label, name], idx) => {
    const row = Math.floor(idx / 3);
    const col = idx % 3;
    const x = 0.6 + col * 4.08;
    const y = 2.95 + row * 1.88;
    addImageCard(slide, { x, y, w: cardW, h: cardH, label, imagePath: shot(name) });
  });

  slide.addText("功能链路：Dashboard -> Agents -> Devices -> Sites -> Scanner -> Alerts -> History", {
    x: 0.86,
    y: 6.83,
    w: 8.8,
    h: 0.14,
    fontFace: FONTS.body,
    fontSize: 8.8,
    color: COLORS.faint,
    margin: 0,
    fit: "shrink",
  });
}

function comparisonSlide(pptx) {
  const slide = createContentSlide(pptx, {
    pageNum: 9,
    section: "P09 / 优势",
    badge: "推导表达",
    title: "为什么这套方案更适合中小团队落地",
    conclusion: "AetherGuard 的竞争力不只来自功能数量，而来自“统一平台 + 内置能力 + 低门槛接入”带来的综合效率优势。",
  });

  addPanel(slide, { x: 0.6, y: 1.95, w: 5.2, h: 3.85, title: "相对传统方案的综合优势" });
  addBulletList(slide, [
    "节点、设备、扫描、告警和审计被收敛到同一个平台中，降低工具切换成本。",
    "内置扫描、演练和历史记录能力，有望减少对外部安全服务的依赖。",
    "私有化与本地模型思路，更适合对数据主权敏感的场景。",
    "答辩阶段更适合强调“结构性成本优势”，而不是把内部测算说成已成交结果。",
  ], 0.82, 2.36, 4.84, { gap: 0.48 });

  addPanel(slide, { x: 6.1, y: 1.95, w: 6.63, h: 2.7, title: "三年总成本相对趋势（内部测算口径）" });
  addBar(slide, { x: 6.38, y: 2.42, w: 2.95, label: "传统硬件方案", valueLabel: "高", ratio: 1, color: "94A3B8" });
  addBar(slide, { x: 6.38, y: 2.94, w: 2.95, label: "云安全方案", valueLabel: "中高", ratio: 0.72, color: COLORS.blue });
  addBar(slide, { x: 6.38, y: 3.46, w: 2.95, label: "AetherGuard", valueLabel: "低", ratio: 0.18, color: COLORS.green });

  addPanel(slide, { x: 6.1, y: 4.9, w: 6.63, h: 0.9, title: "表达边界", fill: COLORS.amberSoft, line: "F4D48A" });
  slide.addText("若后续补到真实报价或试点交付数据，可替换当前相对趋势图；当前版本仅展示方向性优势，不承诺未经验证的商业结果。", {
    x: 6.32,
    y: 5.24,
    w: 6.18,
    h: 0.28,
    fontFace: FONTS.body,
    fontSize: 8.8,
    color: COLORS.faint,
    margin: 0,
    fit: "shrink",
  });
}

function marketSlide(pptx) {
  const slide = createContentSlide(pptx, {
    pageNum: 10,
    section: "P10 / 场景",
    badge: "推导表达",
    title: "先切哪些场景，最容易形成转化",
    conclusion: "项目更适合从“服务器资产明确、合规敏感、但缺少高成本安全团队”的场景切入。",
  });

  const cards = [
    ["自建服务器企业", "需要统一看站点、节点和告警状态，最适合平台化切入。"],
    ["SaaS 与云服务团队", "更关注低门槛部署、持续运营和跨节点管理能力。"],
    ["科研实验室 / 教学演示", "适合展示可视化、可演练、可复盘的安全平台能力。"],
    ["高隐私敏感场景", "更看重本地处理、私有部署和可追溯的历史记录。"],
  ];

  cards.forEach(([title, body], idx) => {
    const row = Math.floor(idx / 2);
    const col = idx % 2;
    const x = 0.6 + col * 6.15;
    const y = 2.02 + row * 1.95;
    addPanel(slide, { x, y, w: 5.6, h: 1.55, title, fill: COLORS.white });
    slide.addText(body, {
      x: x + 0.2,
      y: y + 0.45,
      w: 5.2,
      h: 0.6,
      fontFace: FONTS.body,
      fontSize: 10,
      color: COLORS.muted,
      margin: 0,
      fit: "shrink",
    });
  });
}

function businessSlide(pptx) {
  const slide = createContentSlide(pptx, {
    pageNum: 11,
    section: "P11 / 商业化",
    badge: "推导表达",
    title: "怎么从项目走向可持续运营",
    conclusion: "项目适合采用“软件订阅为基础、硬件配套与服务增值补充”的复合型落地路径。",
  });

  const cols = [
    ["软件订阅", COLORS.greenSoft, COLORS.green, ["按能力分层", "承接基础防护与进阶分析", "适合作为持续性收入基础"]],
    ["硬件配套", COLORS.blueSoft, COLORS.blue, ["与 ESP32 联动形成差异化", "增强演示识别度和交付深度", "适合切入高风险动作场景"]],
    ["增值服务", COLORS.amberSoft, COLORS.amber, ["部署支持", "合规文档与策略调优", "演练与运营辅导"]],
  ];
  cols.forEach(([title, fill, line, bullets], idx) => {
    const x = 0.6 + idx * 4.12;
    addPanel(slide, { x, y: 2.0, w: 3.72, h: 2.62, title, fill, line });
    addBulletList(slide, bullets, x + 0.18, 2.48, 3.3, { fontSize: 10, gap: 0.42 });
  });

  addPanel(slide, { x: 0.6, y: 4.95, w: 12.13, h: 1.0, title: "建议的推进路径" });
  addStepChip(slide, 0.92, 5.36, 2.15, "演示验证", COLORS.white, COLORS.line);
  addArrowLine(slide, 3.12, 5.57, 3.6, 5.57, COLORS.blue);
  addStepChip(slide, 3.68, 5.36, 2.15, "小规模试点", COLORS.white, COLORS.line);
  addArrowLine(slide, 5.88, 5.57, 6.36, 5.57, COLORS.blue);
  addStepChip(slide, 6.44, 5.36, 2.15, "沉淀案例", COLORS.white, COLORS.line);
  addArrowLine(slide, 8.64, 5.57, 9.12, 5.57, COLORS.blue);
  addStepChip(slide, 9.2, 5.36, 2.15, "行业复制", COLORS.white, COLORS.line);
}

function resultsSlide(pptx) {
  const slide = createContentSlide(pptx, {
    pageNum: 12,
    section: "P12 / 阶段成果",
    badge: "仓库可证实",
    title: "我们已经做到了什么",
    conclusion: "项目当前最大的说服力，在于它已经具备可运行代码、连续页面、配套文档和测试材料。",
  });

  addMetricCard(slide, { x: 0.6, y: 1.92, w: 2.65, h: 1.15, number: "27", label: "页面组件", note: "覆盖总览、列表、详情和后台页" });
  addMetricCard(slide, { x: 3.45, y: 1.92, w: 2.65, h: 1.15, number: "22", label: "运行截图", note: "可直接用于答辩和软著材料", accent: COLORS.blue });
  addMetricCard(slide, { x: 6.3, y: 1.92, w: 2.65, h: 1.15, number: "7", label: "E2E 测试文件", note: "说明项目已开始考虑演示与验证链路", accent: COLORS.amber });
  addMetricCard(slide, { x: 9.15, y: 1.92, w: 3.58, h: 1.15, number: "4 类+", label: "文档沉淀", note: "架构图、功能说明、操作说明、客户介绍", accent: COLORS.greenDark });

  addPanel(slide, { x: 0.6, y: 3.36, w: 4.15, h: 2.48, title: "证据墙" });
  addBulletList(slide, [
    "已有系统架构图、操作说明书和产品功能说明。",
    "已沉淀前端路由与模块入口，说明功能链路完整。",
    "截图采集于实际运行环境，可直接支撑答辩展示。",
    "测试目录证明项目已进入可验证而非纯概念阶段。",
  ], 0.82, 3.76, 3.78, { fontSize: 9.8, gap: 0.42 });

  addImageCard(slide, { x: 5.0, y: 3.36, w: 2.45, h: 2.48, label: "Login", imagePath: shot("01-login.png") });
  addImageCard(slide, { x: 7.65, y: 3.36, w: 2.45, h: 2.48, label: "Scanner", imagePath: shot("12-scanner.png") });
  addImageCard(slide, { x: 10.3, y: 3.36, w: 2.43, h: 2.48, label: "Admin", imagePath: shot("17-admin.png") });
}

function teamSlide(pptx) {
  const slide = createContentSlide(pptx, {
    pageNum: 13,
    section: "P13 / 团队",
    badge: "用户待补充",
    title: "团队如何支撑这个项目继续落地",
    conclusion: "这个项目需要的不是单一程序员能力，而是产品、前后端、安全、AI、硬件和展示协同。",
  });

  addPanel(slide, { x: 0.6, y: 1.95, w: 3.75, h: 4.15, title: "团队信息占位" });
  addPlaceholderField(slide, "团队名称待补", 0.82, 2.38, 3.31);
  addPlaceholderField(slide, "项目负责人待补", 0.82, 2.88, 3.31);
  addPlaceholderField(slide, "指导老师待补", 0.82, 3.38, 3.31);
  addPlaceholderField(slide, "学校 / 学院待补", 0.82, 3.88, 3.31);
  addPlaceholderField(slide, "相关奖项 / 经历待补", 0.82, 4.38, 3.31);
  addPlaceholderField(slide, "软著编号 / 专利状态待补", 0.82, 4.88, 3.31);

  const roles = [
    ["项目推进", "需求整合、答辩表达、整体协调与节奏把控。"],
    ["前后端研发", "负责控制台、接口、状态同步和系统集成。"],
    ["安全与 AI", "负责分析逻辑、扫描策略、模型配置和演练思路。"],
    ["硬件与运维", "负责 ESP32 设备侧、接入验证和运行环境部署。"],
  ];
  roles.forEach(([title, body], idx) => {
    const row = Math.floor(idx / 2);
    const col = idx % 2;
    const x = 4.7 + col * 4.0;
    const y = 1.95 + row * 2.0;
    addPanel(slide, { x, y, w: 3.7, h: 1.7, title, fill: COLORS.white });
    slide.addText(body, {
      x: x + 0.18,
      y: y + 0.45,
      w: 3.35,
      h: 0.82,
      fontFace: FONTS.body,
      fontSize: 9.6,
      color: COLORS.muted,
      margin: 0,
      fit: "shrink",
    });
  });
  slide.addText("说明：若团队人数较少，可在答辩中说明“一人承担多角色”，重点展示能力匹配，而不是强行拼出完整组织架构。", {
    x: 4.88,
    y: 6.02,
    w: 7.58,
    h: 0.32,
    fontFace: FONTS.body,
    fontSize: 8.8,
    color: COLORS.faint,
    margin: 0,
    fit: "shrink",
  });
}

function roadmapSlide(pptx) {
  const slide = createContentSlide(pptx, {
    pageNum: 14,
    section: "P14 / 路线图",
    badge: "用户待补充",
    title: "下一步：从可演示走向可试点、可转化、可复制",
    conclusion: "AetherGuard 的下一阶段重点，不是继续堆功能，而是把现有平台能力打磨成可试点验证的完整方案。",
  });

  slide.addShape("line", {
    x: 1.2,
    y: 2.72,
    w: 10.8,
    h: 0,
    line: { color: COLORS.blue, pt: 1.4 },
  });
  const roadmap = [
    [1.6, COLORS.green, "短期", "补齐演示链路\n完善答辩材料"],
    [5.0, COLORS.blue, "中期", "寻找试点场景\n沉淀小规模案例"],
    [8.4, COLORS.amber, "长期", "围绕私有部署、设备联动\n和生态接口持续演进"],
  ];
  roadmap.forEach(([x, color, title, body]) => {
    slide.addShape("ellipse", {
      x,
      y: 2.46,
      w: 0.5,
      h: 0.5,
      fill: { color },
      line: { color, pt: 1 },
    });
    slide.addText(title, {
      x: x - 0.15,
      y: 3.08,
      w: 0.8,
      h: 0.22,
      fontFace: FONTS.body,
      fontSize: 10,
      bold: true,
      color: COLORS.text,
      align: "center",
      margin: 0,
    });
    slide.addText(body, {
      x: x - 0.9,
      y: 3.38,
      w: 2.3,
      h: 0.62,
      fontFace: FONTS.body,
      fontSize: 9.5,
      color: COLORS.muted,
      align: "center",
      margin: 0,
      fit: "shrink",
    });
  });

  addPanel(slide, { x: 0.6, y: 4.72, w: 6.95, h: 1.55, title: "总结" });
  slide.addText("AetherGuard 已经具备平台雏形、连续页面和可验证材料。对双创项目而言，它同时回答了三个问题：问题真实存在、方案已经成形、后续具备继续打磨成试点产品的可能。", {
    x: 0.82,
    y: 5.08,
    w: 6.5,
    h: 0.66,
    fontFace: FONTS.body,
    fontSize: 10.2,
    color: COLORS.text,
    margin: 0,
    fit: "shrink",
  });
  slide.addText("守望流量，安抵未来", {
    x: 0.82,
    y: 5.78,
    w: 2.8,
    h: 0.22,
    fontFace: FONTS.heading,
    fontSize: 14,
    bold: true,
    color: COLORS.greenDark,
    margin: 0,
  });

  addPanel(slide, { x: 7.9, y: 4.72, w: 4.83, h: 1.55, title: "后续补充占位", fill: COLORS.white });
  addPlaceholderField(slide, "试点单位 / 场景待补", 8.12, 5.06, 4.39);
  addPlaceholderField(slide, "软著编号 / 知识产权状态待补", 8.12, 5.52, 4.39);
}

function buildPresentation() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "OpenAI Codex";
  pptx.company = "AetherGuard Project Team";
  pptx.subject = "AetherGuard 双创答辩";
  pptx.title = "AetherGuard 双创答辩演示稿";
  pptx.lang = "zh-CN";
  pptx.theme = {
    headFontFace: FONTS.heading,
    bodyFontFace: FONTS.body,
  };

  coverSlide(pptx);
  painSlide(pptx);
  definitionSlide(pptx);
  agentSlide(pptx);
  esp32Slide(pptx);
  aiSlide(pptx);
  architectureSlide(pptx);
  evidenceGridSlide(pptx);
  comparisonSlide(pptx);
  marketSlide(pptx);
  businessSlide(pptx);
  resultsSlide(pptx);
  teamSlide(pptx);
  roadmapSlide(pptx);

  return pptx.writeFile({ fileName: OUTPUT_FILE, compression: true });
}

buildPresentation()
  .then(() => {
    console.log(`Generated PPTX: ${OUTPUT_FILE}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
