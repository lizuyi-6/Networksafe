import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Activity,
    AlertTriangle,
    ArrowDown,
    ArrowRight,
    Box,
    Cable,
    CheckCircle2,
    Cpu,
    FileCheck2,
    Fingerprint,
    HardDrive,
    KeyRound,
    LockKeyhole,
    Network,
    ScanSearch,
    Server,
    ShieldCheck,
    Workflow,
    type LucideIcon,
} from 'lucide-react';
import Logo from '../components/Logo';
import { COMPANY_NAME_CN, COMPANY_NAME_EN } from '../config/branding';
import consoleDashboard from '../assets/landing-workshop/console-dashboard.png';
import consoleScanner from '../assets/landing-workshop/console-scanner.png';
import consoleTraffic from '../assets/landing-workshop/console-traffic.png';

type Language = 'en' | 'zh';

type PageCopy = {
    header: {
        architecture: string;
        console: string;
        deployment: string;
        login: string;
    };
    hero: {
        eyebrow: string;
        statement: string;
        body: string;
        qualifier: string;
        primary: string;
        secondary: string;
        signals: string[];
        imageAlt: string;
        imageCaption: string;
    };
    premise: {
        eyebrow: string;
        title: string;
        body: string;
        items: Array<{ title: string; body: string }>;
    };
    architecture: {
        eyebrow: string;
        title: string;
        body: string;
        steps: Array<{ tag: string; title: string; body: string }>;
        invariantTitle: string;
        invariants: string[];
    };
    surfaces: {
        eyebrow: string;
        title: string;
        body: string;
        captureNote: string;
        dashboard: string;
        traffic: string;
        scanner: string;
    };
    capabilities: {
        eyebrow: string;
        title: string;
        body: string;
        items: Array<{ title: string; body: string }>;
    };
    deployment: {
        eyebrow: string;
        title: string;
        body: string;
        modes: Array<{ title: string; body: string }>;
    };
    limits: {
        eyebrow: string;
        title: string;
        body: string;
        items: string[];
    };
    cta: {
        eyebrow: string;
        title: string;
        body: string;
        primary: string;
        secondary: string;
    };
    footer: {
        tagline: string;
        privacy: string;
        terms: string;
        copyright: string;
    };
};

