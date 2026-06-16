import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "docs", "generated");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "AetherGuard-雄才杯决赛版-雅典学院-原生组件版.pptx");
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, "frontend", "public", "pitch");

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

const COLORS = {
  deepCover: "080E1C",
  deepSection: "0F1E3A",
  panelNavy: "162B52",
  lightBg: "F0F6FF",
  white: "FFFFFF",
  cyan: "00BFFF",
  purple: "7C4DFF",
  hardwareAmber: "FF8C00",
  successGreen: "00E5A0",
  darkText: "0F1E3A",
  mutedDark: "526B8B",
  mutedLight: "C5D8F0",
  slateLine: "B8C7DA",
  hardwareDark: "160B04",
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

const SHAPES = {
  rect: "rect",
  roundRect: "roundRect",
  ellipse: "ellipse",
  line: "line",
};

const evidenceMap = {
  repo: { label: "已有原型证据", color: COLORS.successGreen },
  inferred: { label: "推导表达", color: COLORS.hardwareAmber },
  placeholder: { label: "待补真实材料", color: COLORS.mutedDark },
};

const iconLabels = ["安", "算", "硬", "审", "试", "商", "园", "队"];

const slides = [
  {
    title: "AetherGuard",
    kicker: "雄才杯2026决赛项目",
    claim: "用 Agent + 雅典学院多智能体讨论 + ESP32 物理确认门，守住雄安数字基础设施中的关键服务器高危操作。",
    bullets: [
      "赛道匹配：新一代信息技术、人工智能软件与系统服务、信创安全",
      "核心问题：危险运维动作不能只依赖远程账号和软件权限确认",
      "差异化答案：AI 先多角色讨论判断，硬件再把确认拉回物理现场",
      "落地指向：园区企业服务器、数字城市基础设施、AI 应用安全",
    ],
    visual: { type: "image", src: "02-dashboard.png", caption: "控制台总览：已有可演示产品界面" },
    stat: { value: "4", label: "层安全闭环", note: "控制平面 + Agent + 雅典学院 + ESP32" },
    speakerNote: "开场不要只讲产品名，要先给评委一句判断：这是面向雄安数字基础设施的服务器安全项目，核心差异是 ESP32 物理确认门和雅典学院多智能体讨论。",
    evidenceLevel: "repo",
    tone: "dark",
    accent: "cyan",
    footerCue: "决赛开场：先给一句能记住的项目定义",
  },
  {
    title: "高危操作不能只靠远程权限确认",
    kicker: "一句话价值",
    claim: "一旦服务器账号或控制台权限失守，纯软件确认会变成同一条攻击链上的薄弱环节。",
    bullets: [
      "安装/卸载 Agent、擦除数据、关键配置变更，本质上都是高后果动作",
      "传统确认常停留在登录态、二次弹窗或远程审批，仍依赖同一套网络权限",
      "AetherGuard 要补的是“最后一步可信确认”而不是再做一个告警列表",
      "“0 远程绕过”只表述为机制设计目标，不写成未经验证的性能承诺",
    ],
    visual: { type: "flow", steps: ["高危动作", "平台请求", "ESP32 显示", "现场按键", "审计执行"] },
    stat: { value: "1", label: "个安全断点", note: "高危动作缺少独立可信确认" },
    speakerNote: "这一页要把问题讲得具体：我们不是泛泛讲服务器安全，而是锁定高危操作最后一步确认断点。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "cyan",
    footerCue: "评审问题：你解决的到底是哪一个安全断点",
  },
  {
    title: "雄安场景需要可控、可审计、可私有化",
    kicker: "雄安场景痛点",
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
        { value: "数字城市", label: "基础设施", note: "关键系统运维与审计" },
        { value: "园区企业", label: "试点入口", note: "从中小团队服务器切入" },
        { value: "信创安全", label: "本地部署", note: "数据留在本地边界" },
        { value: "AI 应用", label: "智能治理", note: "监控、演练、复盘闭环" },
      ],
    },
    speakerNote: "把痛点拉回雄安，不讲泛安全大市场，讲新区数字基础设施和园区企业的采用障碍。",
    evidenceLevel: "inferred",
    tone: "light",
    accent: "cyan",
    footerCue: "雄安价值：从新区真实采用场景切入",
  },
  {
    title: "方案是一条可演示的安全闭环",
    kicker: "解决方案",
    claim: "控制平面负责统一编排，Agent 贴近服务器现场，雅典学院负责多智能体讨论判断，ESP32 承接高危动作的物理确认。",
    bullets: [
      "控制台：统一管理节点、设备、扫描、告警、部署和审计",
      "Agent：把采集、执行和风险感知前移到业务服务器侧",
      "雅典学院：Socrates / Plato / Aristotle 多角色讨论，输出可追溯判断",
      "ESP32：只通过串口通信，让危险动作必须经过现场确认",
    ],
    visual: { type: "flow", steps: ["控制台", "Agent", "雅典学院", "ESP32 确认", "审计证据"] },
    stat: { value: "闭环", label: "发现到执行", note: "讨论、确认、留痕都在链路内" },
    speakerNote: "这里承上启下，不要展开底层细节，只让评委记住四个模块构成闭环，后面三页分别讲核心技术。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "cyan",
    footerCue: "系统闭环：控制平面 / Agent / 雅典学院 / ESP32",
  },
  {
    title: "Agent 把防护放到服务器现场",
    kicker: "核心技术一",
    claim: "Agent-Inside 不是边界工具拼接，而是把防护位置前移到业务服务器运行现场。",
    bullets: [
      "统一查看 Agent 心跳、资源状态、风险事件和节点详情",
      "适合覆盖多站点、多服务器实例和分布式业务节点",
      "与扫描、告警、审计联动，避免安全信息停留在孤立列表",
      "为后续高危操作确认提供受管节点、动作和证据上下文",
    ],
    visual: { type: "image", src: "03-agents.png", caption: "Agent 管理：主机侧状态与节点管理" },
    stat: { value: "Agent", label: "主机侧防护", note: "防护贴近业务运行现场" },
    speakerNote: "对应评审重点中的核心技术和可实现性：主机侧防护已有产品界面支撑。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "cyan",
    footerCue: "核心技术：不是边界工具拼接",
  },
  {
    title: "ESP32 是本项目最强差异化",
    kicker: "核心技术二",
    claim: "ESP32 把安全确认从远程软件权限拉回物理现场，形成独立于服务器网络权限的确认门。",
    bullets: [
      "ESP32 只通过 USB-TTL 串口通信，不暴露网络控制面",
      "协议采用 allow-list：AG:REQ -> AG:BEGIN / STEP / OK / ERR",
      "适用于安装/卸载 Agent、擦除数据、关键配置变更等危险动作",
      "当前表述为硬件原型和链路设计，不夸大为量产硬件或已规模部署",
    ],
    visual: { type: "hardwareProtocol" },
    stat: { value: "ESP32", label: "物理确认门", note: "串口通信 + 现场按键确认" },
    speakerNote: "这一页是冲奖记忆点。要把 ESP32 讲成可信确认机制，不要讲成普通硬件配件。",
    evidenceLevel: "repo",
    tone: "hardware",
    accent: "amber",
    footerCue: "最大差异：把确认动作拉回物理现场",
  },
  {
    title: "雅典学院让 AI 决策可讨论",
    kicker: "核心技术三",
    claim: "雅典学院不是单模型给结论，而是让红队、蓝队和仲裁智能体围绕安全事件进行结构化讨论，留下可审计的判断过程。",
    bullets: [
      "Socrates 红队智能体负责质疑风险、寻找绕过路径和攻击链假设",
      "Plato 蓝队智能体负责提出防护策略、处置建议和运维可行性判断",
      "Aristotle 仲裁智能体负责综合证据、冲突裁决和输出最终处置理由",
      "讨论记录可形成审计材料，避免单次模型判断黑箱化",
    ],
    visual: { type: "multiAgent" },
    stat: { value: "3", label: "类智能体角色", note: "红队、蓝队、仲裁协同判断" },
    speakerNote: "这是除 ESP32 之外的第二个技术亮点。讲清楚不是普通调用大模型，而是安全场景里的多角色讨论和可审计决策。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "purple",
    footerCue: "AI 亮点：多智能体讨论，而不是单模型黑箱结论",
  },
  {
    title: "原型已经能连续演示",
    kicker: "产品证据",
    claim: "AetherGuard 已有控制台、Agent、多智能体监控、设备、扫描、告警和后台页面，现场可按产品链路讲而不是按概念图讲。",
    bullets: [
      "已有 React 前端、Node/TypeScript 后端、Socket.IO 实时链路和硬件目录",
      "页面覆盖 Dashboard、Agents、Multi-Agent Monitor、Devices、Scanner、Alerts、Admin",
      "截图与网页演示用于证明连续链路，具体客户和试点单位未提供前不虚构",
      "产品证据页负责回答“能不能做出来、能不能演示”的评审问题",
    ],
    visual: {
      type: "evidenceWall",
      images: [
        { src: "02-dashboard.png", caption: "Dashboard" },
        { src: "03-agents.png", caption: "Agents" },
        { src: "05-agent-monitor.png", caption: "Multi-Agent Monitor" },
        { src: "07-devices.png", caption: "Devices" },
        { src: "12-scanner.png", caption: "Scanner" },
        { src: "14-alerts.png", caption: "Alerts" },
      ],
    },
    stat: { value: "6+", label: "可演示页面", note: "原型链路已覆盖核心模块" },
    speakerNote: "这一页回答评委的可实现性问题：不是只讲概念，已有产品链路可演示。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "green",
    footerCue: "产品证据：不要让评委觉得只是概念图",
  },
  {
    title: "成果转化从小试点开始",
    kicker: "成果转化路径",
    claim: "下一步不是扩大叙事，而是把原型演示链路打磨成可在雄安场景试点的交付包。",
    bullets: [
      "近期：打磨部署、硬件确认、审计证据和现场演示链路",
      "中期：选择 1-2 个服务器场景做小规模试点验证",
      "长期：沉淀私有化交付包、行业案例和安全运营服务能力",
      "资源诉求：对接雄安创新创业支持政策、产业资源和场景机会",
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
    speakerNote: "成果转化重点是从演示走向雄安试点，不虚构已经落地的客户。",
    evidenceLevel: "inferred",
    tone: "light",
    accent: "green",
    footerCue: "成果转化：从可演示原型到小规模试点",
  },
  {
    title: "商业化不是卖单点工具",
    kicker: "商业模式与市场前景",
    claim: "软件订阅建立持续收入，硬件确认门形成差异化，私有化交付和安全服务承接高价值场景。",
    bullets: [
      "软件订阅：按节点、站点或企业版本提供持续防护与运营能力",
      "硬件配套：ESP32 确认门作为高危操作安全配件进入部署包",
      "私有化交付：面向政企、园区、信创和合规敏感场景",
      "安全服务：安全配置、演练验证、响应支持和合规材料补充",
    ],
    visual: {
      type: "metrics",
      items: [
        { value: "订阅", label: "软件平台", note: "节点 / 站点 / 企业版" },
        { value: "硬件", label: "确认门", note: "高危操作安全配件" },
        { value: "交付", label: "私有化", note: "政企、园区、信创场景" },
        { value: "服务", label: "安全运营", note: "演练、配置、响应支持" },
      ],
    },
    speakerNote: "商业模式只写方向性表达，不承诺未经验证的收入数字。",
    evidenceLevel: "inferred",
    tone: "light",
    accent: "green",
    footerCue: "商业模式：订阅 + 硬件 + 私有化 + 服务",
  },
  {
    title: "落地雄安有四个试点入口",
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
        { value: "园区企业", label: "试点入口", note: "服务器与应用链路保护" },
        { value: "数字城市", label: "基础设施", note: "高危操作确认与审计" },
        { value: "信创安全", label: "私有化", note: "数据留在本地边界" },
        { value: "AI 安全", label: "智能应用", note: "监控、演练、复盘闭环" },
      ],
    },
    speakerNote: "这一页明确回到雄安，回答为什么值得新区支持和对接资源。",
    evidenceLevel: "inferred",
    tone: "light",
    accent: "purple",
    footerCue: "落地雄安：四类入口可先试点",
  },
  {
    title: "决赛要让评委记住四件事",
    kicker: "收束判断",
    claim: "AetherGuard 的决赛答案是：问题够具体、技术有差异、产品可演示、落地路径清楚；团队与知识产权材料按真实口径补齐。",
    bullets: [
      "具体问题：关键服务器高危操作缺少独立可信确认",
      "核心技术：Agent 主机侧防护、雅典学院多智能体讨论、ESP32 串口确认门",
      "产品证据：已有原型、截图、硬件链路和可演示页面",
      "团队与知识产权：补齐核心成员、分工、软著/专利、技术权属和非外包说明",
    ],
    visual: { type: "flow", steps: ["问题具体", "技术差异", "产品可演示", "试点转化", "雄安落地"] },
    stat: { value: "4", label: "个评审答案", note: "问题、技术、产品、落地" },
    speakerNote: "最后回到评委关心的问题：为什么值得支持。答案是问题具体、双亮点清楚、可演示且能继续转化。",
    evidenceLevel: "inferred",
    tone: "dark",
    accent: "cyan",
    footerCue: "收束答案：记住雅典学院 + ESP32 双亮点",
  },
  {
    title: "备用：技术架构详解",
    kicker: "附录 · 技术追问",
    claim: "系统由访问层、控制平面、雅典学院 AI 决策层、支撑层和受管对象层组成，支持从发现到执行的安全闭环。",
    bullets: [
      "访问层：React 控制台负责展示、操作和演示入口",
      "控制平面：Express、Socket.IO、业务模块和服务编排",
      "AI 决策层：Socrates、Plato、Aristotle 多智能体讨论与仲裁",
      "受管对象层：Agent、站点、ESP32 串口确认设备和 Rust fastpath",
    ],
    visual: { type: "architecture" },
    stat: { value: "5", label: "层技术架构", note: "访问、控制、AI、支撑、受管对象" },
    speakerNote: "这页只在评委追问架构时打开，不进入默认 8-10 分钟主线。",
    evidenceLevel: "repo",
    tone: "dark",
    accent: "purple",
    footerCue: "附录：技术追问时打开",
  },
  {
    title: "备用：团队与知识产权待补",
    kicker: "附录 · 待补真实材料",
    claim: "团队信息和知识产权状态需要按真实材料补齐，当前版本保留占位，避免虚构参赛主体、奖项、试点或授权状态。",
    bullets: [
      "团队名称 / 项目负责人 / 学校或公司：待补公开",
      "成员分工：前后端、安全、AI、硬件、展示材料待补充",
      "软著编号 / 专利状态 / 奖项经历：待补真实材料",
      "试点单位或合作意向：待补公开，未确认前不写具体单位",
    ],
    visual: {
      type: "metrics",
      items: [
        { value: "待补", label: "团队名称", note: "不虚构参赛主体" },
        { value: "待补", label: "负责人", note: "按真实报名信息填写" },
        { value: "待补", label: "知识产权", note: "只写已申请或已授权状态" },
        { value: "待补", label: "试点", note: "有材料后再写具体单位" },
      ],
    },
    speakerNote: "这页只服务问答和材料补充，不默认展示。真实信息补齐后可替换占位。",
    evidenceLevel: "placeholder",
    tone: "light",
    accent: "green",
    footerCue: "附录：真实材料未提供前只保留占位",
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

function isDark(deckSlide) {
  return deckSlide.tone === "dark" || deckSlide.tone === "hardware";
}

function accentOf(deckSlide) {
  return ACCENTS[deckSlide.accent] || COLORS.cyan;
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
    line: { color: noHash(lineColor || fill), pt: linePt, transparency: lineTransparency },
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
    line: { color: noHash(lineColor || fill), pt: linePt, transparency: lineTransparency },
    fill: { color: noHash(fill), transparency },
  });
}

