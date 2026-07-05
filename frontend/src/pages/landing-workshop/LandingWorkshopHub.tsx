import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BookOpen, Building2, Factory, TerminalSquare } from 'lucide-react';

/**
 * Landing workshop hub — /landing-workshop.
 *
 * Compares the four official-site landing candidates side by side and links
 * to each. The production landing at "/" is untouched; promotion of any
 * variant is a one-line route swap in App.tsx (documented in
 * docs/landing-page-workshop-2026-07-05.md, along with the rollback).
 */

type Lang = 'en' | 'zh';

type Variant = {
    key: string;
    route: string;
    icon: typeof Factory;
    swatch: string;
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
    variants: Variant[];
    promoteTitle: string;
    promoteBody: string;
    currentLanding: string;
    doc: string;
};

const COPY: Record<Lang, Copy> = {
    zh: {
        tag: '落地页工作坊 · 4 个官网候选',
        title: '同一个产品，四种讲法。',
        subtitle:
            '四个候选都基于同一套项目事实（Root-Resistant 网关一体机、fail-closed 不变量、条件式承诺、三种安装路径），差别只在叙事姿态与视觉语言。现行首页 "/" 未做任何改动——看完选一个，晋级只需换一行路由。',
        tableHint: '点击任意卡片进入全页预览（每页均有中英切换）',
        open: '打开预览',
        colTone: '视觉与语气',
        colAudience: '首要受众',
        colBet: '这版在赌什么',
        variants: [
            {
                key: 'industrial',
                route: '/landing-workshop/industrial',
                icon: Factory,
                swatch: 'from-zinc-800 to-zinc-950',
                name: 'A · 工业信任',
                tone: '暗色、工程证据密度高、不变量直接上页面',
                audience: '安全工程师 / 技术决策者',
                bet: '把"我们如何 fail-closed"讲得越具体，信任越深',
            },
            {
                key: 'enterprise',
                route: '/landing-workshop/enterprise',
                icon: Building2,
                swatch: 'from-blue-500 to-indigo-600',
                name: 'B · 企业官网',
                tone: '亮色、经典企业站结构（导航锚点/规格表/FAQ/页脚）',
                audience: '企业买家 / 采购与合规',
                bet: '像一家成熟公司,是采购流程里最大的加分项',
            },
            {
                key: 'terminal',
                route: '/landing-workshop/terminal',
                icon: TerminalSquare,
                swatch: 'from-emerald-700 to-emerald-950',
                name: 'C · 终端审计',
                tone: '等宽字体、开机日志与 fail-closed 事件流即内容',
                audience: 'SRE / 红队 / 极客评委',
                bet: '对真正的操作者,一段诚实的日志胜过十页文案',
            },
            {
                key: 'story',
                route: '/landing-workshop/story',
                icon: BookOpen,
                swatch: 'from-sky-500 to-indigo-800',
                name: 'D · 品牌叙事',
                tone: '大字排版、章节滚动、灯塔声线（brand_story.md）',
                audience: '路演评委 / 媒体 / 品牌传播',
                bet: '先让人记住"为什么造它",功能自然有人来问',
            },
        ],
        promoteTitle: '晋级与回滚',
        promoteBody:
            '选定风格后,把 App.tsx 里 "/" 路由的 element 从 <Landing /> 换成对应变体组件即为晋级;回滚是同一行改回来。所有变体与现行首页零共享状态、零共享文件,互不影响。细节与本次项目梳理见 docs/landing-page-workshop-2026-07-05.md。',
        currentLanding: '查看现行首页 /',
        doc: '工作坊文档',
    },
    en: {
        tag: 'Landing workshop · 4 official-site candidates',
        title: 'One product, four ways to tell it.',
        subtitle:
            'All four candidates are grounded in the same project facts (the root-resistant gateway appliance, fail-closed invariants, the conditional promise, three install paths); they differ only in narrative stance and visual language. The production "/" landing is untouched — pick one, and promotion is a one-line route swap.',
        tableHint: 'Click any card for a full-page preview (every page has a zh/en toggle)',
        open: 'Open preview',
        colTone: 'Look & voice',
        colAudience: 'Primary audience',
        colBet: 'The bet this version makes',
        variants: [
            {
                key: 'industrial',
                route: '/landing-workshop/industrial',
                icon: Factory,
                swatch: 'from-zinc-800 to-zinc-950',
                name: 'A · Industrial Evidence',
                tone: 'Dark, engineering-dense, invariants printed on the page',
                audience: 'Security engineers / technical buyers',
                bet: 'The more concretely we explain fail-closed, the deeper the trust',
            },
            {
                key: 'enterprise',
                route: '/landing-workshop/enterprise',
                icon: Building2,
                swatch: 'from-blue-500 to-indigo-600',
                name: 'B · Enterprise Official',
                tone: 'Light, classic corporate-site structure (anchors/specs/FAQ/footer)',
                audience: 'Enterprise buyers / procurement & compliance',
                bet: 'Looking like an established company wins procurement',
            },
            {
                key: 'terminal',
                route: '/landing-workshop/terminal',
                icon: TerminalSquare,
                swatch: 'from-emerald-700 to-emerald-950',
                name: 'C · Terminal Ops',
                tone: 'Monospace; the boot log and fail-closed feed are the content',
                audience: 'SREs / red teams / hacker judges',
                bet: 'For real operators, one honest log beats ten pages of copy',
            },
            {
                key: 'story',
                route: '/landing-workshop/story',
                icon: BookOpen,
                swatch: 'from-sky-500 to-indigo-800',
                name: 'D · Lighthouse Story',
                tone: 'Oversized type, scroll chapters, the brand-story voice',
                audience: 'Roadshow judges / media / brand',
                bet: 'Make people remember why it exists; features follow',
            },
        ],
        promoteTitle: 'Promote & roll back',
        promoteBody:
            'To promote a style, swap the element of the "/" route in App.tsx from <Landing /> to the chosen variant; rollback is the same line reversed. Variants share no state or files with the current landing. Details and the project-grounding notes live in docs/landing-page-workshop-2026-07-05.md.',
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
        <div className="min-h-screen bg-slate-950 text-slate-100">
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
                    {c.variants.map((v) => {
                        const Icon = v.icon;
                        return (
                            <button
                                key={v.key}
                                type="button"
                                onClick={() => navigate(v.route)}
                                className="group rounded-3xl border border-slate-800 bg-slate-900/60 p-6 text-left transition hover:border-slate-500"
                            >
                                <div className={`flex h-28 items-center justify-center rounded-2xl bg-gradient-to-br ${v.swatch}`}>
                                    <Icon className="h-10 w-10 text-white/90" />
                                </div>
                                <div className="mt-5 flex items-center justify-between">
                                    <h2 className="text-lg font-bold">{v.name}</h2>
                                    <span className="inline-flex items-center gap-1 text-xs text-slate-400 transition group-hover:text-white">
                                        {c.open}
                                        <ArrowUpRight className="h-3.5 w-3.5" />
                                    </span>
                                </div>
                                <dl className="mt-4 space-y-2 text-sm">
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
