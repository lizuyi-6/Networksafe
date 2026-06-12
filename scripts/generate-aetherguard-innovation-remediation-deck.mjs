import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "generated");
const ASSET_DIR = path.join(OUT_DIR, "aetherguard-remediation-assets");
const OUT_FILE = path.join(OUT_DIR, "AetherGuard-大学生创新创业大赛-整改版-GPT图像增强.pptx");

const W = 13.333;
const H = 7.5;

const C = {
  black: "050506",
  black2: "0B0B0D",
  panel: "111113",
  panel2: "1A1712",
  gold: "D9A441",
  gold2: "F3D18A",
  pale: "FFF0CA",
  muted: "CBB88A",
  line: "8E6B2C",
  red: "B72018",
  red2: "E14632",
  white: "FFFFFF",
  gray: "B7B7B7",
  green: "56D58A",
  amber: "FFB84C",
  blue: "64C7FF",
};

const F = {
  h: "Microsoft YaHei",
  k: "KaiTi",
  s: "SimSun",
  m: "Consolas",
};

const img = {
  esp32: path.join(ASSET_DIR, "ai-esp32-physical-gate.png"),
  agents: path.join(ASSET_DIR, "ai-seven-layer-agents.png"),
  evidence: path.join(ASSET_DIR, "ai-evidence-chain.png"),
  roadmap: path.join(ASSET_DIR, "ai-commercial-roadmap.png"),
  dashboard: firstExisting([
    path.join(ROOT, "output", "playwright", "softcopyright-aetherguard-v1", "02-dashboard.png"),
    path.join(ROOT, "frontend", "public", "pitch", "02-dashboard.png"),
  ]),
  agentsPage: firstExisting([
    path.join(ROOT, "output", "playwright", "softcopyright-aetherguard-v1", "03-agents.png"),
    path.join(ROOT, "frontend", "public", "pitch", "03-agents.png"),
  ]),
  monitor: firstExisting([
    path.join(ROOT, "output", "playwright", "softcopyright-aetherguard-v1", "05-agent-monitor.png"),
    path.join(ROOT, "frontend", "public", "pitch", "05-agent-monitor.png"),
  ]),
  devices: firstExisting([
    path.join(ROOT, "output", "playwright", "softcopyright-aetherguard-v1", "08-devices.png"),
    path.join(ROOT, "frontend", "public", "pitch", "07-devices.png"),
  ]),
  scanner: firstExisting([
    path.join(ROOT, "output", "playwright", "softcopyright-aetherguard-v1", "13-scanner.png"),
    path.join(ROOT, "frontend", "public", "pitch", "12-scanner.png"),
  ]),
  alerts: firstExisting([
    path.join(ROOT, "output", "playwright", "softcopyright-aetherguard-v1", "14-alerts.png"),
    path.join(ROOT, "frontend", "public", "pitch", "14-alerts.png"),
  ]),
};

const evidence = {
  codeStats: "607个源码文件 / 17.68万行；需团队确认学生贡献占比",
  aiPaths: [
    "backend/src/ai-agents/core/agent-orchestrator.ts",
    "backend/src/ai-agents/debate/debate-protocol.ts",
    "backend/src/ai-agents/core/scoring.ts",
  ],
  hwPaths: [
    "esp32/src/main.cpp",
    "hardware/factory/aetherguard-serial-deployer-ev1/manufacturing-readiness.md",
    "hardware/kicad/aetherguard-control-board-v1/",
  ],
  reports: [
    "docs/reports/validated-capability-status-2026-03-08.md",
    "docs/papers/ieee-access-submission/experimental-results/owasp-web-eval-summary.md",
    "docs/legal/softcopyright/README.md",
  ],
};

