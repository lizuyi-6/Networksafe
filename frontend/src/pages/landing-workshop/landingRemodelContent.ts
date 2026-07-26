import type { LandingCopy, LandingLanguage } from '../landingContent';

/**
 * Copy for the "Remodel" workshop variant (/landing-workshop/remodel):
 * the existing landing's exact skeleton (LandingCopy shape, so the page can
 * reuse Landing.tsx's layout and primitives verbatim), with the narrative
 * upgraded from the 2025 "AI traffic security" story to the shipped product
 * line — the Root-Resistant Gateway Appliance and hardware-enforced,
 * fail-closed final defense. Figures are limited to facts reproducible in
 * this workspace (firmware host tests, simulator injection scenarios,
 * release-TTL clamp, offline bundle contents); the PRD's claim-discipline
 * section bans unverified performance numbers.
 */

const content: Record<LandingLanguage, LandingCopy> = {
    en: {
        language: { en: 'EN', zh: '中文' },
        nav: [
            { label: 'Defense Chain', href: 'product-surfaces' },
            { label: 'How It Decides', href: 'workflow' },
            { label: 'Deploy', href: 'edge-and-deploy' },
        ],
        login: 'Open Console',
        hero: {
            badge: 'Root-Resistant Gateway Appliance',
            title: 'The last line of defense, enforced outside the server.',
            description:
                'AetherGuard detects and audits in software — and enforces in hardware. The final release of protected network links is decided by an external appliance: a fail-closed L2 bridge, an STM32 security controller, and a secure element that must all agree before traffic flows.',
            primaryCta: 'See the defense chain',
            secondaryCta: 'Open Console',
            chips: ['Fail-closed by default', 'Hardware-signed releases', 'Release windows always expire', 'E-stop latches until cleared'],
            metrics: [
                { label: 'Firmware host tests', value: '13 / 13', note: 'controller task invariants, all passing' },
                { label: 'Fail-closed injections', value: '9', note: 'simulated end-to-end on the M1–M4 loop' },
                { label: 'Release window cap', value: '15 min', note: 'every release auto-returns to isolated' },
            ],
            fabricEyebrow: 'Live console',
            fabricTitle: 'One screen for detection, audit, and hardware state',
            fabricDescription: 'The operations console aggregates traffic, blocked threats, and appliance health — while the release decision itself stays in hardware.',
            fabricSignals: [
                { label: 'Bridge', value: 'isolated', note: 'steady state; releases are the exception' },
                { label: 'Interlock', value: 'verified', note: 'relay feedback matches expected state' },
                { label: 'Counter', value: 'monotonic', note: 'replay and rollback rejected at 3 layers' },
            ],
            orbitCards: [
                { eyebrow: 'Detect', title: 'Multi-agent pipeline', description: 'Seven decision layers tuned under a zero-false-positive constraint on normal traffic.' },
                { eyebrow: 'Authorize', title: 'Hardware grant chain', description: 'Policy digest, challenge freshness, monotonic counter, expiry — re-verified in firmware.' },
                { eyebrow: 'Enforce', title: 'Physical interlock', description: 'A relay with feedback verification actually moves the topology, not just an API response.' },
            ],
        },
        whyNow: {
            eyebrow: 'Why this exists',
            title: 'Every software defense dies with the host it lives on.',
            description:
                'Firewalls, EDR, and ops automation all run inside an environment an attacker can own. Once root is lost, the guards fall with the castle — so the final authority has to live somewhere else.',
            pressures: [
                { title: 'Root ends the story', description: 'With host root, an attacker can silence agents, rewrite logs, and re-open network paths — unless the path is enforced outside the host.' },
                { title: 'Recovery needs a live rail', description: 'Cutting everything strands the operator too. Isolation must break the business bridge while keeping an independent management path alive.' },
                { title: 'Trust needs evidence', description: 'A last line you cannot audit is a promise, not a control. Every grant, denial, and state change must leave a verifiable trail.' },
            ],
            manifestoTitle: 'Design stance',
            manifestoBody: 'Assume the protected server is already lost. Move the trust boundary out of the blast radius, and make uncertainty fail closed.',
            manifestoPoints: [
                'The control plane can request and audit — only hardware can release.',
                'One policy digest, compared byte-for-byte across four services and the firmware.',
                'Three independent monotonic counters; replay or rollback is refused at each.',
                'Isolation preserves the appliance’s own management channel, so recovery is always reachable.',
            ],
        },
        pillars: {
            eyebrow: 'The system',
            title: 'Three planes, one non-negotiable order.',
            description: 'Detection advises. Authorization verifies. Enforcement moves metal. Each plane can say no; only all three together can say yes.',
            items: [
                {
                    eyebrow: 'Detection plane',
                    title: 'See and classify.',
                    description: 'Rule-based detections with attack-family classification stay effective offline; contested evidence escalates through role debate before a verdict.',
                    bullets: ['Deterministic rules first, AI escalation second', 'Zero-false-positive constraint on normal traffic', 'Degraded cloud AI is reported, never hidden'],
                    statLabel: 'Verdict authority',
                    statValue: 'Advisory',
                },
                {
                    eyebrow: 'Authorization plane',
                    title: 'Verify everything twice.',
                    description: 'The daemon validates policy digest and counters; the STM32 controller re-verifies challenge, digest, counter, and expiry in firmware. Deny is the default answer.',
                    bullets: ['Policy digest === across 4 services + firmware', 'Challenge replay window: 16-slot ring, reuse denied', 'E-stop latches; a valid grant cannot unlatch it'],
                    statLabel: 'Host tests',
                    statValue: '13 / 13',
                },
                {
                    eyebrow: 'Enforcement plane',
                    title: 'Move the topology.',
                    description: 'A hardware interlock with feedback verification opens or closes the SERVER↔LAN/WAN bridge. Feedback mismatch means immediate re-isolation.',
                    bullets: ['Relay + feedback closed loop', 'Release TTL capped at 15 minutes, auto re-isolate', 'MGMT path stays alive through isolation'],
                    statLabel: 'Failure semantics',
                    statValue: 'Fail-closed',
                },
            ],
        },
        surfaces: {
            eyebrow: 'Product surfaces',
            title: 'Three windows into the same defense.',
            description: 'The console shows what the fleet sees, what the pipeline decided, and what the hardware is doing — each surface backed by the screens below.',
            items: [
                {
                    eyebrow: 'Console',
                    title: 'Operations dashboard',
                    description: 'Requests, blocked threats, latency, node health, attack origins, and a live log stream — the whole estate on one screen.',
                    bullets: ['KPI strip with live traffic trend', 'Attack-source aggregation with drill-down', 'Streaming log view with export'],
                    metrics: [
                        { label: 'Scope', value: 'Full estate' },
                        { label: 'Refresh', value: 'Live' },
                    ],
                    railTitle: 'Screenshot',
                    railDescription: 'The operations dashboard as shipped — dark console, bilingual UI.',
                    railLines: ['Traffic analysis with block trend', 'Attack sources by region', 'Live log stream with CSV export'],
                },
                {
                    eyebrow: 'Interceptor',
                    title: 'Traffic decisions, explained',
                    description: 'Each intercepted session carries its matched rules, verdict path, and evidence — so an operator can agree or overrule with context.',
                    bullets: ['Per-session verdict trail', 'Rule hit statistics and tuning', 'Replay-safe evidence export'],
                    metrics: [
                        { label: 'False-positive target', value: '0 on normal traffic' },
                        { label: 'Escalation', value: 'Multi-agent' },
                    ],
                    railTitle: 'Pipeline',
                    railDescription: 'From deterministic rules to multi-agent escalation.',
                    railLines: ['Rule engine verdict', 'Role-agent debate', 'Synthesized decision'],
                },
                {
                    eyebrow: 'Hardware',
                    title: 'Appliance & board status',
                    description: 'Gateway registration, policy digests, interlock state, counters, and the physical confirmation trail — the hardware side of every decision.',
                    bullets: ['Bridge and interlock state with feedback', 'Grant history with signature verdicts', 'E-stop and release-window visibility'],
                    metrics: [
                        { label: 'Signing', value: 'ECDSA P-256' },
                        { label: 'Data ports', value: '2 × 1GbE' },
                    ],
                    railTitle: 'Screenshot',
                    railDescription: 'Device fleet and board status views as shipped.',
                    railLines: ['Appliance fleet with health', 'Board status with interlock detail', 'Audit trail per grant'],
                },
            ],
        },
        journey: {
            eyebrow: 'One request, end to end',
            title: 'How a release actually happens.',
            description: 'The happy path is deliberately the hard path — four gates, in order, every time.',
            steps: [
                { step: '01', title: 'Request', description: 'The control plane composes a release with policy digest, challenge, and expiry.', detail: 'Nothing here is trusted yet — the request is just a claim, signed and auditable.' },
                { step: '02', title: 'Daemon check', description: 'M1 validates the digest and refuses non-increasing counters before hardware is touched.', detail: 'First independent high-water mark; replay dies here without reaching the controller.' },
                { step: '03', title: 'Firmware check', description: 'M2 re-verifies challenge freshness, digest, counter, and expiry; M3 verifies the signature.', detail: 'Deny is the default. Any mismatch raises an alert and keeps the bridge isolated.' },
                { step: '04', title: 'Physical release', description: 'M4 closes the relay, feedback confirms, and a TTL countdown starts immediately.', detail: 'On expiry — or any anomaly — the bridge returns to isolated on its own.' },
            ],
        },
        infrastructure: {
            eyebrow: 'Delivery',
            title: 'Installs with a network. Installs without one.',
            description: 'Every path generates real secrets at install time and refuses to start on placeholder configuration — verified end to end on this codebase.',
            stats: [
                { label: 'Offline bundle', value: '7 images', note: 'checksummed, optionally with Docker itself' },
                { label: 'Setup', value: '1 command', note: 'secrets generated, never committed' },
                { label: 'Boot guard', value: 'Hard-fail', note: 'placeholder configs are rejected at startup' },
            ],
            regions: [
                { name: 'Connected deployment', role: 'node scripts/setup.mjs && docker compose up -d --build — cross-platform, health-checked.', latency: 'Docker Compose v2', status: 'Verified' },
                { name: 'Fresh Linux host', role: 'sudo bash scripts/install.sh — installs Docker if missing, waits for backend health.', latency: 'One command', status: 'Scripted' },
                { name: 'Air-gapped site', role: 'A self-contained tar.gz: images, checksums, installer, optionally Docker. Zero network on site.', latency: 'Offline bundle', status: 'Verified' },
            ],
            deviceEyebrow: 'The appliance',
            deviceTitle: 'Purpose-built, fail-closed hardware',
            deviceDescription: 'An industrial enclosure with stack light, physical E-STOP and CONFIRM controls, and three isolated network planes.',
            deviceRows: [
                { label: 'Bridge', value: 'SERVER ↔ LAN/WAN, transparent L2' },
                { label: 'Management', value: 'Independent MGMT + optional cellular' },
                { label: 'Controller', value: 'STM32H5/U5 security MCU' },
                { label: 'Root of trust', value: 'Secure Element, P-256, non-exportable' },
            ],
            deviceBadges: ['Fail-closed interlock', 'Feedback verified', 'E-stop latch', 'DIN-rail prototype'],
            calloutTitle: 'Honest scope',
            calloutDescription: 'The claim covers links physically cabled through the appliance. BMC, Wi-Fi, spare NICs, and local console are outside v1 — stated here, not buried.',
        },
        cta: {
            eyebrow: 'Next step',
            title: 'Wire the last line outside the server.',
            description: 'Start with the console, then decide how much of the release path you want in hardware.',
            primary: 'Open Console',
            secondary: 'Privacy & terms',
            cards: [
                { label: 'Evaluate', title: 'Run the console and simulator locally' },
                { label: 'Pilot', title: 'Cable one protected link through the appliance' },
                { label: 'Deploy', title: 'Roll out fail-closed policies fleet-wide' },
            ],
        },
        footer: {
            tagline: 'Watching over traffic, arriving safely at the future.',
            privacy: 'Privacy',
            terms: 'Terms',
            copyright: '© 2026 AetherGuard. Conditional claims are documented, not implied.',
        },
    },
    zh: {
        language: { en: 'EN', zh: '中文' },
        nav: [
            { label: '防线链路', href: 'product-surfaces' },
            { label: '决策过程', href: 'workflow' },
            { label: '交付部署', href: 'edge-and-deploy' },
        ],
        login: '进入控制台',
        hero: {
            badge: '根权限抵抗型最终防线网关一体机',
            title: '最后防线，布线在服务器之外。',
            description:
                'AetherGuard 用软件做检测与审计，用硬件做最终执行。受保护网络链路的放行，由一台外置一体机决定：fail-closed 二层桥、STM32 安全控制器、安全元件——三者全部同意，流量才能通过。',
            primaryCta: '看防线链路',
            secondaryCta: '进入控制台',
            chips: ['默认 fail-closed', '硬件签名放行', '释放窗口必然过期', '急停锁存直至复位'],
            metrics: [
                { label: '固件 host 测试', value: '13 / 13', note: '控制器任务不变量全数通过' },
                { label: 'fail-closed 注入', value: '9 种', note: 'M1–M4 控制环端到端模拟验证' },
                { label: '释放窗口上限', value: '15 分钟', note: '每次释放自动回到隔离态' },
            ],
            fabricEyebrow: '实时控制台',
            fabricTitle: '检测、审计与硬件状态，同屏可见',
            fabricDescription: '运营控制台聚合流量、拦截与设备健康——而放行决策本身留在硬件里。',
            fabricSignals: [
                { label: '业务桥', value: 'isolated', note: '隔离是常态，连通是例外' },
                { label: '联锁', value: 'verified', note: '继电器反馈与预期状态一致' },
                { label: '计数器', value: '单调递增', note: '重放与回滚在三层被独立拒绝' },
            ],
            orbitCards: [
                { eyebrow: '检测', title: '多智能体管线', description: '七层决策,以正常流量零误报为硬约束调参。' },
                { eyebrow: '授权', title: '硬件授权链', description: '策略摘要、challenge 新鲜度、单调计数器、有效期——固件内再验一遍。' },
                { eyebrow: '执行', title: '物理联锁', description: '带反馈校验的继电器真正改变拓扑,而不是返回一个 API 响应。' },
            ],
        },
        whyNow: {
            eyebrow: '为什么要有它',
            title: '所有软件防御，都与宿主同生共死。',
            description: '防火墙、EDR、自动化运维都运行在可能被攻破的环境里。root 一丢,守卫与城池一起沦陷——所以最终权威必须住在别处。',
            pressures: [
                { title: 'root 即终局', description: '拿到主机 root,攻击者可以灭掉代理、改写日志、重开网络通路——除非通路的开关不在这台主机上。' },
                { title: '恢复需要活的通道', description: '一刀全切会把运维也关在门外。隔离必须只断业务桥,同时保住独立管理通道。' },
                { title: '信任需要证据', description: '不可审计的最后防线只是承诺,不是控制。每次放行、拒绝、状态变化都要留下可验证的痕迹。' },
            ],
            manifestoTitle: '设计立场',
            manifestoBody: '假设被保护的服务器已经沦陷。把信任边界移出爆炸半径,让所有不确定都失败闭锁。',
            manifestoPoints: [
                '控制面可以请求、可以审计——只有硬件可以放行。',
                '同一份策略摘要,跨四个服务与固件逐字节比对。',
                '三套互不共享的单调计数器,重放与回滚在每一处被独立拒绝。',
                '隔离保留设备自身管理通道,恢复永远有路。',
            ],
        },
        pillars: {
            eyebrow: '系统构成',
            title: '三个平面，一条不可协商的顺序。',
            description: '检测负责建议,授权负责校验,执行负责动真格。每个平面都能说不;只有三者同时点头才是"是"。',
            items: [
                {
                    eyebrow: '检测平面',
                    title: '看见并分类。',
                    description: '规则检测与攻击族分类完全离线可用;有争议的证据经角色辩论升级后才形成结论。',
                    bullets: ['确定性规则打底,AI 升级在后', '正常流量零误报硬约束', '云端 AI 降级如实上报,绝不掩盖'],
                    statLabel: '结论权限',
                    statValue: '仅建议',
                },
                {
                    eyebrow: '授权平面',
                    title: '一切都验两遍。',
                    description: '守护进程校验策略摘要与计数器;STM32 控制器在固件内复核 challenge、摘要、计数器与有效期。默认答案是拒绝。',
                    bullets: ['策略摘要跨 4 服务+固件逐字 ===', 'challenge 16 槽环形去重,重用即拒', '急停锁存,合法授权也无法解锁'],
                    statLabel: '固件 host 测试',
                    statValue: '13 / 13',
                },
                {
                    eyebrow: '执行平面',
                    title: '真正改变拓扑。',
                    description: '带反馈校验的硬件联锁开合 SERVER↔LAN/WAN 业务桥。反馈不一致,立即重新隔离。',
                    bullets: ['继电器+反馈闭环', '释放 TTL 上限 15 分钟,到期自动隔离', '隔离期间 MGMT 通道保持存活'],
                    statLabel: '失败语义',
                    statValue: 'Fail-closed',
                },
            ],
        },
        surfaces: {
            eyebrow: '产品界面',
            title: '同一条防线的三扇窗。',
            description: '控制台展示集群看见了什么、管线决定了什么、硬件正在做什么——每个界面都有下方真实截图为证。',
            items: [
                {
                    eyebrow: '控制台',
                    title: '运营大屏',
                    description: '请求量、拦截威胁、延迟、节点健康、攻击来源与实时日志流——整个防区一屏尽收。',
                    bullets: ['KPI 条带+实时流量趋势', '攻击来源聚合与下钻', '流式日志视图,支持导出'],
                    metrics: [
                        { label: '覆盖', value: '全防区' },
                        { label: '刷新', value: '实时' },
                    ],
                    railTitle: '真实截图',
                    railDescription: '出厂即如此的运营大屏——深色控制台,双语界面。',
                    railLines: ['流量分析与拦截趋势', '按地区聚合的攻击来源', '实时日志流与 CSV 导出'],
                },
                {
                    eyebrow: '流量拦截',
                    title: '每个决定都讲得清',
                    description: '每条被拦截的会话都带着命中的规则、结论路径与证据——运维可以带着上下文同意或推翻。',
                    bullets: ['逐会话结论轨迹', '规则命中统计与调参', '可重放的证据导出'],
                    metrics: [
                        { label: '误报目标', value: '正常流量 0' },
                        { label: '升级机制', value: '多智能体' },
                    ],
                    railTitle: '决策管线',
                    railDescription: '从确定性规则到多智能体升级。',
                    railLines: ['规则引擎初判', '角色智能体辩论', '综合结论落地'],
                },
                {
                    eyebrow: '硬件',
                    title: '一体机与板卡状态',
                    description: '网关注册、策略摘要、联锁状态、计数器与物理确认轨迹——每个决定的硬件侧。',
                    bullets: ['桥与联锁状态+反馈', '授权历史与验签结论', '急停与释放窗口可视'],
                    metrics: [
                        { label: '签名', value: 'ECDSA P-256' },
                        { label: '数据口', value: '2 × 1GbE' },
                    ],
                    railTitle: '真实截图',
                    railDescription: '出厂即如此的设备与板卡状态视图。',
                    railLines: ['设备清单与健康态', '板卡状态与联锁细节', '逐授权审计轨迹'],
                },
            ],
        },
        journey: {
            eyebrow: '一次请求的完整旅程',
            title: '一次放行究竟要经过什么。',
            description: '顺利路径被刻意设计成艰难路径——四道门,按顺序,每一次。',
            steps: [
                { step: '01', title: '请求', description: '控制面组装放行请求:策略摘要、challenge、有效期。', detail: '此刻没有任何东西被信任——请求只是一个已签名、可审计的主张。' },
                { step: '02', title: '守护进程校验', description: 'M1 校验摘要,拒绝非递增计数器——在触碰硬件之前。', detail: '第一套独立高水位;重放在这里就死,根本到不了控制器。' },
                { step: '03', title: '固件校验', description: 'M2 复核 challenge 新鲜度、摘要、计数器、有效期;M3 验签。', detail: '默认拒绝。任何不匹配都会告警,业务桥保持隔离。' },
                { step: '04', title: '物理放行', description: 'M4 闭合继电器,反馈确认,TTL 倒计时立即开始。', detail: '到期——或任何异常——业务桥自动回到隔离态。' },
            ],
        },
        infrastructure: {
            eyebrow: '交付',
            title: '有网装得上，没网也装得上。',
            description: '每条路径都在安装现场生成真实密钥,占位配置直接拒绝启动——在本代码库上端到端实测过。',
            stats: [
                { label: '离线分发包', value: '7 镜像', note: '带校验和,可捆绑 Docker 本身' },
                { label: '初始化', value: '1 条命令', note: '密钥现场生成,永不入库' },
                { label: '启动守卫', value: '硬失败', note: '占位配置在启动时被硬拒' },
            ],
            regions: [
                { name: '在线部署', role: 'node scripts/setup.mjs && docker compose up -d --build——跨平台,带健康检查。', latency: 'Docker Compose v2', status: '已实测' },
                { name: '全新 Linux 主机', role: 'sudo bash scripts/install.sh——缺 Docker 自动安装,等待后端健康。', latency: '一条命令', status: '脚本化' },
                { name: '离线(air-gapped)现场', role: '自包含 tar.gz:镜像、校验和、安装器,可捆绑 Docker。现场零外网。', latency: '离线分发包', status: '已实测' },
            ],
            deviceEyebrow: '这台设备',
            deviceTitle: '为 fail-closed 而生的硬件',
            deviceDescription: '工业机箱,顶置三色堆叠灯,面板集成物理 E-STOP 与 CONFIRM,三个网络平面彼此隔离。',
            deviceRows: [
                { label: '业务桥', value: 'SERVER ↔ LAN/WAN 透明二层' },
                { label: '管理面', value: '独立 MGMT + 可选蜂窝' },
                { label: '控制器', value: 'STM32H5/U5 安全 MCU' },
                { label: '信任根', value: 'Secure Element,P-256 私钥不可导出' },
            ],
            deviceBadges: ['fail-closed 联锁', '反馈校验', '急停锁存', 'DIN 导轨原型'],
            calloutTitle: '诚实边界',
            calloutDescription: '承诺只覆盖实际经过设备布线的链路。BMC、Wi-Fi、备用网卡、本地控制台不在 v1 范围——写在这里,不藏在文档里。',
        },
        cta: {
            eyebrow: '下一步',
            title: '把最后防线布线到服务器之外。',
            description: '先用控制台,再决定把放行路径的多大一段交给硬件。',
            primary: '进入控制台',
            secondary: '隐私与条款',
            cards: [
                { label: '评估', title: '本地跑通控制台与全链路模拟器' },
                { label: '试点', title: '把一条受保护链路接入一体机' },
                { label: '铺开', title: '全防区落地 fail-closed 策略' },
            ],
        },
        footer: {
            tagline: '守望流量,安抵未来。',
            privacy: '隐私政策',
            terms: '服务条款',
            copyright: '© 2026 AetherGuard。条件式承诺,以文档为准,不含糊其辞。',
        },
    },
};

export const getLandingRemodelCopy = (language: LandingLanguage): LandingCopy => content[language];
