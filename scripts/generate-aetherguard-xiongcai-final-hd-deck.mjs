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

const slides = [
  {
    title: "AetherGuard",
    kicker: "雄才杯2026决赛 · 聚雄才 创未来",
    claim: "面向雄安数字基础设施的智能服务器安全防御平台。",
    bullets: ["新一代信息技术", "人工智能软件与系统服务", "服务器安全", "ESP32 物理确认门"],
    screenshot: "02-dashboard.png",
    screenshotLabel: "控制台总览",
    speakerNote: "开场先点明赛题匹配：AetherGuard 面向雄安数字基础设施安全，用 Agent、AI 和 ESP32 补上高危操作可信确认断点。",
    evidenceLevel: "repo",
    tone: "dark",
    accent: "cyan",
    stat: { value: "4", label: "层防护闭环", note: "控制平面 + Agent + AI + ESP32" },
    visual: "heroImage",
  },
  {
    title: "补上可信确认断点",
    kicker: "一句话价值",
    claim: "我们不是多做一个安全控制台，而是补上关键服务器高危操作的可信确认断点。",
    bullets: [
      "远程账号或服务器权限失守时，纯软件确认容易被绕过",
      "AetherGuard 把危险动作接入串口硬件确认，要求人到现场按键",
      "“0 远程绕过”只作为物理确认机制的设计目标，不写成性能承诺",
    ],
    speakerNote: "这一页给评委留下核心记忆点：安全确认从远程软件权限回到物理现场。",
    evidenceLevel: "repo",
    tone: "dark",
    accent: "cyan",
    stat: { value: "0", label: "远程绕过目标", note: "危险动作必须现场确认" },
    visual: "trustFlow",
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
    speakerNote: "把痛点拉回雄安，不讲泛安全大市场，讲新区数字基础设施和园区企业的采用障碍。",
    evidenceLevel: "inferred",
    tone: "light",
    accent: "cyan",
    visual: "scenarioCards",
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
    speakerNote: "这一页讲系统结构，承接后面三页核心技术，不要展开过多实现细节。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "cyan",
    visual: "architectureFlow",
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
    screenshot: "03-agents.png",
    screenshotLabel: "Agent 管理界面",
    speakerNote: "对应评审重点中的核心技术和可实现性：主机侧防护已有产品界面支撑。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "cyan",
    stat: { value: "Agent", label: "主机侧内生防护", note: "防护贴近业务运行现场" },
    visual: "singleImage",
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
    screenshot: "07-devices.png",
    screenshotLabel: "硬件网关管理",
    speakerNote: "这是决赛重点页。用琥珀橙形成视觉停顿，强调原创性和物理可信。",
    evidenceLevel: "repo",
    tone: "hardware",
    accent: "amber",
    stat: { value: "ESP32", label: "物理可信确认", note: "串口硬件门，现场按键确认" },
    visual: "singleImage",
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
    screenshot: "05-agent-monitor.png",
    screenshotLabel: "AI 与 Agent 监控",
    speakerNote: "承接雄才杯赛道方向，避免把 AI 讲成口号，讲成可配置、可验证的工程闭环。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "purple",
    stat: { value: "AI", label: "可验证判断", note: "监控、演练、复盘闭环" },
    visual: "singleImage",
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
    screenshots: [
      { file: "02-dashboard.png", label: "总览" },
      { file: "11-deployment.png", label: "部署" },
      { file: "12-scanner.png", label: "扫描" },
      { file: "14-alerts.png", label: "告警" },
      { file: "17-admin.png", label: "后台" },
      { file: "07-devices.png", label: "设备" },
    ],
    speakerNote: "这页回答评委的可实现性问题：不是只讲概念，已有产品链路可演示。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "green",
    stat: { value: "6+", label: "产品界面", note: "已有运行截图" },
    visual: "evidenceWall",
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
    speakerNote: "路线图不要贪大，成果转化重点是从演示走向雄安试点。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "green",
    visual: "timeline",
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
    speakerNote: "商业模式只写方向性表达，不承诺未经验证的收入数字。",
    evidenceLevel: "inferred",
    tone: "light",
    accent: "green",
    visual: "businessModel",
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
    speakerNote: "这一页明确回到雄安，回答为什么值得新区支持和对接资源。",
    evidenceLevel: "inferred",
    tone: "light",
    accent: "purple",
    visual: "xionganEntrances",
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
    speakerNote: "最后回到评委关心的问题：为什么值得支持，答案是差异化明确且能继续转化。",
    evidenceLevel: "inferred",
    tone: "dark",
    accent: "cyan",
    stat: { value: "4", label: "个决赛答案", note: "技术、产品、转化、团队" },
    visual: "closingFlow",
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
    speakerNote: "只在评委追问架构时打开，不进入默认 8-10 分钟主线。",
    evidenceLevel: "repo",
    tone: "dark",
    accent: "purple",
    visual: "appendixArchitecture",
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
    speakerNote: "这页只服务问答和材料补充，不默认展示。",
    evidenceLevel: "placeholder",
    tone: "light",
    accent: "green",
    visual: "teamPlaceholder",
  },
];

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