const slides = [
  {
    section: "重构版",
    title: "AetherGuard",
    subtitle: "服务器高危操作的 AI + 硬件可信确认平台",
    quote: "把“远程软件权限确认”升级为“AI 研判 + 物理现场确认 + 审计证据链”。",
    bg: img.esp32,
    kind: "cover",
    note: "开场先把项目定义收窄：不是泛网络安全平台，而是解决关键服务器高危操作缺少可信确认的问题。",
  },
  {
    section: "评委视角",
    title: "先承认四个硬伤，再给出整改口径",
    subtitle: "这版 PPT 的目标不是更炫，而是让评委找不到致命口子",
    kind: "fourRisks",
    bg: img.evidence,
    note: "这一页用于主动拆弹。不要回避创业组、学生主体性、ESP32 场景和知识产权四个问题。",
  },
  {
    section: "赛道选择",
    title: "创业组必须拿商业证据说话",
    subtitle: "没有公司、营收、合同，就建议转报高教主赛道本科生创意组",
    kind: "track",
    bg: img.roadmap,
    note: "这是最关键的策略页。若已有注册公司和收入，马上替换占位；若没有，创意组更安全。",
  },
  {
    section: "痛点重写",
    title: "目标场景从“所有云服务器”收窄到特种高可信场景",
    subtitle: "中小企业本地机房、园区私有化、政企/保密内网更适合 ESP32 物理确认",
    kind: "scenario",
    bg: img.esp32,
    note: "这页专门修复 ESP32 悖论。不要说所有云服务器都按键，强调本地机房和保密内网。",
  },
  {
    section: "解决方案",
    title: "四段闭环：发现、研判、确认、留痕",
    subtitle: "Agent-Inside 贴近主机，多 Agent 讨论判断，ESP32 承接高危动作，审计链固化证据",
    kind: "loop",
    note: "这一页讲系统闭环，用通俗语言代替术语堆砌。",
  },
  {
    section: "核心算法",
    title: "7 层多 Agent AI 决策系统：证据要落到代码和实验",
    subtitle: "不是一句“核心算法”，而是可追溯到编排、辩论、打分和实验结果",
    kind: "aiEvidence",
    bg: img.agents,
    note: "这一页回答“证据在哪里”。重点放路径和实验指标，不夸 10w QPS。",
  },
  {
    section: "实验数据",
    title: "多智能体辩论降低误报：用保守指标讲可信",
    subtitle: "OWASP 衍生 32 样本：单智能体 87.5%，多智能体辩论 100%，误报 4 降至 0",
    kind: "experiment",
    note: "这页用现有实验数据，不要扩展成未经验证的大规模商用指标。",
  },
  {
    section: "硬件定位",
    title: "ESP32 不是云服务器万能钥匙，而是高危动作的现场授权门",
    subtitle: "将物理按键明确绑定到 On-Premise、IDC 运维窗口、保密内网和教学实验场景",
    kind: "hardwarePosition",
    bg: img.esp32,
    note: "解释为什么物理按键合理：它面向有限但高价值的场景。",
  },
  {
    section: "硬件证据",
    title: "硬件确认门证据链：固件、协议、PCB、BOM",
    subtitle: "当前应表述为工程原型和可打样链路，不要提前写量产成熟",
    kind: "hardwareEvidence",
    bg: img.evidence,
    note: "这里要诚实：有 PCB 打样准备和验证文档，但不能宣称已量产。",
  },
  {
    section: "产品原型",
    title: "已有可演示产品链路，而不是概念图",
    subtitle: "控制台、Agent、设备、扫描、告警和软著截图材料可以组成演示证据墙",
    kind: "productWall",
    note: "把产品截图作为可信度支撑，避免 PPT 只讲概念。",
  },
  {
    section: "学生主体性",
    title: "学生主体性要用研发历程和分工证明",
    subtitle: "从课程问题、实验室迭代、代码提交、竞赛训练到知识产权署名，形成教育维度闭环",
    kind: "student",
    note: "这一页避免被质疑套壳。具体成员、课程和奖项需要团队补真实信息。",
  },
  {
    section: "知识产权",
    title: "知识产权从“1 项软著”升级为“软著 + 双专利布局”",
    subtitle: "立即补提：多 Agent 决策方法、ESP32 物理确认与断路机制",
    kind: "ip",
    note: "如果还没提交专利，不要写申请号；写拟申请/已进入代理撰写，提交后再替换。",
  },
  {
    section: "商业模式",
    title: "商业模式改成三级火箭",
    subtitle: "免费社区版获客，SaaS 订阅变现，私有化 + 硬件承接高价值客户",
    kind: "business",
    bg: img.roadmap,
    note: "用三级火箭替换不可信的对赌分成。",
  },
  {
    section: "成果表达",
    title: "项目成果按“商业、技术、教育、社会价值”四栏写",
    subtitle: "创业组补商业数据；创意组突出技术硬度、学生成长和可转化路径",
    kind: "results",
    note: "这页可直接改成报名表项目成果栏目。",
  },
  {
    section: "冲刺清单",
    title: "7 天内补齐最关键的证据",
    subtitle: "把“评委相信”变成“附件可查、现场可演示、数字不虚构”",
    kind: "checklist",
    bg: img.evidence,
    note: "最后给团队执行清单，避免只停留在 PPT 润色。",
  },
  {
    section: "收束",
    title: "答辩只让评委记住三句话",
    subtitle: "场景收窄、证据可查、商业不虚构",
    kind: "closing",
    bg: img.agents,
    note: "结尾用三句话收束。根据最终赛道调整第一句话。",
  },
];

function firstExisting(paths) {
  return paths.find((p) => fs.existsSync(p));
}

function requireImage(p) {
  if (!p || !fs.existsSync(p)) throw new Error(`Missing image asset: ${p}`);
  return p;
}

function addBg(slide, bg, dim = 18) {
  slide.addShape("rect", { x: 0, y: 0, w: W, h: H, fill: { color: C.black }, line: { color: C.black } });
  if (bg) slide.addImage({ path: requireImage(bg), x: 0, y: 0, w: W, h: H });
  slide.addShape("rect", { x: 0, y: 0, w: W, h: H, fill: { color: C.black, transparency: dim }, line: { color: C.black, transparency: 100 } });
  slide.addShape("arc", { x: -0.7, y: 5.9, w: 4.8, h: 1.9, line: { color: C.gold, transparency: 35, width: 2 }, adjustPoint: 0.35 });
  slide.addShape("line", { x: 0.35, y: 7.08, w: 12.55, h: 0, line: { color: C.line, transparency: 25, width: 1 } });
}

function addHeader(slide, s, i) {
  slide.addShape("rect", { x: 0.38, y: 0.24, w: 1.16, h: 0.36, fill: { color: C.red }, line: { color: C.red, transparency: 100 }, rotate: -1 });
  slide.addText(`Part ${String(Math.floor(i / 4) + 1).padStart(2, "0")}`, {
    x: 0.46, y: 0.28, w: 1.0, h: 0.24, fontFace: F.h, fontSize: 11, bold: true, italic: true, color: C.white, margin: 0.02,
  });
  slide.addText(s.section, {
    x: 1.7, y: 0.22, w: 3.0, h: 0.35, fontFace: F.h, fontSize: 17, bold: true, color: C.gold2, margin: 0,
  });
  slide.addText(`${String(i + 1).padStart(2, "0")} / ${slides.length}`, {
    x: 11.3, y: 0.23, w: 1.55, h: 0.34, align: "right", fontFace: F.m, fontSize: 15, bold: true, color: C.gold2, margin: 0,
  });
}