const COPY: Record<Language, PageCopy> = {
    en: {
        header: {
            architecture: 'Architecture',
            console: 'Console',
            deployment: 'Deployment',
            login: 'Login',
        },
        hero: {
            eyebrow: 'Hardware-enforced server defense',
            statement: 'Security that can intercept, reason, and execute in one decision loop.',
            body: 'A control plane for detection, investigation, response, and evidence, backed by an external Gateway Appliance that keeps the final network-release decision outside the server it protects.',
            qualifier: 'Engineering scope: the final grant is hardware-enforced when protected links are physically wired through the appliance, Final Defense Mode is enabled, and the signed policy, secure element, interlock feedback, and health checks all agree.',
            primary: 'Explore the system',
            secondary: 'Open console',
            signals: ['Fail-closed by default', 'Signed hardware grants', 'Temporary release windows'],
            imageAlt: 'AetherGuard security control plane dashboard',
            imageCaption: 'Current AetherGuard console interface',
        },
        premise: {
            eyebrow: 'The operating premise',
            title: 'Assume the protected server can lose root.',
            body: 'AetherGuard separates observation from final authority. Software can detect, explain, and request action; an independent appliance decides whether the protected network link may be released.',
            items: [
                {
                    title: 'Authority moves off-host',
                    body: 'Hardware identity, signed grants, policy binding, and interlock state live outside the server an attacker may control.',
                },
                {
                    title: 'Failure changes topology',
                    body: 'A rejected or uncertain release isolates the SERVER-to-LAN/WAN bridge instead of merely returning an application error.',
                },
                {
                    title: 'Recovery remains reachable',
                    body: 'Isolation preserves the appliance management path so operators can investigate and restore service without reopening the protected bridge.',
                },
            ],
        },
        architecture: {
            eyebrow: 'Authorization chain',
            title: 'Four modules must independently agree.',
            body: 'Every release request crosses the same ordered chain. A mismatch in signature, challenge, policy digest, monotonic counter, expiry, secure-element presence, or interlock feedback returns the bridge to isolation.',
            steps: [
                { tag: 'M1', title: 'Gateway Daemon', body: 'Validates control-plane context, policy binding, counters, and release timing before contacting hardware.' },
                { tag: 'M2', title: 'STM32 Controller', body: 'Repeats the critical checks in firmware and denies release when any required field or feedback is uncertain.' },
                { tag: 'M3', title: 'Secure Element', body: 'Keeps device identity and signing material in hardware. Missing hardware trust means no release.' },
                { tag: 'M4', title: 'Fail-Closed Interlock', body: 'Moves the physical bridge and verifies the resulting state. Feedback mismatch reasserts isolation.' },
            ],
            invariantTitle: 'Release is the exception, isolation is the steady state.',
            invariants: [
                'The same policy digest is compared end to end.',
                'Monotonic counters reject replay and rollback.',
                'Every release carries a TTL and returns to isolated.',
                'Emergency stop remains latched until explicit reset.',
            ],
        },
        surfaces: {
            eyebrow: 'Product surfaces',
            title: 'The operating picture is visible, not implied.',
            body: 'These captures come from the current AetherGuard console and show the interfaces operators use for telemetry, traffic decisions, and scan evidence.',
            captureNote: 'Interface capture. Visible values represent the captured console state and are not performance claims.',
            dashboard: 'Control plane overview',
            traffic: 'Traffic interception and verdicts',
            scanner: 'Scan scope, history, and evidence',
        },
        capabilities: {
            eyebrow: 'One operational surface',
            title: 'From signal collection to governed response.',
            body: 'The control plane keeps detection, response, deployment, and evidence in one inspectable workflow while the hardware boundary remains independently enforceable.',
            items: [
                { title: 'Traffic interception', body: 'Observe flows, protocols, threats, and per-session outcomes from a shared console.' },
                { title: 'Distributed agents', body: 'Track host agents, health, recent threats, and signed command activity across managed sites.' },
                { title: 'Multi-agent cognition', body: 'Inspect layered analysis, role contributions, and the audit trail behind a synthesized verdict.' },
                { title: 'Scanning and evidence', body: 'Scope URL and host checks, retain findings, and carry evidence into remediation actions.' },
                { title: 'Governance and audit', body: 'Separate tenant, admin, and governance views while keeping sensitive actions attributable.' },
                { title: 'Offline operations', body: 'Support connected Docker deployments, fresh Linux hosts, and self-contained air-gapped bundles.' },
            ],
        },
        deployment: {
            eyebrow: 'Deployment paths',
            title: 'Built for the rack, not only the lab.',
            body: 'Deployment paths share the same generated-secret and health-check expectations. Placeholder secrets are rejected rather than accepted as a convenient default.',
            modes: [
                { title: 'Container stack', body: 'Cross-platform environment setup followed by the canonical Compose topology.' },
                { title: 'Fresh Linux host', body: 'A guided installer prepares the host, generates configuration, starts services, and waits for health.' },
                { title: 'Air-gapped site', body: 'A self-contained bundle carries images, checksums, configuration generation, and an optional Docker runtime.' },
            ],
        },
        limits: {
            eyebrow: 'Honest boundary',
            title: 'The hardware claim is conditional and deliberately narrow.',
            body: 'A last line of defense is credible only when its limits are explicit. The current product protects the network path that is physically routed through the Gateway Appliance.',
            items: [
                'Out-of-band paths such as BMC, Wi-Fi, spare NICs, and local console access are outside this boundary.',
                'The appliance does not prevent direct storage damage or host disk encryption after root compromise.',
                'The current appliance controls the low-voltage network path; it does not switch server mains power.',
                'Production-appliance hardware-in-the-loop release and feedback evidence remains a release gate beyond software simulation and host-side firmware tests.',
            ],
        },
        cta: {
            eyebrow: 'Operate with an external trust boundary',
            title: 'Put the final decision outside the server.',
            body: 'Enter the console to inspect the control plane, or review the product boundary before deployment.',
            primary: 'Open console',
            secondary: 'Read privacy policy',
        },
        footer: {
            tagline: 'Hardware-enforced final defense for protected server networks.',
            privacy: 'Privacy',
            terms: 'Terms',
            copyright: 'All rights reserved.',
        },
    },
    zh: {
        header: {
            architecture: '架构',
            console: '控制台',
            deployment: '部署',
            login: '登录',
        },
        hero: {
            eyebrow: '由硬件强制执行的服务器防御',
            statement: '把拦截、推理、仲裁与执行收进同一条决策链。',
            body: 'AetherGuard 将检测、调查、响应与证据管理收进统一控制面，并通过独立 Gateway Appliance，把最终网络放行决定留在被保护服务器之外。',
            qualifier: '工程口径：只有受保护链路实际经过设备布线、Final Defense 模式开启，并且签名策略、安全元件、联锁反馈与健康检查全部一致时，最终放行才由硬件强制执行。',
            primary: '查看系统全貌',
            secondary: '进入控制台',
            signals: ['默认 fail-closed', '硬件签名授权', '释放窗口必然过期'],
            imageAlt: 'AetherGuard 安全控制台界面',
            imageCaption: '当前 AetherGuard 控制台界面',
        },
        premise: {
            eyebrow: '运行前提',
            title: '假设被保护服务器已经失去 root。',
            body: 'AetherGuard 把观察能力与最终授权分开：软件负责检测、解释与发起动作，独立设备负责决定受保护网络链路能否放行。',
            items: [
                { title: '权威移出主机', body: '硬件身份、签名授权、策略绑定与联锁状态都位于攻击者可能控制的服务器之外。' },
                { title: '失败会改变拓扑', body: '放行被拒或状态不确定时，系统隔离 SERVER 到 LAN/WAN 的业务桥，而不只是返回应用错误。' },
                { title: '恢复通道仍可到达', body: '隔离保留设备自身的管理路径，让运维在不重新开放业务桥的前提下调查和恢复。' },
            ],
        },
        architecture: {
            eyebrow: '授权链路',
            title: '四个模块必须独立同意。',
            body: '每次放行请求都按同一顺序穿过整条链路。签名、challenge、策略摘要、单调计数器、过期时间、安全元件在位或联锁反馈任一不一致，业务桥都会回到隔离态。',
            steps: [
                { tag: 'M1', title: 'Gateway Daemon', body: '在接触硬件之前校验控制面上下文、策略绑定、计数器与释放时间。' },
                { tag: 'M2', title: 'STM32 控制器', body: '在固件中重复关键校验；任何必需字段或反馈不确定时默认拒绝放行。' },
                { tag: 'M3', title: '安全元件', body: '把设备身份与签名材料留在硬件中。缺少硬件信任，就没有放行。' },
                { tag: 'M4', title: 'Fail-Closed 联锁', body: '真正改变物理桥状态并核验结果；反馈不一致时重新断言隔离。' },
            ],
            invariantTitle: '放行是例外，隔离是常态。',
            invariants: [
                '同一份策略摘要在端到端逐字比对。',
                '单调计数器拒绝重放与回滚。',
                '每次放行都携带 TTL，并自动回到隔离态。',
                '急停保持锁存，直到操作员显式复位。',
            ],
        },
        surfaces: {
            eyebrow: '产品界面',
            title: '运行态看得见，而不是靠想象。',
            body: '以下画面取自当前 AetherGuard 控制台，呈现运维实际使用的遥测总览、流量判定与扫描证据界面。',
            captureNote: '界面实拍；画面中的数值仅代表截图时的控制台状态，不构成性能承诺。',
            dashboard: '控制面总览',
            traffic: '流量拦截与判定',
            scanner: '扫描范围、历史与证据',
        },
        capabilities: {
            eyebrow: '统一运维界面',
            title: '从信号采集到受治理响应。',
            body: '控制面把检测、响应、部署与证据放进同一条可审计流程，同时让硬件边界保持独立强制。',
            items: [
                { title: '流量拦截', body: '在统一控制台观察流、协议、威胁与逐会话处置结果。' },
                { title: '分布式智能节点', body: '跨站点跟踪主机 Agent、健康状态、近期威胁与签名命令活动。' },
                { title: '多智能体认知', body: '查看分层分析、角色贡献，以及合成结论背后的审计轨迹。' },
                { title: '扫描与证据', body: '定义 URL 与主机检查范围，保留发现，并将证据带入修复动作。' },
                { title: '治理与审计', body: '分离租户、管理员与治理视图，让敏感动作始终可归因。' },
                { title: '离线运行', body: '覆盖联网 Docker 部署、全新 Linux 主机与自包含的 air-gapped 分发包。' },
            ],
        },
        deployment: {
            eyebrow: '部署路径',
            title: '面向真实机柜，而不只面向实验室。',
            body: '各部署路径遵循同一套现场密钥生成与健康检查要求；占位密钥会被拒绝，而不是作为方便的默认值继续运行。',
            modes: [
                { title: '容器化部署', body: '跨平台环境初始化后，启动规范的 Compose 拓扑。' },
                { title: '全新 Linux 主机', body: '引导式安装准备主机、生成配置、启动服务并等待健康状态。' },
                { title: '离线客户现场', body: '自包含分发包携带镜像、校验和、配置生成器与可选 Docker 运行时。' },
            ],
        },
        limits: {
            eyebrow: '诚实边界',
            title: '硬件声明有明确条件，也刻意保持狭窄。',
            body: '可信的最后防线必须把边界写在明面上。当前产品保护的是实际经过 Gateway Appliance 布线的网络链路。',
            items: [
                'BMC、Wi-Fi、备用网卡与本地控制台等带外路径不在该边界内。',
                'root 沦陷后，设备不能阻止攻击者直接破坏存储或加密主机磁盘。',
                '当前设备控制低压网络链路，不负责切断服务器市电。',
                '量产设备的硬件在环放行与反馈证据仍是发布门禁；现有软件模拟与固件 host 测试不能替代它。',
            ],
        },
        cta: {
            eyebrow: '把信任边界移出主机',
            title: '让最终决定发生在服务器之外。',
            body: '进入控制台查看完整控制面，或在部署前先阅读产品边界。',
            primary: '进入控制台',
            secondary: '阅读隐私政策',
        },
        footer: {
            tagline: '面向受保护服务器网络的硬件强制最后防线。',
            privacy: '隐私政策',
            terms: '服务条款',
            copyright: '保留所有权利。',
        },
    },
};

