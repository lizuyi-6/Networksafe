import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BookOpen, Building2, Factory, RefreshCcw, TerminalSquare } from 'lucide-react';
import { requireInternalRoute } from '../../utils/internal-navigation';
import consoleDashboard from '../../assets/landing-workshop/console-dashboard.png';
import consoleTraffic from '../../assets/landing-workshop/console-traffic.png';
import consoleDevices from '../../assets/landing-workshop/console-devices.png';
import consoleBoardStatus from '../../assets/landing-workshop/console-board-status.png';
import applianceAssembly from '../../assets/landing-workshop/appliance-assembly.png';

/**
 * Landing workshop hub — /landing-workshop.
 *
 * Compares the five official-site landing candidates and links to each.
 * The production landing at "/" is untouched; promoting any variant is a
 * one-line route swap in App.tsx (documented in
 * docs/landing-page-workshop-2026-07-05.md, along with the rollback).
 */

type Lang = 'en' | 'zh';

type Variant = {
    key: string;
    route: string;
    icon: typeof Factory;
    image: string;
    imageOnLight?: boolean;
    name: string;
    tone: string;
    audience: string;
    bet: string;
};

type Copy = {
    tag: string;
    title: string;
    subtitle: string;
    tableHint: string;
    open: string;
    colTone: string;
    colAudience: string;
    colBet: string;
    recommended: string;
    variants: Variant[];
    promoteTitle: string;
    promoteBody: string;
    currentLanding: string;
    doc: string;
};