function addFooter(slide) {
  slide.addText("AetherGuard  ·  大学生创新创业大赛整改版  ·  保守证据口径", {
    x: 0.65, y: 7.12, w: 8.5, h: 0.18, fontFace: F.h, fontSize: 8.5, color: C.muted, margin: 0,
  });
}

function addTitle(slide, title, subtitle, y = 0.85, w = 11.8) {
  slide.addText(title, {
    x: 0.65, y, w, h: 0.58, fontFace: F.k, fontSize: 29, bold: true, color: C.gold2, breakLine: false, margin: 0,
    fit: "shrink",
  });
  slide.addText(subtitle, {
    x: 0.7, y: y + 0.67, w: Math.min(w, 10.9), h: 0.32, fontFace: F.h, fontSize: 13.5, color: C.pale, margin: 0,
    fit: "shrink",
  });
  slide.addShape("line", { x: 0.7, y: y + 1.1, w: 5.2, h: 0, line: { color: C.gold, transparency: 15, width: 1.2 } });
}

function addPanel(slide, x, y, w, h, opts = {}) {
  slide.addShape("rect", {
    x, y, w, h,
    fill: { color: opts.fill || C.panel, transparency: opts.transparency ?? 4 },
    line: { color: opts.line || C.line, transparency: opts.lineTransparency ?? 0, width: opts.width || 1.1 },
    radius: 0.06,
  });
}

function addPill(slide, text, x, y, w, color = C.red) {
  slide.addShape("rect", { x, y, w, h: 0.34, fill: { color }, line: { color, transparency: 100 }, radius: 0.08 });
  slide.addText(text, { x: x + 0.08, y: y + 0.07, w: w - 0.16, h: 0.16, align: "center", fontFace: F.h, fontSize: 9.5, bold: true, color: C.white, margin: 0 });
}

function addBullets(slide, items, x, y, w, size = 12.2, color = C.pale, gap = 0.43) {
  items.forEach((text, idx) => {
    const yy = y + idx * gap;
    slide.addText("◆", { x, y: yy + 0.02, w: 0.16, h: 0.16, fontFace: F.h, fontSize: 8, color: idx % 2 ? C.gold : C.red2, margin: 0 });
    slide.addText(text, { x: x + 0.25, y: yy, w, h: 0.28, fontFace: F.h, fontSize: size, color, margin: 0.01, fit: "shrink" });
  });
}

function addEvidence(slide, text, x = 0.72, y = 6.62, w = 11.8) {
  slide.addShape("rect", { x, y, w, h: 0.32, fill: { color: C.black, transparency: 8 }, line: { color: C.gold, transparency: 45, width: 0.6 } });
  slide.addText(`证据口径：${text}`, { x: x + 0.13, y: y + 0.08, w: w - 0.25, h: 0.15, fontFace: F.h, fontSize: 8.2, color: C.muted, margin: 0, fit: "shrink" });
}

function addMetric(slide, value, label, x, y, w, accent = C.gold) {
  addPanel(slide, x, y, w, 0.88, { fill: C.black2, line: accent, lineTransparency: 15 });
  slide.addText(value, { x: x + 0.12, y: y + 0.12, w: w - 0.24, h: 0.28, fontFace: F.h, fontSize: 20, bold: true, color: accent, align: "center", margin: 0, fit: "shrink" });
  slide.addText(label, { x: x + 0.12, y: y + 0.53, w: w - 0.24, h: 0.16, fontFace: F.h, fontSize: 8.5, color: C.pale, align: "center", margin: 0, fit: "shrink" });
}

function addCover(slide, s) {
  slide.addText("AETHERGUARD  |  INTER-COLLEGE INNOVATION CONTEST 2026", {
    x: 0.55, y: 0.37, w: 6.6, h: 0.22, fontFace: F.m, fontSize: 10, bold: true, color: C.gold2, margin: 0,
  });
  slide.addText("AetherGuard", { x: 0.62, y: 1.25, w: 6.6, h: 0.72, fontFace: "Arial", fontSize: 42, bold: true, color: C.gold2, margin: 0 });
  slide.addText("让服务器拥有\n自主免疫能力", {
    x: 0.62, y: 2.16, w: 6.1, h: 1.45, fontFace: F.k, fontSize: 34, bold: true, color: C.white, breakLine: false, margin: 0,
    fit: "shrink",
  });
  slide.addText(s.subtitle, { x: 0.68, y: 4.0, w: 6.6, h: 0.3, fontFace: F.h, fontSize: 16, color: C.gold2, margin: 0 });
  slide.addText(s.quote, { x: 0.72, y: 4.45, w: 5.9, h: 0.52, fontFace: F.h, fontSize: 13, color: C.pale, margin: 0, fit: "shrink" });
  ["Multi-Agent", "Agent-Inside", "Physical Trust Root"].forEach((t, idx) => {
    const x = 0.72 + idx * 2.2;
    addPanel(slide, x, 5.55, 1.9, 0.46, { fill: C.black, line: C.gold });
    slide.addText(t, { x: x + 0.1, y: 5.68, w: 1.7, h: 0.14, fontFace: F.h, fontSize: 9.2, bold: true, color: C.gold2, align: "center", margin: 0 });
  });
  addPill(slide, "整改版：证据链增强 / 商业口径保守 / 生图视觉增强", 0.72, 6.22, 4.2, C.red);
}