function isDark(slide) {
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

function addShape(slide, shape, options) {
  const {
    fill = COLORS.white,
    transparency = 0,
    lineColor = fill,
    linePt = 0,
    lineTransparency = 0,
    shadow,
    ...rest
  } = options;
  slide.addShape(shape, {
    ...rest,
    line: { color: noHash(lineColor), pt: linePt, transparency: lineTransparency },
    fill: { color: noHash(fill), transparency },
    shadow,
  });
}

function addRect(slide, options) {
  addShape(slide, "rect", options);
}

function addRoundRect(slide, options) {
  addShape(slide, "roundRect", { rectRadius: 0.04, ...options });
}

function addCircle(slide, options) {
  addShape(slide, "ellipse", options);
}

function addLine(slide, x1, y1, x2, y2, color, options = {}) {
  slide.addShape("line", {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    line: {
      color: noHash(color),
      pt: options.pt || 1,
      transparency: options.transparency || 0,
      beginArrowType: options.beginArrowType,
      endArrowType: options.endArrowType,
    },
  });
}

function background(slide, deckSlide) {
  const accent = accentOf(deckSlide);
  const dark = isDark(deckSlide);
  slide.background = { color: deckSlide.tone === "hardware" ? COLORS.hardwareDark : dark ? COLORS.deepCover : COLORS.lightBg };
  if (deckSlide.tone === "hardware") {
    addRect(slide, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: COLORS.deepCover, transparency: 8 });
    addCircle(slide, { x: 9.2, y: -0.8, w: 4.6, h: 4.6, fill: COLORS.hardwareAmber, transparency: 82 });
  } else if (dark) {
    addRect(slide, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: COLORS.deepSection, transparency: 18 });
    addCircle(slide, { x: 9.2, y: -0.85, w: 4.8, h: 4.8, fill: accent, transparency: 84 });
  } else {
    addRect(slide, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: COLORS.white, transparency: 34 });
    addCircle(slide, { x: 9.7, y: -0.6, w: 4.1, h: 4.1, fill: accent, transparency: 91 });
  }
  const grid = dark ? COLORS.mutedLight : COLORS.panelNavy;
  for (let x = 0; x <= SLIDE_W; x += 0.48) addLine(slide, x, 0, x, SLIDE_H, grid, { pt: 0.22, transparency: dark ? 88 : 93 });
  for (let y = 0; y <= SLIDE_H; y += 0.48) addLine(slide, 0, y, SLIDE_W, y, grid, { pt: 0.22, transparency: dark ? 88 : 93 });
  addLine(slide, 0, 0.04, SLIDE_W, 0.04, accent, { pt: 4.3 });
}

