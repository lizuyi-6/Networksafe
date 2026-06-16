import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "docs", "generated");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "AetherGuard-雄才杯决赛版.pptx");
const RENDER_DIR = path.join(OUTPUT_DIR, "aetherguard-xiongcai-webshot-pages");
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, "frontend", "public", "pitch");
const CHROME_EXE = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const RENDER_W = 3840;
const RENDER_H = 2160;

const COLORS = {
  deepCover: "#080E1C",
  deepSection: "#0F1E3A",
  panelNavy: "#162B52",
  lightBg: "#F0F6FF",
  cyan: "#00BFFF",
  purple: "#7C4DFF",
  hardwareAmber: "#FF8C00",
  successGreen: "#00E5A0",
  darkText: "#0F1E3A",
  mutedDark: "#6B8BAD",
  mutedLight: "#C5D8F0",
  white: "#FFFFFF",
  hardwareDark: "#120B05",
};

const ACCENTS = {
  cyan: COLORS.cyan,
  purple: COLORS.purple,
  amber: COLORS.hardwareAmber,
  green: COLORS.successGreen,
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
    speakerNote: "开场先点明赛题匹配：AetherGuard 面向雄安数字基础设施安全，用 Agent、AI 和 ESP32 补上高危操作可信确认断点。",
    evidenceLevel: "repo",
    tone: "dark",
    accent: "cyan",
    stat: { value: "4", label: "层防护闭环", note: "控制平面 + Agent + AI + ESP32" },
    visual: "image",
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
    visual: "flow",
    steps: ["高危动作", "平台请求", "ESP32 显示", "现场按键", "审计执行"],
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
    visual: "cards",
    cards: [
      ["数字城市", "基础设施", "关键系统运维与审计", "cyan"],
      ["园区企业", "试点入口", "从中小团队服务器切入", "green"],
      ["信创安全", "私有化", "数据留在本地边界", "amber"],
      ["AI 应用", "智能治理", "监控、演练、复盘", "purple"],
    ],
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
    visual: "flow",
    steps: ["控制台", "Agent", "AI 判断", "ESP32 确认", "审计证据"],
  },
  {
    title: "Agent 让防护前移",
    kicker: "核心技术一",
    claim: "Agent-Inside 不是边界工具拼接，而是把防护位置前移到业务服务器运行现场。",
    bullets: ["统一查看 Agent 心跳、资源状态、风险事件和节点详情", "适合覆盖多站点、多服务器实例和分布式业务节点", "与扫描、告警、审计联动，避免安全信息停留在孤立列表"],
    screenshot: "03-agents.png",
    speakerNote: "对应评审重点中的核心技术和可实现性：主机侧防护已有产品界面支撑。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "cyan",
    stat: { value: "Agent", label: "主机侧内生防护", note: "防护贴近业务运行现场" },
    visual: "image",
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
    speakerNote: "这是决赛重点页。用琥珀橙形成视觉停顿，强调原创性和物理可信。",
    evidenceLevel: "repo",
    tone: "hardware",
    accent: "amber",
    stat: { value: "ESP32", label: "物理可信确认", note: "串口硬件门，现场按键确认" },
    visual: "image",
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
    speakerNote: "承接雄才杯赛道方向，避免把 AI 讲成口号，讲成可配置、可验证的工程闭环。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "purple",
    stat: { value: "AI", label: "可验证判断", note: "监控、演练、复盘闭环" },
    visual: "image",
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
      ["02-dashboard.png", "主控制台"],
      ["07-devices.png", "设备"],
      ["14-alerts.png", "告警"],
      ["17-admin.png", "后台"],
    ],
    speakerNote: "这页回答评委的可实现性问题：不是只讲概念，已有产品链路可演示。",
    evidenceLevel: "repo",
    tone: "light",
    accent: "green",
    stat: { value: "6+", label: "产品界面", note: "已有运行截图" },
    visual: "evidence",
  },
  {
    title: "从原型走向试点",
    kicker: "成果转化路径",
    claim: "下一步不是扩张叙事，而是把原型演示链路打磨成可在雄安场景试点的交付包。",
    bullets: ["短期：打磨部署、硬件确认、审计证据和现场演示链路", "中期：选择 1-2 个服务器场景做小规模试点验证", "长期：沉淀私有化交付包、行业案例和安全运营服务能力", "争取对接雄安创新创业支持政策、产业资源和场景机会"],
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
    bullets: ["软件订阅：按节点、站点或企业版本提供持续防护与运营能力", "硬件配套：ESP32 确认门作为部署包和高危操作安全配件", "私有化交付：面向政企、园区、信创和合规敏感场景", "增值服务：安全配置、演练验证、合规材料和响应支持"],
    speakerNote: "商业模式只写方向性表达，不承诺未经验证的收入数字。",
    evidenceLevel: "inferred",
    tone: "light",
    accent: "green",
    visual: "cards",
    cards: [
      ["订阅", "软件平台", "持续运营与升级", "cyan"],
      ["硬件", "物理确认", "强化差异化和客单价", "amber"],
      ["交付", "私有化部署", "适配敏感行业", "purple"],
      ["服务", "安全运营", "试点后沉淀案例", "green"],
    ],
  },
  {
    title: "落地雄安有四类入口",
    kicker: "雄安落地计划",
    claim: "项目可优先从园区企业服务器、数字城市基础设施、信创安全和 AI 应用安全四类场景切入。",
    bullets: ["园区企业：从中小团队服务器安全运营切入，降低落地门槛", "数字城市：服务关键系统的高危运维确认和审计留痕", "信创安全：支持本地化、私有化和数据不外发的部署诉求", "AI 应用安全：用监控与演练闭环服务智能应用治理"],
    speakerNote: "这一页明确回到雄安，回答为什么值得新区支持和对接资源。",
    evidenceLevel: "inferred",
    tone: "light",
    accent: "purple",
    visual: "cards",
    cards: [
      ["园区企业", "试点入口", "服务器和应用链路保护", "cyan"],
      ["数字城市", "基础设施", "高危操作确认与审计", "purple"],
      ["信创安全", "私有化", "数据留在本地边界", "amber"],
      ["AI 安全", "智能应用", "监控、演练、复盘闭环", "green"],
    ],
  },
  {
    title: "值得支持的四个答案",
    kicker: "决赛收束",
    claim: "AetherGuard 的决赛答案是：技术有差异、产品可演示、场景能落地、团队可推进。",
    bullets: ["核心技术：Agent、AI 和 ESP32 串口确认协议形成差异化闭环", "成果转化：已有原型、截图、硬件链路和试点路径", "商业前景：订阅、硬件、私有化交付和安全服务组合", "团队实力：真实材料未补齐前保留占位，不虚构成果"],
    speakerNote: "最后回到评委关心的问题：为什么值得支持，答案是差异化明确且能继续转化。",
    evidenceLevel: "inferred",
    tone: "dark",
    accent: "cyan",
    stat: { value: "4", label: "个决赛答案", note: "技术、产品、转化、团队" },
    visual: "closing",
  },
  {
    title: "备用：技术架构详解",
    kicker: "附录页 · 评委追问时打开",
    claim: "系统由访问层、控制平面、支撑层和受管对象层组成，支持从发现到执行的安全闭环。",
    bullets: ["访问层：React 控制台负责展示、操作和演示入口", "控制平面：Express、Socket.IO、业务模块和服务编排", "支撑层：SQLite / Postgres shadow writes、Redis、审计与配置", "受管对象层：Agent、站点、ESP32 串口确认设备和 Rust fastpath"],
    speakerNote: "只在评委追问架构时打开，不进入默认 8-10 分钟主线。",
    evidenceLevel: "repo",
    tone: "dark",
    accent: "purple",
    visual: "flow",
    steps: ["React 控制台", "Node 控制平面", "数据与缓存", "Agent / Site / ESP32", "审计证据"],
  },
  {
    title: "备用：团队与知识产权",
    kicker: "附录页 · 待补真实材料",
    claim: "团队信息和知识产权状态需要按真实材料补齐，当前版本保留占位，避免虚构参赛主体。",
    bullets: ["团队名称 / 项目负责人 / 学校或公司：待补充", "成员分工：前后端、安全、AI、硬件、展示材料待补充", "软著编号 / 专利状态 / 奖项经历：待补充", "试点单位或合作意向：待补充"],
    speakerNote: "这页只服务问答和材料补充，不默认展示。",
    evidenceLevel: "placeholder",
    tone: "light",
    accent: "green",
    visual: "cards",
    cards: [
      ["待补", "团队名称", "不虚构参赛主体", "cyan"],
      ["待补", "负责人", "按真实报名信息填写", "purple"],
      ["待补", "知识产权", "只填已申请或已授权状态", "amber"],
      ["待补", "试点", "有材料后再写具体单位", "green"],
    ],
  },
];

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function dataUri(file) {
  const filePath = path.join(SCREENSHOT_DIR, file);
  if (!fs.existsSync(filePath)) throw new Error(`Missing screenshot: ${filePath}`);
  const buf = fs.readFileSync(filePath);
  if (buf.length === 0) throw new Error(`Empty screenshot: ${filePath}`);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function accent(slide) {
  return ACCENTS[slide.accent] || COLORS.cyan;
}

function renderBullets(slide) {
  return slide.bullets.map((item) => `<div class="bullet"><span></span><p>${esc(item)}</p></div>`).join("");
}

function renderScreenshot(file, label, cls = "") {
  return `<div class="shot ${cls}">
    <div class="chrome"><i></i><i></i><i></i></div>
    <img src="${dataUri(file)}" />
    <b>${esc(label)}</b>
  </div>`;
}

function renderCards(slide) {
  return `<div class="cards">${slide.cards.map(([value, label, note, key]) => {
    const color = ACCENTS[key] || COLORS.cyan;
    return `<div class="metric" style="--c:${color}">
      <div class="dot">${esc(label.slice(0, 1))}</div>
      <strong>${esc(value)}</strong>
      <small>${esc(label)}</small>
      <p>${esc(note)}</p>
    </div>`;
  }).join("")}</div>`;
}

function renderFlow(slide) {
  return `<div class="flow">${slide.steps.map((step, idx) => {
    const colors = [COLORS.cyan, COLORS.cyan, COLORS.purple, COLORS.hardwareAmber, COLORS.successGreen];
    const color = colors[idx] || COLORS.cyan;
    return `<div class="flowItem" style="--c:${color}">
      <em>${idx + 1}</em>
      <strong>${esc(step)}</strong>
      ${idx < slide.steps.length - 1 ? "<i></i>" : ""}
    </div>`;
  }).join("")}</div>`;
}

function renderTimeline() {
  const items = [
    ["现在", "可演示平台与硬件原型", COLORS.cyan],
    ["决赛后", "打磨部署、确认、审计闭环", COLORS.purple],
    ["试点期", "接入真实服务器场景", COLORS.hardwareAmber],
    ["复制期", "沉淀交付包和行业案例", COLORS.successGreen],
  ];
  return `<div class="timeline">${items.map(([title, text, color], idx) => `<div class="timeItem" style="--c:${color}">
    <em>${idx + 1}</em><strong>${esc(title)}</strong><p>${esc(text)}</p>
  </div>`).join("")}</div>`;
}

function renderEvidence(slide) {
  return `<div class="evidence">
    ${renderScreenshot(slide.screenshots[0][0], "主控制台：运行态总览", "main")}
    <div class="miniRow">
      ${slide.screenshots.slice(1).map(([file, label]) => renderScreenshot(file, label, "mini")).join("")}
    </div>
  </div>`;
}

function renderVisual(slide) {
  if (slide.visual === "image") return `<div class="visual imageVisual">${renderScreenshot(slide.screenshot, slide.stat?.label || "产品截图", "big")}${renderStat(slide)}</div>`;
  if (slide.visual === "flow") return `<div class="visual">${renderFlow(slide)}</div>`;
  if (slide.visual === "cards") return `<div class="visual">${renderCards(slide)}</div>`;
  if (slide.visual === "timeline") return `<div class="visual">${renderTimeline()}</div>`;
  if (slide.visual === "evidence") return `<div class="visual">${renderEvidence(slide)}</div>`;
  if (slide.visual === "closing") return `<div class="visual">${renderFlow({ ...slide, steps: ["核心技术", "产品证据", "成果转化", "商业模式", "雄安落地"] })}${renderStat(slide)}</div>`;
  return "";
}

function renderStat(slide) {
  if (!slide.stat) return "";
  return `<div class="stat">
    <strong>${esc(slide.stat.value)}</strong>
    <b>${esc(slide.stat.label)}</b>
    <p>${esc(slide.stat.note)}</p>
  </div>`;
}

function renderSlide(slide, index, total) {
  const dark = slide.tone === "dark" || slide.tone === "hardware";
  const badge = evidenceMap[slide.evidenceLevel] || evidenceMap.inferred;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; width: ${RENDER_W}px; height: ${RENDER_H}px; overflow: hidden; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; background: ${dark ? COLORS.deepCover : COLORS.lightBg}; }
    .slide { position: relative; width: ${RENDER_W}px; height: ${RENDER_H}px; padding: 140px 156px 130px; color: ${dark ? COLORS.white : COLORS.darkText}; background: ${dark ? COLORS.deepCover : COLORS.lightBg}; }
    .slide:before { content:""; position:absolute; inset:0; background-image: linear-gradient(${dark ? "rgba(197,216,240,.14)" : "rgba(15,30,58,.08)"} 2px, transparent 2px), linear-gradient(90deg, ${dark ? "rgba(197,216,240,.14)" : "rgba(15,30,58,.08)"} 2px, transparent 2px); background-size: 138px 138px; }
    .slide:after { content:""; position:absolute; top:-220px; right:-80px; width:1050px; height:1050px; border-radius:50%; border:5px solid ${accent(slide)}; background:${accent(slide)}22; }
    .topline { position:absolute; left:0; top:0; width:100%; height:14px; background:${accent(slide)}; z-index:2; }
    .hud, .content, .footer { position:relative; z-index:3; }
    .hud { display:flex; align-items:center; gap:48px; height:70px; }
    .pill { height:70px; min-width:230px; padding: 0 34px; border:4px solid var(--c); border-radius:12px; display:flex; align-items:center; justify-content:center; font: 800 25px Consolas, monospace; color:${dark ? COLORS.white : COLORS.darkText}; background:${dark ? "#080E1C88" : "#FFFFFFCC"}; box-shadow:0 10px 18px #0001; }
    .event { margin-left:auto; min-width: 950px; font-size:26px; font-weight:900; }
    .content { display:grid; grid-template-columns: 45% 55%; gap:70px; margin-top: 116px; }
    .kicker { color:${accent(slide)}; font-weight:900; font-size:28px; margin-bottom:130px; }
    h1 { margin:0 0 110px 0; font-size:${slide.title.length > 12 ? 82 : 104}px; line-height:1.02; letter-spacing:0; font-weight:1000; }
    .claim { font-size:44px; line-height:1.35; color:${dark ? COLORS.mutedLight : COLORS.darkText}; margin:0 0 90px 0; max-width: 1500px; }
    .bullet { display:flex; align-items:center; min-height:118px; margin-bottom:36px; padding:24px 44px; border:4px solid ${accent(slide)}; border-radius:12px; background:${dark ? "rgba(22,43,82,.72)" : "rgba(255,255,255,.78)"}; }
    .bullet span { width:34px; height:34px; border-radius:50%; flex:0 0 auto; margin-right:36px; background:${accent(slide)}; }
    .bullet p { margin:0; font-size:32px; line-height:1.28; color:${dark ? COLORS.white : COLORS.darkText}; }
    .visual { min-height: 1210px; display:flex; align-items:center; justify-content:center; position:relative; }
    .imageVisual { align-items:flex-start; }
    .shot { position:relative; border:5px solid ${accent(slide)}; border-radius:14px; background:${dark ? COLORS.panelNavy : COLORS.white}; box-shadow: 18px 22px 30px rgba(0,0,0,.18); overflow:hidden; }
    .shot.big { width: 1720px; height: 970px; }
    .chrome { height:116px; background:${COLORS.deepCover}; border-bottom:5px solid ${accent(slide)}; display:flex; align-items:center; padding-left:70px; gap:26px; }
    .chrome i { width:28px; height:28px; border-radius:50%; display:block; }
    .chrome i:nth-child(1){ background:${COLORS.hardwareAmber}; } .chrome i:nth-child(2){ background:${COLORS.cyan}; } .chrome i:nth-child(3){ background:${COLORS.successGreen}; }
    .shot img { display:block; width:100%; height:auto; }
    .shot b { position:absolute; left:64px; bottom:42px; font-size:34px; color:${dark ? COLORS.white : COLORS.panelNavy}; }
    .stat { position:absolute; left:0; bottom:0; width:650px; height:310px; padding:70px 75px; border:5px solid ${accent(slide)}; border-radius:14px; background:${dark ? "rgba(8,14,28,.9)" : "rgba(255,255,255,.95)"}; box-shadow: 14px 18px 30px rgba(0,0,0,.22); }
    .stat strong { display:block; font:900 80px Consolas, monospace; color:${accent(slide)}; }
    .stat b { display:block; margin-top:24px; font-size:34px; }
    .stat p { margin:18px 0 0; font-size:24px; color:${dark ? COLORS.mutedLight : COLORS.mutedDark}; }
    .flow { width: 1480px; min-height: 760px; padding:260px 90px; border:5px solid ${accent(slide)}; border-radius:16px; background:${dark ? "rgba(22,43,82,.62)" : "rgba(255,255,255,.8)"}; display:flex; align-items:center; justify-content:space-between; }
    .flowItem { position:relative; width:220px; }
    .flowItem em { position:absolute; left:50%; top:-150px; transform:translateX(-50%); width:100px; height:100px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:var(--c); color:white; font:900 28px Consolas, monospace; font-style:normal; }
    .flowItem strong { height:190px; border:5px solid var(--c); border-radius:14px; display:flex; align-items:center; justify-content:center; text-align:center; padding:20px; font-size:32px; color:${dark ? COLORS.white : COLORS.darkText}; background:${dark ? "rgba(8,14,28,.7)" : COLORS.lightBg}; }
    .flowItem i { position:absolute; right:-70px; top:78px; width:48px; height:48px; border-top:18px solid transparent; border-bottom:18px solid transparent; border-left:34px solid var(--c); }
    .cards { width: 1480px; display:grid; grid-template-columns:1fr 1fr; gap:64px; }
    .metric { height:440px; border:5px solid var(--c); border-radius:16px; background:${dark ? "rgba(22,43,82,.62)" : "rgba(255,255,255,.88)"}; padding:72px; position:relative; box-shadow: 10px 16px 24px rgba(0,0,0,.08); }
    .metric .dot { width:116px; height:116px; border-radius:50%; background:var(--c); color:white; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:30px; }
    .metric strong { display:block; margin-top:86px; font-size:70px; line-height:1; color:var(--c); font-weight:1000; }
    .metric small { position:absolute; top:94px; right:76px; font-size:28px; color:${dark ? COLORS.mutedLight : COLORS.mutedDark}; font-weight:900; }
    .metric p { margin:56px 0 0; font-size:26px; color:${dark ? COLORS.mutedLight : COLORS.mutedDark}; }
    .timeline { width: 1430px; padding:90px; border:5px solid ${accent(slide)}; border-radius:16px; background:rgba(255,255,255,.86); }
    .timeItem { display:grid; grid-template-columns:100px 230px 1fr; align-items:center; gap:34px; height:180px; }
    .timeItem em { width:78px; height:78px; border-radius:50%; background:var(--c); color:white; display:flex; align-items:center; justify-content:center; font:900 26px Consolas, monospace; font-style:normal; }
    .timeItem strong { font-size:36px; color:var(--c); }
    .timeItem p { margin:0; font-size:30px; color:${COLORS.darkText}; }
    .evidence { width:1510px; }
    .evidence .main { width:1510px; height:790px; }
    .miniRow { display:grid; grid-template-columns:1fr 1fr 1fr; gap:56px; margin-top:48px; }
    .mini { height:330px; }
    .mini .chrome { height:78px; padding-left:46px; gap:18px; } .mini .chrome i { width:20px; height:20px; } .mini b { font-size:28px; left:46px; bottom:28px; }
    .footer { position:absolute; left:156px; right:156px; bottom:86px; height:70px; border-top:3px solid ${dark ? "rgba(197,216,240,.22)" : "rgba(15,30,58,.16)"}; display:flex; align-items:flex-end; justify-content:space-between; color:${dark ? COLORS.white : COLORS.darkText}; font-size:26px; font-weight:900; }
    .footer span { color:${dark ? COLORS.mutedLight : COLORS.mutedDark}; font-weight:500; }
  </style>
</head>
<body>
  <section class="slide">
    <div class="topline"></div>
    <div class="hud">
      <div class="pill" style="--c:${accent(slide)}">${String(index + 1).padStart(2, "0")} / ${total}</div>
      <div class="pill" style="--c:${badge.color}; color:${dark ? COLORS.white : badge.color}">${esc(badge.label)}</div>
      <div class="pill event" style="--c:${accent(slide)}">雄才杯2026决赛 · 聚雄才 创未来</div>
    </div>
    <main class="content">
      <section>
        <div class="kicker">${esc(slide.kicker)}</div>
        <h1>${esc(slide.title)}</h1>
        <p class="claim">${esc(slide.claim)}</p>
        ${renderBullets(slide)}
      </section>
      ${renderVisual(slide)}
    </main>
    <div class="footer"><span>●&nbsp;&nbsp;雄安落地价值</span><b>AetherGuard · 雄安落地价值 · ${String(index + 1).padStart(2, "0")} / ${total}</b></div>
  </section>
</body>
</html>`;
}

async function renderPages() {
  fs.mkdirSync(RENDER_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: fs.existsSync(CHROME_EXE) ? CHROME_EXE : undefined });
  const page = await browser.newPage({ viewport: { width: RENDER_W, height: RENDER_H }, deviceScaleFactor: 1 });
  for (let i = 0; i < slides.length; i += 1) {
    await page.setContent(renderSlide(slides[i], i, slides.length), { waitUntil: "load" });
    await page.screenshot({ path: path.join(RENDER_DIR, `slide-${String(i + 1).padStart(2, "0")}.png`), fullPage: false });
  }
  await browser.close();
}

async function buildDeck() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await renderPages();
  const deck = new PptxGenJS();
  deck.author = "OpenAI Codex";
  deck.company = "杭州视界奇点科技有限公司";
  deck.subject = "AetherGuard 雄才杯2026决赛";
  deck.title = "AetherGuard 雄才杯决赛版";
  deck.lang = "zh-CN";
  deck.defineLayout({ name: "AETHER_WIDE", width: SLIDE_W, height: SLIDE_H });
  deck.layout = "AETHER_WIDE";
  slides.forEach((item, idx) => {
    const slide = deck.addSlide();
    slide.background = { color: "080E1C" };
    slide.addImage({ path: path.join(RENDER_DIR, `slide-${String(idx + 1).padStart(2, "0")}.png`), x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
    slide.addNotes(item.speakerNote);
  });
  await deck.writeFile({ fileName: OUTPUT_FILE, compression: true });
}

buildDeck()
  .then(() => console.log(`Generated PPTX: ${OUTPUT_FILE}`))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