function addLine(slide, x1, y1, x2, y2, color, options = {}) {
  slide.addShape(SHAPES.line, {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    line: {
      color: noHash(color),
      pt: options.pt ?? 1,
      transparency: options.transparency ?? 0,
      beginArrowType: options.beginArrowType,
      endArrowType: options.endArrowType,
      dash: options.dash,
    },
  });
}

function imageSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function containRect(filePath, frame) {
  const { width, height } = imageSize(filePath);
  const ratio = width / height;
  const frameRatio = frame.w / frame.h;
  if (ratio > frameRatio) {
    const h = frame.w / ratio;
    return { x: frame.x, y: frame.y + (frame.h - h) / 2, w: frame.w, h };
  }
  const w = frame.h * ratio;
  return { x: frame.x + (frame.w - w) / 2, y: frame.y, w, h: frame.h };
}

function addBackground(slide, deckSlide) {
  const accent = accentOf(deckSlide);
  const dark = isDark(deckSlide);
  slide.background = {
    color: deckSlide.tone === "hardware" ? COLORS.hardwareDark : dark ? COLORS.deepCover : COLORS.lightBg,
  };

  if (deckSlide.tone === "hardware") {
    addRect(slide, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: COLORS.deepCover, transparency: 10 });
    addCircle(slide, { x: 9.2, y: -0.85, w: 4.9, h: 4.9, fill: COLORS.hardwareAmber, transparency: 80 });
  } else if (dark) {
    addRect(slide, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: COLORS.deepSection, transparency: 12 });
    addCircle(slide, { x: 9.0, y: -0.95, w: 5.0, h: 5.0, fill: accent, transparency: 84 });
  } else {
    addRect(slide, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: COLORS.white, transparency: 28 });
    addCircle(slide, { x: 9.7, y: -0.7, w: 4.2, h: 4.2, fill: accent, transparency: 92 });
  }

  addLine(slide, 0, 0.05, SLIDE_W, 0.05, accent, { pt: 4.2 });
  addLine(slide, 0.55, 6.82, 12.78, 6.82, dark ? COLORS.mutedLight : COLORS.slateLine, {
    pt: 0.8,
    transparency: dark ? 78 : 15,
  });

  const grid = dark ? COLORS.white : COLORS.panelNavy;
  for (let x = 0; x <= SLIDE_W; x += 0.62) {
    addLine(slide, x, 0, x, SLIDE_H, grid, { pt: 0.16, transparency: dark ? 91 : 96 });
  }
  for (let y = 0; y <= SLIDE_H; y += 0.62) {
    addLine(slide, 0, y, SLIDE_W, y, grid, { pt: 0.16, transparency: dark ? 91 : 96 });
  }
}