function header(slide, deckSlide, index, total) {
  const dark = isDark(deckSlide);
  const accent = accentOf(deckSlide);
  const textColor = dark ? COLORS.white : COLORS.darkText;
  addRoundRect(slide, {
    x: 0.55,
    y: 0.34,
    w: 0.8,
    h: 0.28,
    fill: dark ? COLORS.deepCover : COLORS.white,
    transparency: dark ? 8 : 0,
    lineColor: accent,
    linePt: 1,
    shadow: { type: "outer", color: "000000", opacity: 0.12, blur: 1.2, angle: 45, distance: 1 },
  });
  addText(slide, `${String(index + 1).padStart(2, "0")} / ${total}`, {
    x: 0.66,
    y: 0.44,
    w: 0.58,
    h: 0.1,
    fontFace: FONTS.mono,
    fontSize: 6.6,
    bold: true,
    align: "center",
    color: textColor,
  });
  const badge = evidenceMap[deckSlide.evidenceLevel] || evidenceMap.inferred;
  addRoundRect(slide, {
    x: 1.52,
    y: 0.34,
    w: 1.24,
    h: 0.28,
    fill: dark ? COLORS.deepCover : COLORS.white,
    transparency: dark ? 10 : 0,
    lineColor: badge.color,
    linePt: 1,
  });
  addText(slide, badge.label, {
    x: 1.76,
    y: 0.43,
    w: 0.76,
    h: 0.1,
    fontSize: 6.8,
    bold: true,
    align: "center",
    color: dark ? COLORS.white : badge.color,
  });
  addRoundRect(slide, {
    x: 9.35,
    y: 0.36,
    w: 3.28,
    h: 0.32,
    fill: dark ? COLORS.deepCover : COLORS.white,
    transparency: dark ? 25 : 4,
    lineColor: accent,
    linePt: 1,
    lineTransparency: 25,
  });
  addText(slide, "雄才杯2026决赛 · 聚雄才 创未来", {
    x: 9.62,
    y: 0.465,
    w: 2.72,
    h: 0.1,
    fontSize: 6.8,
    bold: true,
    align: "center",
    color: textColor,
  });
}

function footer(slide, deckSlide, index, total) {
  const dark = isDark(deckSlide);
  const accent = accentOf(deckSlide);
  const y = 6.93;
  addLine(slide, 0.55, y - 0.12, 12.8, y - 0.12, dark ? COLORS.mutedLight : COLORS.panelNavy, { pt: 0.7, transparency: dark ? 78 : 82 });
  addCircle(slide, { x: 0.55, y: y - 0.02, w: 0.13, h: 0.13, fill: accent });
  addText(slide, "雄安落地价值", {
    x: 0.78,
    y,
    w: 2,
    h: 0.16,
    fontSize: 7.2,
    color: dark ? COLORS.mutedLight : COLORS.mutedDark,
  });
  addText(slide, `AetherGuard · 雄安落地价值 · ${String(index + 1).padStart(2, "0")} / ${total}`, {
    x: 10.15,
    y,
    w: 2.65,
    h: 0.16,
    fontSize: 7.2,
    bold: true,
    align: "right",
    color: dark ? COLORS.white : COLORS.darkText,
  });
}

function titleBlock(slide, deckSlide, opts = {}) {
  const dark = isDark(deckSlide);
  const accent = accentOf(deckSlide);
  const x = opts.x ?? 0.58;
  const y = opts.y ?? 0.98;
  const w = opts.w ?? 5.4;
  addText(slide, deckSlide.kicker, {
    x,
    y,
    w,
    h: 0.16,
    fontSize: 8.2,
    bold: true,
    color: accent,
  });
  addText(slide, deckSlide.title, {
    x,
    y: y + 0.48,
    w,
    h: opts.titleH ?? 0.52,
    fontFace: FONTS.heading,
    fontSize: opts.titleSize ?? 27,
    bold: true,
    breakLine: true,
    color: dark ? COLORS.white : COLORS.darkText,
  });
  addText(slide, deckSlide.claim, {
    x,
    y: y + (opts.claimY ?? 1.28),
    w,
    h: opts.claimH ?? 0.62,
    fontSize: opts.claimSize ?? 12.4,
    breakLine: true,
    color: dark ? COLORS.mutedLight : COLORS.darkText,
    margin: 0.01,
    fit: "shrink",
  });
}

function bullets(slide, deckSlide, frame) {
  const dark = isDark(deckSlide);
  const accent = accentOf(deckSlide);
  const gap = frame.gap ?? 0.52;
  deckSlide.bullets.forEach((bullet, i) => {
    const y = frame.y + i * gap;
    addRoundRect(slide, {
      x: frame.x,
      y,
      w: frame.w,
      h: frame.itemH ?? 0.44,
      fill: dark ? COLORS.panelNavy : COLORS.white,
      transparency: dark ? 22 : 4,
      lineColor: accent,
      linePt: 0.75,
      lineTransparency: dark ? 38 : 70,
    });
    addCircle(slide, { x: frame.x + 0.22, y: y + 0.17, w: 0.1, h: 0.1, fill: accent });
    addText(slide, bullet, {
      x: frame.x + 0.43,
      y: y + 0.135,
      w: frame.w - 0.58,
      h: 0.13,
      fontSize: frame.fontSize ?? 8.6,
      color: dark ? COLORS.white : COLORS.darkText,
      fit: "shrink",
    });
  });
}