function addFourRisks(slide) {
  addTitle(slide, "先承认四个硬伤，再给出整改口径", "把评委会追问的问题，提前写成答辩结构");
  const cards = [
    ["赛道错配", "创业组必须补公司、营收、合同；没有就转创意组。", "优先级 S"],
    ["学生主体性", "用课程来源、提交记录、学生第一作者/发明人证明不是套壳。", "优先级 A"],
    ["硬件悖论", "ESP32 只定位本地机房、IDC 窗口、保密内网等特种场景。", "优先级 A"],
    ["知识产权", "软著之外补 2 项专利：多 Agent 决策、物理确认断路。", "优先级 A"],
  ];
  cards.forEach(([h, b, tag], i) => {
    const x = 0.75 + (i % 2) * 6.05;
    const y = 2.15 + Math.floor(i / 2) * 1.55;
    addPanel(slide, x, y, 5.45, 1.2, { fill: C.black2, line: i === 0 ? C.red : C.gold });
    addPill(slide, tag, x + 3.95, y + 0.12, 1.15, i === 0 ? C.red : C.gold);
    slide.addText(h, { x: x + 0.2, y: y + 0.16, w: 2.2, h: 0.24, fontFace: F.h, fontSize: 17, bold: true, color: i === 0 ? C.red2 : C.gold2, margin: 0 });
    slide.addText(b, { x: x + 0.22, y: y + 0.55, w: 4.95, h: 0.34, fontFace: F.h, fontSize: 11.6, color: C.pale, margin: 0.01, fit: "shrink" });
  });
  addEvidence(slide, "本页直接对应评委四大致命硬伤，后续页面逐项给材料和口径。");
}

function addTrack(slide) {
  addTitle(slide, "创业组必须拿商业证据说话", "报名策略先于 PPT 美化：赛道不对，技术再硬也吃亏");
  addPanel(slide, 0.78, 2.05, 5.75, 3.82, { fill: C.black, line: C.red, width: 1.5 });
  addPanel(slide, 6.85, 2.05, 5.75, 3.82, { fill: C.black, line: C.gold, width: 1.5 });
  slide.addText("若坚持创业组", { x: 1.05, y: 2.36, w: 2.8, h: 0.32, fontFace: F.h, fontSize: 20, bold: true, color: C.red2, margin: 0 });
  addBullets(slide, [
    "已注册公司：名称 / 统一社会信用代码",
    "真实营收：金额、合同、发票或回款凭证",
    "种子客户：PoC、试用协议、采购意向",
    "财务模型：节点订阅、私有化交付、硬件配套",
  ], 1.08, 2.9, 4.65, 11.5, C.pale, 0.5);
  slide.addText("缺一项就会被追问：商业落地在哪里？", { x: 1.05, y: 5.3, w: 4.95, h: 0.22, fontFace: F.h, fontSize: 12.5, bold: true, color: C.red2, margin: 0 });
  slide.addText("若暂无营收", { x: 7.12, y: 2.36, w: 2.8, h: 0.32, fontFace: F.h, fontSize: 20, bold: true, color: C.gold2, margin: 0 });
  addBullets(slide, [
    "建议改报：高教主赛道 - 本科生创意组",
    "主打技术硬核、原型完成度、学生成长",
    "商业写“转化计划”，不写虚构收入",
    "把 ESP32 + 多 Agent 作为降维打击亮点",
  ], 7.15, 2.9, 4.75, 11.5, C.pale, 0.5);
  slide.addText("本稿默认采用“保守口径”，所有商业数字留占位。", { x: 7.12, y: 5.3, w: 5.0, h: 0.22, fontFace: F.h, fontSize: 12.5, bold: true, color: C.green, margin: 0 });
  addEvidence(slide, "公司、营收、客户、合同均需团队提供真实附件；未提供前不得替写。");
}

function addScenario(slide) {
  addTitle(slide, "目标场景从“所有云服务器”收窄到特种高可信场景", "ESP32 的价值在现场授权，不在替代云原生运维");
  const items = [
    ["中小企业本地机房", "缺专职安全团队，危险动作需要低成本现场兜底。"],
    ["园区/学校私有化", "数据不便外发，适合本地 Agent + 私有控制台。"],
    ["保密/政企内网", "物理隔离、审计留痕和人为授权本来就是流程要求。"],
    ["IDC 运维窗口", "设备放在机柜或运维台，仅在变更窗口现场确认。"],
  ];
  items.forEach(([h, b], i) => {
    const x = 0.78 + i * 3.08;
    addPanel(slide, x, 2.25, 2.75, 2.65, { fill: C.black, line: i < 2 ? C.gold : C.red });
    slide.addText(String(i + 1).padStart(2, "0"), { x: x + 0.18, y: 2.45, w: 0.55, h: 0.28, fontFace: F.m, fontSize: 20, bold: true, color: i < 2 ? C.gold2 : C.red2, margin: 0 });
    slide.addText(h, { x: x + 0.24, y: 3.02, w: 2.25, h: 0.28, fontFace: F.h, fontSize: 15, bold: true, color: C.pale, align: "center", margin: 0, fit: "shrink" });
    slide.addText(b, { x: x + 0.28, y: 3.62, w: 2.15, h: 0.56, fontFace: F.h, fontSize: 10.5, color: C.muted, align: "center", margin: 0.01, fit: "shrink" });
  });
  addPill(slide, "口径修正：不再宣称适用于所有云端服务器", 3.65, 5.34, 5.9, C.red);
  addEvidence(slide, "硬件价值限定在 On-Premise / 保密内网 / IDC 变更窗口，避免评委质疑不懂云运维。");
}

