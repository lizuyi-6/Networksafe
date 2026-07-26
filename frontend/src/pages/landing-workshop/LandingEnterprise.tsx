import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowRight,
    Building2,
    CheckCircle2,
    ChevronDown,
    Cpu,
    Factory,
    FileSearch,
    Landmark,
    LayoutDashboard,
    Lock,
    Network,
    Radar,
    Server,
    ShieldCheck,
    Siren,
    Workflow,
} from 'lucide-react';
import consoleDashboard from '../../assets/landing-workshop/console-dashboard.png';
import consoleTraffic from '../../assets/landing-workshop/console-traffic.png';
import consoleDevices from '../../assets/landing-workshop/console-devices.png';
import consoleScanner from '../../assets/landing-workshop/console-scanner.png';
import applianceAssembly from '../../assets/landing-workshop/appliance-assembly.png';

/**
 * Landing workshop · Variant B "Enterprise Official" (企业官网 · 亮色).
 *
 * Mounted at /landing-workshop/enterprise only; the production landing at "/"
 * is untouched. Classic corporate-site structure: anchored nav, hero with a
 * fact strip (validated numbers only — the PRD's claim-discipline section
 * bans unverified perf figures), capability grid, hardware architecture with
 * spec table, audience-specific pitches (from the gateway PRD §2), deployment
 * paths, FAQ, and a proper footer. Light theme is self-contained (explicit
 * slate palette) so it renders corporate regardless of the app theme.
 */

type Lang = 'en' | 'zh';

type QA = { q: string; a: string };

type Copy = {
    nav: { items: Array<{ label: string; href: string }>; login: string; tag: string };
    hero: {
        badge: string;
        title: string;
        subtitle: string;
        primaryCta: string;
        secondaryCta: string;
        facts: Array<{ value: string; label: string }>;
        factNote: string;
    };
    capabilities: {
        eyebrow: string;
        title: string;
        items: Array<{ title: string; body: string }>;
    };
    architecture: {
        eyebrow: string;
        title: string;
        body: string;
        modules: Array<{ tag: string; name: string; role: string }>;
        specTitle: string;
        specs: Array<{ k: string; v: string }>;
    };
    audiences: {
        eyebrow: string;
        title: string;
        items: Array<{ who: string; pitch: string }>;
    };
    deploy: {
        eyebrow: string;
        title: string;
        modes: Array<{ title: string; body: string }>;
    };
    faq: { eyebrow: string; title: string; items: QA[] };
    footer: {
        blurb: string;
        productCol: { title: string; items: string[] };
        claim: string;
        privacy: string;
        terms: string;
        console: string;
        currentLanding: string;
    };
};

