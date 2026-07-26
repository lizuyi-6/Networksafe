import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    Brain,
    CheckCircle2,
    Cpu,
    KeyRound,
    Lock,
    Network,
    Package,
    Server,
    ShieldCheck,
    Terminal,
} from 'lucide-react';
import Logo from '../../components/Logo';
import { COMPANY_NAME_CN, COMPANY_NAME_EN } from '../../config/branding';
import consoleDashboard from '../../assets/landing-workshop/console-dashboard.png';
import consoleBoardStatus from '../../assets/landing-workshop/console-board-status.png';
import applianceAssembly from '../../assets/landing-workshop/appliance-assembly.png';

/**
 * Landing workshop · Variant A "Industrial Evidence" (工业信任 · 暗色).
 *
 * Mounted at /landing-workshop/industrial only. The production landing at
 * "/" (Landing.tsx) is untouched; promoting any variant is a one-line route
 * swap documented in docs/landing-page-workshop-2026-07-05.md.
 *
 * Narrative: the current "/" page still tells the 2025 "AI traffic security"
 * story. This version tells the shipped product's story — the Root-Resistant
 * Gateway Appliance and hardware-enforced, fail-closed final defense — with
 * the engineering qualifiers kept intact (the claim is conditional; v1 scope
 * limits are stated on the page, not hidden).
 */

type Lang = 'en' | 'zh';

type Copy = {
    nav: { login: string; workshopTag: string };
    hero: {
        badge: string;
        title: string;
        subtitle: string;
        qualifier: string;
        primaryCta: string;
        secondaryCta: string;
        chips: string[];
    };
    threat: {
        eyebrow: string;
        title: string;
        body: string;
        cards: Array<{ title: string; body: string }>;
    };
    chain: {
        eyebrow: string;
        title: string;
        body: string;
        steps: Array<{ tag: string; title: string; body: string }>;
        invariantsTitle: string;
        invariants: Array<{ name: string; body: string }>;
    };
    detection: {
        eyebrow: string;
        title: string;
        body: string;
        points: Array<{ title: string; body: string }>;
    };
    deploy: {
        eyebrow: string;
        title: string;
        body: string;
        modes: Array<{ title: string; body: string; command: string }>;
    };
    limits: {
        eyebrow: string;
        title: string;
        body: string;
        items: string[];
    };
    footer: { cta: string; ctaButton: string; privacy: string; terms: string; currentLanding: string };
};