function addLoop(slide) {
  addTitle(slide, "四段闭环：发现、研判、确认、留痕", "把专业名词翻译成非技术评委也能理解的安全流程");
  const steps = [
    ["1", "发现", "Agent-Inside\n贴近服务器现场"],
    ["2", "研判", "多 Agent 讨论\n红队质疑/蓝队防御/仲裁"],
    ["3", "确认", "ESP32 物理按键\n高危动作现场授权"],
    ["4", "留痕", "WORM 审计链\n事后可核验追责"],
  ];
  steps.forEach(([n, h, b], i) => {
    const x = 0.8 + i * 3.05;
    slide.addShape("ellipse", { x: x + 0.86, y: 2.15, w: 0.76, h: 0.76, fill: { color: i === 2 ? C.red : C.gold }, line: { color: C.pale, transparency: 20 } });
    slide.addText(n, { x: x + 1.06, y: 2.34, w: 0.36, h: 0.18, fontFace: F.m, fontSize: 15, bold: true, color: C.black, align: "center", margin: 0 });
    addPanel(slide, x, 3.05, 2.5, 1.55, { fill: C.black2, line: i === 2 ? C.red : C.gold });
    slide.addText(h, { x: x + 0.2, y: 3.25, w: 2.1, h: 0.25, fontFace: F.h, fontSize: 18, bold: true, color: i === 2 ? C.red2 : C.gold2, align: "center", margin: 0 });
    slide.addText(b, { x: x + 0.22, y: 3.74, w: 2.05, h: 0.44, fontFace: F.h, fontSize: 10.5, color: C.pale, align: "center", breakLine: false, margin: 0.01, fit: "shrink" });
    if (i < steps.length - 1) slide.addShape("line", { x: x + 2.55, y: 2.52, w: 0.46, h: 0, line: { color: C.gold, width: 2, beginArrowType: "none", endArrowType: "triangle" } });
  });
  addPanel(slide, 1.1, 5.38, 11.15, 0.65, { fill: C.black, line: C.red });
  slide.addText("通俗表达：传统防护像“只看门口监控”，AetherGuard 像给服务器装“内窥镜”并给危险动作加“实体确认键”。", {
    x: 1.35, y: 5.58, w: 10.65, h: 0.2, fontFace: F.h, fontSize: 12.8, bold: true, color: C.pale, align: "center", margin: 0,
  });
  addEvidence(slide, "控制台、Agent、设备流、审计链已有实现；高危物理确认以模拟设备链路验证为当前证据。");
}

function addAiEvidence(slide) {
  addTitle(slide, "7 层多 Agent AI 决策系统：证据要落到代码和实验", "把“原创算法”拆成可检查的实现路径");
  addPanel(slide, 0.74, 2.1, 5.2, 3.88, { fill: C.black, line: C.gold });
  slide.addText("核心机制", { x: 1.0, y: 2.36, w: 1.8, h: 0.25, fontFace: F.h, fontSize: 18, bold: true, color: C.gold2, margin: 0 });
  addBullets(slide, [
    "Agent Orchestrator：任务分配、角色调用、结果聚合",
    "Debate Protocol：Socrates / Plato / Aristotle 多轮辩论",
    "Scoring：分歧度、置信度区间、仲裁输出",
    "Model Routing：本地/云端模型按隐私策略路由",
  ], 1.02, 2.92, 4.5, 10.2, C.pale, 0.46);
  addPanel(slide, 6.25, 2.1, 6.25, 3.88, { fill: C.black, line: C.red });
  slide.addText("证据路径", { x: 6.55, y: 2.36, w: 1.8, h: 0.25, fontFace: F.h, fontSize: 18, bold: true, color: C.red2, margin: 0 });
  addBullets(slide, evidence.aiPaths, 6.58, 2.95, 5.55, 9.2, C.pale, 0.52);
  addMetric(slide, "100%", "多智能体辩论准确率（32样本）", 6.72, 4.9, 1.7, C.green);
  addMetric(slide, "0", "误报数", 8.65, 4.9, 1.35, C.green);
  addMetric(slide, "37.5%", "辩论触发率", 10.23, 4.9, 1.7, C.gold2);
  addEvidence(slide, "实验来源：docs/papers/ieee-access-submission/experimental-results/owasp-web-eval-summary.md。");
}

function addExperiment(slide) {
  addTitle(slide, "多智能体辩论降低误报：用保守指标讲可信", "只讲当前仓库可验证的数据，不写 10w+ QPS / <5ms");
  const baseX = 1.0;
  const y = 2.45;
  const chart = [
    ["单智能体", 87.5, C.red2, "FP=4"],
    ["多智能体\n无辩论", 87.5, C.amber, "FP=4"],
    ["多智能体\n有辩论", 100, C.green, "FP=0"],
  ];
  chart.forEach(([label, val, color, fp], i) => {
    const x = baseX + i * 3.55;
    addPanel(slide, x, y, 2.8, 2.75, { fill: C.black2, line: color });
    slide.addShape("rect", { x: x + 0.78, y: y + 1.95 - (val / 100) * 1.5, w: 1.1, h: (val / 100) * 1.5, fill: { color }, line: { color, transparency: 100 } });
    slide.addText(`${val}%`, { x: x + 0.35, y: y + 0.25, w: 2.1, h: 0.34, fontFace: F.h, fontSize: 22, bold: true, color, align: "center", margin: 0 });
    slide.addText(label, { x: x + 0.35, y: y + 2.12, w: 2.1, h: 0.32, fontFace: F.h, fontSize: 11.5, bold: true, color: C.pale, align: "center", breakLine: false, margin: 0, fit: "shrink" });
    slide.addText(fp, { x: x + 0.35, y: y + 2.48, w: 2.1, h: 0.15, fontFace: F.m, fontSize: 8.8, color: C.muted, align: "center", margin: 0 });
  });
  addPanel(slide, 1.15, 5.72, 11.0, 0.52, { fill: C.black, line: C.gold });
  slide.addText("解释边界：32 个 OWASP 衍生样本是原型验证，不等于商业生产环境大规模实测；Fastpath 当前证据为 1329.79 QPS / P95 21ms。", {
    x: 1.35, y: 5.9, w: 10.6, h: 0.16, fontFace: F.h, fontSize: 9.8, color: C.pale, align: "center", margin: 0,
  });
  addEvidence(slide, "真实性口径来自 docs/reports/validated-capability-status-2026-03-08.md，明确不支持 100000+ QPS 等强宣称。");
}