const premiseIcons: LucideIcon[] = [Fingerprint, Cable, KeyRound];
const moduleIcons: LucideIcon[] = [Network, Cpu, LockKeyhole, ShieldCheck];
const capabilityIcons: LucideIcon[] = [Activity, Server, Workflow, ScanSearch, FileCheck2, HardDrive];
const deploymentIcons: LucideIcon[] = [Box, Server, HardDrive];

const Landing = () => {
    const navigate = useNavigate();
    const [language, setLanguage] = useState<Language>(() => (
        typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    ));
    const copy = COPY[language];

    useEffect(() => {
        const bodyOverflow = document.body.style.overflow;
        const bodyHeight = document.body.style.height;
        const htmlOverflow = document.documentElement.style.overflow;

        document.body.style.overflow = 'auto';
        document.body.style.height = 'auto';
        document.documentElement.style.overflow = 'auto';

        return () => {
            document.body.style.overflow = bodyOverflow;
            document.body.style.height = bodyHeight;
            document.documentElement.style.overflow = htmlOverflow;
        };
    }, []);

    const scrollTo = (id: string) => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
        <div className="min-h-screen overflow-x-hidden bg-[#f4f5f2] text-[#141816]">
            <header className="sticky top-0 z-50 border-b border-black/10 bg-[#f7f7f1]/95">
                <div className="mx-auto flex min-h-[72px] max-w-[1480px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
                    <button
                        type="button"
                        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                        className="flex min-h-11 items-center gap-2 text-left"
                        aria-label="AetherGuard home"
                    >
                        <Logo showText={false} />
                        <span className="hidden text-base font-bold sm:inline">AetherGuard</span>
                    </button>

                    <nav className="hidden items-center gap-7 text-sm font-medium text-black/65 lg:flex" aria-label="Landing page">
                        <button type="button" onClick={() => scrollTo('architecture')} className="transition-colors hover:text-black">
                            {copy.header.architecture}
                        </button>
                        <button type="button" onClick={() => scrollTo('product-surfaces')} className="transition-colors hover:text-black">
                            {copy.header.console}
                        </button>
                        <button type="button" onClick={() => scrollTo('deployment')} className="transition-colors hover:text-black">
                            {copy.header.deployment}
                        </button>
                    </nav>

                    <div className="flex items-center gap-2">
                        <div className="flex rounded-md border border-black/15 bg-white p-1" role="group" aria-label="Language">
                            <button
                                type="button"
                                data-testid="landing-lang-en"
                                aria-pressed={language === 'en'}
                                onClick={() => setLanguage('en')}
                                className={`min-h-8 rounded px-2.5 text-xs font-semibold transition-colors ${language === 'en' ? 'bg-[#15251d] text-white' : 'text-black/55 hover:text-black'}`}
                            >
                                EN
                            </button>
                            <button
                                type="button"
                                data-testid="landing-lang-zh"
                                aria-pressed={language === 'zh'}
                                onClick={() => setLanguage('zh')}
                                className={`min-h-8 rounded px-2.5 text-xs font-semibold transition-colors ${language === 'zh' ? 'bg-[#15251d] text-white' : 'text-black/55 hover:text-black'}`}
                            >
                                中文
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate('/login')}
                            className="min-h-10 rounded-md bg-[#1f6f52] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#195d45] sm:px-4"
                        >
                            {copy.header.login}
                        </button>
                    </div>
                </div>
            </header>

            <main data-testid="landing-main">
                <section
                    data-testid="landing-hero"
                    className="relative isolate flex min-h-[calc(100svh-10.5rem)] items-center overflow-hidden border-b border-black/10"
                >
                    <img
                        src={consoleDashboard}
                        alt={copy.hero.imageAlt}
                        className="absolute inset-0 -z-20 h-full w-full object-cover object-top"
                    />
                    <div className="absolute inset-0 -z-10 bg-[#07100b]/75" />

                    <div className="mx-auto flex w-full max-w-[1480px] px-5 py-10 sm:px-8 sm:py-14 lg:px-12">
                        <div className="max-w-3xl">
                            <p className="flex items-center gap-2 text-sm font-semibold text-[#8ce0ba]">
                                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                                {copy.hero.eyebrow}
                            </p>
                            <h1 className="mt-5 text-6xl font-black leading-none text-white sm:text-7xl lg:text-8xl">
                                AetherGuard
                            </h1>
                            <p className="mt-6 max-w-2xl text-xl font-semibold leading-8 text-white sm:text-2xl sm:leading-9">
                                {copy.hero.statement}
                            </p>
                            <p className="mt-4 max-w-2xl text-base leading-7 text-white/75 sm:text-lg sm:leading-8">
                                {copy.hero.body}
                            </p>

                            <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2">
                                {copy.hero.signals.map((signal) => (
                                    <span key={signal} className="inline-flex items-center gap-2 text-sm font-medium text-white/85">
                                        <CheckCircle2 className="h-4 w-4 text-[#8ce0ba]" aria-hidden="true" />
                                        {signal}
                                    </span>
                                ))}
                            </div>

                            <p className="mt-7 max-w-2xl border-l-4 border-[#d9a83e] pl-4 text-sm leading-6 text-white/70">
                                {copy.hero.qualifier}
                            </p>

                            <div className="mt-8 flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    data-testid="landing-primary-cta"
                                    onClick={() => scrollTo('product-surfaces')}
                                    className="inline-flex min-h-12 items-center gap-2 rounded-md bg-[#1f6f52] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#195d45]"
                                >
                                    {copy.hero.primary}
                                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                                </button>
                                <button
                                    type="button"
                                    data-testid="landing-secondary-cta"
                                    onClick={() => navigate('/login')}
                                    className="inline-flex min-h-12 items-center gap-2 rounded-md border border-white/35 bg-black/25 px-5 text-sm font-semibold text-white transition-colors hover:bg-black/40"
                                >
                                    {copy.hero.secondary}
                                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                    </div>

                    <p className="absolute bottom-3 right-4 hidden text-xs text-white/55 md:block">
                        {copy.hero.imageCaption}
                    </p>
                </section>

                <section className="border-b border-black/10 bg-white" id="premise">
                    <div className="mx-auto max-w-[1480px] px-5 py-12 sm:px-8 lg:px-12">
                        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
                            <div className="max-w-xl">
                                <p className="text-sm font-semibold text-[#9a6811]">{copy.premise.eyebrow}</p>
                                <h2 className="mt-3 text-3xl font-bold leading-tight sm:text-5xl">{copy.premise.title}</h2>
                                <p className="mt-5 text-base leading-8 text-black/65">{copy.premise.body}</p>
                            </div>

                            <div className="grid border-t border-black/10 md:grid-cols-3 md:border-l md:border-t-0">
                                {copy.premise.items.map((item, index) => {
                                    const Icon = premiseIcons[index];
                                    return (
                                        <article key={item.title} className="border-b border-black/10 px-0 py-6 md:border-b-0 md:border-r md:px-6 md:py-2">
                                            <Icon className="h-6 w-6 text-[#1f6f52]" aria-hidden="true" />
                                            <h3 className="mt-5 text-lg font-bold">{item.title}</h3>
                                            <p className="mt-3 text-sm leading-7 text-black/60">{item.body}</p>
                                        </article>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </section>

                <section id="architecture" className="scroll-mt-20 border-b border-black/10 bg-[#14221b] text-white">
                    <div className="mx-auto max-w-[1480px] px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
                        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
                            <div>
                                <p className="text-sm font-semibold text-[#7fd4ad]">{copy.architecture.eyebrow}</p>
                                <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight sm:text-5xl">{copy.architecture.title}</h2>
                            </div>
                            <p className="max-w-2xl text-base leading-8 text-white/65">{copy.architecture.body}</p>
                        </div>

                        <div className="mt-12 grid gap-3 lg:grid-cols-4">
                            {copy.architecture.steps.map((step, index) => {
                                const Icon = moduleIcons[index];
                                return (
                                    <article key={step.tag} className="rounded-lg border border-white/15 bg-white/[0.04] p-5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-bold text-[#7fd4ad]">{step.tag}</span>
                                            <Icon className="h-5 w-5 text-white/75" aria-hidden="true" />
                                        </div>
                                        <h3 className="mt-8 text-lg font-bold">{step.title}</h3>
                                        <p className="mt-3 text-sm leading-7 text-white/60">{step.body}</p>
                                    </article>
                                );
                            })}
                        </div>

                        <div className="mt-10 border-t border-white/15 pt-8 lg:flex lg:items-start lg:justify-between lg:gap-12">
                            <h3 className="max-w-md text-2xl font-bold leading-tight">{copy.architecture.invariantTitle}</h3>
                            <div className="mt-6 grid flex-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:mt-0">
                                {copy.architecture.invariants.map((item) => (
                                    <div key={item} className="flex items-start gap-3 text-sm leading-6 text-white/70">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#7fd4ad]" aria-hidden="true" />
                                        <span>{item}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                <section
                    id="product-surfaces"
                    data-testid="landing-product-surfaces"
                    className="scroll-mt-20 border-b border-black/10 bg-[#eef0ec]"
                >
                    <div className="mx-auto max-w-[1480px] px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
                        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
                            <div>
                                <p className="text-sm font-semibold text-[#1f6f52]">{copy.surfaces.eyebrow}</p>
                                <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight sm:text-5xl">{copy.surfaces.title}</h2>
                            </div>
                            <div>
                                <p className="max-w-2xl text-base leading-8 text-black/65">{copy.surfaces.body}</p>
                                <p className="mt-3 text-xs leading-5 text-black/45">{copy.surfaces.captureNote}</p>
                            </div>
                        </div>

                        <div className="mt-12 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
                            <figure className="overflow-hidden rounded-lg border border-black/15 bg-[#090b0a] shadow-lg">
                                <img src={consoleDashboard} alt={copy.surfaces.dashboard} className="h-full w-full object-cover object-top" />
                                <figcaption className="border-t border-white/10 bg-[#101312] px-4 py-3 text-sm text-white/70">
                                    {copy.surfaces.dashboard}
                                </figcaption>
                            </figure>

                            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
                                <figure className="overflow-hidden rounded-lg border border-black/15 bg-[#090b0a] shadow-lg">
                                    <img src={consoleTraffic} alt={copy.surfaces.traffic} className="aspect-[16/9] w-full object-cover object-top" />
                                    <figcaption className="border-t border-white/10 bg-[#101312] px-4 py-3 text-sm text-white/70">
                                        {copy.surfaces.traffic}
                                    </figcaption>
                                </figure>
                                <figure className="overflow-hidden rounded-lg border border-black/15 bg-[#090b0a] shadow-lg">
                                    <img src={consoleScanner} alt={copy.surfaces.scanner} className="aspect-[16/9] w-full object-cover object-top" />
                                    <figcaption className="border-t border-white/10 bg-[#101312] px-4 py-3 text-sm text-white/70">
                                        {copy.surfaces.scanner}
                                    </figcaption>
                                </figure>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="border-b border-black/10 bg-white">
                    <div className="mx-auto max-w-[1480px] px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
                        <div className="max-w-3xl">
                            <p className="text-sm font-semibold text-[#9a6811]">{copy.capabilities.eyebrow}</p>
                            <h2 className="mt-3 text-3xl font-bold leading-tight sm:text-5xl">{copy.capabilities.title}</h2>
                            <p className="mt-5 text-base leading-8 text-black/65">{copy.capabilities.body}</p>
                        </div>

                        <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-black/10 bg-black/10 sm:grid-cols-2 lg:grid-cols-3">
                            {copy.capabilities.items.map((item, index) => {
                                const Icon = capabilityIcons[index];
                                return (
                                    <article key={item.title} className="min-h-56 bg-[#f8f8f4] p-6">
                                        <Icon className="h-6 w-6 text-[#1f6f52]" aria-hidden="true" />
                                        <h3 className="mt-8 text-lg font-bold">{item.title}</h3>
                                        <p className="mt-3 text-sm leading-7 text-black/60">{item.body}</p>
                                    </article>
                                );
                            })}
                        </div>
                    </div>
                </section>

                <section id="deployment" className="scroll-mt-20 border-b border-black/10 bg-[#e7ebe5]">
                    <div className="mx-auto max-w-[1480px] px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
                        <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr]">
                            <div>
                                <p className="text-sm font-semibold text-[#1f6f52]">{copy.deployment.eyebrow}</p>
                                <h2 className="mt-3 text-3xl font-bold leading-tight sm:text-5xl">{copy.deployment.title}</h2>
                                <p className="mt-5 text-base leading-8 text-black/65">{copy.deployment.body}</p>
                            </div>

                            <div className="grid gap-4 md:grid-cols-3">
                                {copy.deployment.modes.map((mode, index) => {
                                    const Icon = deploymentIcons[index];
                                    return (
                                        <article key={mode.title} className="rounded-lg border border-black/10 bg-white p-5">
                                            <Icon className="h-6 w-6 text-[#9a6811]" aria-hidden="true" />
                                            <h3 className="mt-7 text-lg font-bold">{mode.title}</h3>
                                            <p className="mt-3 text-sm leading-7 text-black/60">{mode.body}</p>
                                        </article>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="border-b border-black/10 bg-[#fbf6ea]">
                    <div className="mx-auto max-w-[1480px] px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
                        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
                            <div>
                                <p className="flex items-center gap-2 text-sm font-semibold text-[#a33c2e]">
                                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                                    {copy.limits.eyebrow}
                                </p>
                                <h2 className="mt-3 text-3xl font-bold leading-tight sm:text-5xl">{copy.limits.title}</h2>
                                <p className="mt-5 text-base leading-8 text-black/65">{copy.limits.body}</p>
                            </div>

                            <div className="divide-y divide-black/10 border-y border-black/10">
                                {copy.limits.items.map((item) => (
                                    <div key={item} className="flex items-start gap-4 py-5">
                                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#a33c2e]" />
                                        <p className="text-sm leading-7 text-black/65">{item}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="bg-[#1f6f52] text-white">
                    <div className="mx-auto flex max-w-[1480px] flex-col gap-8 px-5 py-16 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-12 lg:py-20">
                        <div className="max-w-3xl">
                            <p className="text-sm font-semibold text-white/70">{copy.cta.eyebrow}</p>
                            <h2 className="mt-3 text-3xl font-bold leading-tight sm:text-5xl">{copy.cta.title}</h2>
                            <p className="mt-5 max-w-2xl text-base leading-8 text-white/75">{copy.cta.body}</p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={() => navigate('/login')}
                                className="inline-flex min-h-12 items-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-[#174e3b] transition-colors hover:bg-[#f2f4ef]"
                            >
                                {copy.cta.primary}
                                <ArrowRight className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/privacy')}
                                className="inline-flex min-h-12 items-center rounded-md border border-white/35 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                            >
                                {copy.cta.secondary}
                            </button>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="border-t border-white/10 bg-[#101512] text-white">
                <div className="mx-auto flex max-w-[1480px] flex-col gap-8 px-5 py-10 sm:px-8 md:flex-row md:items-end md:justify-between lg:px-12">
                    <div>
                        <div className="flex items-center gap-3">
                            <Logo showText={false} />
                            <span className="text-lg font-bold">AetherGuard</span>
                        </div>
                        <p className="mt-4 max-w-xl text-sm leading-6 text-white/60">{copy.footer.tagline}</p>
                        <p className="mt-3 text-xs text-white/40">{COMPANY_NAME_CN} · {COMPANY_NAME_EN}</p>
                        <p className="mt-1 text-xs text-white/40">© 2026 AetherGuard. {copy.footer.copyright}</p>
                    </div>
                    <div className="flex items-center gap-6 text-sm text-white/65">
                        <a href="/privacy" className="min-h-10 py-2 transition-colors hover:text-white">{copy.footer.privacy}</a>
                        <a href="/terms" className="min-h-10 py-2 transition-colors hover:text-white">{copy.footer.terms}</a>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Landing;