function addHeader(slide, deckSlide, index, total) {
  const dark = isDark(deckSlide);
  const accent = accentOf(deckSlide);
  const textColor = dark ? COLORS.white : COLORS.darkText;
  const badge = evidenceMap[deckSlide.evidenceLevel] || evidenceMap.inferred;

  addRoundRect(slide, {
    x: 0.55,
    y: 0.32,
    w: 0.82,
    h: 0.3,
    fill: dark ? COLORS.deepCover : COLORS.white,
    transparency: dark ? 14 : 0,
    lineColor: accent,
    lineTransparency: dark ? 15 : 55,
    linePt: 0.9,
  });
  addText(slide, `${String(index + 1).padStart(2, "0")} / ${total}`, {
    x: 0.64,
    y: 0.405,
    w: 0.64,
    h: 0.1,
    fontFace: FONTS.mono,
    fontSize: 6.3,
    bold: true,
    align: "center",
    color: textColor,
  });

  addRoundRect(slide, {
    x: 1.55,
    y: 0.32,
    w: 1.48,
    h: 0.3,
    fill: dark ? COLORS.deepCover : COLORS.white,
    transparency: dark ? 14 : 0,
    lineColor: badge.color,
    lineTransparency: 35,
    linePt: 0.9,
  });
  addText(slide, badge.label, {
    x: 1.7,
    y: 0.402,
    w: 1.18,
    h: 0.1,
    fontSize: 6.4,
    bold: true,
    align: "center",
    color: dark ? COLORS.white : badge.color,
  });

  addText(slide, deckSlide.kicker, {
    x: 0.55,
    y: 0.84,
    w: 6.6,
    h: 0.18,
    fontFace: FONTS.heading,
    fontSize: 8.6,
    bold: true,
    color: accent,
  });

  addRoundRect(slide, {
    x: 9.25,
    y: 0.33,
    w: 3.45,
    h: 0.32,
    fill: dark ? COLORS.deepCover : COLORS.white,
    transparency: dark ? 24 : 0,
    lineColor: dark ? accent : COLORS.slateLine,
    lineTransparency: dark ? 40 : 0,
    linePt: 0.8,
  });
  addText(slide, "杭州视界奇点科技有限公司", {
    x: 9.45,
    y: 0.417,
    w: 3.05,
    h: 0.1,
    fontSize: 7.1,
    bold: true,
    align: "center",
    color: textColor,
  });
}