function addHardwarePosition(slide) {
  addTitle(slide, "ESP32 是现场授权门，不是云服务器万能钥匙", "把硬件悖论改成场景优势");
  addPanel(slide, 0.78, 2.05, 5.1, 3.8, { fill: C.black, line: C.gold });
  slide.addText("不可再这样讲", { x: 1.05, y: 2.32, w: 2.2, h: 0.25, fontFace: F.h, fontSize: 18, bold: true, color: C.red2, margin: 0 });
  addBullets(slide, [
    "所有服务器高危操作都必须现场按键",
    "云上 ECS / 容器节点统一接硬件确认",
    "硬件已经大规模量产和部署",
  ], 1.05, 2.92, 4.25, 11.4, C.pale, 0.55);
  addPanel(slide, 6.25, 2.05, 5.95, 3.8, { fill: C.black, line: C.green });
  slide.addText("推荐这样讲", { x: 6.55, y: 2.32, w: 2.2, h: 0.25, fontFace: F.h, fontSize: 18, bold: true, color: C.green, margin: 0 });
  addBullets(slide, [
    "面向本地机房、保密内网、IDC 运维窗口",
    "高危动作才触发：安装/卸载、擦除、关键配置",
    "服务器被攻陷时，远程攻击者仍无法替代现场确认",
    "当前为工程原型与验证链路，逐步进入小规模试点",
  ], 6.55, 2.92, 4.95, 11.4, C.pale, 0.47);
  addEvidence(slide, "README 将 ESP32 serial deployment dongle 定义为 local deployment/removal workflow 的 physical confirmation。");
}

function addHardwareEvidence(slide, s) {
  addTitle(slide, s.title, s.subtitle);
  addPanel(slide, 0.75, 2.05, 3.75, 3.85, { fill: C.black2, line: C.gold });
  addPanel(slide, 4.8, 2.05, 3.75, 3.85, { fill: C.black2, line: C.gold });
  addPanel(slide, 8.85, 2.05, 3.75, 3.85, { fill: C.black2, line: C.red });
  slide.addText("固件与协议", { x: 1.05, y: 2.34, w: 3.1, h: 0.24, fontFace: F.h, fontSize: 17, bold: true, color: C.gold2, align: "center", margin: 0 });
  addBullets(slide, ["esp32/src/main.cpp", "button_handler / display / transport", "AG:REQ -> BEGIN / STEP / OK / ERR"], 1.05, 2.9, 3.05, 9.5, C.pale, 0.48);
  slide.addText("电路与打样", { x: 5.1, y: 2.34, w: 3.1, h: 0.24, fontFace: F.h, fontSize: 17, bold: true, color: C.gold2, align: "center", margin: 0 });
  addBullets(slide, ["KiCad 原理图 / PCB", "BOM / Pick-and-place", "ERC=0，DRC=0，Gerber 已导出"], 5.1, 2.9, 3.05, 9.5, C.pale, 0.48);
  slide.addText("边界说明", { x: 9.15, y: 2.34, w: 3.1, h: 0.24, fontFace: F.h, fontSize: 17, bold: true, color: C.red2, align: "center", margin: 0 });
  addBullets(slide, ["当前：pcb-prototype-order-ready", "不得写：量产成熟 / 监管认证", "需补：实物烧录 + HIL 验收视频"], 9.15, 2.9, 3.05, 9.5, C.pale, 0.48);
  addEvidence(slide, evidence.hwPaths.join("；"));
}

function addProductWall(slide) {
  addTitle(slide, "已有可演示产品链路，而不是概念图", "产品截图直接回应“有没有做出来”");
  const shots = [
    [img.dashboard, "Dashboard"],
    [img.agentsPage, "Agents"],
    [img.monitor, "Multi-Agent"],
    [img.devices, "Devices"],
    [img.scanner, "Scanner"],
    [img.alerts, "Alerts"],
  ];
  shots.forEach(([p, label], i) => {
    const x = 0.8 + (i % 3) * 4.12;
    const y = 2.03 + Math.floor(i / 3) * 1.82;
    addPanel(slide, x, y, 3.68, 1.5, { fill: C.black, line: C.gold, lineTransparency: 20 });
    if (p) slide.addImage({ path: p, x: x + 0.08, y: y + 0.1, w: 3.52, h: 1.12 });
    slide.addText(label, { x: x + 0.1, y: y + 1.28, w: 3.48, h: 0.12, fontFace: F.m, fontSize: 7.5, color: C.gold2, align: "center", margin: 0 });
  });
  addEvidence(slide, "截图来源：output/playwright/softcopyright-aetherguard-v1/，已用于软著用户手册材料。");
}

