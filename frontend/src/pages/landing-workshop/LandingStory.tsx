import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

/**
 * Landing workshop · Variant D "Lighthouse Story" (品牌叙事 · 灯塔).
 *
 * Mounted at /landing-workshop/story only; the production landing at "/" is
 * untouched. Voice comes from docs/brand_story.md ("在数据的洪流中，为您点亮
 * 安全的灯塔" / "守望流量，安抵未来"): long-form scroll chapters, oversized
 * typography, one idea per screen. The conditional promise and v1 limits are
 * kept in the closing chapter — the story ends honest.
 */

type Lang = 'en' | 'zh';

type Chapter = { no: string; title: string; lines: string[] };

type Copy = {
    tag: string;
    login: string;
    heroKicker: string;
    heroTitle: string;
    heroSub: string;
    chapters: Chapter[];
    promiseTitle: string;
    promiseBody: string;
    promiseLimits: string[];
    closing: string;
    cta: string;
    back: string;
};

const COPY: Record<Lang, Copy> = {
    zh: {
        tag: 'workshop · 品牌叙事',
        login: '进入控制台',
        heroKicker: 'AetherGuard 品牌章程',
        heroTitle: '在数据的洪流中，\n为您点亮安全的灯塔。',
        heroSub: '这不是又一页功能清单。这是我们为什么造这台设备的故事。',
        chapters: [
            {
                no: '壹',
                title: '洪流',
                lines: [
                    '每一秒，你的服务器都在接住来自全世界的请求——多数无害，少数不怀好意。',
                    '防火墙、EDR、堡垒机层层设防。但它们有一个共同的软肋：全都运行在可能被攻破的那台机器上。',
                    '当攻击者拿到 root，守卫和城池一起沦陷。',
                ],
            },
            {
                no: '贰',
                title: '守望',
                lines: [
                    '所以我们先做了守望者：分布式 Agent 驻守每台服务器，七层多智能体管线审读每一份可疑证据，正常流量零误报是我们给自己上的硬约束。',
                    '看见，是守护的第一步。但看见还不够。',
                ],
            },
            {
                no: '叁',
                title: '防线',
                lines: [
                    '真正的最后防线，必须站在城墙之外。',
                    '我们把关键网络的放行权，从服务器软件里整体移出，交给一台独立的硬件网关一体机：双千兆透明桥默认隔离，STM32 安全控制器执行授权状态机，Secure Element 里的私钥永不出芯片，硬件联锁带着反馈闭环真正拉断拓扑。',
                    '四个模块彼此独立。任何一环说不，桥就保持断开。',
                ],
            },
            {
                no: '肆',
                title: '克制',
                lines: [
                    '释放永远是暂态——每一次放行都带着倒计时，到点自动回到隔离。',
                    '急停按钮按下之后，即使收到完全合法的授权，设备也会拒绝，直到有人亲手复位。',
                    '隔离是常态，连通是例外。这是我们与工业安全共享的世界观。',
                ],
            },
        ],
        promiseTitle: '我们的承诺，连同它的边界',
        promiseBody:
            '即使服务器被 root 完全控制，受控网络链路的最终放行，仍由服务器之外的硬件网关决定。这个承诺是条件式的：链路须实际经过设备布线、Final Defense 模式开启、本地策略经签名、安全芯片在位且全链健康。',
        promiseLimits: [
            '带外 BMC、Wi-Fi、备用网卡、本地控制台不在 v1 范围内。',
            'v1 只断低压网络链路，不切市电。',
            '量产设备的硬件在环测试仍在进行，当前为原型阶段。',
        ],
        closing: '守望流量，安抵未来。',
        cta: '进入控制台',
        back: '返回现行首页',
    },
    en: {
        tag: 'workshop · story',
        login: 'Open Console',
        heroKicker: 'The AetherGuard story',
        heroTitle: 'A lighthouse\nin the flood of data.',
        heroSub: 'This is not another feature list. This is why we built the machine.',
        chapters: [
            {
                no: 'I',
                title: 'The flood',
                lines: [
                    'Every second, your servers catch requests from the whole world — most harmless, some not.',
                    'Firewalls, EDR, bastions stand guard in layers. They share one weakness: they all run on the very machine that can be taken.',
                    'When an attacker gets root, the guards fall with the castle.',
                ],
            },
            {
                no: 'II',
                title: 'The watch',
                lines: [
                    'So first we built the watchers: distributed agents on every server, a seven-layer multi-agent pipeline reading every piece of contested evidence, zero false positives on normal traffic as a hard constraint we set for ourselves.',
                    'Seeing is the first act of protection. But seeing is not enough.',
                ],
            },
            {
                no: 'III',
                title: 'The line',
                lines: [
                    'A true last line must stand outside the walls.',
                    'We moved the release of critical network links out of server software entirely, into an independent hardware appliance: a dual-gigabit transparent bridge isolated by default, an STM32 security controller running the authorization state machine, secure-element keys that never leave the chip, and a hardware interlock with feedback that physically moves the topology.',
                    'Four modules, mutually independent. If any one says no, the bridge stays open-circuit.',
                ],
            },
            {
                no: 'IV',
                title: 'Restraint',
                lines: [
                    'A release is always temporary — every grant carries a countdown and returns to isolation on expiry.',
                    'After an emergency stop, even a perfectly valid grant is refused until a human resets the latch.',
                    'Isolation is the steady state; connectivity is the exception. This is the worldview we share with industrial safety.',
                ],
            },
        ],
        promiseTitle: 'Our promise, with its edges shown',
        promiseBody:
            'Even with full root control of the server, the final release of protected network links is decided by hardware outside it. The promise is conditional: links must be physically cabled through the appliance, Final Defense enabled, the local policy signed, the secure element present, and the whole chain healthy.',
        promiseLimits: [
            'Out-of-band BMC, Wi-Fi, spare NICs, and local console are outside v1 scope.',
            'v1 cuts the low-voltage network link only — never mains power.',
            'Hardware-in-the-loop tests on production units are still pending; this is a prototype.',
        ],
        closing: 'Watching over traffic, arriving safely at the future.',
        cta: 'Open Console',
        back: 'Current landing',
    },
};