function addFooter(slide, deckSlide, index, total) {
  const dark = isDark(deckSlide);
  const accent = accentOf(deckSlide);
  addCircle(slide, { x: 0.55, y: 6.9, w: 0.13, h: 0.13, fill: accent });
  addText(slide, deckSlide.footerCue || "雄安落地价值", {
    x: 0.78,
    y: 6.915,
    w: 8.4,
    h: 0.16,
    fontSize: 7.2,
    color: dark ? COLORS.mutedLight : COLORS.mutedDark,
  });
  addText(slide, `AetherGuard · 雄才杯2026决赛 · ${String(index + 1).padStart(2, "0")} / ${total}`, {
    x: 9.4,
    y: 6.915,
    w: 3.38,
    h: 0.16,
    fontSize: 7.2,
    bold: true,
    align: "right",
    color: dark ? COLORS.white : COLORS.darkText,
  });
}

function addTitleAndBullets(slide, deckSlide) {
  const dark = isDark(deckSlide);
  const accent = accentOf(deckSlide);
  const textColor = dark ? COLORS.white : COLORS.darkText;
  const muted = dark ? COLORS.mutedLight : COLORS.darkText;
  const titleSize = deckSlide.title.length > 18 ? 21.2 : deckSlide.title.length > 12 ? 24 : 29;

  addText(slide, deckSlide.title, {
    x: 0.55,
    y: 1.22,
    w: 5.5,
    h: 0.95,
    fontFace: FONTS.heading,
    fontSize: titleSize,
    bold: true,
    color: textColor,
    breakLine: true,
  });
  addText(slide, deckSlide.claim, {
    x: 0.58,
    y: 2.18,
    w: 5.42,
    h: 0.66,
    fontSize: 11.6,
    color: muted,
    breakLine: true,
  });

  deckSlide.bullets.forEach((bullet, idx) => {
    const y = 3.02 + idx * 0.53;
    addRoundRect(slide, {
      x: 0.58,
      y,
      w: 5.48,
      h: 0.43,
      fill: dark ? COLORS.panelNavy : COLORS.white,
      transparency: dark ? 24 : 2,
      lineColor: dark ? accent : COLORS.slateLine,
      lineTransparency: dark ? 50 : 0,
      linePt: 0.75,
    });
    addCircle(slide, { x: 0.78, y: y + 0.16, w: 0.1, h: 0.1, fill: accent });
    addText(slide, bullet, {
      x: 0.98,
      y: y + 0.105,
      w: 4.78,
      h: 0.18,
      fontSize: 8.1,
      color: textColor,
      breakLine: true,
    });
  });
}