const COPY: Record<Lang, Copy> = {
    en: {
        nav: { login: 'Open Console', workshopTag: 'workshop · industrial' },
        hero: {
            badge: 'Root-Resistant Gateway Appliance',
            title: 'The last line of defense, enforced in hardware.',
            subtitle:
                'AetherGuard moves the final network-release decision off the protected server into an independent gateway appliance: a dual-1GbE fail-closed L2 bridge, an STM32 security controller, and a secure element that must all agree before traffic flows.',
            qualifier:
                'Engineering definition: the control plane can request and audit dangerous actions, but the final grant is enforced by hardware. The claim holds when the link is physically cabled through the interlock, Final Defense Mode is enabled, and the signed local policy, secure element, and health checks are in place.',
            primaryCta: 'Open Console',
            secondaryCta: 'See how it works',
            chips: ['Fail-closed by default', 'Signed hardware grants', 'Release windows always expire', 'E-stop latches until cleared'],
        },
        threat: {
            eyebrow: 'Threat model',
            title: 'Assume root is already lost.',
            body: 'Traditional agents die with the host they defend. AetherGuard’s root-resistant mode assumes the protected server — OS, agent, scripts, logs — may be fully attacker-controlled, and moves the trust boundary outside the blast radius.',
            cards: [
                {
                    title: 'Off-host authority',
                    body: 'Policy state, hardware identity, firmware measurement, and release grants live on the appliance, not on the server an attacker can own.',
                },
                {
                    title: 'Physical isolation, not a kill switch API',
                    body: 'A failed check does not return an HTTP error. It drops the SERVER↔LAN/WAN bridge via a hardware interlock while keeping the appliance’s own management path alive.',
                },
                {
                    title: 'Recovery stays possible',
                    body: 'Isolation cuts the business bridge only. The independent MGMT/cellular path survives, so operators can always reach the appliance to recover.',
                },
            ],
        },
        chain: {
            eyebrow: 'Authorization chain',
            title: 'Four modules, one non-negotiable sequence.',
            body: 'A release only happens when every link in the chain independently agrees. Any mismatch anywhere fails closed — the bridge isolates and the relay physically opens.',
            steps: [
                { tag: 'M1', title: 'Gateway Daemon', body: 'Terminates the control-plane protocol, validates policy digests, and refuses non-increasing counters before anything reaches hardware.' },
                { tag: 'M2', title: 'STM32 Security Controller', body: 'Re-verifies challenge freshness, policy digest, monotonic counter, and expiry in firmware. Denies by default; alerts on every rejection.' },
                { tag: 'M3', title: 'Secure Element', body: 'Hardware-backed keys sign and verify release grants. No secure element, no release.' },
                { tag: 'M4', title: 'Fail-Closed Interlock', body: 'A relay with feedback verification actually moves the topology. Feedback mismatch means immediate re-isolation.' },
            ],
            invariantsTitle: 'Invariants the code refuses to bend',
            invariants: [
                { name: 'policyDigest ===', body: 'One digest is computed once and compared byte-for-byte across four services and the firmware. Any mismatch anywhere: fail closed.' },
                { name: 'counter strictly >', body: 'Three independent monotonic high-water marks. Replay or rollback is rejected at each of them separately.' },
                { name: 'release is temporary', body: 'Every release carries a TTL and automatically returns to isolated. Isolation is the steady state; connectivity is the exception.' },
                { name: 'e-stop latches', body: 'After an emergency stop, valid grants are still refused until an explicit operator reset — aligned with ISO 13850 semantics.' },
            ],
        },
        detection: {
            eyebrow: 'Detection plane',
            title: 'Detection advises. Hardware decides.',
            body: 'A seven-layer multi-agent pipeline classifies attacks and escalates evidence, tuned against a hard zero-false-positive constraint on normal traffic. Its verdicts inform operators — they never bypass the hardware chain.',
            points: [
                { title: 'Rule engine first', body: 'Deterministic detections with attack-family classification stay effective even fully offline.' },
                { title: 'Multi-agent escalation', body: 'Contested evidence goes through role debate and scenario traversal before a verdict is synthesized.' },
                { title: 'Degradation is visible', body: 'When cloud AI is unreachable, the console says so explicitly. Reduced capability is reported, never silently faked.' },
            ],
        },
        deploy: {
            eyebrow: 'Deployment',
            title: 'From a connected lab to an air-gapped rack.',
            body: 'Every path generates real secrets at install time and refuses to start on placeholder configuration.',
            modes: [
                { title: 'Docker, one command pair', body: 'Cross-platform setup script plus Compose v2. Secrets generated, containers health-checked.', command: 'node scripts/setup.mjs && docker compose up -d --build' },
                { title: 'Fresh Linux host', body: 'Installs Docker if missing, generates configuration, builds, starts, and waits for backend health.', command: 'sudo bash scripts/install.sh' },
                { title: 'Air-gapped customer machine', body: 'A self-contained bundle carries every image, checksums, and optionally Docker itself. Zero network on site.', command: 'tar -xzf aetherguard-offline-*.tar.gz && sudo bash install.sh' },
            ],
        },
        limits: {
            eyebrow: 'Honest scope',
            title: 'What v1 does not cover.',
            body: 'A last line of defense you can trust starts with limits stated up front. The claim covers network links physically cabled through the appliance — and nothing else.',
            items: [
                'Out-of-band paths: BMC, Wi-Fi, spare NICs, local console access.',
                'Direct storage damage and host disk encryption by a root attacker.',
                'Mains power switching — v1 controls the low-voltage network link only.',
                'Hardware-in-the-loop release/feedback tests on production appliances are still pending; current validation is firmware host-tests plus a full software simulator.',
            ],
        },
        footer: {
            cta: 'Wire the last line of defense outside the server.',
            ctaButton: 'Open Console',
            privacy: 'Privacy',
            terms: 'Terms',
            currentLanding: 'Current landing',
        },
    },
    zh: {
        nav: { login: '进入控制台', workshopTag: 'workshop · 工业信任' },
        hero: {
            badge: 'Root-Resistant 网关设备',
            title: '最后防线，由硬件强制执行。',
            subtitle:
                'AetherGuard 把"是否放行网络"的最终决策移出被保护服务器，落到独立网关设备上：双千兆 fail-closed 二层桥、STM32 安全控制器与安全元件全部独立同意，流量才能通过。',
            qualifier:
                '工程口径：控制面可以发起并审计危险动作，但最终放行由硬件强制。该声明在以下条件下成立——链路实际经过硬件联锁布线、Final Defense 模式开启、本地策略经签名、安全元件在位且健康检查通过。',
            primaryCta: '进入控制台',
            secondaryCta: '看它如何工作',
            chips: ['默认 fail-closed', '硬件签名放行', '释放窗口必然过期', '急停锁存直至显式复位'],
        },
        threat: {
            eyebrow: '威胁模型',
            title: '假设 root 已经沦陷。',
            body: '传统安全代理与其守护的主机同归于尽。AetherGuard 的 root-resistant 模式假设被保护服务器——操作系统、代理、脚本、日志——可能已被攻击者完全控制，因此把信任边界整体移出爆炸半径。',
            cards: [
                { title: '权威在主机之外', body: '策略状态、硬件身份、固件度量与放行授权都存放在网关设备上，而不是攻击者可以拿下的那台服务器里。' },
                { title: '物理隔离，而非一个"kill switch API"', body: '校验失败不是返回一个 HTTP 错误，而是通过硬件联锁断开 SERVER↔LAN/WAN 业务桥，同时保留设备自身的管理通道。' },
                { title: '恢复通道始终存在', body: '隔离只切业务桥。独立 MGMT/蜂窝管理路径仍然存活，运维始终能够到达设备完成恢复。' },
            ],
        },
        chain: {
            eyebrow: '授权链路',
            title: '四个模块，一条不可妥协的顺序。',
            body: '只有链上每一环独立同意，放行才会发生。任何一处不匹配都会 fail-closed——桥隔离、继电器物理断开。',
            steps: [
                { tag: 'M1', title: '网关守护进程', body: '终结控制面协议，校验策略摘要，拒绝非递增计数器——在任何东西触及硬件之前。' },
                { tag: 'M2', title: 'STM32 安全控制器', body: '固件内重新校验 challenge 新鲜度、策略摘要、单调计数器与过期时间。默认拒绝，每次拒绝都告警。' },
                { tag: 'M3', title: '安全元件', body: '硬件密钥对放行授权签名与验签。没有安全元件，就没有放行。' },
                { tag: 'M4', title: 'Fail-Closed 联锁', body: '带反馈校验的继电器真正改变拓扑。反馈不一致，立即重新隔离。' },
            ],
            invariantsTitle: '代码拒绝弯曲的不变量',
            invariants: [
                { name: 'policyDigest 逐字 ===', body: '同一份摘要跨四个服务与固件逐字节比对，任何一处不一致即 fail-closed。' },
                { name: '计数器严格递增', body: '三套互不共享的单调高水位，重放与回滚在每一处都被独立拒绝。' },
                { name: '释放必是暂态', body: '每次释放都携带 TTL 并自动回到隔离态。隔离是常态，连通是例外。' },
                { name: '急停锁存', body: '急停之后，即使收到合法授权也拒绝放行，直到操作员显式复位——与 ISO 13850 语义一致。' },
            ],
        },
        detection: {
            eyebrow: '检测平面',
            title: '检测负责建议，硬件负责决定。',
            body: '七层多智能体管线做攻击分类与证据升级，并以"正常流量零误报"为硬约束调参。它的结论供运维决策——永远不会绕过硬件授权链。',
            points: [
                { title: '规则引擎打底', body: '确定性检测与攻击族分类，完全离线时依然有效。' },
                { title: '多智能体升级', body: '有争议的证据经过角色辩论与场景遍历，才会合成结论。' },
                { title: '降级全程可见', body: '云端 AI 不可达时，控制台明确说明。能力下降会被如实报告,而不是被悄悄掩盖。' },
            ],
        },
        deploy: {
            eyebrow: '部署',
            title: '从有网的实验室，到完全断网的机柜。',
            body: '每条路径都在安装现场生成真实密钥，占位配置直接拒绝启动。',
            modes: [
                { title: 'Docker 两条命令', body: '跨平台初始化脚本 + Compose v2。密钥自动生成，容器带健康检查。', command: 'node scripts/setup.mjs && docker compose up -d --build' },
                { title: '全新 Linux 主机', body: '缺 Docker 自动安装，生成配置、构建、启动并等待后端健康。', command: 'sudo bash scripts/install.sh' },
                { title: '离线客户机（air-gapped）', body: '自包含分发包携带全部镜像、校验和，甚至 Docker 本身。现场零网络。', command: 'tar -xzf aetherguard-offline-*.tar.gz && sudo bash install.sh' },
            ],
        },
        limits: {
            eyebrow: '诚实边界',
            title: 'v1 不覆盖什么。',
            body: '可信的最后防线，从把边界写在明面上开始。该声明只覆盖实际经过设备布线的网络链路——除此之外都不在承诺内。',
            items: [
                '带外路径：BMC、Wi-Fi、备用网卡、本地控制台。',
                'root 攻击者对存储的直接破坏与主机磁盘加密。',
                '市电通断——v1 只控制低压网络链路，不切服务器电源。',
                '量产设备上的硬件在环放行/反馈测试尚未完成；当前验证为固件 host 测试加全链路软件模拟器。',
            ],
        },
        footer: {
            cta: '把最后防线布线到服务器之外。',
            ctaButton: '进入控制台',
            privacy: '隐私政策',
            terms: '服务条款',
            currentLanding: '现行落地页',
        },
    },
};

