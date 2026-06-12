import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "docs", "generated");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "AetherGuard-雄才杯决赛版-视觉增强版.pptx");
const SHOT_DIR = path.join(ROOT, "frontend", "public", "pitch");

const W = 13.333;
const H = 7.5;

const C = {
  ink: "07111F",
  navy: "0B1D33",
  panel: "102A48",
  light: "F3F8FF",
  white: "FFFFFF",
  cyan: "00BFFF",
  purple: "7C4DFF",
  amber: "FF8C00",
  green: "00E5A0",
  red: "EF4444",
  text: "0B1D33",
  muted: "58708E",
  pale: "C7D7EA",
  line: "B8C7DA",
};

const F = {
  head: "Microsoft YaHei",
  body: "Microsoft YaHei",
  mono: "Consolas",
};

const S = {
  rect: "rect",
  roundRect: "roundRect",
  ellipse: "ellipse",
  line: "line",
};

const slides = [
  {
    tone: "dark",
    accent: C.cyan,
    kicker: "雄才杯2026决赛项目",
    title: "AetherGuard",
    claim: "面向雄安数字基础设施的智能服务器安全防御平台",
    bullets: [
      "Agent 主机侧防护",
      "雅典学院多智能体讨论",
      "ESP32 物理确认门",
      "高危操作审计闭环",
    ],
    visual: "cover",
    note: "开场只讲一句：AetherGuard 解决关键服务器高危操作缺少可信确认的问题，双亮点是雅典学院和 ESP32。",
  },
  {
    tone: "dark",
    accent: C.red,
    kicker: "问题定义",
    title: "高危操作不能只靠远程权限确认",
    claim: "一旦服务器账号或控制台权限失守，纯软件确认会变成同一条攻击链上的薄弱环节。",
    bullets: [
      "安装/卸载 Agent、擦除数据、关键配置变更都是高后果动作",
      "登录态、二次弹窗、远程审批仍依赖同一套网络权限",
      "AetherGuard 补的是“最后一步可信确认”，不是再做一个告警列表",
      "“0 远程绕过”只作为机制设计目标，不写成未经验证的性能承诺",
    ],
    visual: "riskGate",
    stat: { value: "1", label: "个关键断点", note: "高危动作缺少独立可信确认" },
    note: "把问题讲具体：关键服务器的危险动作，最后一步不能只由远程软件权限确认。",
  },
  {
    tone: "light",
    accent: C.cyan,
    kicker: "雄安场景痛点",
    title: "雄安场景需要可控、可审计、可私有化",
    claim: "数字城市、园区平台、信创环境和 AI 应用安全，都需要服务器侧可控防护能力。",
    bullets: [
      "园区和创新企业服务器数量增长，安全运营能力容易碎片化",
      "关键运维动作缺少独立可信确认，事前阻断弱，事后追责难",
      "政企、信创和数字城市场景对本地化、私有化和审计链路要求更高",
      "AI 应用安全需要持续监控、攻击演练和策略复盘闭环",
    ],
    visual: "scenarioCards",
    note: "这一页回答为什么是雄安，避免讲成泛安全市场。",
  },
  {
    tone: "dark",
    accent: C.cyan,
    kicker: "解决方案",
    title: "一条可演示的安全闭环",
    claim: "控制平面统一编排，Agent 贴近服务器现场，雅典学院讨论判断，ESP32 承接高危动作物理确认。",
    bullets: [
      "控制台：统一管理节点、设备、扫描、告警、部署和审计",
      "Agent：把采集、执行和风险感知前移到业务服务器侧",
      "雅典学院：Socrates / Plato / Aristotle 多角色讨论，输出可追溯判断",
      "ESP32：只通过串口通信，让危险动作必须经过现场确认",
    ],
    visual: "loop",
    note: "承上启下，让评委先记住四个模块，后面分别讲 Agent、ESP32、雅典学院。",
  },
  {
    tone: "light",
    accent: C.cyan,
    kicker: "核心技术一",
    title: "Agent 把防护放到服务器现场",
    claim: "Agent-Inside 不是边界工具拼接，而是把防护位置前移到业务服务器运行现场。",
    bullets: [
      "统一查看 Agent 心跳、资源状态、风险事件和节点详情",
      "适合覆盖多站点、多服务器实例和分布式业务节点",
      "与扫描、告警、审计联动，避免安全信息停留在孤立列表",
      "为高危操作确认提供受管节点、动作和证据上下文",
    ],
    visual: "screenshot",
    image: "03-agents.png",
    caption: "Agent 管理：主机侧状态与节点管理",
    note: "讲清 Agent 不是边界防火墙，而是把采集、执行和上下文放到服务器现场。",
  },
  {
    tone: "hardware",
    accent: C.amber,
    kicker: "核心技术二 · 最大差异化",
    title: "ESP32 把确认拉回物理现场",
    claim: "ESP32 物理确认门独立于服务器网络权限，让危险动作必须经过现场按键确认。",
    bullets: [
      "只通过 USB-TTL 串口通信，不暴露网络控制面",
      "协议采用 allow-list：AG:REQ -> AG:BEGIN / STEP / OK / ERR",
      "适用于安装/卸载 Agent、擦除数据、关键配置变更等危险动作",
      "当前表述为硬件原型和链路设计，不夸大为量产硬件或已规模部署",
    ],
    visual: "hardwareGate",
    stat: { value: "ESP32", label: "物理确认门", note: "串口通信 + 现场按键确认" },
    note: "这是整套 PPT 的视觉停顿页，讲成可信确认机制，不要讲成普通硬件配件。",
  },
  {
    tone: "ai",
    accent: C.purple,
    kicker: "核心技术三 · AI 亮点",
    title: "雅典学院让 AI 决策可讨论",
    claim: "不是单模型给结论，而是让红队、蓝队和仲裁智能体围绕安全事件结构化讨论，留下可审计判断过程。",
    bullets: [
      "Socrates 红队智能体：质疑风险、寻找绕过路径和攻击链假设",
      "Plato 蓝队智能体：提出防护策略、处置建议和运维可行性判断",
      "Aristotle 仲裁智能体：综合证据、冲突裁决和输出最终处置理由",
      "讨论记录可形成审计材料，避免单次模型判断黑箱化",
    ],
    visual: "athens",
    stat: { value: "3", label: "类智能体角色", note: "红队、蓝队、仲裁协同判断" },
    note: "这是第二个记忆点：不是普通大模型调用，而是多角色讨论和可审计决策。",
  },
  {
    tone: "dark",
    accent: C.purple,
    kicker: "技术架构",
    title: "从访问层到物理确认的五层架构",
    claim: "访问层、控制平面、雅典学院 AI 决策层、支撑层和受管对象层组成完整安全闭环。",
    bullets: [
      "访问层：React 控制台负责展示、操作和演示入口",
      "控制平面：Express、Socket.IO、业务模块和服务编排",
      "AI 决策层：Socrates、Plato、Aristotle 多智能体讨论与仲裁",
      "受管对象层：Agent、站点、ESP32 串口确认设备和 Rust fastpath",
    ],
    visual: "architecture",
    note: "如果时间紧，这页可以简讲；问答时再展开技术细节。",
  },
  {
    tone: "light",
    accent: C.green,
    kicker: "产品证据",
    title: "原型已经能连续演示",
    claim: "已有控制台、Agent、多智能体监控、设备、扫描、告警和后台页面，现场可按产品链路讲，而不是按概念图讲。",
    bullets: [
      "已有 React 前端、Node/TypeScript 后端、Socket.IO 实时链路和硬件目录",
      "页面覆盖 Dashboard、Agents、Multi-Agent Monitor、Devices、Scanner、Alerts、Admin",
      "截图用于证明连续链路，具体客户和试点单位未提供前不虚构",
      "产品证据页负责回答“能不能做出来、能不能演示”的评审问题",
    ],
    visual: "proof",
    note: "产品证据页要少而大，评委能看清界面。",
  },
  {
    tone: "light",
    accent: C.green,
    kicker: "成果转化路径",
    title: "成果转化从小试点开始",
    claim: "下一步不是扩大叙事，而是把原型演示链路打磨成可在雄安场景试点的交付包。",
    bullets: [
      "近期：打磨部署、硬件确认、审计证据和现场演示链路",
      "中期：选择 1-2 个服务器场景做小规模试点验证",
      "长期：沉淀私有化交付包、行业案例和安全运营服务能力",
      "资源诉求：对接雄安创新创业支持政策、产业资源和场景机会",
    ],
    visual: "timeline",
    note: "转化路径要朴素可信，不虚构已经落地的客户。",
  },
  {
    tone: "light",
    accent: C.green,
    kicker: "商业模式与市场前景",
    title: "商业化不是卖单点工具",
    claim: "软件订阅建立持续收入，硬件确认门形成差异化，私有化交付和安全服务承接高价值场景。",
    bullets: [
      "软件订阅：按节点、站点或企业版本提供持续防护与运营能力",
      "硬件配套：ESP32 确认门作为高危操作安全配件进入部署包",
      "私有化交付：面向政企、园区、信创和合规敏感场景",
      "安全服务：安全配置、演练验证、响应支持和合规材料补充",
    ],
    visual: "business",
    note: "只讲方向，不承诺未经验证的收入数字。",
  },
  {
    tone: "dark",
    accent: C.cyan,
    kicker: "雄安落地计划",
    title: "落地雄安有四个试点入口",
    claim: "项目可优先从园区企业服务器、数字城市基础设施、信创安全和 AI 应用安全四类场景切入。",
    bullets: [
      "园区企业：从中小团队服务器安全运营切入，降低落地门槛",
      "数字城市：服务关键系统的高危运维确认和审计留痕",
      "信创安全：支持本地化、私有化和数据不外发的部署诉求",
      "AI 应用安全：用监控与演练闭环服务智能应用治理",
    ],
    visual: "landing",
    note: "明确回到雄安，回答为什么值得新区支持和对接资源。",
  },
  {
    tone: "dark",
    accent: C.cyan,
    kicker: "收束判断",
    title: "AetherGuard 值得支持的四个理由",
    claim: "问题够具体、技术有差异、产品可演示、落地路径清楚；团队与知识产权材料按真实口径补齐。",
    bullets: [
      "问题具体：关键服务器高危操作缺少独立可信确认",
      "技术差异：Agent 主机侧防护、雅典学院多智能体讨论、ESP32 串口确认门",
      "产品证据：已有原型、截图、硬件链路和可演示页面",
      "落地路径：从园区服务器小试点切入雄安数字基础设施场景",
    ],
    visual: "closing",
    note: "不要用感谢观看做结尾，用四个理由收束成评审判断。",
  },
];