const fade = {
    hidden: { opacity: 0, y: 32 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.7 } },
};

const LandingStory = () => {
    const navigate = useNavigate();
    const [lang, setLang] = useState<Lang>(() =>
        typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en',
    );
    const c = useMemo(() => COPY[lang], [lang]);

    return (
        <div className="min-h-screen bg-[#060913] text-slate-100">
            {/* Chrome */}
            <header className="absolute inset-x-0 top-0 z-40">
                <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5 text-sm">
                    <span className="font-semibold tracking-wide text-slate-300">
                        AetherGuard
                        <span className="ml-2 rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-400">
                            {c.tag}
                        </span>
                    </span>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
                            className="text-xs text-slate-400 transition hover:text-white"
                        >
                            {lang === 'zh' ? 'EN' : '中文'}
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/login')}
                            className="rounded-full border border-slate-600 px-4 py-1.5 text-xs text-slate-200 transition hover:border-slate-300"
                        >
                            {c.login}
                        </button>
                    </div>
                </div>
            </header>

            {/* Hero */}
            <section className="relative flex min-h-[92vh] items-center overflow-hidden">
                <div
                    aria-hidden
                    className="pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
                    style={{ background: 'radial-gradient(closest-side, #38bdf8, #6366f1 60%, transparent)' }}
                />
                <div className="relative mx-auto w-full max-w-5xl px-6">
                    <motion.p variants={fade} initial="hidden" animate="visible" className="text-xs uppercase tracking-[0.35em] text-sky-300/80">
                        {c.heroKicker}
                    </motion.p>
                    <motion.h1
                        variants={fade}
                        initial="hidden"
                        animate="visible"
                        className="mt-6 whitespace-pre-line text-5xl font-black leading-[1.08] tracking-tight md:text-7xl"
                    >
                        {c.heroTitle}
                    </motion.h1>
                    <motion.p variants={fade} initial="hidden" animate="visible" className="mt-8 max-w-xl text-lg text-slate-400">
                        {c.heroSub}
                    </motion.p>
                </div>
            </section>

            {/* Chapters */}
            {c.chapters.map((chapter) => (
                <motion.section
                    key={chapter.no}
                    variants={fade}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-120px' }}
                    className="mx-auto w-full max-w-3xl px-6 py-24"
                >
                    <div className="flex items-baseline gap-4">
                        <span className="text-sm text-sky-400/70">{chapter.no}</span>
                        <h2 className="text-3xl font-bold tracking-tight md:text-5xl">{chapter.title}</h2>
                    </div>
                    <div className="mt-8 space-y-6 border-l border-slate-800 pl-6">
                        {chapter.lines.map((line) => (
                            <p key={line} className="text-lg leading-relaxed text-slate-300 md:text-xl">
                                {line}
                            </p>
                        ))}
                    </div>
                </motion.section>
            ))}

            {/* Promise */}
            <motion.section
                variants={fade}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-120px' }}
                className="mx-auto w-full max-w-3xl px-6 py-24"
            >
                <h2 className="text-3xl font-bold tracking-tight md:text-5xl">{c.promiseTitle}</h2>
                <p className="mt-8 text-lg leading-relaxed text-slate-300 md:text-xl">{c.promiseBody}</p>
                <ul className="mt-8 space-y-3">
                    {c.promiseLimits.map((limit) => (
                        <li key={limit} className="flex gap-3 text-base text-slate-400">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                            {limit}
                        </li>
                    ))}
                </ul>
            </motion.section>

            {/* Closing */}
            <section className="relative overflow-hidden py-32 text-center">
                <div
                    aria-hidden
                    className="pointer-events-none absolute bottom-0 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
                    style={{ background: 'radial-gradient(closest-side, #38bdf8, transparent)' }}
                />
                <p className="relative text-2xl font-bold tracking-wide text-slate-200 md:text-4xl">{c.closing}</p>
                <div className="relative mt-10 flex items-center justify-center gap-4">
                    <button
                        type="button"
                        onClick={() => navigate('/login')}
                        className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-7 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
                    >
                        {c.cta}
                        <ArrowRight className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => navigate('/')} className="text-sm text-slate-500 transition hover:text-slate-300">
                        {c.back}
                    </button>
                </div>
            </section>
        </div>
    );
};

export default LandingStory;
