import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const softcopyrightDir = path.join(repoRoot, 'docs', 'legal', 'softcopyright');
const screenshotDir = path.join(repoRoot, 'output', 'playwright', 'softcopyright-aetherguard-v1');
const runtimeNodeModules = path.join(
  process.env.CODEX_RUNTIME_NODE_MODULES || 'C:/Users/Abraham/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules',
);
const docxEntry = pathToFileURL(path.join(runtimeNodeModules, 'docx', 'dist', 'index.mjs')).href;

const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  TextRun,
  WidthType,
  convertMillimetersToTwip,
} = await import(docxEntry);

const softwareName = 'AetherGuard 智能服务器安全防御平台 V1.0';
const manualTitle = `${softwareName} 用户手册`;
const manualHtmlPath = path.join(softcopyrightDir, 'aetherguard_v1_user_manual.html');
const manualDocxPath = path.join(softcopyrightDir, 'aetherguard_v1_user_manual.docx');
const documentDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}).format(new Date());

const sections = [
  {
    title: '1. 软件概述与使用范围',
    subtitle: '本章介绍平台定位、适用对象和主要使用场景。',
    paragraphs: [
      'AetherGuard 智能服务器安全防御平台 V1.0 面向服务器、站点、网关设备和分布式安全智能体管理场景。系统以浏览器控制台为操作入口，集中提供运行状态查看、Agent 纳管、硬件板卡管理、站点配置、部署向导、扫描任务、告警处置和历史记录等功能。',
      '平台由后端控制平面、前端控制台、实时通信服务和硬件确认机制组成。管理员可在控制台内查看接入对象、调整配置、处理告警并查询审计记录。普通操作人员主要使用首页、告警、扫描、设备和站点相关页面完成日常巡检。',
      '本手册按照控制台导航顺序介绍各页面。用户可先阅读登录和首页章节，再根据实际岗位查阅智能体、设备、站点、部署、扫描、告警和历史记录等章节。'
    ],
    table: [
      ['文档类型', '用户操作手册'],
      ['适用对象', '管理员、安全运营人员、运维人员和测试人员'],
      ['运行入口', '浏览器访问 AetherGuard 控制台'],
      ['主要用途', '查看安全状态、管理接入对象、执行检测任务并查询处置记录']
    ]
  },
  {
    title: '2. 运行环境与登录',
    subtitle: '用户进入系统前需要打开浏览器访问控制台地址，并通过账号密码完成身份认证。',
    screenshot: '01-login.png',
    alt: '登录页',
    paragraphs: [
      '登录页是平台的统一入口，用户在此输入邮箱或账号、密码，并通过“安全登录”按钮进入控制台。页面左侧展示平台定位和运行指标，右侧为账号登录区域；正式部署时应使用已授权的企业账号登录系统。',
      '登录成功后，系统进入 Dashboard 首页。若凭据填写错误或账号不可用，页面会显示登录失败提示。用户可重新核对账号密码，或联系管理员检查账号状态。'
    ],
    notes: ['用户应妥善保管账号凭据，公共设备使用完成后应及时退出登录。']
  },
  {
    title: '3. Dashboard 首页总览',
    subtitle: 'Dashboard 汇总展示系统运行状态和近期安全事件。',
    screenshot: '02-dashboard.png',
    alt: 'Dashboard 总览',
    paragraphs: [
      'Dashboard 首页显示请求处理量、威胁拦截、活跃连接、成功率、实时日志、系统状态和安全趋势。用户登录后可先查看该页面，确认平台健康状态、近期告警和主要服务在线情况。',
      '顶部数据卡片适合快速浏览，趋势图和日志区域适合查看近期变化。发现异常后，可从侧边栏进入 Agent、Traffic、Alerts 或 Scanner 页面继续排查。'
    ],
    steps: ['登录控制台后进入 Dashboard。', '查看顶部指标卡，确认请求、拦截、连接和成功率变化。', '结合实时日志和状态面板选择后续页面。']
  },
  {
    title: '4. 智能体列表',
    subtitle: '智能体列表用于查看已接入的安全执行单元、运行状态和最近活动。',
    screenshot: '03-agents.png',
    alt: '智能体列表',
    paragraphs: [
      'Agents 页面列出已纳管的智能体节点，内容包括节点标识、主机名称、平台类型、授权状态、最近在线时间和操作入口。管理员可在此确认节点接入状态和心跳情况。',
      '列表页适合日常巡检。若某个节点长时间未上报，可进入详情页查看节点信息，也可结合服务日志排查网络、凭据或进程状态。'
    ],
    notes: ['智能体管理涉及服务器安全能力的部署状态，建议只允许管理员或授权运维人员操作。']
  },
  {
    title: '5. 智能体详情',
    subtitle: '智能体详情页展示单个节点的运行上下文、检测结果和近期安全事件。',
    screenshot: '04-agent-detail.png',
    alt: '智能体详情',
    paragraphs: [
      '进入 Agent 详情页后，可查看节点基础信息、运行状态、任务记录、检测摘要和近期威胁。详情页将列表中的单个节点展开，便于查看该节点在扫描、策略更新或告警处理中的状态。',
      '当安全事件与某个节点相关时，可优先查看最近通信时间、状态变化、任务执行结果和异常记录，再与告警中心、流量拦截和修复历史中的记录对照。'
    ],
    steps: ['从智能体列表选择目标节点。', '查看节点状态、最近上报时间和任务记录。', '根据威胁记录跳转到相关告警或历史记录。']
  },
  {
    title: '6. 智能体监控',
    subtitle: '智能体监控页面用于观察多智能体协同分析、任务队列和学习状态。',
    screenshot: '05-agent-monitor.png',
    alt: '智能体监控',
    paragraphs: [
      'Agent Monitor 页面显示多智能体系统的队列、响应时间、任务完成数、策略更新和案例文件等指标。该页面更适合查看整体运行情况，而不是单个节点详情。',
      '当告警数量增加或扫描任务增多时，可在这里观察任务队列和响应时间。如果队列持续积压、响应变慢或错误计数上升，管理员应继续检查服务日志和资源占用。'
    ]
  },
  {
    title: '7. 流量拦截',
    subtitle: '流量拦截页面用于展示网络会话、协议分布和威胁检测结果。',
    screenshot: '06-traffic-interceptor.png',
    alt: '流量拦截',
    paragraphs: [
      'Traffic 页面展示网络流量观察和拦截结果，包括活跃会话、协议分布、已检测威胁和处理统计。安全人员可根据该页面判断异常请求来源、拦截规则效果和近期流量变化。',
      '排查异常时，可先查看汇总指标，再定位具体会话和威胁类型，最后结合告警中心或修复历史确认处理结果。'
    ],
    notes: ['该页面适合在巡检时查看，用于说明平台具备实时流量观察和威胁拦截能力。']
  },
  {
    title: '8. 安全验证',
    subtitle: '安全验证页面用于运行受控检测用例，验证平台检测、拦截和告警联动能力。',
    screenshot: '07-attack-simulator.png',
    alt: '安全验证',
    paragraphs: [
      '安全验证页面列出多种受控检测用例，用户可以选择用例并启动验证流程。该功能主要用于测试平台规则、告警联动和处置流程是否按预期运行，正式环境中应由授权人员在可控范围内使用。',
      '验证运行后，平台会生成执行过程、拦截结果和相关告警。用户可以通过 Dashboard、Traffic、Alerts 和 History 页面查看验证任务产生的联动结果，从而确认平台的检测链路和处置闭环是否正常。'
    ],
    steps: ['选择一个或多个验证用例。', '启动验证并等待执行结果。', '进入告警、流量和历史页面查看联动结果。']
  },
  {
    title: '9. 设备管理',
    subtitle: '设备管理页面用于纳管硬件板卡、网关和串口确认设备。',
    screenshot: '08-devices.png',
    alt: '设备管理',
    paragraphs: [
      'Devices 页面列出接入平台的硬件设备，包括设备编号、在线状态、固件版本、策略摘要、最近心跳和操作入口。管理员可在该页面确认硬件安全门是否在线可用。',
      '从设备列表可进入板卡状态详情，查看设备上报、命令队列和策略同步情况。若设备离线或策略摘要不一致，应检查串口连接、设备供电、后端服务和授权配置。'
    ],
    notes: ['设备相关操作可能影响高风险动作确认流程，正式环境应限制为授权管理员使用。']
  },
  {
    title: '10. 板卡状态',
    subtitle: '板卡状态页用于查看单个 ESP32 或网关设备的心跳、策略和命令状态。',
    screenshot: '09-board-status.png',
    alt: '板卡状态',
    paragraphs: [
      'Board Status 页面显示单个硬件设备的详细状态，包括在线心跳、策略摘要、固件信息、命令执行记录和事件上报。管理员可在这里确认设备是否正常参与关键操作流程。',
      '当系统发起高风险操作时，硬件设备需要通过串口协议和物理按钮确认。管理员可检查设备是否接收到命令、是否完成确认、是否存在错误或超时。'
    ]
  },
  {
    title: '11. 站点列表',
    subtitle: '站点列表用于展示平台纳管的业务站点、目标地址和当前安全状态。',
    screenshot: '10-sites.png',
    alt: '站点列表',
    paragraphs: [
      'Sites 页面列出已纳管站点，包括域名、目标地址、状态和操作入口。安全运营人员可在此确认业务系统纳管范围，以及各站点当前状态。',
      '站点列表常与扫描中心、告警中心配合使用。发现某个站点异常后，可进入站点详情查看关联告警、流量和扫描结果，再决定是否重新扫描或处理配置。'
    ]
  },
  {
    title: '12. 站点详情',
    subtitle: '站点详情页展示单个业务站点的安全上下文和关联证据。',
    screenshot: '11-site-detail.png',
    alt: '站点详情',
    paragraphs: [
      'Site Detail 页面汇总单个站点的基础信息、目标地址、风险状态、关联告警和流量记录。相比站点列表，详情页更适合处理单个业务资产的问题。',
      '当扫描中心或告警中心提示某站点存在风险时，可回到站点详情页查看整体情况，再决定是否修复、重新扫描或调整访问策略。'
    ]
  },
  {
    title: '13. 部署向导',
    subtitle: '部署向导用于生成或保存服务器接入配置，辅助完成 Agent 或站点部署。',
    screenshot: '12-deployment-wizard.png',
    alt: '部署向导',
    paragraphs: [
      'Deployment 页面以向导方式组织部署参数，用户按步骤填写服务器类型、目标信息、访问配置和安全选项。向导生成的配置可用于后续安装、接入或验证，减少手工配置错误。',
      '涉及安装、卸载、数据清理或关键配置变更时，应结合硬件确认机制执行。管理员在操作前应确认目标服务器、网络连通性、凭据权限和回滚方案。'
    ],
    steps: ['选择部署类型和目标服务器。', '填写连接参数和安全配置。', '生成配置并进入后续验证流程。']
  },
  {
    title: '14. 扫描中心',
    subtitle: '扫描中心用于创建、查看和管理安全扫描任务。',
    screenshot: '13-scanner.png',
    alt: '扫描中心',
    paragraphs: [
      'Scanner 页面展示扫描任务、目标、状态、发现数量和执行记录。用户可在此发起扫描、查看历史任务并进入扫描详情。',
      '扫描结果应结合告警中心和修复历史查看。对于高危发现，需要确认问题是否真实存在、是否已有修复措施，并在处理完成后保留记录。'
    ]
  },
  {
    title: '15. 告警中心',
    subtitle: '告警中心用于集中处理平台检测到的风险事件。',
    screenshot: '14-alerts.png',
    alt: '告警中心',
    paragraphs: [
      'Alerts 页面展示告警标题、严重程度、来源、状态、创建时间和处置入口。安全人员可根据严重程度和来源筛选告警，优先处理 critical 和 high 等高风险事件。',
      '告警处理通常包括确认、调查、标记解决或抑制。处理过程中应保留流量会话、扫描发现、Agent 记录和修复历史，以便后续查询。'
    ],
    notes: ['告警状态变化属于重要运营记录，应避免无依据地批量关闭。']
  },
  {
    title: '16. 修复历史',
    subtitle: '修复历史页面用于保存安全处置、配置调整和扫描修复的过程记录。',
    screenshot: '15-history.png',
    alt: '修复历史',
    paragraphs: [
      'History 页面按照时间顺序展示修复记录、处置对象、操作结果和相关摘要。用户可在这里查看问题处理过程和处理结果。',
      '管理员应定期检查历史记录是否完整，并将重要事件与告警、扫描结果和设备确认记录关联保存。'
    ]
  },
  {
    title: '17. 系统设置',
    subtitle: '系统设置页面用于维护平台配置、模型接口、安全策略和运行偏好。',
    screenshot: '16-settings.png',
    alt: '系统设置',
    paragraphs: [
      'Settings 页面集中管理系统运行参数和集成配置，包括模型接口、通知、账号会话、外部服务或其他平台级选项。由于设置项会影响全局行为，该页面应由管理员或授权人员使用。',
      '修改设置前，用户应确认配置来源、变更原因和回滚方案。涉及密钥、模型接口、告警策略或部署能力的变更，应在低风险时段进行并保留记录，以便出现异常时快速恢复。'
    ]
  },
  {
    title: '18. 日常操作流程与管理注意事项',
    subtitle: '本节归纳平台日常使用路径和管理注意事项。',
    paragraphs: [
      '日常巡检建议从 Dashboard 开始，先查看总体指标和系统状态，再根据异常线索进入 Agent、Traffic、Devices、Sites、Scanner 或 Alerts 页面。若发现高风险事件，应记录告警编号、来源对象和触发时间，避免仅凭单一页面判断问题。',
      '对于部署、安装、卸载、清理数据或关键配置变更等敏感操作，应遵循最小权限和双重确认原则。AetherGuard 的硬件设备用于提供物理确认门，管理员应确保设备在线、策略一致且按钮确认流程可用。',
      '完成处置后，应保存关键告警、扫描结果、设备确认记录和修复历史。对于涉及配置变更的事项，还应记录变更原因、执行人员、执行时间和回滚方式。'
    ],
    table: [
      ['巡检路径', 'Dashboard → Alerts / Traffic / Agents → History'],
      ['站点风险处理', 'Sites → Scanner → Alerts → History'],
      ['设备确认处理', 'Devices → Board Status → 命令记录 / 策略摘要'],
      ['记录归档', '告警记录、扫描结果、修复历史和设备确认记录']
    ]
  },
];