function noHash(color) {
  return String(color).replace(/^#/, "");
}

function shot(file) {
  return path.join(SHOT_DIR, file);
}

function ensure(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing asset: ${file}`);
  if (fs.statSync(file).size === 0) throw new Error(`Empty asset: ${file}`);
  return file;
}

function isDark(slide) {
  return slide.tone === "dark" || slide.tone === "hardware" || slide.tone === "ai";
}

function bgColor(slide) {
  if (slide.tone === "hardware") return "120A03";
  if (slide.tone === "ai") return "100724";
  if (slide.tone === "dark") return C.ink;
  return C.light;
}

function addText(slide, text, opts) {
  slide.addText(text, {
    margin: 0,
    fit: "shrink",
    breakLine: false,
    fontFace: F.body,
    ...opts,
    color: noHash(opts.color || C.text),
  });
}

function shape(slide, type, opts) {
  const { fill = C.white, transparency = 0, lineColor = fill, linePt = 0, lineTransparency = 0, shadow, ...rest } = opts;
  slide.addShape(type, {
    ...rest,
    fill: { color: noHash(fill), transparency },
    line: { color: noHash(lineColor), pt: linePt, transparency: lineTransparency },
    shadow,
  });
}

function rect(slide, opts) {
  shape(slide, S.rect, opts);
}

function rr(slide, opts) {
  shape(slide, S.roundRect, { rectRadius: 0.04, ...opts });
}

function circle(slide, opts) {
  shape(slide, S.ellipse, opts);
}

function line(slide, x1, y1, x2, y2, color, opts = {}) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.max(Math.abs(x2 - x1), 0.001);
  const h = Math.max(Math.abs(y2 - y1), 0.001);
  slide.addShape(S.line, {
    x,
    y,
    w,
    h,
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

function imageSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function contain(file, frame) {
  const size = imageSize(file);
  const r = size.w / size.h;
  const fr = frame.w / frame.h;
  if (r > fr) {
    const h = frame.w / r;
    return { x: frame.x, y: frame.y + (frame.h - h) / 2, w: frame.w, h };
  }
  const w = frame.h * r;
  return { x: frame.x + (frame.w - w) / 2, y: frame.y, w, h: frame.h };
}

function background(slide, s) {
  const dark = isDark(s);
  slide.background = { color: bgColor(s) };
  if (dark) {
    rect(slide, { x: 0, y: 0, w: W, h: H, fill: s.tone === "ai" ? "190B36" : C.navy, transparency: s.tone === "dark" ? 12 : 8 });
    circle(slide, { x: 8.9, y: -1.05, w: 5.15, h: 5.15, fill: s.accent, transparency: 83 });
    circle(slide, { x: -0.8, y: 5.6, w: 2.3, h: 2.3, fill: s.accent, transparency: 92 });
  } else {
    rect(slide, { x: 0, y: 0, w: W, h: H, fill: C.white, transparency: 16 });
    circle(slide, { x: 9.6, y: -0.72, w: 4.2, h: 4.2, fill: s.accent, transparency: 91 });
  }

  const grid = dark ? C.white : C.panel;
  for (let x = 0; x <= W; x += 0.65) line(slide, x, 0, x, H, grid, { pt: 0.15, transparency: dark ? 92 : 96 });
  for (let y = 0; y <= H; y += 0.65) line(slide, 0, y, W, y, grid, { pt: 0.15, transparency: dark ? 92 : 96 });
  line(slide, 0, 0.05, W, 0.05, s.accent, { pt: 4.5 });
}

function header(slide, s, i, total) {
  const dark = isDark(s);
  const color = dark ? C.white : C.text;
  addText(slide, s.kicker, {
    x: 0.58,
    y: 0.42,
    w: 4.6,
    h: 0.14,
    fontSize: 8,
    bold: true,
    color: s.accent,
  });
  rr(slide, {
    x: 10.1,
    y: 0.32,
    w: 2.55,
    h: 0.31,
    fill: dark ? bgColor(s) : C.white,
    transparency: dark ? 12 : 0,
    lineColor: dark ? s.accent : C.line,
    linePt: 0.75,
    lineTransparency: dark ? 35 : 0,
  });
  addText(slide, "杭州视界奇点科技有限公司", {
    x: 10.25,
    y: 0.405,
    w: 2.25,
    h: 0.1,
    fontSize: 6.8,
    bold: true,
    align: "center",
    color,
  });
  addText(slide, `${String(i + 1).padStart(2, "0")} / ${total}`, {
    x: 11.98,
    y: 6.92,
    w: 0.78,
    h: 0.12,
    fontFace: F.mono,
    fontSize: 7.2,
    bold: true,
    align: "right",
    color,
  });
}

function footer(slide, s) {
  const dark = isDark(s);
  line(slide, 0.58, 6.78, 12.75, 6.78, dark ? C.pale : C.line, { pt: 0.7, transparency: dark ? 78 : 0 });
  circle(slide, { x: 0.58, y: 6.88, w: 0.13, h: 0.13, fill: s.accent });
  addText(slide, "雄才杯决赛版 · AetherGuard", {
    x: 0.82,
    y: 6.9,
    w: 3.2,
    h: 0.12,
    fontSize: 7,
    color: dark ? C.pale : C.muted,
  });
}

function titleBlock(slide, s, opts = {}) {
  const dark = isDark(s);
  const titleSize = opts.titleSize ?? (s.title.length > 17 ? 22 : s.title.length > 12 ? 25 : 31);
  addText(slide, s.title, {
    x: opts.x ?? 0.58,
    y: opts.y ?? 1.05,
    w: opts.w ?? 5.6,
    h: opts.h ?? 0.82,
    fontFace: F.head,
    fontSize: titleSize,
    bold: true,
    color: dark ? C.white : C.text,
    breakLine: true,
  });
  addText(slide, s.claim, {
    x: opts.x ?? 0.6,
    y: opts.claimY ?? 2.0,
    w: opts.w ?? 5.55,
    h: opts.claimH ?? 0.55,
    fontSize: opts.claimSize ?? 11.3,
    color: dark ? C.pale : C.text,
    breakLine: true,
  });
}

function bullets(slide, s, frame = {}) {
  const dark = isDark(s);
  const x = frame.x ?? 0.62;
  const y0 = frame.y ?? 2.95;
  const w = frame.w ?? 5.35;
  s.bullets.forEach((b, idx) => {
    const y = y0 + idx * (frame.gap ?? 0.52);
    rr(slide, {
      x,
      y,
      w,
      h: frame.h ?? 0.42,
      fill: dark ? C.panel : C.white,
      transparency: dark ? 18 : 0,
      lineColor: dark ? s.accent : C.line,
      linePt: 0.75,
      lineTransparency: dark ? 50 : 0,
    });
    circle(slide, { x: x + 0.2, y: y + 0.16, w: 0.1, h: 0.1, fill: s.accent });
    addText(slide, b, {
      x: x + 0.42,
      y: y + 0.11,
      w: w - 0.6,
      h: 0.14,
      fontSize: frame.fontSize ?? 7.8,
      color: dark ? C.white : C.text,
      breakLine: true,
    });
  });
}

function stat(slide, s, frame) {
  if (!s.stat) return;
  const dark = isDark(s);
  rr(slide, {
    ...frame,
    fill: dark ? bgColor(s) : C.white,
    transparency: dark ? 8 : 0,
    lineColor: s.accent,
    linePt: 1,
    shadow: { type: "outer", color: "000000", opacity: dark ? 0.28 : 0.12, blur: 1.7, offset: 1.1, angle: 45 },
  });
  addText(slide, s.stat.value, {
    x: frame.x + 0.22,
    y: frame.y + 0.18,
    w: frame.w - 0.44,
    h: 0.36,
    fontFace: F.mono,
    fontSize: s.stat.value.length > 5 ? 20 : 26,
    bold: true,
    color: s.accent,
  });
  addText(slide, s.stat.label, {
    x: frame.x + 0.22,
    y: frame.y + 0.72,
    w: frame.w - 0.44,
    h: 0.14,
    fontSize: 8.6,
    bold: true,
    color: dark ? C.white : C.text,
  });
  addText(slide, s.stat.note, {
    x: frame.x + 0.22,
    y: frame.y + 0.99,
    w: frame.w - 0.44,
    h: 0.12,
    fontSize: 6.4,
    color: dark ? C.pale : C.muted,
  });
}

function screenshot(slide, s, file, caption, frame) {
  const img = ensure(shot(file));
  const dark = isDark(s);
  rr(slide, {
    ...frame,
    fill: dark ? C.panel : C.white,
    transparency: dark ? 8 : 0,
    lineColor: C.panel,
    linePt: 1,
    shadow: { type: "outer", color: "000000", opacity: dark ? 0.28 : 0.14, blur: 2, offset: 1.1, angle: 45 },
  });
  rr(slide, { x: frame.x + 0.12, y: frame.y + 0.12, w: frame.w - 0.24, h: 0.28, fill: C.ink, linePt: 0 });
  [C.amber, C.cyan, C.green].forEach((color, idx) => circle(slide, { x: frame.x + 0.31 + idx * 0.18, y: frame.y + 0.22, w: 0.075, h: 0.075, fill: color }));
  const imageFrame = { x: frame.x + 0.14, y: frame.y + 0.5, w: frame.w - 0.28, h: frame.h - 0.78 };
  slide.addImage({ path: img, ...contain(img, imageFrame) });
  line(slide, frame.x + 0.12, frame.y + 0.45, frame.x + frame.w - 0.12, frame.y + 0.45, s.accent, { pt: 1, transparency: 45 });
  addText(slide, caption, {
    x: frame.x + 0.2,
    y: frame.y + frame.h - 0.24,
    w: frame.w - 0.4,
    h: 0.1,
    fontSize: 6.6,
    bold: true,
    color: dark ? C.pale : C.muted,
  });
}

function cover(slide, s) {
  addText(slide, "面向雄安数字基础设施的智能服务器安全防御平台", {
    x: 0.75,
    y: 0.72,
    w: 6.2,
    h: 0.16,
    fontSize: 8.6,
    bold: true,
    color: C.cyan,
  });
  addText(slide, "AetherGuard", {
    x: 0.72,
    y: 1.38,
    w: 6.8,
    h: 0.6,
    fontFace: F.head,
    fontSize: 37,
    bold: true,
    color: C.white,
  });
  addText(slide, "Agent + 雅典学院多智能体讨论 + ESP32 物理确认门", {
    x: 0.76,
    y: 2.22,
    w: 6.4,
    h: 0.22,
    fontSize: 13,
    bold: true,
    color: C.pale,
  });
  const x = 7.55;
  const y = 1.23;
  rr(slide, { x, y, w: 4.75, h: 4.25, fill: C.navy, transparency: 4, lineColor: C.cyan, linePt: 1.1 });
  const nodes = [
    { label: "Agent", x: x + 0.55, y: y + 1.9, color: C.cyan },
    { label: "雅典学院", x: x + 2.05, y: y + 0.72, color: C.purple },
    { label: "ESP32", x: x + 3.5, y: y + 1.9, color: C.amber },
    { label: "审计证据", x: x + 2.05, y: y + 3.1, color: C.green },
  ];
  nodes.forEach((n) => {
    circle(slide, { x: n.x, y: n.y, w: 0.85, h: 0.85, fill: n.color });
    addText(slide, n.label, { x: n.x - 0.18, y: n.y + 0.31, w: 1.2, h: 0.1, fontSize: 7.4, bold: true, align: "center", color: C.white });
  });
  line(slide, x + 1.35, y + 2.3, x + 2.08, y + 1.33, C.cyan, { pt: 1.4, endArrowType: "triangle" });
  line(slide, x + 2.88, y + 1.33, x + 3.5, y + 2.3, C.purple, { pt: 1.4, endArrowType: "triangle" });
  line(slide, x + 3.52, y + 2.7, x + 2.88, y + 3.47, C.amber, { pt: 1.4, endArrowType: "triangle" });
  line(slide, x + 2.07, y + 3.47, x + 1.35, y + 2.7, C.green, { pt: 1.4, endArrowType: "triangle" });
  rr(slide, { x: 0.76, y: 3.35, w: 5.95, h: 1.85, fill: C.panel, transparency: 15, lineColor: C.cyan, lineTransparency: 50, linePt: 0.9 });
  s.bullets.forEach((b, idx) => {
    const bx = 1.05 + (idx % 2) * 2.75;
    const by = 3.68 + Math.floor(idx / 2) * 0.63;
    circle(slide, { x: bx, y: by, w: 0.16, h: 0.16, fill: [C.cyan, C.purple, C.amber, C.green][idx] });
    addText(slide, b, { x: bx + 0.28, y: by - 0.01, w: 2.15, h: 0.12, fontSize: 8.6, bold: true, color: C.white });
  });
}

function riskGate(slide, s) {
  titleBlock(slide, s, { titleSize: 26, w: 5.8, claimY: 2.0 });
  bullets(slide, s, { y: 3.0, w: 5.52, fontSize: 7.6 });
  const frame = { x: 6.7, y: 1.2, w: 5.75, h: 4.95 };
  rr(slide, { ...frame, fill: C.navy, transparency: 4, lineColor: C.red, linePt: 1 });
  const steps = [
    { label: "高危动作", color: C.red },
    { label: "远程权限", color: C.red },
    { label: "可信断点", color: C.amber },
    { label: "现场确认", color: C.green },
  ];
  steps.forEach((st, idx) => {
    const y = frame.y + 0.68 + idx * 0.9;
    circle(slide, { x: frame.x + 0.55, y, w: 0.45, h: 0.45, fill: st.color });
    rr(slide, { x: frame.x + 1.25, y: y - 0.02, w: 3.65, h: 0.48, fill: C.ink, transparency: 4, lineColor: st.color, linePt: 0.9 });
    addText(slide, st.label, { x: frame.x + 1.48, y: y + 0.13, w: 3.1, h: 0.1, fontSize: 10, bold: true, color: C.white });
    if (idx < steps.length - 1) line(slide, frame.x + 0.78, y + 0.46, frame.x + 0.78, y + 0.78, st.color, { pt: 1.1, endArrowType: "triangle" });
  });
  stat(slide, s, { x: frame.x + 3.05, y: frame.y + 3.9, w: 2.25, h: 0.95 });
}

function scenarioCards(slide, s) {
  titleBlock(slide, s);
  bullets(slide, s, { y: 3.03, w: 5.42, fontSize: 7.5 });
  const items = [
    ["数字城市", "关键系统运维与审计", C.cyan],
    ["园区企业", "从服务器小试点切入", C.green],
    ["信创安全", "本地化、私有化部署", C.amber],
    ["AI 应用", "监控、演练、复盘闭环", C.purple],
  ];
  cards(slide, s, items, { x: 6.55, y: 1.32, w: 5.95, h: 4.85 });
}

function cards(slide, s, items, frame) {
  const dark = isDark(s);
  const gap = 0.24;
  const cw = (frame.w - gap) / 2;
  const ch = (frame.h - gap) / 2;
  items.forEach(([title, note, color], idx) => {
    const x = frame.x + (idx % 2) * (cw + gap);
    const y = frame.y + Math.floor(idx / 2) * (ch + gap);
    rr(slide, { x, y, w: cw, h: ch, fill: dark ? C.panel : C.white, transparency: dark ? 16 : 0, lineColor: color, linePt: 1, shadow: { type: "outer", color: "000000", opacity: dark ? 0.24 : 0.1, blur: 1.7, offset: 1, angle: 45 } });
    circle(slide, { x: x + 0.28, y: y + 0.28, w: 0.45, h: 0.45, fill: color });
    addText(slide, String(idx + 1).padStart(2, "0"), { x: x + 0.28, y: y + 0.42, w: 0.45, h: 0.1, fontFace: F.mono, fontSize: 6.2, bold: true, align: "center", color: C.white });
    addText(slide, title, { x: x + 0.3, y: y + 0.98, w: cw - 0.6, h: 0.24, fontSize: 17, bold: true, color });
    addText(slide, note, { x: x + 0.32, y: y + 1.52, w: cw - 0.64, h: 0.22, fontSize: 7.4, color: dark ? C.pale : C.muted, breakLine: true });
  });
}

function loop(slide, s) {
  titleBlock(slide, s, { titleSize: 27, w: 5.65 });
  bullets(slide, s, { y: 3.02, w: 5.48, fontSize: 7.5 });
  const frame = { x: 6.55, y: 1.35, w: 5.95, h: 4.75 };
  rr(slide, { ...frame, fill: C.navy, transparency: 8, lineColor: C.cyan, linePt: 1 });
  const steps = [
    ["控制台", C.cyan],
    ["Agent", C.cyan],
    ["雅典学院", C.purple],
    ["ESP32", C.amber],
    ["审计证据", C.green],
  ];
  steps.forEach(([label, color], idx) => {
    const x = frame.x + 0.33 + idx * 1.08;
    const y = frame.y + 2.0;
    circle(slide, { x: x + 0.24, y: y - 0.7, w: 0.45, h: 0.45, fill: color });
    rr(slide, { x, y, w: 0.93, h: 0.86, fill: C.ink, transparency: 6, lineColor: color, linePt: 1 });
    addText(slide, label, { x: x + 0.08, y: y + 0.32, w: 0.77, h: 0.1, fontSize: 7.5, bold: true, align: "center", color: C.white });
    if (idx < steps.length - 1) line(slide, x + 0.94, y + 0.43, x + 1.05, y + 0.43, color, { pt: 1.1, endArrowType: "triangle" });
  });
  addText(slide, "发现 -> 讨论 -> 确认 -> 执行 -> 留痕", { x: frame.x + 0.55, y: frame.y + 3.72, w: frame.w - 1.1, h: 0.18, fontSize: 11, bold: true, align: "center", color: C.green });
}

function screenshotPage(slide, s) {
  titleBlock(slide, s);
  bullets(slide, s, { y: 3.0, w: 5.35, fontSize: 7.5 });
  screenshot(slide, s, s.image, s.caption, { x: 6.45, y: 1.28, w: 5.95, h: 4.15 });
}

function hardwareGate(slide, s) {
  titleBlock(slide, s, { titleSize: 29, w: 5.75, claimY: 2.02 });
  bullets(slide, s, { y: 3.0, w: 5.45, fontSize: 7.5 });
  const frame = { x: 6.55, y: 1.15, w: 5.82, h: 5.0 };
  rr(slide, { ...frame, fill: C.ink, transparency: 0, lineColor: C.amber, linePt: 1.25 });
  addText(slide, "串口 allow-list 协议", { x: frame.x + 0.36, y: frame.y + 0.38, w: 3.5, h: 0.2, fontSize: 13, bold: true, color: C.amber });
  ["AG:REQ/WIPE", "AG:BEGIN/1234", "AG:STEP/PRESS-A", "AG:OK/CONFIRMED", "AG:ERR/TIMEOUT"].forEach((p, idx) => {
    const y = frame.y + 0.95 + idx * 0.54;
    const color = idx === 3 ? C.green : idx === 4 ? C.pale : C.amber;
    rr(slide, { x: frame.x + 0.4, y, w: 3.1, h: 0.34, fill: idx === 3 ? "09231C" : "201305", lineColor: color, linePt: 0.8, lineTransparency: 30 });
    addText(slide, p, { x: frame.x + 0.55, y: y + 0.1, w: 2.7, h: 0.1, fontFace: F.mono, fontSize: 8.0, bold: true, color });
  });
  const dx = frame.x + 4.0;
  rr(slide, { x: dx, y: frame.y + 0.95, w: 1.3, h: 3.05, fill: "251305", lineColor: C.amber, linePt: 1.1 });
  rr(slide, { x: dx + 0.18, y: frame.y + 1.25, w: 0.94, h: 0.65, fill: C.ink, lineColor: C.amber, lineTransparency: 40, linePt: 0.8 });
  addText(slide, "ESP32\nOLED", { x: dx + 0.24, y: frame.y + 1.42, w: 0.82, h: 0.22, fontFace: F.mono, fontSize: 7, bold: true, align: "center", color: C.amber, breakLine: true });
  [0, 1, 2].forEach((idx) => circle(slide, { x: dx + 0.23 + idx * 0.35, y: frame.y + 2.32, w: 0.25, h: 0.25, fill: C.amber }));
  addText(slide, "现场按键\n不可远程伪造", { x: dx + 0.12, y: frame.y + 2.95, w: 1.06, h: 0.32, fontSize: 7.2, bold: true, align: "center", color: C.white, breakLine: true });
  line(slide, frame.x + 3.55, frame.y + 2.4, dx - 0.12, frame.y + 2.4, C.amber, { pt: 1.25, endArrowType: "triangle" });
  stat(slide, s, { x: 3.82, y: 5.2, w: 2.25, h: 1.05 });
}

function athens(slide, s) {
  titleBlock(slide, s, { titleSize: 29, w: 5.95, claimY: 2.02 });
  bullets(slide, s, { y: 3.0, w: 5.58, fontSize: 7.3 });
  const frame = { x: 6.55, y: 1.13, w: 5.85, h: 5.02 };
  rr(slide, { ...frame, fill: "16072F", transparency: 0, lineColor: C.purple, linePt: 1.15 });
  const agents = [
    ["Socrates", "红队质疑", "绕过路径 / 攻击链假设", C.amber],
    ["Plato", "蓝队防护", "处置策略 / 运维可行性", C.cyan],
    ["Aristotle", "仲裁输出", "证据综合 / 冲突裁决", C.purple],
  ];
  agents.forEach(([name, role, note, color], idx) => {
    const x = frame.x + 0.45 + idx * 1.78;
    circle(slide, { x: x + 0.43, y: frame.y + 0.78, w: 0.75, h: 0.75, fill: color });
    addText(slide, name[0], { x: x + 0.43, y: frame.y + 1.02, w: 0.75, h: 0.1, fontSize: 11, bold: true, align: "center", color: C.white });
    rr(slide, { x, y: frame.y + 1.92, w: 1.58, h: 1.45, fill: C.ink, transparency: 5, lineColor: color, linePt: 1 });
    addText(slide, name, { x: x + 0.16, y: frame.y + 2.15, w: 1.26, h: 0.1, fontFace: F.mono, fontSize: 7.8, bold: true, align: "center", color });
    addText(slide, role, { x: x + 0.16, y: frame.y + 2.54, w: 1.26, h: 0.1, fontSize: 8.4, bold: true, align: "center", color: C.white });
    addText(slide, note, { x: x + 0.16, y: frame.y + 2.9, w: 1.26, h: 0.16, fontSize: 6.2, align: "center", color: C.pale, breakLine: true });
  });
  line(slide, frame.x + 2.04, frame.y + 2.64, frame.x + 2.38, frame.y + 2.64, C.purple, { pt: 1.15, endArrowType: "triangle" });
  line(slide, frame.x + 3.82, frame.y + 2.64, frame.x + 4.16, frame.y + 2.64, C.purple, { pt: 1.15, endArrowType: "triangle" });
  rr(slide, { x: frame.x + 0.55, y: frame.y + 4.12, w: frame.w - 1.1, h: 0.48, fill: "EAF3FF", lineColor: C.green, linePt: 0.9 });
  addText(slide, "输出：风险判断 + 处置建议 + 可审计讨论记录", { x: frame.x + 0.78, y: frame.y + 4.27, w: frame.w - 1.56, h: 0.1, fontSize: 8.6, bold: true, align: "center", color: C.text });
  stat(slide, s, { x: 3.82, y: 5.2, w: 2.25, h: 1.05 });
}

function architecture(slide, s) {
  titleBlock(slide, s, { titleSize: 27, w: 5.75 });
  bullets(slide, s, { y: 3.0, w: 5.45, fontSize: 7.4 });
  const frame = { x: 6.55, y: 1.25, w: 5.85, h: 4.75 };
  rr(slide, { ...frame, fill: C.navy, transparency: 5, lineColor: C.purple, linePt: 1 });
  [
    ["访问层", "React 控制台", C.cyan],
    ["控制平面", "Express / Socket.IO / 服务编排", C.green],
    ["雅典学院 AI 决策层", "Socrates / Plato / Aristotle", C.purple],
    ["支撑层", "SQLite / Postgres / Redis / 审计", C.amber],
    ["受管对象层", "Agent / Site / ESP32 / Rust fastpath", C.cyan],
  ].forEach(([name, value, color], idx) => {
    const y = frame.y + 0.42 + idx * 0.77;
    rr(slide, { x: frame.x + 0.42, y, w: frame.w - 0.84, h: 0.5, fill: C.ink, transparency: 8, lineColor: color, lineTransparency: 35, linePt: 0.9 });
    addText(slide, name, { x: frame.x + 0.64, y: y + 0.16, w: 1.6, h: 0.1, fontSize: 8, bold: true, color });
    addText(slide, value, { x: frame.x + 2.36, y: y + 0.16, w: 3.0, h: 0.1, fontSize: 7.4, color: C.white });
  });
}

function proof(slide, s) {
  titleBlock(slide, s, { titleSize: 27, w: 5.75 });
  bullets(slide, s, { y: 3.0, w: 5.45, fontSize: 7.3 });
  screenshot(slide, s, "05-agent-monitor.png", "主证据：Multi-Agent Monitor", { x: 6.35, y: 1.18, w: 5.95, h: 3.25 });
  const small = [
    ["02-dashboard.png", "Dashboard"],
    ["07-devices.png", "Devices"],
    ["14-alerts.png", "Alerts"],
  ];
  small.forEach(([file, cap], idx) => screenshot(slide, s, file, cap, { x: 6.35 + idx * 2.0, y: 4.62, w: 1.83, h: 1.22 }));
}

function timeline(slide, s) {
  titleBlock(slide, s);
  bullets(slide, s, { y: 3.0, w: 5.45, fontSize: 7.4 });
  const frame = { x: 6.55, y: 1.35, w: 5.85, h: 4.7 };
  rr(slide, { ...frame, fill: C.white, lineColor: C.green, linePt: 1 });
  const items = [
    ["现在", "可演示平台与硬件原型", C.cyan],
    ["决赛后", "打磨部署、确认、审计闭环", C.purple],
    ["试点期", "接入真实服务器场景", C.amber],
    ["复制期", "沉淀交付包和行业案例", C.green],
  ];
  line(slide, frame.x + 0.72, frame.y + 0.65, frame.x + 0.72, frame.y + 4.0, C.cyan, { pt: 1.3 });
  items.forEach(([t, tx, color], idx) => {
    const y = frame.y + 0.65 + idx * 1.05;
    circle(slide, { x: frame.x + 0.54, y: y - 0.18, w: 0.36, h: 0.36, fill: color });
    rr(slide, { x: frame.x + 1.1, y: y - 0.27, w: 4.25, h: 0.54, fill: C.light, lineColor: color, linePt: 0.8, lineTransparency: 35 });
    addText(slide, t, { x: frame.x + 1.3, y: y - 0.1, w: 0.9, h: 0.1, fontSize: 8.4, bold: true, color });
    addText(slide, tx, { x: frame.x + 2.15, y: y - 0.1, w: 3.0, h: 0.1, fontSize: 7.7, color: C.text });
  });
}

function business(slide, s) {
  titleBlock(slide, s);
  bullets(slide, s, { y: 3.0, w: 5.45, fontSize: 7.4 });
  cards(slide, s, [
    ["订阅", "节点 / 站点 / 企业版", C.cyan],
    ["硬件", "高危操作安全配件", C.amber],
    ["交付", "政企、园区、信创场景", C.purple],
    ["服务", "演练、配置、响应支持", C.green],
  ], { x: 6.55, y: 1.32, w: 5.95, h: 4.85 });
}

function landing(slide, s) {
  titleBlock(slide, s, { titleSize: 27, w: 5.75 });
  bullets(slide, s, { y: 3.0, w: 5.45, fontSize: 7.4 });
  cards(slide, s, [
    ["园区企业", "服务器与应用链路保护", C.cyan],
    ["数字城市", "高危操作确认与审计", C.purple],
    ["信创安全", "数据留在本地边界", C.amber],
    ["AI 安全", "监控、演练、复盘闭环", C.green],
  ], { x: 6.55, y: 1.32, w: 5.95, h: 4.85 });
}

function closing(slide, s) {
  addText(slide, "AetherGuard", { x: 0.74, y: 0.82, w: 4.1, h: 0.4, fontSize: 25, bold: true, color: C.cyan });
  addText(slide, s.title, { x: 0.72, y: 1.55, w: 6.4, h: 0.78, fontSize: 31, bold: true, color: C.white, breakLine: true });
  addText(slide, s.claim, { x: 0.76, y: 2.58, w: 6.1, h: 0.44, fontSize: 12, color: C.pale, breakLine: true });
  const items = [
    ["问题具体", "高危操作缺少独立可信确认", C.red],
    ["技术差异", "Agent + 雅典学院 + ESP32", C.purple],
    ["产品可演示", "已有连续页面和硬件链路", C.green],
    ["落地清楚", "园区、数字城市、信创、AI 安全", C.cyan],
  ];
  items.forEach(([t, tx, color], idx) => {
    const x = 7.1 + (idx % 2) * 2.55;
    const y = 1.35 + Math.floor(idx / 2) * 2.05;
    rr(slide, { x, y, w: 2.25, h: 1.65, fill: C.navy, transparency: 2, lineColor: color, linePt: 1.1 });
    addText(slide, `0${idx + 1}`, { x: x + 0.2, y: y + 0.16, w: 0.5, h: 0.14, fontFace: F.mono, fontSize: 10, bold: true, color });
    addText(slide, t, { x: x + 0.2, y: y + 0.62, w: 1.82, h: 0.16, fontSize: 12, bold: true, color: C.white });
    addText(slide, tx, { x: x + 0.2, y: y + 1.03, w: 1.82, h: 0.18, fontSize: 7.0, color: C.pale, breakLine: true });
  });
  rr(slide, { x: 0.78, y: 5.42, w: 4.6, h: 0.52, fill: C.panel, transparency: 10, lineColor: C.cyan, linePt: 0.9, lineTransparency: 45 });
  addText(slide, "期待与雄安场景、产业资源和试点机会对接", { x: 1.0, y: 5.6, w: 4.1, h: 0.1, fontSize: 9, bold: true, color: C.white });
}

const renderers = {
  cover,
  riskGate,
  scenarioCards,
  loop,
  screenshot: screenshotPage,
  hardwareGate,
  athens,
  architecture,
  proof,
  timeline,
  business,
  landing,
  closing,
};

function buildSlide(deck, s, i) {
  const slide = deck.addSlide();
  background(slide, s);
  if (s.visual !== "cover" && s.visual !== "closing") {
    header(slide, s, i, slides.length);
  }
  renderers[s.visual](slide, s);
  footer(slide, s);
  slide.addNotes(s.note);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const pptx = new PptxGenJS();
  pptx.author = "OpenAI Codex";
  pptx.company = "杭州视界奇点科技有限公司";
  pptx.subject = "AetherGuard 雄才杯2026决赛视觉增强版";
  pptx.title = "AetherGuard 雄才杯决赛版 视觉增强版";
  pptx.lang = "zh-CN";
  pptx.theme = { headFontFace: F.head, bodyFontFace: F.body, lang: "zh-CN" };
  pptx.defineLayout({ name: "AETHER_WIDE", width: W, height: H });
  pptx.layout = "AETHER_WIDE";
  slides.forEach((s, i) => buildSlide(pptx, s, i));
  await pptx.writeFile({ fileName: OUTPUT_FILE, compression: true });
  console.log(`Generated ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