const COPY: Record<Lang, Copy> = {
    zh: {
        tag: '落地页工作坊 · 5 个官网候选',
        title: '同一个产品，五种讲法。',
        subtitle:
            '五个候选都基于同一套项目事实(Root-Resistant 网关一体机、fail-closed 不变量、条件式承诺、三种安装路径),配图全部来自真实控制台截图与机箱渲染。现行首页 "/" 未做任何改动——看完选一个,晋级只需换一行路由。',
        tableHint: '点击任意卡片进入全页预览(每页均有中英切换)',
        open: '打开预览',
        colTone: '视觉与语气',
        colAudience: '首要受众',
        colBet: '这版在赌什么',
        recommended: '推荐起点',
        variants: [
            {
                key: 'remodel',
                route: '/landing-workshop/remodel',
                icon: RefreshCcw,
                image: consoleDashboard,
                name: 'E · 基于现行改造',
                tone: '完整保留现行页的骨架、组件与动效,只升级叙事与配图(截图+机箱渲染替换已退役的 ESP32 渲染图)',
                audience: '想要最小改动、最快上线的团队',
                bet: '现有页面的"好看"值得继承,过期的是故事不是骨架',
            },
            {
                key: 'enterprise',
                route: '/landing-workshop/enterprise',
                icon: Building2,
                image: consoleTraffic,
                name: 'B · 企业官网',
                tone: '亮色经典企业站:锚点导航、浏览器框大屏截图、能力矩阵+截图带、硬件规格表、FAQ、深色页脚',
                audience: '企业买家 / 采购与合规',
                bet: '像一家成熟公司,是采购流程里最大的加分项',
            },
            {
                key: 'industrial',
                route: '/landing-workshop/industrial',
                icon: Factory,
                image: applianceAssembly,
                imageOnLight: true,
                name: 'A · 工业信任',
                tone: '暗色工程证据流:双栏 hero(大屏截图+机箱渲染)、不变量清单、板卡状态实景',
                audience: '安全工程师 / 技术决策者',
                bet: '把"我们如何 fail-closed"讲得越具体,信任越深',
            },
            {
                key: 'terminal',
                route: '/landing-workshop/terminal',
                icon: TerminalSquare,
                image: consoleBoardStatus,
                name: 'C · 终端审计',
                tone: '等宽终端:开机日志、fail-closed 事件流、CRT 扫描线截图,reason code 与代码同源',
                audience: 'SRE / 红队 / 极客评委',
                bet: '对真正的操作者,一段诚实的日志胜过十页文案',
            },
            {
                key: 'story',
                route: '/landing-workshop/story',
                icon: BookOpen,
                image: consoleDevices,
                name: 'D · 品牌叙事',
                tone: '大字滚动章节,灯塔声线;控制台辉光实景与"城墙外的那台机器"渲染图点题',
                audience: '路演评委 / 媒体 / 品牌传播',
                bet: '先让人记住"为什么造它",功能自然有人来问',
            },
        ],
        promoteTitle: '晋级与回滚',
        promoteBody:
            '选定风格后,把 App.tsx 里 "/" 路由的 element 从 <Landing /> 换成对应变体组件即为晋级;回滚是同一行改回来。所有变体与现行首页零共享状态,互不影响。细节与项目梳理见 docs/landing-page-workshop-2026-07-05.md。',
        currentLanding: '查看现行首页 /',
        doc: '工作坊文档',
    },
    en: {
        tag: 'Landing workshop · 5 official-site candidates',
        title: 'One product, five ways to tell it.',
        subtitle:
            'All five candidates share one fact base (the root-resistant gateway appliance, fail-closed invariants, the conditional promise, three install paths); imagery comes from real console screenshots and the enclosure render. The production "/" landing is untouched — pick one, promotion is a one-line route swap.',
        tableHint: 'Click any card for a full-page preview (every page has a zh/en toggle)',
        open: 'Open preview',
        colTone: 'Look & voice',
        colAudience: 'Primary audience',
        colBet: 'The bet this version makes',
        recommended: 'Recommended start',
        variants: [
            {
                key: 'remodel',
                route: '/landing-workshop/remodel',
                icon: RefreshCcw,
                image: consoleDashboard,
                name: 'E · Remodel of current',
                tone: 'Keeps the current page’s skeleton, primitives, and motion; upgrades only the story and imagery (screenshots + enclosure render replace the retired ESP32 art)',
                audience: 'Teams wanting the smallest change, shipped fastest',
                bet: 'The current page’s polish is worth keeping — the story was stale, not the bones',
            },
            {
                key: 'enterprise',
                route: '/landing-workshop/enterprise',
                icon: Building2,
                image: consoleTraffic,
                name: 'B · Enterprise Official',
                tone: 'Light corporate site: anchor nav, browser-framed hero screenshot, capability grid + screenshot strip, hardware spec table, FAQ',
                audience: 'Enterprise buyers / procurement & compliance',
                bet: 'Looking like an established company wins procurement',
            },
            {
                key: 'industrial',
                route: '/landing-workshop/industrial',
                icon: Factory,
                image: applianceAssembly,
                imageOnLight: true,
                name: 'A · Industrial Evidence',
                tone: 'Dark engineering: two-column hero (console shot + enclosure render), invariant list, board-status view',
                audience: 'Security engineers / technical buyers',
                bet: 'The more concretely we explain fail-closed, the deeper the trust',
            },
            {
                key: 'terminal',
                route: '/landing-workshop/terminal',
                icon: TerminalSquare,
                image: consoleBoardStatus,
                name: 'C · Terminal Ops',
                tone: 'Monospace: boot log, fail-closed event feed, CRT-scanline screenshot; reason codes mirror the code',
                audience: 'SREs / red teams / hacker judges',
                bet: 'For real operators, one honest log beats ten pages of copy',
            },
            {
                key: 'story',
                route: '/landing-workshop/story',
                icon: BookOpen,
                image: consoleDevices,
                name: 'D · Lighthouse Story',
                tone: 'Oversized type, scroll chapters, the brand-story voice; a glowing console shot and “the machine outside the walls”',
                audience: 'Roadshow judges / media / brand',
                bet: 'Make people remember why it exists; features follow',
            },
        ],
        promoteTitle: 'Promote & roll back',
        promoteBody:
            'To promote a style, swap the element of the "/" route in App.tsx from <Landing /> to the chosen variant; rollback is the same line reversed. Variants share no state with the current landing. Details in docs/landing-page-workshop-2026-07-05.md.',
        currentLanding: 'View current landing /',
        doc: 'Workshop notes',
    },
};