const fadeUp = {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const stepIcons = [Network, Cpu, KeyRound, Lock];
const detectionIcons = [Activity, Brain, AlertTriangle];
const deployIcons = [Terminal, Server, Package];

const Section = ({
    eyebrow,
    title,
    body,
    children,
}: {
    eyebrow: string;
    title: string;
    body: string;
    children?: ReactNode;
}) => (
    <motion.section
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        className="mx-auto w-full max-w-6xl px-6 py-16"
    >
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
        <h2 className="mt-3 max-w-3xl text-3xl font-bold leading-tight text-foreground md:text-4xl">{title}</h2>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">{body}</p>
        {children}
    </motion.section>
);

const LandingIndustrial = () => {
    const navigate = useNavigate();
    const [lang, setLang] = useState<Lang>(() =>
        typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en',
    );
    const c = useMemo(() => COPY[lang], [lang]);

    return (
        <div className="min-h-screen bg-background text-foreground">
            {/* Nav */}
            <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
                <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                        <Logo />
                        <span className="hidden text-sm text-muted-foreground sm:inline">
                            {lang === 'zh' ? COMPANY_NAME_CN : COMPANY_NAME_EN}
                        </span>
                        <span className="rounded-full border border-primary/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                            {c.nav.workshopTag}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex rounded-full border border-border p-0.5 text-xs">
                            {(['en', 'zh'] as const).map((l) => (
                                <button
                                    key={l}
                                    type="button"
                                    aria-pressed={lang === l}
                                    onClick={() => setLang(l)}
                                    className={`rounded-full px-3 py-1 transition ${
                                        lang === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    {l === 'en' ? 'EN' : '中文'}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate('/login')}
                            className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                        >
                            {c.nav.login}
                        </button>
                    </div>
                </div>
            </header>

            {/* Hero */}
            <motion.section variants={fadeUp} initial="hidden" animate="visible" className="mx-auto w-full max-w-6xl px-6 pb-10 pt-20">
                <div className="grid gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start">
                    <div>
                        <div className="flex items-center gap-2 text-primary">
                            <ShieldCheck className="h-5 w-5" />
                            <span className="text-xs font-semibold uppercase tracking-[0.25em]">{c.hero.badge}</span>
                        </div>
                        <h1 className="mt-6 max-w-4xl text-4xl font-bold leading-tight md:text-5xl">{c.hero.title}</h1>
                        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground">{c.hero.subtitle}</p>
                        <div className="mt-8 flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                onClick={() => navigate('/login')}
                                className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                            >
                                {c.hero.primaryCta}
                                <ArrowRight className="h-4 w-4" />
                            </button>
                            <a
                                href="#chain"
                                className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-2.5 text-sm font-semibold text-foreground transition hover:border-primary/60"
                            >
                                {c.hero.secondaryCta}
                            </a>
                        </div>
                        <div className="mt-8 flex flex-wrap gap-2">
                            {c.hero.chips.map((chip) => (
                                <span key={chip} className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                                    {chip}
                                </span>
                            ))}
                        </div>
                        <p className="mt-8 max-w-3xl border-l-2 border-primary/50 pl-4 text-sm leading-relaxed text-muted-foreground">
                            {c.hero.qualifier}
                        </p>
                    </div>

                    <div className="space-y-4">
                        <figure className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
                            <img src={consoleDashboard} alt="AetherGuard operations console" className="w-full object-cover object-top" />
                            <figcaption className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                                console · {`{`}detect, audit{`}`} — the release decision stays in hardware
                            </figcaption>
                        </figure>
                        <figure className="overflow-hidden rounded-2xl border border-border bg-white shadow-lg">
                            <img src={applianceAssembly} alt="Gateway appliance enclosure render" className="mx-auto h-[190px] object-contain p-3" />
                            <figcaption className="border-t border-border/60 bg-card px-4 py-2.5 text-xs text-muted-foreground">
                                gateway appliance · stack light + E-STOP / CONFIRM + SERVER / LAN-WAN / MGMT (prototype render)
                            </figcaption>
                        </figure>
                    </div>
                </div>
            </motion.section>

            {/* Threat model */}
            <Section eyebrow={c.threat.eyebrow} title={c.threat.title} body={c.threat.body}>
                <div className="mt-10 grid gap-4 md:grid-cols-3">
                    {c.threat.cards.map((card) => (
                        <div key={card.title} className="rounded-2xl border border-border bg-card p-6">
                            <h3 className="text-base font-semibold text-foreground">{card.title}</h3>
                            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
                        </div>
                    ))}
                </div>
            </Section>

            {/* Authorization chain */}
            <div id="chain">
                <Section eyebrow={c.chain.eyebrow} title={c.chain.title} body={c.chain.body}>
                    <div className="mt-10 grid gap-4 md:grid-cols-4">
                        {c.chain.steps.map((step, index) => {
                            const Icon = stepIcons[index] ?? Network;
                            return (
                                <div key={step.tag} className="relative rounded-2xl border border-border bg-card p-6">
                                    <div className="flex items-center gap-2">
                                        <Icon className="h-5 w-5 text-primary" />
                                        <span className="text-xs font-bold uppercase tracking-widest text-primary">{step.tag}</span>
                                    </div>
                                    <h3 className="mt-3 text-base font-semibold text-foreground">{step.title}</h3>
                                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                                </div>
                            );
                        })}
                    </div>
                    <h3 className="mt-12 text-sm font-semibold uppercase tracking-[0.2em] text-primary">{c.chain.invariantsTitle}</h3>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        {c.chain.invariants.map((inv) => (
                            <div key={inv.name} className="flex gap-3 rounded-xl border border-border/70 bg-card/60 p-4">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                <div>
                                    <p className="font-mono text-sm font-semibold text-foreground">{inv.name}</p>
                                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{inv.body}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    <figure className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
                        <img src={consoleBoardStatus} alt="Board status console view" className="w-full object-cover object-top" />
                        <figcaption className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                            board status · interlock / counter / grant trail — every decision leaves evidence
                        </figcaption>
                    </figure>
                </Section>
            </div>

            {/* Detection plane */}
            <Section eyebrow={c.detection.eyebrow} title={c.detection.title} body={c.detection.body}>
                <div className="mt-10 grid gap-4 md:grid-cols-3">
                    {c.detection.points.map((point, index) => {
                        const Icon = detectionIcons[index] ?? Activity;
                        return (
                            <div key={point.title} className="rounded-2xl border border-border bg-card p-6">
                                <Icon className="h-5 w-5 text-primary" />
                                <h3 className="mt-3 text-base font-semibold text-foreground">{point.title}</h3>
                                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{point.body}</p>
                            </div>
                        );
                    })}
                </div>
            </Section>

            {/* Deployment */}
            <Section eyebrow={c.deploy.eyebrow} title={c.deploy.title} body={c.deploy.body}>
                <div className="mt-10 grid gap-4 md:grid-cols-3">
                    {c.deploy.modes.map((mode, index) => {
                        const Icon = deployIcons[index] ?? Terminal;
                        return (
                            <div key={mode.title} className="flex flex-col rounded-2xl border border-border bg-card p-6">
                                <Icon className="h-5 w-5 text-primary" />
                                <h3 className="mt-3 text-base font-semibold text-foreground">{mode.title}</h3>
                                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{mode.body}</p>
                                <code className="mt-4 block overflow-x-auto rounded-lg bg-secondary px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
                                    {mode.command}
                                </code>
                            </div>
                        );
                    })}
                </div>
            </Section>

            {/* Honest limits */}
            <Section eyebrow={c.limits.eyebrow} title={c.limits.title} body={c.limits.body}>
                <ul className="mt-8 max-w-3xl space-y-3">
                    {c.limits.items.map((item) => (
                        <li key={item} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
            </Section>

            {/* Footer CTA */}
            <footer className="border-t border-border">
                <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center md:justify-between">
                    <h2 className="max-w-xl text-2xl font-bold leading-snug text-foreground">{c.footer.cta}</h2>
                    <button
                        type="button"
                        onClick={() => navigate('/login')}
                        className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                    >
                        {c.footer.ctaButton}
                        <ArrowRight className="h-4 w-4" />
                    </button>
                </div>
                <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-6 pb-10 text-xs text-muted-foreground">
                    <button type="button" className="hover:text-foreground" onClick={() => navigate('/privacy')}>
                        {c.footer.privacy}
                    </button>
                    <button type="button" className="hover:text-foreground" onClick={() => navigate('/terms')}>
                        {c.footer.terms}
                    </button>
                    <button type="button" className="hover:text-foreground" onClick={() => navigate('/')}>
                        {c.footer.currentLanding}
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default LandingIndustrial;