function statPoster(slide, deckSlide, frame) {
  if (!deckSlide.stat) return;
  const dark = isDark(deckSlide);
  const accent = accentOf(deckSlide);
  addRoundRect(slide, {
    ...frame,
    fill: dark ? COLORS.deepCover : COLORS.white,
    transparency: dark ? 10 : 0,
    lineColor: accent,
    linePt: 1.1,
    shadow: { type: "outer", color: "000000", opacity: dark ? 0.28 : 0.12, blur: 2, angle: 45, distance: 2 },
  });
  addText(slide, deckSlide.stat.value, {
    x: frame.x + 0.25,
    y: frame.y + 0.22,
    w: frame.w - 0.5,
    h: 0.38,
    fontFace: FONTS.mono,
    fontSize: 23,
    bold: true,
    color: accent,
  });
  addText(slide, deckSlide.stat.label, {
    x: frame.x + 0.25,
    y: frame.y + 0.78,
    w: frame.w - 0.5,
    h: 0.17,
    fontSize: 9.6,
    bold: true,
    color: dark ? COLORS.white : COLORS.darkText,
  });
  addText(slide, deckSlide.stat.note, {
    x: frame.x + 0.25,
    y: frame.y + 1.13,
    w: frame.w - 0.5,
    h: 0.16,
    fontSize: 7.6,
    color: dark ? COLORS.mutedLight : COLORS.mutedDark,
  });
}