function addStatPoster(slide, deckSlide, frame) {
  if (!deckSlide.stat) return;
  const dark = isDark(deckSlide);
  const accent = accentOf(deckSlide);
  addRoundRect(slide, {
    ...frame,
    fill: dark ? COLORS.deepCover : COLORS.white,
    transparency: dark ? 16 : 0,
    lineColor: accent,
    lineTransparency: 28,
    linePt: 1,
    shadow: { type: "outer", color: "000000", opacity: dark ? 0.25 : 0.1, blur: 1.8, offset: 1.2, angle: 45 },
  });
  addText(slide, deckSlide.stat.value, {
    x: frame.x + 0.2,
    y: frame.y + 0.16,
    w: frame.w - 0.4,
    h: 0.42,
    fontFace: FONTS.mono,
    fontSize: deckSlide.stat.value.length > 5 ? 20 : 26,
    bold: true,
    color: accent,
  });
  addText(slide, deckSlide.stat.label, {
    x: frame.x + 0.22,
    y: frame.y + 0.72,
    w: frame.w - 0.44,
    h: 0.18,
    fontSize: 9.0,
    bold: true,
    color: dark ? COLORS.white : COLORS.darkText,
  });
  addText(slide, deckSlide.stat.note, {
    x: frame.x + 0.22,
    y: frame.y + 0.96,
    w: frame.w - 0.44,
    h: 0.12,
    fontSize: 6.4,
    color: dark ? COLORS.mutedLight : COLORS.mutedDark,
  });
}

function addScreenshotFrame(slide, fileName, caption, frame, deckSlide) {
  const img = ensureAsset(shot(fileName));
  const dark = isDark(deckSlide);
  const accent = accentOf(deckSlide);
  addRoundRect(slide, {
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    fill: dark ? COLORS.panelNavy : COLORS.white,
    transparency: dark ? 10 : 0,
    lineColor: COLORS.panelNavy,
    linePt: 1,
    shadow: { type: "outer", color: "000000", opacity: dark ? 0.3 : 0.16, blur: 2.1, offset: 1.2, angle: 45 },
  });
  addRoundRect(slide, {
    x: frame.x + 0.12,
    y: frame.y + 0.12,
    w: frame.w - 0.24,
    h: 0.28,
    fill: COLORS.deepCover,
    lineColor: COLORS.deepCover,
    linePt: 0,
  });
  [COLORS.hardwareAmber, COLORS.cyan, COLORS.successGreen].forEach((color, idx) => {
    addCircle(slide, { x: frame.x + 0.3 + idx * 0.18, y: frame.y + 0.22, w: 0.075, h: 0.075, fill: color });
  });
  const imageFrame = { x: frame.x + 0.14, y: frame.y + 0.5, w: frame.w - 0.28, h: frame.h - 0.78 };
  slide.addImage({ path: img, ...containRect(img, imageFrame) });
  addLine(slide, frame.x + 0.12, frame.y + 0.45, frame.x + frame.w - 0.12, frame.y + 0.45, accent, { pt: 1, transparency: 52 });
  addText(slide, caption, {
    x: frame.x + 0.2,
    y: frame.y + frame.h - 0.25,
    w: frame.w - 0.4,
    h: 0.1,
    fontSize: 6.7,
    bold: true,
    color: dark ? COLORS.mutedLight : COLORS.mutedDark,
  });
}

function addFlow(slide, deckSlide, steps, frame) {
  const dark = isDark(deckSlide);
  addRoundRect(slide, {
    ...frame,
    fill: dark ? COLORS.panelNavy : COLORS.white,
    transparency: dark ? 24 : 0,
    lineColor: accentOf(deckSlide),
    lineTransparency: dark ? 46 : 15,
    linePt: 1,
  });
  const cardW = 0.95;
  const gap = (frame.w - 0.42 - cardW * steps.length) / Math.max(1, steps.length - 1);
  const y = frame.y + 1.72;
  steps.forEach((step, idx) => {
    const x = frame.x + 0.21 + idx * (cardW + gap);
    const color = step.includes("雅典") ? COLORS.purple : step.includes("ESP32") ? COLORS.hardwareAmber : idx === steps.length - 1 ? COLORS.successGreen : COLORS.cyan;
    addCircle(slide, { x: x + 0.3, y: y - 0.55, w: 0.36, h: 0.36, fill: color });
    addText(slide, String(idx + 1), {
      x: x + 0.39,
      y: y - 0.45,
      w: 0.18,
      h: 0.08,
      fontFace: FONTS.mono,
      fontSize: 6.2,
      bold: true,
      align: "center",
      color: COLORS.white,
    });
    addRoundRect(slide, {
      x,
      y,
      w: cardW,
      h: 0.92,
      fill: dark ? COLORS.deepCover : COLORS.lightBg,
      transparency: dark ? 12 : 0,
      lineColor: color,
      linePt: 1.05,
    });
    addText(slide, step, {
      x: x + 0.08,
      y: y + 0.18,
      w: cardW - 0.16,
      h: 0.34,
      fontSize: 7.6,
      bold: true,
      align: "center",
      breakLine: true,
      color: dark ? COLORS.white : COLORS.darkText,
    });
    if (idx < steps.length - 1) {
      addLine(slide, x + cardW + 0.04, y + 0.46, x + cardW + gap - 0.08, y + 0.46, color, { pt: 1.15, endArrowType: "triangle" });
    }
  });
}