const LandingWorkshopHub = () => {
    const navigate = useNavigate();
    const [lang, setLang] = useState<Lang>(() =>
        typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en',
    );
    const c = useMemo(() => COPY[lang], [lang]);

    return (
        <div data-testid="landing-workshop-hub" className="min-h-screen bg-slate-950 text-slate-100">
            <div className="mx-auto w-full max-w-6xl px-6 py-16">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-widest text-slate-400">
                        {c.tag}
                    </span>
                    <div className="flex items-center gap-3 text-sm">
                        <button
                            type="button"
                            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
                            className="text-slate-400 transition hover:text-white"
                        >
                            {lang === 'zh' ? 'EN' : '中文'}
                        </button>
                        <button type="button" onClick={() => navigate('/')} className="text-slate-400 transition hover:text-white">
                            {c.currentLanding}
                        </button>
                    </div>
                </div>

                <h1 className="mt-10 max-w-3xl text-4xl font-black leading-tight tracking-tight md:text-6xl">{c.title}</h1>
                <p className="mt-6 max-w-3xl text-base leading-relaxed text-slate-400">{c.subtitle}</p>
                <p className="mt-3 text-xs text-slate-500">{c.tableHint}</p>

                {/* Variant cards */}
                <div className="mt-12 grid gap-6 md:grid-cols-2">
                    {c.variants.map((v, index) => {
                        const Icon = v.icon;
                        return (
                            <button
                                key={v.key}
                                type="button"
                                onClick={() => navigate(requireInternalRoute(v.route))}
                                className="group relative rounded-3xl border border-slate-800 bg-slate-900/60 p-5 text-left transition hover:border-slate-500"
                            >
                                {index === 0 && (
                                    <span className="absolute -top-3 left-5 rounded-full bg-sky-500 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-950">
                                        {c.recommended}
                                    </span>
                                )}
                                <div className={`h-40 overflow-hidden rounded-2xl border border-slate-800 ${v.imageOnLight ? 'bg-white' : 'bg-slate-950'}`}>
                                    <img
                                        src={v.image}
                                        alt={`${v.name} preview`}
                                        className={`h-full w-full transition duration-300 group-hover:scale-[1.02] ${
                                            v.imageOnLight ? 'object-contain p-2' : 'object-cover object-top opacity-90'
                                        }`}
                                    />
                                </div>
                                <div className="mt-4 flex items-center justify-between">
                                    <h2 className="flex items-center gap-2 text-lg font-bold">
                                        <Icon className="h-4 w-4 text-sky-400" />
                                        {v.name}
                                    </h2>
                                    <span className="inline-flex items-center gap-1 text-xs text-slate-400 transition group-hover:text-white">
                                        {c.open}
                                        <ArrowUpRight className="h-3.5 w-3.5" />
                                    </span>
                                </div>
                                <dl className="mt-3 space-y-1.5 text-sm">
                                    <div className="flex gap-2">
                                        <dt className="shrink-0 text-slate-500">{c.colTone}:</dt>
                                        <dd className="text-slate-300">{v.tone}</dd>
                                    </div>
                                    <div className="flex gap-2">
                                        <dt className="shrink-0 text-slate-500">{c.colAudience}:</dt>
                                        <dd className="text-slate-300">{v.audience}</dd>
                                    </div>
                                    <div className="flex gap-2">
                                        <dt className="shrink-0 text-slate-500">{c.colBet}:</dt>
                                        <dd className="text-slate-300">{v.bet}</dd>
                                    </div>
                                </dl>
                            </button>
                        );
                    })}
                </div>

                {/* Promotion note */}
                <div className="mt-12 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
                    <h3 className="flex items-center gap-2 text-base font-semibold">
                        <ArrowRight className="h-4 w-4 text-sky-400" />
                        {c.promoteTitle}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-400">{c.promoteBody}</p>
                    <p className="mt-3 text-xs text-slate-500">{c.doc}: docs/landing-page-workshop-2026-07-05.md</p>
                </div>
            </div>
        </div>
    );
};

export default LandingWorkshopHub;