function imageSize(filePath) {
  const buf = fs.readFileSync(filePath);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function containRect(filePath, frame) {
  const { width, height } = imageSize(filePath);
  const imageRatio = width / height;
  const frameRatio = frame.w / frame.h;
  if (imageRatio > frameRatio) {
    const h = frame.w / imageRatio;
    return { x: frame.x, y: frame.y + (frame.h - h) / 2, w: frame.w, h };
  }
  const w = frame.h * imageRatio;
  return { x: frame.x + (frame.w - w) / 2, y: frame.y, w, h: frame.h };
}

function screenshotFrame(slide, file, label, frame, deckSlide, options = {}) {
  const img = ensureAsset(shot(file));
  const dark = isDark(deckSlide);
  const accent = accentOf(deckSlide);
  addRoundRect(slide, {
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    fill: dark ? COLORS.panelNavy : COLORS.white,
    transparency: dark ? 0 : 0,
    lineColor: options.accentLine || COLORS.panelNavy,
    linePt: options.linePt ?? 1.1,
    shadow: { type: "outer", color: "000000", opacity: dark ? 0.35 : 0.18, blur: 2.5, angle: 45, distance: 2 },
  });
  addRoundRect(slide, {
    x: frame.x + 0.12,
    y: frame.y + 0.12,
    w: frame.w - 0.24,
    h: 0.34,
    fill: COLORS.deepCover,
    lineColor: COLORS.deepCover,
    linePt: 0,
  });
  [COLORS.hardwareAmber, COLORS.cyan, COLORS.successGreen].forEach((color, idx) => {
    addCircle(slide, { x: frame.x + 0.33 + idx * 0.18, y: frame.y + 0.24, w: 0.075, h: 0.075, fill: color });
  });
  const imageFrame = { x: frame.x + 0.14, y: frame.y + 0.52, w: frame.w - 0.28, h: frame.h - 0.66 };
  const rect = options.cover ? imageFrame : containRect(img, imageFrame);
  slide.addImage({ path: img, ...rect });
  addLine(slide, frame.x + 0.12, frame.y + 0.48, frame.x + frame.w - 0.12, frame.y + 0.48, accent, { pt: 1, transparency: 55 });
  addText(slide, label, {
    x: frame.x + 0.28,
    y: frame.y + frame.h - 0.28,
    w: frame.w - 0.56,
    h: 0.13,
    fontSize: 7.6,
    bold: true,
    color: options.labelColor || (dark ? COLORS.white : COLORS.panelNavy),
  });
}

function heroImage(slide, deckSlide) {
  titleBlock(slide, deckSlide, { x: 0.58, y: 0.95, w: 5.6, titleSize: 30, claimY: 1.25 });
  bullets(slide, deckSlide, { x: 0.58, y: 3.02, w: 5.45, itemH: 0.42, gap: 0.54, fontSize: 8.8 });
  screenshotFrame(slide, deckSlide.screenshot, deckSlide.screenshotLabel, { x: 6.14, y: 1.55, w: 6.72, h: 3.65 }, deckSlide);
  statPoster(slide, deckSlide, { x: 6.14, y: 5.35, w: 2.28, h: 1.05 });
}

function singleImage(slide, deckSlide) {
  titleBlock(slide, deckSlide, { x: 0.58, y: 0.95, w: 5.72, titleSize: 26.5, claimY: 1.2, claimH: 0.58 });
  bullets(slide, deckSlide, { x: 0.58, y: 3.02, w: 5.45, itemH: 0.4, gap: 0.5, fontSize: 8.2 });
  screenshotFrame(slide, deckSlide.screenshot, deckSlide.screenshotLabel, { x: 6.04, y: 1.62, w: 6.82, h: 3.72 }, deckSlide, { accentLine: accentOf(deckSlide) });
  statPoster(slide, deckSlide, { x: 6.04, y: 5.47, w: 2.35, h: 1.0 });
}

function trustFlow(slide, deckSlide) {
  titleBlock(slide, deckSlide, { x: 0.58, y: 0.95, w: 6.0, titleSize: 29, claimY: 1.18, claimH: 0.65 });
  bullets(slide, deckSlide, { x: 0.58, y: 3.08, w: 5.92, itemH: 0.45, gap: 0.58, fontSize: 8.6 });
  const accent = accentOf(deckSlide);
  const frame = { x: 6.95, y: 1.62, w: 5.5, h: 4.6 };
  addRoundRect(slide, { ...frame, fill: COLORS.panelNavy, transparency: 18, lineColor: accent, linePt: 1.15 });
  const steps = ["高危动作", "平台请求", "ESP32 显示", "现场按键", "审计执行"];
  steps.forEach((step, idx) => {
    const y = frame.y + 0.45 + idx * 0.76;
    const c = idx === 2 ? COLORS.hardwareAmber : idx === 4 ? COLORS.successGreen : COLORS.cyan;
    addCircle(slide, { x: frame.x + 0.5, y, w: 0.42, h: 0.42, fill: c });
    addText(slide, String(idx + 1), { x: frame.x + 0.64, y: y + 0.14, w: 0.12, h: 0.08, fontSize: 6, bold: true, color: COLORS.white });
    addRoundRect(slide, { x: frame.x + 1.12, y: y - 0.03, w: 3.8, h: 0.48, fill: COLORS.deepCover, transparency: 5, lineColor: c, linePt: 1 });
    addText(slide, step, { x: frame.x + 1.42, y: y + 0.14, w: 3.1, h: 0.12, fontSize: 10, bold: true, color: COLORS.white });
    if (idx < steps.length - 1) addLine(slide, frame.x + 0.71, y + 0.44, frame.x + 0.71, y + 0.74, c, { pt: 1.15, endArrowType: "triangle" });
  });
  statPoster(slide, deckSlide, { x: 10.05, y: 5.18, w: 2.28, h: 1.1 });
}

function scenarioCards(slide, deckSlide) {
  titleBlock(slide, deckSlide, { x: 0.58, y: 0.95, w: 5.75, titleSize: 25.8, claimY: 1.22 });
  bullets(slide, deckSlide, { x: 0.58, y: 3.02, w: 5.45, itemH: 0.4, gap: 0.5, fontSize: 8.1 });
  const items = [
    { value: "数字城市", label: "基础设施", note: "关键系统运维与审计", color: COLORS.cyan },
    { value: "园区企业", label: "试点入口", note: "从中小团队服务器切入", color: COLORS.successGreen },
    { value: "信创安全", label: "私有化", note: "数据留在本地边界", color: COLORS.hardwareAmber },
    { value: "AI 应用", label: "智能治理", note: "监控、演练、复盘", color: COLORS.purple },
  ];
  metricCards(slide, deckSlide, items, { x: 6.45, y: 1.42, w: 6.22, h: 4.82 }, 2);
}

function architectureFlow(slide, deckSlide) {
  titleBlock(slide, deckSlide, { x: 0.58, y: 0.95, w: 5.75, titleSize: 25.8, claimY: 1.22 });
  bullets(slide, deckSlide, { x: 0.58, y: 3.02, w: 5.45, itemH: 0.4, gap: 0.5, fontSize: 8.1 });
  const frame = { x: 6.45, y: 1.45, w: 6.2, h: 4.8 };
  flow(slide, deckSlide, ["控制台", "Agent", "AI 判断", "ESP32 确认", "审计证据"], frame);
}

function flow(slide, deckSlide, steps, frame) {
  const dark = isDark(deckSlide);
  addRoundRect(slide, {
    ...frame,
    fill: dark ? COLORS.panelNavy : COLORS.white,
    transparency: dark ? 24 : 4,
    lineColor: accentOf(deckSlide),
    linePt: 1,
    lineTransparency: 40,
  });
  const cardW = 0.96;
  const gap = (frame.w - cardW * steps.length) / (steps.length + 1);
  steps.forEach((step, idx) => {
    const x = frame.x + gap + idx * (cardW + gap);
    const y = frame.y + 1.68;
    const color = idx === 2 ? COLORS.purple : idx === 3 ? COLORS.hardwareAmber : idx === 4 ? COLORS.successGreen : COLORS.cyan;
    addCircle(slide, { x: x + 0.31, y: y - 0.5, w: 0.34, h: 0.34, fill: color });
    addText(slide, String(idx + 1), { x: x + 0.43, y: y - 0.38, w: 0.1, h: 0.08, fontSize: 5.4, bold: true, color: COLORS.white });
    addRoundRect(slide, { x, y, w: cardW, h: 0.9, fill: dark ? COLORS.deepCover : COLORS.lightBg, transparency: dark ? 10 : 0, lineColor: color, linePt: 1.05 });
    addText(slide, step, { x: x + 0.1, y: y + 0.35, w: cardW - 0.2, h: 0.12, fontSize: 8, bold: true, align: "center", color: dark ? COLORS.white : COLORS.darkText, breakLine: true });
    if (idx < steps.length - 1) addLine(slide, x + cardW + 0.04, y + 0.45, x + cardW + gap - 0.07, y + 0.45, color, { pt: 1.2, endArrowType: "triangle" });
  });
}

function evidenceWall(slide, deckSlide) {
  titleBlock(slide, deckSlide, { x: 0.58, y: 0.9, w: 5.8, titleSize: 25.8, claimY: 1.2 });
  bullets(slide, deckSlide, { x: 0.58, y: 2.9, w: 5.45, itemH: 0.38, gap: 0.47, fontSize: 7.9 });
  statPoster(slide, deckSlide, { x: 0.58, y: 5.15, w: 2.45, h: 1.15 });
  screenshotFrame(slide, "02-dashboard.png", "主控制台：运行态总览", { x: 6.17, y: 1.34, w: 6.62, h: 3.62 }, deckSlide);
  screenshotFrame(slide, "07-devices.png", "设备", { x: 6.17, y: 5.12, w: 2.05, h: 1.34 }, deckSlide);
  screenshotFrame(slide, "14-alerts.png", "告警", { x: 8.47, y: 5.12, w: 2.05, h: 1.34 }, deckSlide);
  screenshotFrame(slide, "17-admin.png", "后台", { x: 10.74, y: 5.12, w: 2.05, h: 1.34 }, deckSlide);
}

function timeline(slide, deckSlide) {
  titleBlock(slide, deckSlide, { x: 0.58, y: 0.95, w: 5.75, titleSize: 25.8, claimY: 1.22 });
  bullets(slide, deckSlide, { x: 0.58, y: 3.02, w: 5.45, itemH: 0.4, gap: 0.5, fontSize: 8.1 });
  const frame = { x: 6.45, y: 1.45, w: 6.2, h: 4.8 };
  addRoundRect(slide, { ...frame, fill: COLORS.white, transparency: 2, lineColor: COLORS.successGreen, linePt: 1 });
  const items = [
    ["现在", "可演示平台与硬件原型"],
    ["决赛后", "打磨部署、确认、审计闭环"],
    ["试点期", "接入真实服务器场景"],
    ["复制期", "沉淀交付包和行业案例"],
  ];
  addLine(slide, frame.x + 0.7, frame.y + 0.65, frame.x + 0.7, frame.y + frame.h - 0.62, COLORS.cyan, { pt: 1.35 });
  items.forEach((item, idx) => {
    const y = frame.y + 0.65 + idx * 1.05;
    const color = [COLORS.cyan, COLORS.purple, COLORS.hardwareAmber, COLORS.successGreen][idx];
    addCircle(slide, { x: frame.x + 0.52, y: y - 0.18, w: 0.36, h: 0.36, fill: color });
    addRoundRect(slide, { x: frame.x + 1.08, y: y - 0.24, w: 4.45, h: 0.55, fill: COLORS.lightBg, lineColor: color, linePt: 1 });
    addText(slide, item[0], { x: frame.x + 1.28, y: y - 0.06, w: 0.9, h: 0.12, fontSize: 8.4, bold: true, color });
    addText(slide, item[1], { x: frame.x + 2.25, y: y - 0.06, w: 3.05, h: 0.12, fontSize: 8, color: COLORS.darkText });
  });
}

function businessModel(slide, deckSlide) {
  titleBlock(slide, deckSlide, { x: 0.58, y: 0.95, w: 5.75, titleSize: 25.8, claimY: 1.22 });
  bullets(slide, deckSlide, { x: 0.58, y: 3.02, w: 5.45, itemH: 0.4, gap: 0.5, fontSize: 8.1 });
  const items = [
    { value: "订阅", label: "软件平台", note: "持续运营与升级", color: COLORS.cyan },
    { value: "硬件", label: "物理确认", note: "强化差异化和客单价", color: COLORS.hardwareAmber },
    { value: "交付", label: "私有化部署", note: "适配敏感行业", color: COLORS.purple },
    { value: "服务", label: "安全运营", note: "试点后沉淀案例", color: COLORS.successGreen },
  ];
  metricCards(slide, deckSlide, items, { x: 6.45, y: 1.42, w: 6.22, h: 4.82 }, 2);
}

function xionganEntrances(slide, deckSlide) {
  titleBlock(slide, deckSlide, { x: 0.58, y: 0.95, w: 5.75, titleSize: 25.8, claimY: 1.22 });
  bullets(slide, deckSlide, { x: 0.58, y: 3.02, w: 5.45, itemH: 0.4, gap: 0.5, fontSize: 8.1 });
  const items = [
    { value: "园区企业", label: "试点入口", note: "服务器和应用链路保护", color: COLORS.cyan },
    { value: "数字城市", label: "基础设施", note: "高危操作确认与审计", color: COLORS.purple },
    { value: "信创安全", label: "私有化", note: "数据留在本地边界", color: COLORS.hardwareAmber },
    { value: "AI 安全", label: "智能应用", note: "监控、演练、复盘闭环", color: COLORS.successGreen },
  ];
  metricCards(slide, deckSlide, items, { x: 6.45, y: 1.42, w: 6.22, h: 4.82 }, 2);
}

function closingFlow(slide, deckSlide) {
  titleBlock(slide, deckSlide, { x: 0.58, y: 0.95, w: 5.75, titleSize: 27.5, claimY: 1.22 });
  bullets(slide, deckSlide, { x: 0.58, y: 3.02, w: 5.45, itemH: 0.4, gap: 0.5, fontSize: 8.1 });
  const frame = { x: 6.45, y: 1.48, w: 6.2, h: 4.78 };
  flow(slide, deckSlide, ["核心技术", "产品证据", "成果转化", "商业模式", "雄安落地"], frame);
  statPoster(slide, deckSlide, { x: 10.35, y: 5.18, w: 2.22, h: 1.08 });
}

function appendixArchitecture(slide, deckSlide) {
  titleBlock(slide, deckSlide, { x: 0.58, y: 0.95, w: 5.75, titleSize: 26.5, claimY: 1.22 });
  bullets(slide, deckSlide, { x: 0.58, y: 3.02, w: 5.45, itemH: 0.4, gap: 0.5, fontSize: 8.1 });
  const frame = { x: 6.45, y: 1.48, w: 6.2, h: 4.78 };
  flow(slide, deckSlide, ["React 控制台", "Node 控制平面", "数据与缓存", "Agent / Site / ESP32", "审计证据"], frame);
}

function teamPlaceholder(slide, deckSlide) {
  titleBlock(slide, deckSlide, { x: 0.58, y: 0.95, w: 5.75, titleSize: 25.8, claimY: 1.22 });
  bullets(slide, deckSlide, { x: 0.58, y: 3.02, w: 5.45, itemH: 0.4, gap: 0.5, fontSize: 8.1 });
  const items = [
    { value: "待补", label: "团队名称", note: "不虚构参赛主体", color: COLORS.cyan },
    { value: "待补", label: "负责人", note: "按真实报名信息填写", color: COLORS.purple },
    { value: "待补", label: "知识产权", note: "只填已申请或已授权状态", color: COLORS.hardwareAmber },
    { value: "待补", label: "试点", note: "有材料后再写具体单位", color: COLORS.successGreen },
  ];
  metricCards(slide, deckSlide, items, { x: 6.45, y: 1.42, w: 6.22, h: 4.82 }, 2);
}

function metricCards(slide, deckSlide, items, frame, cols) {
  const dark = isDark(deckSlide);
  const gap = 0.22;
  const rows = Math.ceil(items.length / cols);
  const cardW = (frame.w - gap * (cols - 1)) / cols;
  const cardH = (frame.h - gap * (rows - 1)) / rows;
  items.forEach((item, idx) => {
    const x = frame.x + (idx % cols) * (cardW + gap);
    const y = frame.y + Math.floor(idx / cols) * (cardH + gap);
    addRoundRect(slide, {
      x,
      y,
      w: cardW,
      h: cardH,
      fill: dark ? COLORS.panelNavy : COLORS.white,
      transparency: dark ? 16 : 0,
      lineColor: item.color,
      linePt: 1,
      shadow: { type: "outer", color: "000000", opacity: dark ? 0.24 : 0.1, blur: 1.8, angle: 45, distance: 1.3 },
    });
    addCircle(slide, { x: x + 0.28, y: y + 0.28, w: 0.44, h: 0.44, fill: item.color });
    addText(slide, item.label.slice(0, 1), { x: x + 0.42, y: y + 0.43, w: 0.12, h: 0.08, fontSize: 6.2, bold: true, color: COLORS.white });
    addText(slide, item.value, { x: x + 0.28, y: y + 0.98, w: cardW - 0.56, h: 0.3, fontSize: 18, bold: true, color: item.color, fit: "shrink" });
    addText(slide, item.label, { x: x + cardW - 1.35, y: y + 0.35, w: 1.05, h: 0.1, fontSize: 7.4, bold: true, align: "right", color: dark ? COLORS.mutedLight : COLORS.mutedDark });
    addText(slide, item.note, { x: x + 0.28, y: y + 1.62, w: cardW - 0.56, h: 0.15, fontSize: 7.4, color: dark ? COLORS.mutedLight : COLORS.mutedDark });
  });
}

const renderers = {
  heroImage,
  trustFlow,
  scenarioCards,
  architectureFlow,
  singleImage,
  evidenceWall,
  timeline,
  businessModel,
  xionganEntrances,
  closingFlow,
  appendixArchitecture,
  teamPlaceholder,
};

function addDeckSlide(deck, deckSlide, index, total) {
  const slide = deck.addSlide();
  background(slide, deckSlide);
  header(slide, deckSlide, index, total);
  const renderer = renderers[deckSlide.visual];
  if (!renderer) throw new Error(`No renderer for ${deckSlide.visual}`);
  renderer(slide, deckSlide, index, total);
  footer(slide, deckSlide, index, total);
  slide.addNotes(deckSlide.speakerNote);
}

async function buildPresentation() {
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
  slides.forEach((slide, index) => addDeckSlide(deck, slide, index, slides.length));
  await deck.writeFile({ fileName: OUTPUT_FILE, compression: true });
}

buildPresentation()
  .then(() => {
    console.log(`Generated PPTX: ${OUTPUT_FILE}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