function addMetricsGrid(slide, deckSlide, items, frame) {
  const dark = isDark(deckSlide);
  const cols = 2;
  const rows = Math.ceil(items.length / cols);
  const gap = 0.24;
  const cardW = (frame.w - gap * (cols - 1)) / cols;
  const cardH = (frame.h - gap * (rows - 1)) / rows;
  items.forEach((item, idx) => {
    const x = frame.x + (idx % cols) * (cardW + gap);
    const y = frame.y + Math.floor(idx / cols) * (cardH + gap);
    const color = [COLORS.cyan, COLORS.purple, COLORS.hardwareAmber, COLORS.successGreen][idx % 4];
    addRoundRect(slide, {
      x,
      y,
      w: cardW,
      h: cardH,
      fill: dark ? COLORS.panelNavy : COLORS.white,
      transparency: dark ? 20 : 0,
      lineColor: color,
      lineTransparency: 35,
      linePt: 1,
      shadow: { type: "outer", color: "000000", opacity: dark ? 0.22 : 0.08, blur: 1.8, offset: 1.0, angle: 45 },
    });
    addCircle(slide, { x: x + 0.25, y: y + 0.26, w: 0.42, h: 0.42, fill: color });
    addText(slide, iconLabels[idx % iconLabels.length], {
      x: x + 0.25,
      y: y + 0.38,
      w: 0.42,
      h: 0.1,
      fontSize: 6.6,
      bold: true,
      align: "center",
      color: COLORS.white,
    });
    addText(slide, item.label, {
      x: x + 0.8,
      y: y + 0.35,
      w: cardW - 1.02,
      h: 0.1,
      fontSize: 7.0,
      bold: true,
      align: "right",
      color: dark ? COLORS.mutedLight : COLORS.mutedDark,
    });
    addText(slide, item.value, {
      x: x + 0.25,
      y: y + 0.95,
      w: cardW - 0.5,
      h: 0.36,
      fontSize: item.value.length > 5 ? 16 : 21,
      bold: true,
      color,
    });
    addText(slide, item.note, {
      x: x + 0.25,
      y: y + 1.48,
      w: cardW - 0.5,
      h: 0.22,
      fontSize: 7.2,
      color: dark ? COLORS.mutedLight : COLORS.mutedDark,
      breakLine: true,
    });
  });
}

function addTimeline(slide, deckSlide, items, frame) {
  const dark = isDark(deckSlide);
  addRoundRect(slide, {
    ...frame,
    fill: dark ? COLORS.panelNavy : COLORS.white,
    transparency: dark ? 24 : 0,
    lineColor: accentOf(deckSlide),
    lineTransparency: 30,
    linePt: 1,
  });
  const x = frame.x + 0.7;
  addLine(slide, x, frame.y + 0.62, x, frame.y + frame.h - 0.62, COLORS.cyan, { pt: 1.4 });
  items.forEach((item, idx) => {
    const y = frame.y + 0.65 + idx * 1.05;
    const color = [COLORS.cyan, COLORS.purple, COLORS.hardwareAmber, COLORS.successGreen][idx % 4];
    addCircle(slide, { x: x - 0.18, y: y - 0.18, w: 0.36, h: 0.36, fill: color });
    addText(slide, String(idx + 1), {
      x: x - 0.15,
      y: y - 0.07,
      w: 0.3,
      h: 0.08,
      fontFace: FONTS.mono,
      fontSize: 6.2,
      bold: true,
      align: "center",
      color: COLORS.white,
    });
    addRoundRect(slide, {
      x: x + 0.38,
      y: y - 0.28,
      w: frame.w - 1.25,
      h: 0.56,
      fill: dark ? COLORS.deepCover : COLORS.lightBg,
      transparency: dark ? 14 : 0,
      lineColor: color,
      lineTransparency: 40,
      linePt: 0.8,
    });
    addText(slide, item.title, {
      x: x + 0.58,
      y: y - 0.12,
      w: 1.08,
      h: 0.1,
      fontSize: 8.4,
      bold: true,
      color,
    });
    addText(slide, item.text, {
      x: x + 1.68,
      y: y - 0.12,
      w: frame.w - 2.64,
      h: 0.1,
      fontSize: 7.8,
      color: dark ? COLORS.white : COLORS.darkText,
    });
  });
}