function addStudent(slide) {
  addTitle(slide, "学生主体性要用研发历程和分工证明", "评委怀疑套壳时，不能只说“我们做的”，要给可核查材料");
  const timeline = [
    ["课程发现", "计算机网络 / 网络安全课程中发现高危操作确认断点"],
    ["实验室迭代", "从 Agent 原型、控制台、AI 辩论到 ESP32 串口链路"],
    ["代码证据", evidence.codeStats],
    ["署名证据", "软著、专利、论文、竞赛材料突出学生第一作者/发明人"],
  ];
  timeline.forEach(([h, b], i) => {
    const y = 2.0 + i * 0.92;
    slide.addShape("ellipse", { x: 1.05, y: y + 0.05, w: 0.36, h: 0.36, fill: { color: i === 2 ? C.red : C.gold }, line: { color: C.pale, transparency: 25 } });
    slide.addShape("line", { x: 1.23, y: y + 0.41, w: 0, h: 0.42, line: { color: C.line, width: 1 } });
    slide.addText(h, { x: 1.65, y, w: 1.65, h: 0.23, fontFace: F.h, fontSize: 16, bold: true, color: i === 2 ? C.red2 : C.gold2, margin: 0 });
    slide.addText(b, { x: 3.45, y: y + 0.02, w: 8.2, h: 0.26, fontFace: F.h, fontSize: 11.5, color: C.pale, margin: 0, fit: "shrink" });
  });
  addPanel(slide, 1.0, 5.86, 11.2, 0.5, { fill: C.black, line: C.red });
  slide.addText("待补附件：成员分工表、Git 提交记录截图、课程/实验室证明、学生第一发明人/作者证明、外协边界说明。", {
    x: 1.2, y: 6.03, w: 10.8, h: 0.14, fontFace: F.h, fontSize: 9.5, color: C.pale, align: "center", margin: 0,
  });
  addEvidence(slide, "代码规模仅证明工程体量；学生主体性必须由真实分工与提交记录支撑。");
}

function addIp(slide) {
  addTitle(slide, "知识产权从“1 项软著”升级为“软著 + 双专利布局”", "技术护城河要写成可申请、可检索、可答辩的权利组合");
  const items = [
    ["软件著作权", "AetherGuard 智能服务器安全防御平台 V1.0", "材料已整理：docs/legal/softcopyright/"],
    ["发明专利 1", "一种基于多智能体辩论的服务器高危操作风险判定方法", "待补：申请号 / 受理通知书"],
    ["发明/实用新型 2", "一种基于 ESP32 串口确认的物理授权与断路保护装置", "待补：申请号 / 电路图 / 权利要求书"],
  ];
  items.forEach(([h, b, foot], i) => {
    const x = 0.85 + i * 4.1;
    addPanel(slide, x, 2.25, 3.55, 2.85, { fill: C.black2, line: i === 0 ? C.green : C.gold });
    slide.addText(h, { x: x + 0.25, y: 2.55, w: 3.05, h: 0.25, fontFace: F.h, fontSize: 16.5, bold: true, color: i === 0 ? C.green : C.gold2, align: "center", margin: 0 });
    slide.addText(b, { x: x + 0.28, y: 3.15, w: 3.0, h: 0.62, fontFace: F.h, fontSize: 11, color: C.pale, align: "center", margin: 0.02, fit: "shrink" });
    slide.addText(foot, { x: x + 0.28, y: 4.36, w: 3.0, h: 0.24, fontFace: F.h, fontSize: 8.8, color: C.muted, align: "center", margin: 0.01, fit: "shrink" });
  });
  addPill(slide, "提交前不能虚构申请号；提交后把受理通知书放进附件", 3.55, 5.55, 6.2, C.red);
  addEvidence(slide, "软著材料目录已存在；专利状态需团队联系学校/代理机构后替换。");
}

function addBusiness(slide) {
  addTitle(slide, "商业模式改成三级火箭", "先获得可信部署，再逐步从订阅、私有化和硬件配套变现");
  const rockets = [
    ["引流期", "PLG 社区免费版", "限节点/限额度，吸引开发者和小微企业，积累真实威胁样本。"],
    ["增值期", "SaaS 订阅", "按节点、站点或企业版本收费，提供标准防护和告警运营。"],
    ["大客户期", "私有化 + 硬件", "面向政企/金融/园区，交付私有化平台和 ESP32 硬件确认门。"],
  ];
  rockets.forEach(([stage, h, b], i) => {
    const x = 0.95 + i * 4.0;
    addPanel(slide, x, 2.3, 3.35, 2.35, { fill: C.black, line: i === 2 ? C.red : C.gold });
    addPill(slide, stage, x + 0.26, 2.56, 1.0, i === 2 ? C.red : C.gold);
    slide.addText(h, { x: x + 0.28, y: 3.02, w: 2.8, h: 0.25, fontFace: F.h, fontSize: 17, bold: true, color: C.gold2, align: "center", margin: 0, fit: "shrink" });
    slide.addText(b, { x: x + 0.32, y: 3.63, w: 2.72, h: 0.52, fontFace: F.h, fontSize: 10.2, color: C.pale, align: "center", margin: 0.01, fit: "shrink" });
  });
  addEvidence(slide, "替代“降本分成/对赌协议”表述，降低商业信任门槛。");
}

function addResults(slide) {
  addTitle(slide, "项目成果按四栏写：商业、技术、教育、社会价值", "报名表不要只放技术自嗨，要让创业/创意评委各取所需");
  const rows = [
    ["商业成果", "公司注册 / 营收 / 合同 / PoC / 试用协议", "未提供前留空；创业组必填"],
    ["技术成果", "多 Agent 辩论、ESP32 原型、部署包、审计链、产品界面", "可用仓库路径和截图作证"],
    ["教育成果", "课程来源、学生分工、竞赛/论文/软著/专利署名", "补齐学生第一作者/发明人"],
    ["社会价值", "国产服务器安全、信创私有化、中小企业低成本安全", "突出普惠与安全强国"],
  ];
  rows.forEach(([a, b, c], i) => {
    const y = 2.05 + i * 0.82;
    addPanel(slide, 0.85, y, 11.65, 0.58, { fill: i % 2 ? C.black2 : C.panel2, line: C.line, lineTransparency: 40 });
    slide.addText(a, { x: 1.05, y: y + 0.16, w: 1.4, h: 0.14, fontFace: F.h, fontSize: 11.5, bold: true, color: i === 0 ? C.red2 : C.gold2, margin: 0 });
    slide.addText(b, { x: 2.65, y: y + 0.15, w: 5.95, h: 0.16, fontFace: F.h, fontSize: 10.5, color: C.pale, margin: 0, fit: "shrink" });
    slide.addText(c, { x: 8.9, y: y + 0.15, w: 3.25, h: 0.16, fontFace: F.h, fontSize: 9.4, color: C.muted, margin: 0, fit: "shrink" });
  });
  addPill(slide, "创业组：商业栏必须有真实附件；创意组：技术与教育栏必须更硬", 2.65, 5.74, 7.9, C.red);
  addEvidence(slide, evidence.reports.join("；"));
}