const COPY: Record<Lang, Copy> = {
    zh: {
        nav: {
            items: [
                { label: '产品能力', href: '#capabilities' },
                { label: '硬件架构', href: '#architecture' },
                { label: '客户视角', href: '#audiences' },
                { label: '部署', href: '#deploy' },
                { label: '常见问题', href: '#faq' },
            ],
            login: '进入控制台',
            tag: 'workshop · 企业官网',
        },
        hero: {
            badge: '根权限抵抗型最终防线网关一体机',
            title: '服务器沦陷之后，防线仍在。',
            subtitle:
                'AetherGuard 是面向中大型企业的服务器安全防御平台：分布式检测与审计运行在控制面，而关键网络的最终放行权，交给部署在服务器之外的自研硬件网关一体机。它不替代防火墙、EDR 或堡垒机——它是它们全部失效之后的那一层。',
            primaryCta: '预约演示',
            secondaryCta: '查看硬件架构',
            facts: [
                { value: 'M1–M4', label: '四模块硬件授权链' },
                { value: '13 项', label: '固件 host 测试全数通过' },
                { value: '9 种', label: 'fail-closed 注入场景模拟验证' },
                { value: 'P-256', label: 'Secure Element 硬件签名' },
            ],
            factNote: '以上均为当前工作区可复现的验证事实；未经实测的性能数字不会出现在本页。',
        },
        capabilities: {
            eyebrow: '平台能力',
            title: '从态势感知到硬件放行的完整闭环',
            items: [
                { title: '全局态势感知', body: '实时聚合各节点请求、拦截与健康指标的指挥大屏，威胁态势一眼可读。' },
                { title: '分布式 Agent 集群', body: '轻量级 Agent 驻留每台业务服务器，控制中心断连时本地防御依然有效。' },
                { title: 'AI 检测管线', body: '七层多智能体决策（规则→角色辩论→场景遍历→综合），以正常流量零误报为硬约束调参。' },
                { title: '漏洞扫描引擎', body: '集成 Nuclei 模板体系，覆盖 CVE / OWASP Top 10 基线，输出可执行修复建议。' },
                { title: '攻击模拟与红队', body: '内置攻击模拟器对自身防线做持续演练，检测能力可被反复证伪而非自说自话。' },
                { title: '硬件网关管理', body: '网关一体机注册、策略下发、interlock 状态与审计证据链在控制台统一管理。' },
            ],
        },
        architecture: {
            eyebrow: '硬件架构',
            title: '四个独立模块，共同守住最后一道门',
            body: '任何一个模块不同意，SERVER ↔ LAN/WAN 业务桥保持（或回到）物理隔离。设备自身的独立 MGMT 管理通道在隔离期间仍然存活，恢复永远有路。',
            modules: [
                { tag: 'M1', name: '工业多网口网关', role: '双 1GbE 透明 L2 桥 + 独立 MGMT 口，承载数据面与管理面，只能请求释放、不能单方面决定释放' },
                { tag: 'M2', name: 'STM32H5/U5 安全授权控制器', role: '独立安全 MCU 执行最终授权状态机：challenge 去重、策略摘要比对、单调计数器、有效期、急停锁存' },
                { tag: 'M3', name: 'Secure Element / TPM', role: 'OPTIGA Trust M / SE050 / ATECC608B 多选型，私钥不可导出，release grant 必须硬件签名' },
                { tag: 'M4', name: 'Fail-Closed 硬件联锁', role: '物理继电器 + 反馈闭环真正改变网络拓扑，反馈不一致立即重新隔离' },
            ],
            specTitle: '关键规格（原型阶段）',
            specs: [
                { k: '数据平面', v: '双 1GbE RJ45 透明 L2 桥接（SERVER / LAN-WAN）' },
                { k: '管理平面', v: '独立 MGMT 口，可选蜂窝带外通道' },
                { k: '安全控制器', v: 'STM32H563（Cortex-M33，专用安全 MCU）' },
                { k: '信任根', v: 'Secure Element ECDSA P-256，私钥不可导出' },
                { k: '隔离机制', v: '硬件级 fail-closed interlock + 继电器 + 反馈校验' },
                { k: '产品化状态', v: '工业硬件原型（DIN-rail 集成），未量产' },
            ],
        },
        audiences: {
            eyebrow: '不同视角',
            title: '同一条防线，三种问法',
            items: [
                {
                    who: '给决策者',
                    pitch: '传统 EDR、防火墙和自动化运维都运行在可被攻破的软件环境里，攻击者拿到 root 后许多防护会失效。AetherGuard 把最终网络释放权移到服务器外部——默认隔离、硬件授权、状态反馈、全链路审计。',
                },
                {
                    who: '给安全团队',
                    pitch: '我们不替代你现有的任何安全栈，而是在关键服务器外增加一层可审计的硬件最后防线：网络释放必须经过外部网关、签名本地策略、硬件身份、单调计数器、有效期与 interlock 反馈校验。',
                },
                {
                    who: '给技术评审',
                    pitch: '工业多网口网关承担三平面隔离；STM32H5/U5 承担授权状态机；Secure Element 保护设备私钥；interlock 反馈实现 fail-closed。Linux 网关只能请求释放，不能单方面决定释放。',
                },
            ],
        },
        deploy: {
            eyebrow: '交付与部署',
            title: '有网没网，都装得上',
            modes: [
                { title: 'Docker 标准交付', body: '初始化脚本自动生成全套随机密钥，Compose v2 一次拉起全栈，占位配置直接拒绝启动。' },
                { title: 'Linux 一键安装', body: '全新主机一条命令：自动装 Docker、生成配置、构建启动并等待后端健康检查通过。' },
                { title: '离线（air-gapped）交付', body: '自包含分发包携带全部容器镜像、完整性校验和、甚至 Docker 本身——客户机全程零外网。' },
            ],
        },
        faq: {
            eyebrow: '常见问题',
            title: '把丑话说在前面',
            items: [
                { q: '它替代防火墙 / EDR / 堡垒机吗？', a: '不。AetherGuard 是在这些防护全部失效之后的最后一层，与现有安全栈叠加而非替换。' },
                { q: '断网隔离会不会把恢复通道也切断？', a: '不会。隔离只作用于 SERVER↔LAN/WAN 业务桥；设备自身的独立 MGMT / 蜂窝管理通道保持存活，运维始终可以到达设备。' },
                { q: '它会切断服务器电源吗？', a: '不会。v1 物理断路只控制低压网络链路，不切换市电、不直接断业务主机电源。' },
                { q: '没接入网关的链路也受保护吗？', a: '不受。承诺只覆盖实际经过一体机布线的网络链路；带外 BMC、Wi-Fi、备用网卡、本地控制台不在 v1 范围内，页面与文档均如实标注。' },
                { q: '现在是量产产品吗？', a: '当前为工业硬件原型阶段（DIN-rail 集成），控制面软件可交付部署；量产版将把控制器、安全芯片与隔离 IO 收敛为一体化硬件。' },
            ],
        },
        footer: {
            blurb: '守望流量，安抵未来。让安全技术不再冰冷，让每一次守护都值得信赖。',
            productCol: { title: '产品', items: ['控制台 Dashboard', '分布式 Agent', 'AI 检测管线', '漏洞扫描', '网关一体机'] },
            claim: '对外主张：即使服务器被 root 完全控制，受控网络链路的最终放行仍由服务器外置硬件网关决定。该主张为条件式承诺，成立前提见产品文档。',
            privacy: '隐私政策',
            terms: '服务条款',
            console: '进入控制台',
            currentLanding: '返回现行首页',
        },
    },
    en: {
        nav: {
            items: [
                { label: 'Capabilities', href: '#capabilities' },
                { label: 'Hardware', href: '#architecture' },
                { label: 'Perspectives', href: '#audiences' },
                { label: 'Deployment', href: '#deploy' },
                { label: 'FAQ', href: '#faq' },
            ],
            login: 'Open Console',
            tag: 'workshop · enterprise',
        },
        hero: {
            badge: 'Root-Resistant Final Defense Gateway Appliance',
            title: 'When the server falls, the line holds.',
            subtitle:
                'AetherGuard is a server security platform for mid-to-large enterprises: distributed detection and audit run in the control plane, while the final release of critical network links is enforced by a self-developed hardware gateway appliance outside the server. It does not replace your firewall, EDR, or bastion — it is the layer that remains after all of them fail.',
            primaryCta: 'Book a demo',
            secondaryCta: 'See the hardware',
            facts: [
                { value: 'M1–M4', label: 'four-module authorization chain' },
                { value: '13', label: 'firmware host tests passing' },
                { value: '9', label: 'fail-closed injections simulated' },
                { value: 'P-256', label: 'secure-element signed grants' },
            ],
            factNote: 'Only reproducible facts from this workspace appear here; unverified performance figures are banned by our claim discipline.',
        },
        capabilities: {
            eyebrow: 'Platform',
            title: 'A complete loop, from awareness to hardware release',
            items: [
                { title: 'Situational dashboard', body: 'A command view aggregating requests, blocks, and node health in real time.' },
                { title: 'Distributed agents', body: 'Lightweight agents live on each server; local defense keeps working if the control center disconnects.' },
                { title: 'AI detection pipeline', body: 'A seven-layer multi-agent decision chain tuned under a hard zero-false-positive constraint on normal traffic.' },
                { title: 'Vulnerability scanning', body: 'Nuclei-based template scanning across CVE and OWASP Top 10 baselines with actionable fixes.' },
                { title: 'Attack simulation', body: 'A built-in red-team simulator continuously exercises the defense so claims stay falsifiable.' },
                { title: 'Gateway management', body: 'Appliance registration, policy delivery, interlock state, and audit evidence in one console.' },
            ],
        },
        architecture: {
            eyebrow: 'Hardware',
            title: 'Four independent modules guard the last gate',
            body: 'If any module disagrees, the SERVER↔LAN/WAN bridge stays (or returns to) physically isolated. The appliance’s own MGMT path survives isolation, so recovery is always reachable.',
            modules: [
                { tag: 'M1', name: 'Industrial multi-port gateway', role: 'Dual 1GbE transparent L2 bridge + independent MGMT; carries data and management planes; may request a release, never decide one' },
                { tag: 'M2', name: 'STM32H5/U5 security controller', role: 'Dedicated secure MCU running the final authorization state machine: challenge dedup, policy digest, monotonic counter, expiry, e-stop latch' },
                { tag: 'M3', name: 'Secure Element / TPM', role: 'OPTIGA Trust M / SE050 / ATECC608B options; non-exportable keys; every release grant must be hardware-signed' },
                { tag: 'M4', name: 'Fail-closed interlock', role: 'A physical relay with feedback verification moves the topology; feedback mismatch re-isolates immediately' },
            ],
            specTitle: 'Key specifications (prototype stage)',
            specs: [
                { k: 'Data plane', v: 'Dual 1GbE RJ45 transparent L2 bridge (SERVER / LAN-WAN)' },
                { k: 'Management plane', v: 'Independent MGMT port, optional cellular out-of-band' },
                { k: 'Security controller', v: 'STM32H563 (Cortex-M33, dedicated security MCU)' },
                { k: 'Root of trust', v: 'Secure Element ECDSA P-256, non-exportable private keys' },
                { k: 'Isolation', v: 'Hardware fail-closed interlock + relay + feedback verification' },
                { k: 'Productization', v: 'Industrial prototype (DIN-rail integration), not yet mass-produced' },
            ],
        },
        audiences: {
            eyebrow: 'Perspectives',
            title: 'One defense line, three ways to ask about it',
            items: [
                { who: 'For decision makers', pitch: 'Traditional EDR, firewalls, and ops automation run inside software an attacker can own. AetherGuard moves the final network release outside the server: isolated by default, hardware-authorized, feedback-verified, fully audited.' },
                { who: 'For security teams', pitch: 'We do not replace your existing stack. We add an auditable hardware last line outside critical servers: releases must pass an external gateway, signed local policy, hardware identity, monotonic counters, expiry, and interlock feedback.' },
                { who: 'For technical review', pitch: 'An industrial multi-port gateway isolates three planes; the STM32H5/U5 owns the authorization state machine; the secure element guards device keys; the interlock with feedback implements fail-closed. The Linux gateway can request a release — it can never decide one.' },
            ],
        },
        deploy: {
            eyebrow: 'Delivery',
            title: 'Installs with or without a network',
            modes: [
                { title: 'Standard Docker delivery', body: 'A setup script generates a full set of random secrets; Compose v2 brings up the stack; placeholder configs refuse to boot.' },
                { title: 'One command on fresh Linux', body: 'Installs Docker if missing, generates configuration, builds, starts, and waits for backend health.' },
                { title: 'Air-gapped delivery', body: 'A self-contained bundle carries every container image, integrity checksums, and optionally Docker itself — zero network on site.' },
            ],
        },
        faq: {
            eyebrow: 'FAQ',
            title: 'The hard questions, answered up front',
            items: [
                { q: 'Does it replace my firewall / EDR / bastion?', a: 'No. AetherGuard is the layer that remains after those fail. It stacks on top of your existing controls.' },
                { q: 'Does isolation cut my recovery path too?', a: 'No. Isolation only affects the SERVER↔LAN/WAN business bridge; the appliance’s independent MGMT/cellular path stays alive.' },
                { q: 'Does it cut server power?', a: 'No. v1 controls the low-voltage network link only — no mains switching, no host power cuts.' },
                { q: 'Are links not cabled through it protected?', a: 'No. The claim covers physically cabled links only; BMC, Wi-Fi, spare NICs, and local console are outside v1 scope — stated plainly here and in the docs.' },
                { q: 'Is this a mass-produced product?', a: 'The appliance is an industrial prototype (DIN-rail integration); the control-plane software is deployable today. Production hardware will consolidate controller, secure element, and isolation IO.' },
            ],
        },
        footer: {
            blurb: 'Watching over traffic, arriving safely at the future.',
            productCol: { title: 'Product', items: ['Dashboard', 'Distributed agents', 'AI detection', 'Vulnerability scanning', 'Gateway appliance'] },
            claim: 'External claim: even with full root control of the server, the final release of protected network links is decided by the external hardware gateway. This is a conditional promise; see the product documentation for the exact preconditions.',
            privacy: 'Privacy',
            terms: 'Terms',
            console: 'Open Console',
            currentLanding: 'Current landing',
        },
    },
};