function addHardwareProtocol(slide, deckSlide, frame) {
  const dark = isDark(deckSlide);
  addRoundRect(slide, {
    ...frame,
    fill: COLORS.deepCover,
    transparency: 8,
    lineColor: COLORS.hardwareAmber,
    linePt: 1.25,
    shadow: { type: "outer", color: "000000", opacity: 0.35, blur: 2.5, offset: 1.2, angle: 45 },
  });
  addText(slide, "串口 allow-list 协议", {
    x: frame.x + 0.36,
    y: frame.y + 0.35,
    w: 3.1,
    h: 0.2,
    fontSize: 12.5,
    bold: true,
    color: COLORS.hardwareAmber,
  });
  const protocol = ["AG:REQ/WIPE", "AG:BEGIN/1234", "AG:STEP/PRESS-A", "AG:OK/CONFIRMED", "AG:ERR/TIMEOUT"];
  protocol.forEach((line, idx) => {
    const y = frame.y + 1.0 + idx * 0.58;
    const color = idx === 3 ? COLORS.successGreen : idx === 4 ? COLORS.mutedLight : COLORS.hardwareAmber;
    addRoundRect(slide, {
      x: frame.x + 0.38,
      y,
      w: 3.25,
      h: 0.36,
      fill: idx === 3 ? "09231C" : "1C1309",
      lineColor: color,
      lineTransparency: 35,
      linePt: 0.85,
    });
    addText(slide, line, {
      x: frame.x + 0.56,
      y: y + 0.11,
      w: 2.82,
      h: 0.1,
      fontFace: FONTS.mono,
      fontSize: 8.3,
      bold: true,
      color,
    });
  });

  const deviceX = frame.x + 4.18;
  addRoundRect(slide, {
    x: deviceX,
    y: frame.y + 0.82,
    w: 1.48,
    h: 2.85,
    fill: "201207",
    lineColor: COLORS.hardwareAmber,
    linePt: 1.15,
  });
  addRoundRect(slide, {
    x: deviceX + 0.18,
    y: frame.y + 1.1,
    w: 1.12,
    h: 0.7,
    fill: "080E1C",
    lineColor: COLORS.hardwareAmber,
    lineTransparency: 45,
    linePt: 0.8,
  });
  addText(slide, "ESP32\nOLED", {
    x: deviceX + 0.26,
    y: frame.y + 1.28,
    w: 0.96,
    h: 0.22,
    fontFace: FONTS.mono,
    fontSize: 7.2,
    bold: true,
    align: "center",
    color: COLORS.hardwareAmber,
    breakLine: true,
  });
  [0, 1, 2].forEach((idx) => {
    addCircle(slide, { x: deviceX + 0.24 + idx * 0.4, y: frame.y + 2.25, w: 0.24, h: 0.24, fill: COLORS.hardwareAmber });
  });
  addText(slide, "现场按键\n不可远程伪造", {
    x: deviceX + 0.08,
    y: frame.y + 2.8,
    w: 1.32,
    h: 0.32,
    fontSize: 7.2,
    bold: true,
    align: "center",
    color: COLORS.white,
    breakLine: true,
  });
  addLine(slide, frame.x + 3.72, frame.y + 2.2, deviceX - 0.1, frame.y + 2.2, COLORS.hardwareAmber, { pt: 1.2, endArrowType: "triangle" });
  addText(slide, dark ? "物理确认门" : "物理确认门", {
    x: frame.x + 4.02,
    y: frame.y + 4.0,
    w: 1.8,
    h: 0.14,
    fontSize: 8.5,
    bold: true,
    align: "center",
    color: COLORS.hardwareAmber,
  });
}

function addMultiAgent(slide, deckSlide, frame) {
  const dark = isDark(deckSlide);
  addRoundRect(slide, {
    ...frame,
    fill: dark ? COLORS.panelNavy : COLORS.white,
    transparency: dark ? 24 : 0,
    lineColor: COLORS.purple,
    lineTransparency: 25,
    linePt: 1,
  });
  const agents = [
    { name: "Socrates", role: "红队质疑", note: "寻找绕过路径", color: COLORS.hardwareAmber },
    { name: "Plato", role: "蓝队防护", note: "提出处置策略", color: COLORS.cyan },
    { name: "Aristotle", role: "仲裁输出", note: "综合证据裁决", color: COLORS.purple },
  ];
  agents.forEach((agent, idx) => {
    const x = frame.x + 0.42 + idx * 1.86;
    const y = frame.y + 1.02;
    addCircle(slide, { x: x + 0.4, y, w: 0.76, h: 0.76, fill: agent.color });
    addText(slide, agent.name.slice(0, 1), {
      x: x + 0.4,
      y: y + 0.25,
      w: 0.76,
      h: 0.1,
      fontFace: FONTS.heading,
      fontSize: 11,
      bold: true,
      align: "center",
      color: COLORS.white,
    });
    addRoundRect(slide, {
      x,
      y: y + 1.0,
      w: 1.55,
      h: 1.3,
      fill: dark ? COLORS.deepCover : COLORS.lightBg,
      transparency: dark ? 12 : 0,
      lineColor: agent.color,
      linePt: 1,
    });
    addText(slide, agent.name, {
      x: x + 0.14,
      y: y + 1.22,
      w: 1.27,
      h: 0.12,
      fontFace: FONTS.mono,
      fontSize: 8.1,
      bold: true,
      align: "center",
      color: agent.color,
    });
    addText(slide, agent.role, {
      x: x + 0.14,
      y: y + 1.58,
      w: 1.27,
      h: 0.12,
      fontSize: 8.6,
      bold: true,
      align: "center",
      color: dark ? COLORS.white : COLORS.darkText,
    });
    addText(slide, agent.note, {
      x: x + 0.14,
      y: y + 1.9,
      w: 1.27,
      h: 0.1,
      fontSize: 6.8,
      align: "center",
      color: dark ? COLORS.mutedLight : COLORS.mutedDark,
    });
  });
  addLine(slide, frame.x + 1.95, frame.y + 2.65, frame.x + 2.55, frame.y + 2.65, COLORS.purple, { pt: 1.15, endArrowType: "triangle" });
  addLine(slide, frame.x + 3.82, frame.y + 2.65, frame.x + 4.42, frame.y + 2.65, COLORS.purple, { pt: 1.15, endArrowType: "triangle" });
  addRoundRect(slide, {
    x: frame.x + 0.58,
    y: frame.y + 4.02,
    w: frame.w - 1.16,
    h: 0.5,
    fill: dark ? COLORS.deepCover : COLORS.lightBg,
    transparency: dark ? 14 : 0,
    lineColor: COLORS.successGreen,
    linePt: 0.9,
  });
  addText(slide, "输出：风险判断 + 处置建议 + 可审计讨论记录", {
    x: frame.x + 0.78,
    y: frame.y + 4.17,
    w: frame.w - 1.56,
    h: 0.11,
    fontSize: 9,
    bold: true,
    align: "center",
    color: dark ? COLORS.white : COLORS.darkText,
  });
}