function addChecklist(slide) {
  addTitle(slide, "7 天内补齐最关键的证据", "先补评委会问的，不要先美化边角");
  const tasks = [
    ["D1", "确定赛道：无注册/营收则改创意组；有则收齐商业附件"],
    ["D2", "补团队主体性：成员分工、提交记录、课程/实验室证明"],
    ["D3", "补客户/试点：PoC 截图、试用协议、部署报告、访谈纪要"],
    ["D4", "补硬件视频：ESP32 串口请求、屏幕显示、按键确认、审计记录"],
    ["D5", "补知识产权：软著状态 + 两项专利交底书/受理通知"],
    ["D6", "修报名表：术语通俗化，商业/教育/社会价值四栏重写"],
    ["D7", "彩排问答：10w QPS、云端按键、学生主体性必须有保守回答"],
  ];
  tasks.forEach(([d, t], i) => {
    const y = 1.95 + i * 0.58;
    slide.addShape("rect", { x: 1.0, y, w: 0.58, h: 0.32, fill: { color: i < 2 ? C.red : C.gold }, line: { color: C.white, transparency: 70 } });
    slide.addText(d, { x: 1.08, y: y + 0.09, w: 0.42, h: 0.1, fontFace: F.m, fontSize: 7.2, bold: true, color: C.black, align: "center", margin: 0 });
    slide.addText(t, { x: 1.82, y: y + 0.04, w: 10.4, h: 0.17, fontFace: F.h, fontSize: 11.4, color: C.pale, margin: 0, fit: "shrink" });
  });
  addEvidence(slide, "这页可作为团队内部执行表，完成后再把占位内容替换到正式报名材料。");
}

function addClosing(slide) {
  addTitle(slide, "答辩只让评委记住三句话", "场景收窄、证据可查、商业不虚构", 0.95, 11.5);
  const lines = [
    ["我们不是泛安全平台", "只解决关键服务器高危操作缺少可信确认的断点。"],
    ["我们不是只讲概念", "多 Agent、ESP32、产品界面、测试报告都有可追溯证据。"],
    ["我们不虚构商业成绩", "有营收就报创业组；无营收则以创意组技术硬度冲奖。"],
  ];
  lines.forEach(([h, b], i) => {
    addPanel(slide, 1.05, 2.22 + i * 1.05, 11.1, 0.72, { fill: C.black, line: i === 2 ? C.red : C.gold });
    slide.addText(h, { x: 1.35, y: 2.42 + i * 1.05, w: 2.9, h: 0.18, fontFace: F.h, fontSize: 15, bold: true, color: i === 2 ? C.red2 : C.gold2, margin: 0 });
    slide.addText(b, { x: 4.25, y: 2.42 + i * 1.05, w: 7.4, h: 0.18, fontFace: F.h, fontSize: 12.2, color: C.pale, margin: 0, fit: "shrink" });
  });
  slide.addText("AetherGuard · 安全内生，自主免疫", {
    x: 2.4, y: 5.85, w: 8.6, h: 0.42, fontFace: F.k, fontSize: 25, bold: true, color: C.gold2, align: "center", margin: 0,
  });
}

function renderSlide(deck, s, i) {
  const slide = deck.addSlide();
  addBg(slide, s.bg, s.kind === "cover" ? 8 : 30);
  if (s.kind !== "cover") addHeader(slide, s, i);
  switch (s.kind) {
    case "cover": addCover(slide, s); break;
    case "fourRisks": addFourRisks(slide); break;
    case "track": addTrack(slide); break;
    case "scenario": addScenario(slide); break;
    case "loop": addLoop(slide); break;
    case "aiEvidence": addAiEvidence(slide); break;
    case "experiment": addExperiment(slide); break;
    case "hardwarePosition": addHardwarePosition(slide); break;
    case "hardwareEvidence": addHardwareEvidence(slide, s); break;
    case "productWall": addProductWall(slide); break;
    case "student": addStudent(slide); break;
    case "ip": addIp(slide); break;
    case "business": addBusiness(slide); break;
    case "results": addResults(slide); break;
    case "checklist": addChecklist(slide); break;
    case "closing": addClosing(slide); break;
    default: throw new Error(`Unknown slide kind: ${s.kind}`);
  }
  addFooter(slide);
  slide.addNotes(s.note);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const p of [img.esp32, img.agents, img.evidence, img.roadmap]) requireImage(p);

  const pptx = new PptxGenJS();
  pptx.author = "OpenAI Codex";
  pptx.company = "AetherGuard Project Team";
  pptx.subject = "AetherGuard 大学生创新创业大赛整改版";
  pptx.title = "AetherGuard 大学生创新创业大赛整改版 GPT 图像增强";
  pptx.lang = "zh-CN";
  pptx.theme = {
    headFontFace: F.h,
    bodyFontFace: F.h,
    lang: "zh-CN",
  };
  pptx.defineLayout({ name: "AETHER_WIDE", width: W, height: H });
  pptx.layout = "AETHER_WIDE";
  pptx.margin = 0;

  slides.forEach((s, i) => renderSlide(pptx, s, i));
  await pptx.writeFile({ fileName: OUT_FILE, compression: true });
  console.log(OUT_FILE);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