const capabilityIcons = [LayoutDashboard, Server, Radar, FileSearch, Siren, Cpu];
const audienceIcons = [Landmark, ShieldCheck, Workflow];
const deployIcons = [Network, Building2, Factory];

const LandingEnterprise = () => {
    const navigate = useNavigate();
    const [lang, setLang] = useState<Lang>(() =>
        typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en',
    );
    const [openFaq, setOpenFaq] = useState(0);
    const c = useMemo(() => COPY[lang], [lang]);

    return (
        <div data-testid="landing-workshop-enterprise" className="min-h-screen bg-white text-slate-900">
            {/* Nav */}
            <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
                <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
                            <ShieldCheck className="h-5 w-5 text-white" />
                        </div>
                        <span className="text-lg font-bold tracking-tight">AetherGuard</span>
                        <span className="hidden rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 md:inline">
                            {c.nav.tag}
                        </span>
                    </div>
                    <nav className="hidden items-center gap-6 text-sm text-slate-600 lg:flex">
                        {c.nav.items.map((item) => (
                            <a key={item.href} href={item.href} className="transition hover:text-slate-900">
                                {item.label}
                            </a>
                        ))}
                    </nav>
                    <div className="flex items-center gap-2">
                        <div className="flex rounded-full border border-slate-200 p-0.5 text-xs">
                            {(['zh', 'en'] as const).map((l) => (
                                <button
                                    key={l}
                                    type="button"
                                    aria-pressed={lang === l}
                                    onClick={() => setLang(l)}
                                    className={`rounded-full px-3 py-1 transition ${
                                        lang === l ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'
                                    }`}
                                >
                                    {l === 'zh' ? '中文' : 'EN'}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate('/login')}
                            className="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                        >
                            {c.nav.login}
                        </button>
                    </div>
                </div>
            </header>

            {/* Hero */}
            <section className="border-b border-slate-100 bg-gradient-to-b from-blue-50/60 to-white">
                <div className="mx-auto w-full max-w-6xl px-6 pb-16 pt-20 text-center">
                    <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-4 py-1 text-xs font-semibold text-blue-700">
                        <Lock className="h-3.5 w-3.5" />
                        {c.hero.badge}
                    </span>
                    <h1 className="mx-auto mt-8 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">{c.hero.title}</h1>
                    <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-slate-600">{c.hero.subtitle}</p>
                    <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                        <button
                            type="button"
                            onClick={() => navigate('/login')}
                            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-7 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
                        >
                            {c.hero.primaryCta}
                            <ArrowRight className="h-4 w-4" />
                        </button>
                        <a
                            href="#architecture"
                            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-7 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500"
                        >
                            {c.hero.secondaryCta}
                        </a>
                    </div>
                    <div className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 md:grid-cols-4">
                        {c.hero.facts.map((fact) => (
                            <div key={fact.label} className="bg-white px-4 py-6">
                                <p className="text-2xl font-extrabold text-blue-700">{fact.value}</p>
                                <p className="mt-1 text-xs leading-snug text-slate-500">{fact.label}</p>
                            </div>
                        ))}
                    </div>
                    <p className="mx-auto mt-4 max-w-2xl text-xs text-slate-400">{c.hero.factNote}</p>

                    {/* Product shot — real console screenshot in a browser frame */}
                    <div className="relative mx-auto mt-14 max-w-5xl">
                        <div
                            aria-hidden
                            className="pointer-events-none absolute -inset-8 rounded-[40px] opacity-40 blur-3xl"
                            style={{ background: 'radial-gradient(closest-side, rgba(59,130,246,0.35), transparent)' }}
                        />
                        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 shadow-2xl">
                            <div className="flex items-center gap-1.5 border-b border-slate-700/60 bg-slate-800 px-4 py-2.5">
                                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                                <span className="ml-3 rounded-md bg-slate-700/70 px-2 py-0.5 text-[10px] text-slate-300">
                                    aetherguard · {lang === 'zh' ? '安全控制台' : 'security console'}
                                </span>
                            </div>
                            <img src={consoleDashboard} alt="AetherGuard operations dashboard" className="w-full" />
                        </div>
                    </div>
                </div>
            </section>

            {/* Capabilities */}
            <section id="capabilities" className="mx-auto w-full max-w-6xl px-6 py-20">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">{c.capabilities.eyebrow}</p>
                <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight md:text-4xl">{c.capabilities.title}</h2>
                <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                    {c.capabilities.items.map((item, index) => {
                        const Icon = capabilityIcons[index] ?? LayoutDashboard;
                        return (
                            <div key={item.title} className="rounded-2xl border border-slate-200 p-6 transition hover:border-blue-300 hover:shadow-sm">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
                                    <Icon className="h-5 w-5 text-blue-700" />
                                </div>
                                <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</p>
                            </div>
                        );
                    })}
                </div>

                {/* Screenshot strip — the surfaces behind the capability claims */}
                <div className="mt-12 grid gap-5 md:grid-cols-3">
                    {[
                        { src: consoleTraffic, zh: '流量拦截 · 逐会话结论轨迹', en: 'Traffic interceptor · per-session verdicts' },
                        { src: consoleDevices, zh: '设备管理 · 网关一体机与健康态', en: 'Devices · appliance fleet & health' },
                        { src: consoleScanner, zh: '漏洞扫描 · 基线体检与修复建议', en: 'Scanner · baseline checks & fixes' },
                    ].map((shot) => (
                        <figure key={shot.en} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <img src={shot.src} alt={shot.en} className="h-44 w-full object-cover object-top" />
                            <figcaption className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
                                {lang === 'zh' ? shot.zh : shot.en}
                            </figcaption>
                        </figure>
                    ))}
                </div>
            </section>

            {/* Architecture */}
            <section id="architecture" className="border-y border-slate-100 bg-slate-50">
                <div className="mx-auto w-full max-w-6xl px-6 py-20">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">{c.architecture.eyebrow}</p>
                    <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight md:text-4xl">{c.architecture.title}</h2>
                    <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-600">{c.architecture.body}</p>
                    <div className="mt-10 grid items-start gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                        <div className="grid gap-5 md:grid-cols-2">
                            {c.architecture.modules.map((m) => (
                                <div key={m.tag} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-6">
                                    <span className="flex h-10 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
                                        {m.tag}
                                    </span>
                                    <div>
                                        <h3 className="text-base font-semibold">{m.name}</h3>
                                        <p className="mt-1 text-sm leading-relaxed text-slate-600">{m.role}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <figure className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <img src={applianceAssembly} alt="Gateway appliance enclosure render" className="w-full object-contain p-6" />
                            <figcaption className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                                {lang === 'zh'
                                    ? 'Gateway Appliance 机箱渲染:顶置三色堆叠灯,面板集成 E-STOP / CONFIRM 与 SERVER / LAN-WAN / MGMT 端口(原型)'
                                    : 'Gateway Appliance enclosure render: stack light, panel E-STOP / CONFIRM, SERVER / LAN-WAN / MGMT ports (prototype)'}
                            </figcaption>
                        </figure>
                    </div>
                    <h3 className="mt-14 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">{c.architecture.specTitle}</h3>
                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        {c.architecture.specs.map((row, index) => (
                            <div
                                key={row.k}
                                className={`grid grid-cols-1 gap-1 px-6 py-4 md:grid-cols-[220px_1fr] ${index > 0 ? 'border-t border-slate-100' : ''}`}
                            >
                                <span className="text-sm font-semibold text-slate-500">{row.k}</span>
                                <span className="text-sm text-slate-800">{row.v}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Audiences */}
            <section id="audiences" className="mx-auto w-full max-w-6xl px-6 py-20">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">{c.audiences.eyebrow}</p>
                <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight md:text-4xl">{c.audiences.title}</h2>
                <div className="mt-10 grid gap-5 md:grid-cols-3">
                    {c.audiences.items.map((a, index) => {
                        const Icon = audienceIcons[index] ?? Landmark;
                        return (
                            <div key={a.who} className="rounded-2xl border border-slate-200 p-6">
                                <Icon className="h-5 w-5 text-blue-700" />
                                <h3 className="mt-3 text-base font-semibold">{a.who}</h3>
                                <p className="mt-2 text-sm leading-relaxed text-slate-600">{a.pitch}</p>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* Deploy */}
            <section id="deploy" className="border-y border-slate-100 bg-slate-50">
                <div className="mx-auto w-full max-w-6xl px-6 py-20">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">{c.deploy.eyebrow}</p>
                    <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight md:text-4xl">{c.deploy.title}</h2>
                    <div className="mt-10 grid gap-5 md:grid-cols-3">
                        {c.deploy.modes.map((mode, index) => {
                            const Icon = deployIcons[index] ?? Network;
                            return (
                                <div key={mode.title} className="rounded-2xl border border-slate-200 bg-white p-6">
                                    <Icon className="h-5 w-5 text-blue-700" />
                                    <h3 className="mt-3 text-base font-semibold">{mode.title}</h3>
                                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{mode.body}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* FAQ */}
            <section id="faq" className="mx-auto w-full max-w-4xl px-6 py-20">
                <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">{c.faq.eyebrow}</p>
                <h2 className="mt-3 text-center text-3xl font-bold tracking-tight md:text-4xl">{c.faq.title}</h2>
                <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200">
                    {c.faq.items.map((item, index) => (
                        <div key={item.q}>
                            <button
                                type="button"
                                onClick={() => setOpenFaq(openFaq === index ? -1 : index)}
                                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                                aria-expanded={openFaq === index}
                            >
                                <span className="text-sm font-semibold text-slate-900">{item.q}</span>
                                <ChevronDown
                                    className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${openFaq === index ? 'rotate-180' : ''}`}
                                />
                            </button>
                            {openFaq === index && (
                                <p className="px-6 pb-5 text-sm leading-relaxed text-slate-600">{item.a}</p>
                            )}
                        </div>
                    ))}
                </div>
            </section>

            {/* Footer */}
            <footer className="border-t border-slate-200 bg-slate-950 text-slate-300">
                <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-16 md:grid-cols-[1.4fr_1fr_1fr]">
                    <div>
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="h-5 w-5 text-blue-400" />
                            <span className="text-lg font-bold text-white">AetherGuard</span>
                        </div>
                        <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">{c.footer.blurb}</p>
                        <p className="mt-6 max-w-md text-xs leading-relaxed text-slate-500">{c.footer.claim}</p>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white">{c.footer.productCol.title}</h3>
                        <ul className="mt-4 space-y-2 text-sm text-slate-400">
                            {c.footer.productCol.items.map((item) => (
                                <li key={item} className="flex items-center gap-2">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />
                                    {item}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="space-y-2 text-sm">
                        <button type="button" className="block text-slate-400 transition hover:text-white" onClick={() => navigate('/login')}>
                            {c.footer.console}
                        </button>
                        <button type="button" className="block text-slate-400 transition hover:text-white" onClick={() => navigate('/privacy')}>
                            {c.footer.privacy}
                        </button>
                        <button type="button" className="block text-slate-400 transition hover:text-white" onClick={() => navigate('/terms')}>
                            {c.footer.terms}
                        </button>
                        <button type="button" className="block text-slate-400 transition hover:text-white" onClick={() => navigate('/')}>
                            {c.footer.currentLanding}
                        </button>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default LandingEnterprise;