function addEvidenceWall(slide, deckSlide, images, frame) {
  const gap = 0.16;
  const cols = 3;
  const cardW = (frame.w - gap * (cols - 1)) / cols;
  const cardH = 1.37;
  images.forEach((image, idx) => {
    const x = frame.x + (idx % cols) * (cardW + gap);
    const y = frame.y + Math.floor(idx / cols) * (cardH + gap);
    addScreenshotFrame(slide, image.src, image.caption, { x, y, w: cardW, h: cardH }, deckSlide);
  });
}

function addArchitecture(slide, deckSlide, frame) {
  const dark = isDark(deckSlide);
  addRoundRect(slide, {
    ...frame,
    fill: dark ? COLORS.panelNavy : COLORS.white,
    transparency: dark ? 20 : 0,
    lineColor: COLORS.purple,
    lineTransparency: 25,
    linePt: 1,
  });
  const layers = [
    { name: "访问层", value: "React 控制台", color: COLORS.cyan },
    { name: "控制平面", value: "Express / Socket.IO / 服务编排", color: COLORS.successGreen },
    { name: "雅典学院 AI 决策层", value: "Socrates / Plato / Aristotle", color: COLORS.purple },
    { name: "支撑层", value: "SQLite / Postgres / Redis / 审计", color: COLORS.hardwareAmber },
    { name: "受管对象层", value: "Agent / Site / ESP32 / Rust fastpath", color: COLORS.cyan },
  ];
  layers.forEach((layer, idx) => {
    const y = frame.y + 0.42 + idx * 0.76;
    addRoundRect(slide, {
      x: frame.x + 0.42,
      y,
      w: frame.w - 0.84,
      h: 0.5,
      fill: dark ? COLORS.deepCover : COLORS.lightBg,
      transparency: dark ? 12 : 0,
      lineColor: layer.color,
      lineTransparency: 35,
      linePt: 0.9,
    });
    addText(slide, layer.name, {
      x: frame.x + 0.66,
      y: y + 0.16,
      w: 1.58,
      h: 0.1,
      fontSize: 8.2,
      bold: true,
      color: layer.color,
    });
    addText(slide, layer.value, {
      x: frame.x + 2.42,
      y: y + 0.16,
      w: frame.w - 3.0,
      h: 0.1,
      fontSize: 7.8,
      color: dark ? COLORS.white : COLORS.darkText,
    });
  });
}

function addVisual(slide, deckSlide) {
  const visual = deckSlide.visual;
  const frame = { x: 6.45, y: 1.42, w: 6.22, h: 4.82 };
  if (visual.type === "image") {
    addScreenshotFrame(slide, visual.src, visual.caption, frame, deckSlide);
    addStatPoster(slide, deckSlide, { x: 6.45, y: 5.18, w: 2.28, h: 1.12 });
    return;
  }
  if (visual.type === "flow") {
    addFlow(slide, deckSlide, visual.steps, frame);
    addStatPoster(slide, deckSlide, { x: 10.3, y: 5.18, w: 2.28, h: 1.12 });
    return;
  }
  if (visual.type === "metrics") {
    addMetricsGrid(slide, deckSlide, visual.items, frame);
    return;
  }
  if (visual.type === "timeline") {
    addTimeline(slide, deckSlide, visual.items, frame);
    return;
  }
  if (visual.type === "hardwareProtocol") {
    addHardwareProtocol(slide, deckSlide, frame);
    addStatPoster(slide, deckSlide, { x: 3.75, y: 5.18, w: 2.3, h: 1.12 });
    return;
  }
  if (visual.type === "multiAgent") {
    addMultiAgent(slide, deckSlide, frame);
    addStatPoster(slide, deckSlide, { x: 3.75, y: 5.18, w: 2.3, h: 1.12 });
    return;
  }
  if (visual.type === "evidenceWall") {
    addEvidenceWall(slide, deckSlide, visual.images, frame);
    addStatPoster(slide, deckSlide, { x: 0.58, y: 5.18, w: 2.45, h: 1.12 });
    return;
  }
  if (visual.type === "architecture") {
    addArchitecture(slide, deckSlide, frame);
    addStatPoster(slide, deckSlide, { x: 10.3, y: 5.18, w: 2.28, h: 1.12 });
    return;
  }
  throw new Error(`Unsupported visual type: ${visual.type}`);
}

function addDeckSlide(deck, deckSlide, index, total) {
  const slide = deck.addSlide();
  addBackground(slide, deckSlide);
  addHeader(slide, deckSlide, index, total);
  addTitleAndBullets(slide, deckSlide);
  addVisual(slide, deckSlide);
  addFooter(slide, deckSlide, index, total);
  slide.addNotes(deckSlide.speakerNote);
}

async function buildDeck() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const deck = new PptxGenJS();
  deck.author = "OpenAI Codex";
  deck.company = "杭州视界奇点科技有限公司";
  deck.subject = "AetherGuard 雄才杯2026决赛";
  deck.title = "AetherGuard 雄才杯决赛版 雅典学院 原生组件版";
  deck.lang = "zh-CN";
  deck.theme = {
    headFontFace: FONTS.heading,
    bodyFontFace: FONTS.body,
    lang: "zh-CN",
  };
  deck.defineLayout({ name: "AETHER_WIDE", width: SLIDE_W, height: SLIDE_H });
  deck.layout = "AETHER_WIDE";

  slides.forEach((item, index) => addDeckSlide(deck, item, index, slides.length));
  await deck.writeFile({ fileName: OUTPUT_FILE, compression: true });
}

buildDeck()
  .then(() => {
    console.log(`Generated native component PPTX: ${OUTPUT_FILE}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