function getManualSections() {
  const excludedScreenshots = new Set(['07-attack-simulator.png']);
  let index = 0;
  return sections
    .filter((section) => !excludedScreenshots.has(section.screenshot))
    .map((section) => {
      index += 1;
      return {
        ...section,
        title: section.title.replace(/^\d+\./, `${index}.`),
      };
    });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function buildTableRows(rows) {
  if (!rows?.length) return '';
  return `<table class="summary-table">${rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('')}</table>`;
}

function buildList(items, className) {
  if (!items?.length) return '';
  return `<ol class="${className}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`;
}

function screenshotHtml(section) {
  if (!section.screenshot) return '';
  return `
    <figure class="screenshot">
      <img src="../../../output/playwright/softcopyright-aetherguard-v1/${section.screenshot}" alt="${escapeHtml(section.alt || section.title)}" />
      <figcaption>图：${escapeHtml(section.alt || section.title)}界面</figcaption>
    </figure>
  `;
}

function buildManualHtml() {
  const manualSections = getManualSections();
  const pages = [];
  pages.push(`
    <section class="page cover">
      <div class="page-number">第 1 页</div>
      <div class="cover-mark">用户操作手册</div>
      <h1>${manualTitle}</h1>
      <h2>Web 控制台操作说明</h2>
      <div class="cover-meta">
        <div><strong>软件名称：</strong>${softwareName}</div>
        <div><strong>文档版本：</strong>V1.0</div>
        <div><strong>文档类型：</strong>用户手册</div>
        <div><strong>编制日期：</strong>${documentDate}</div>
        <div><strong>适用对象：</strong>管理员、安全运营人员、运维人员</div>
        <div><strong>运行入口：</strong>浏览器访问平台控制台</div>
      </div>
      <div class="toc">
        <h3>目录</h3>
        <ol>${manualSections.map((section) => `<li>${escapeHtml(section.title.replace(/^\d+\.\s*/, ''))}</li>`).join('')}</ol>
      </div>
    </section>
  `);

  manualSections.forEach((section, index) => {
    pages.push(`
      <section class="page">
        <div class="page-number">第 ${index + 2} 页</div>
        <h2>${escapeHtml(section.title)}</h2>
        <div class="subtitle">${escapeHtml(section.subtitle)}</div>
        ${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
        ${buildList(section.steps, 'steps')}
        ${buildTableRows(section.table)}
        ${section.notes?.map((note) => `<div class="note">${escapeHtml(note)}</div>`).join('') || ''}
        ${screenshotHtml(section)}
        <footer>${softwareName}</footer>
      </section>
    `);
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${manualTitle}</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #e5e7eb;
      color: #111827;
      font-family: "Microsoft YaHei", "SimSun", "Noto Sans CJK SC", sans-serif;
    }
    .page {
      position: relative;
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 17mm 16mm 16mm;
      background: #fff;
      page-break-after: always;
      overflow: hidden;
    }
    .page:last-child { page-break-after: auto; }
    .page-number {
      position: absolute;
      top: 8mm;
      right: 16mm;
      font-size: 9pt;
      color: #374151;
    }
    .cover {
      padding-top: 30mm;
      border-top: 8mm solid #111827;
    }
    .cover-mark {
      font-size: 11pt;
      letter-spacing: 0.5mm;
      color: #4b5563;
      margin-bottom: 22mm;
    }
    h1 {
      margin: 0 0 8mm;
      font-size: 28pt;
      line-height: 1.25;
      color: #111827;
    }
    .cover h2 {
      margin: 0 0 20mm;
      font-size: 16pt;
      color: #374151;
    }
    .cover-meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4mm 8mm;
      border-top: 0.4mm solid #d1d5db;
      border-bottom: 0.4mm solid #d1d5db;
      padding: 6mm 0;
      font-size: 10pt;
      line-height: 1.7;
    }
    .toc {
      margin-top: 14mm;
      padding: 7mm;
      border: 0.35mm solid #d1d5db;
      background: #f9fafb;
    }
    .toc h3 { margin: 0 0 4mm; font-size: 13pt; }
    .toc ol {
      margin: 0;
      columns: 2;
      padding-left: 5mm;
      font-size: 9.6pt;
      line-height: 1.65;
    }
    h2 {
      margin: 0 0 3mm;
      font-size: 18pt;
      line-height: 1.25;
      color: #111827;
      border-bottom: 0.45mm solid #d1d5db;
      padding-bottom: 2.2mm;
    }
    .subtitle {
      margin-bottom: 5mm;
      font-size: 10.2pt;
      color: #4b5563;
      line-height: 1.65;
    }
    p {
      margin: 0 0 3.2mm;
      font-size: 10pt;
      line-height: 1.72;
      text-align: justify;
    }
    .steps {
      margin: 0 0 4mm;
      padding-left: 6mm;
      font-size: 9.7pt;
      line-height: 1.65;
    }
    .steps li { margin-bottom: 1.6mm; }
    .note {
      margin: 3mm 0 4mm;
      border-left: 1.2mm solid #4b5563;
      background: #f9fafb;
      padding: 3mm 3.6mm;
      font-size: 9.5pt;
      line-height: 1.65;
      color: #374151;
    }
    .summary-table {
      width: 100%;
      border-collapse: collapse;
      margin: 3mm 0 4mm;
      font-size: 9.4pt;
    }
    .summary-table th, .summary-table td {
      border: 0.28mm solid #d1d5db;
      padding: 2.3mm 2.8mm;
      line-height: 1.55;
      vertical-align: middle;
      text-align: left;
    }
    .summary-table th {
      width: 28%;
      background: #f3f4f6;
      font-weight: 700;
    }
    .screenshot {
      margin: 4mm 0 0;
      border: 0.32mm solid #d1d5db;
      padding: 2.5mm;
      background: #fff;
      page-break-inside: avoid;
    }
    .screenshot img {
      display: block;
      width: 100%;
      max-height: 122mm;
      object-fit: contain;
      background: #f9fafb;
    }
    figcaption {
      margin-top: 1.8mm;
      font-size: 8.5pt;
      color: #4b5563;
      text-align: center;
      line-height: 1.45;
    }
    footer {
      position: absolute;
      left: 16mm;
      right: 16mm;
      bottom: 8mm;
      border-top: 0.25mm solid #d1d5db;
      padding-top: 2mm;
      font-size: 8.5pt;
      color: #6b7280;
    }
  </style>
</head>
<body>
  ${pages.join('\n')}
</body>
</html>`;
}

function docxText(text, options = {}) {
  return new TextRun({
    text,
    font: options.font || 'Microsoft YaHei',
    size: options.size || 21,
    bold: options.bold || false,
    color: options.color || '111827',
  });
}

function paragraph(text, options = {}) {
  return new Paragraph({
    children: [docxText(text, options)],
    heading: options.heading,
    alignment: options.alignment,
    spacing: {
      before: options.before ?? 0,
      after: options.after ?? 160,
      line: options.line ?? 330,
    },
  });
}

function pageBreakParagraph() {
  return new Paragraph({ children: [new PageBreak()] });
}

function tableParagraph(label, value) {
  return new Paragraph({
    children: [
      docxText(`${label}：`, { bold: true, size: 20 }),
      docxText(value, { size: 20 }),
    ],
    spacing: { after: 120, line: 300 },
  });
}

async function loadImageRun(filename) {
  const imagePath = path.join(screenshotDir, filename);
  const data = await fs.readFile(imagePath);
  return new ImageRun({
    data,
    transformation: {
      width: 610,
      height: 381,
    },
  });
}

async function buildManualDocx() {
  const manualSections = getManualSections();
  const children = [
    paragraph(manualTitle, { heading: HeadingLevel.TITLE, size: 36, bold: true, after: 280 }),
    paragraph('Web 控制台操作说明', { size: 26, bold: true, color: '374151', after: 420 }),
    tableParagraph('软件名称', softwareName),
    tableParagraph('文档版本', 'V1.0'),
    tableParagraph('文档类型', '用户操作手册'),
    tableParagraph('编制日期', documentDate),
    tableParagraph('适用对象', '管理员、安全运营人员、运维人员'),
    paragraph('目录', { heading: HeadingLevel.HEADING_1, size: 28, bold: true, before: 360 }),
    ...manualSections.map((section) => paragraph(section.title, { size: 21, after: 80 })),
    pageBreakParagraph(),
  ];

  for (let index = 0; index < manualSections.length; index += 1) {
    const section = manualSections[index];
    children.push(paragraph(section.title, { heading: HeadingLevel.HEADING_1, size: 28, bold: true, after: 180 }));
    children.push(paragraph(section.subtitle, { size: 20, color: '4B5563', after: 220 }));
    for (const item of section.paragraphs) {
      children.push(paragraph(item, { size: 21 }));
    }
    if (section.steps?.length) {
      children.push(paragraph('操作步骤', { heading: HeadingLevel.HEADING_2, size: 22, bold: true, before: 100 }));
      section.steps.forEach((step, stepIndex) => {
        children.push(paragraph(`${stepIndex + 1}. ${step}`, { size: 20, after: 90 }));
      });
    }
    if (section.table?.length) {
      children.push(paragraph('要点说明', { heading: HeadingLevel.HEADING_2, size: 22, bold: true, before: 100 }));
      section.table.forEach(([label, value]) => children.push(tableParagraph(label, value)));
    }
    if (section.notes?.length) {
      section.notes.forEach((note) => children.push(paragraph(`注意：${note}`, { size: 20, color: '374151' })));
    }
    if (section.screenshot) {
      children.push(new Paragraph({
        children: [await loadImageRun(section.screenshot)],
        alignment: AlignmentType.CENTER,
        spacing: { before: 160, after: 80 },
      }));
      children.push(paragraph(`图：${section.alt || section.title}界面`, {
        size: 18,
        color: '4B5563',
        alignment: AlignmentType.CENTER,
        after: 120,
      }));
    }
    if (index < manualSections.length - 1) {
      children.push(pageBreakParagraph());
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Microsoft YaHei',
            size: 21,
          },
          paragraph: {
            spacing: { line: 330, after: 160 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(18),
              right: convertMillimetersToTwip(17),
              bottom: convertMillimetersToTwip(16),
              left: convertMillimetersToTwip(17),
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  docxText(softwareName, { size: 18, color: '4B5563' }),
                  docxText('    第 ', { size: 18, color: '4B5563' }),
                  PageNumber.CURRENT,
                  docxText(' 页', { size: 18, color: '4B5563' }),
                ],
                alignment: AlignmentType.RIGHT,
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [docxText('用户操作手册', { size: 17, color: '6B7280' })],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  await fs.writeFile(manualDocxPath, await Packer.toBuffer(doc));
}

async function main() {
  await fs.mkdir(softcopyrightDir, { recursive: true });

  const missing = [];
  for (const section of getManualSections()) {
    if (!section.screenshot) continue;
    try {
      await fs.access(path.join(screenshotDir, section.screenshot));
    } catch {
      missing.push(section.screenshot);
    }
  }
  if (missing.length) {
    throw new Error(`Missing screenshots: ${missing.join(', ')}`);
  }

  await fs.writeFile(manualHtmlPath, buildManualHtml(), 'utf8');
  await buildManualDocx();
  console.log(`Generated ${manualHtmlPath}`);
  console.log(`Generated ${manualDocxPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
