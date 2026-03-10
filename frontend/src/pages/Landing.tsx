import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    Activity,
    ArrowRight,
    Brain,
    Cpu,
    Globe2,
    Radar,
    ShieldCheck,
    Workflow,
    Wrench,
} from 'lucide-react';
import heroImage from '../assets/hero-visualization.png';
import Logo from '../components/Logo';
import {
    JourneyStep,
    LandingBadge,
    LandingPanel,
    LandingSection,
    MetricStrip,
    ProductFrame,
    StoryCard,
} from '../components/LandingPrimitives';
import { COMPANY_NAME_CN, COMPANY_NAME_EN } from '../config/branding';
import { getLandingCopy, type LandingLanguage } from './landingContent';

const pressureIcons = [Radar, Workflow, Wrench];
const pillarIcons = [Activity, Brain, ShieldCheck];
const surfaceAccents = ['blue', 'amber', 'emerald'] as const;

const fadeUp = {
    hidden: { opacity: 0, y: 28 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.55 } },
};

const Landing = () => {
    const navigate = useNavigate();
    const [language, setLanguage] = useState<LandingLanguage>(() =>
        typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en',
    );
    const [activeOrbit, setActiveOrbit] = useState(0);

    const content = useMemo(() => getLandingCopy(language), [language]);

    useEffect(() => {
        const interval = window.setInterval(() => {
            setActiveOrbit((previous) => (previous + 1) % content.hero.orbitCards.length);
        }, 2600);
        return () => window.clearInterval(interval);
    }, [content.hero.orbitCards.length]);

    useEffect(() => {
        const previousBodyOverflow = document.body.style.overflow;
        const previousBodyOverflowY = document.body.style.overflowY;
        const previousBodyHeight = document.body.style.height;
        const previousHtmlOverflow = document.documentElement.style.overflow;
        const previousHtmlOverflowY = document.documentElement.style.overflowY;

        document.body.style.overflow = 'auto';
        document.body.style.overflowY = 'auto';
        document.body.style.height = 'auto';
        document.documentElement.style.overflow = 'auto';
        document.documentElement.style.overflowY = 'auto';

        return () => {
            document.body.style.overflow = previousBodyOverflow;
            document.body.style.overflowY = previousBodyOverflowY;
            document.body.style.height = previousBodyHeight;
            document.documentElement.style.overflow = previousHtmlOverflow;
            document.documentElement.style.overflowY = previousHtmlOverflowY;
        };
    }, []);

    const scrollToSection = (sectionId: string) => {
        const target = document.getElementById(sectionId);
        if (!target) return;

        const top = target.getBoundingClientRect().top + window.scrollY - 96;
        window.scrollTo({ top, behavior: 'smooth' });
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute left-[-8%] top-[-8%] h-[480px] w-[480px] rounded-full bg-sky-500/12 blur-3xl" />
                <div className="absolute right-[-10%] top-[12%] h-[420px] w-[420px] rounded-full bg-cyan-500/10 blur-3xl" />
                <div className="absolute bottom-[-16%] left-[18%] h-[460px] w-[460px] rounded-full bg-blue-500/8 blur-3xl" />
                <svg
                    className="absolute right-[-8%] top-[-2%] h-[780px] w-[780px] stroke-border/50"
                    viewBox="0 0 800 800"
                    fill="none"
                    aria-hidden="true"
                >
                    <circle cx="400" cy="400" r="210" strokeWidth="1" />
                    <circle cx="400" cy="400" r="310" strokeWidth="1" />
                    <path d="M118 286C226 188 334 164 470 178C620 194 692 256 744 332" strokeWidth="1.2" />
                    <path d="M146 540C236 612 338 640 468 628C584 616 672 558 726 490" strokeWidth="1.2" />
                    <path d="M230 144L286 200" strokeWidth="1.2" />
                    <path d="M584 604L666 686" strokeWidth="1.2" />
                </svg>
            </div>

            <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-md">
                <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-6 px-6 py-4 md:px-8 xl:px-10">
                    <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center text-left">
                        <Logo showText={true} className="origin-left scale-95" />
                    </button>

                    <nav className="hidden items-center gap-2 lg:flex">
                        {content.nav.map((item) => (
                            <button
                                key={item.href}
                                type="button"
                                onClick={() => scrollToSection(item.href)}
                                className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                            >
                                {item.label}
                            </button>
                        ))}
                    </nav>

                    <div className="flex items-center gap-3">
                        <div className="flex items-center rounded-full border border-border/80 bg-card p-1 shadow-sm">
                            <button
                                type="button"
                                data-testid="landing-lang-en"
                                aria-pressed={language === 'en'}
                                onClick={() => setLanguage('en')}
                                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                                    language === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {content.language.en}
                            </button>
                            <button
                                type="button"
                                data-testid="landing-lang-zh"
                                aria-pressed={language === 'zh'}
                                onClick={() => setLanguage('zh')}
                                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                                    language === 'zh' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {content.language.zh}
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate('/login')}
                            className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
                        >
                            {content.login}
                        </button>
                    </div>
                </div>
            </header>

            <main className="relative z-10" data-testid="landing-main">
                <section className="mx-auto max-w-[1480px] px-6 pb-16 pt-12 md:px-8 md:pb-20 md:pt-20 xl:px-10" data-testid="landing-hero">
                    <div className="grid gap-12 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] lg:items-center">
                        <motion.div initial="hidden" animate="visible" variants={fadeUp} className="space-y-8">
                            <div className="space-y-6">
                                <LandingBadge accent="cyan">{content.hero.badge}</LandingBadge>
                                <h1 className="max-w-4xl text-5xl font-bold tracking-[-0.04em] text-foreground md:text-7xl md:leading-[0.95]">
                                    {content.hero.title}
                                </h1>
                                <p className="max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
                                    {content.hero.description}
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    data-testid="landing-primary-cta"
                                    onClick={() => scrollToSection('product-surfaces')}
                                    className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                                >
                                    {content.hero.primaryCta}
                                    <ArrowRight size={16} />
                                </button>
                                <button
                                    type="button"
                                    data-testid="landing-secondary-cta"
                                    onClick={() => navigate('/login')}
                                    className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card px-6 py-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/30"
                                >
                                    {content.hero.secondaryCta}
                                </button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {content.hero.chips.map((chip) => (
                                    <span key={chip} className="rounded-full border border-border/80 bg-card/80 px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
                                        {chip}
                                    </span>
                                ))}
                            </div>

                            <MetricStrip items={content.hero.metrics} />
                        </motion.div>

                        <motion.div initial="hidden" animate="visible" variants={fadeUp} className="space-y-5">
                            <ProductFrame accent="blue" eyebrow={content.hero.fabricEyebrow} title={content.hero.fabricTitle} description={content.hero.fabricDescription}>
                                <div className="overflow-hidden rounded-[22px] border border-border/80 bg-muted/25">
                                    <div className="relative h-[260px] overflow-hidden">
                                        <img src={heroImage} alt="AetherGuard product preview" className="h-full w-full object-cover" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-background/75 via-background/10 to-transparent" />
                                        <div className="absolute bottom-4 left-4 right-4 grid gap-3 md:grid-cols-3">
                                            {content.hero.fabricSignals.map((signal) => (
                                                <div key={signal.label} className="rounded-2xl border border-white/15 bg-slate-950/55 px-4 py-3 text-white shadow-sm backdrop-blur-md">
                                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">{signal.label}</div>
                                                    <div className="mt-2 text-2xl font-semibold tracking-tight">{signal.value}</div>
                                                    <div className="mt-1 text-xs text-slate-300">{signal.note}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </ProductFrame>

                            <div className="grid gap-4 md:grid-cols-3">
                                {content.hero.orbitCards.map((item, index) => (
                                    <motion.div
                                        key={item.title}
                                        animate={{
                                            y: activeOrbit === index ? -6 : 0,
                                            borderColor: activeOrbit === index ? 'rgba(59,130,246,0.32)' : 'rgba(148,163,184,0.18)',
                                        }}
                                        transition={{ duration: 0.35, ease: 'easeOut' }}
                                        className="rounded-[24px] border bg-card/90 p-5 shadow-sm"
                                    >
                                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.eyebrow}</div>
                                        <h3 className="mt-3 text-lg font-semibold tracking-tight text-foreground">{item.title}</h3>
                                        <p className="mt-3 text-sm leading-7 text-muted-foreground">{item.description}</p>
                                    </motion.div>
                                ))}
                            </div>
                        </motion.div>
                    </div>
                </section>

                <LandingSection
                    id="why-now"
                    testId="landing-why-now"
                    eyebrow={content.whyNow.eyebrow}
                    title={content.whyNow.title}
                    description={content.whyNow.description}
                    className="scroll-mt-28 border-t border-border/60"
                >
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                        <LandingPanel className="overflow-hidden">
                            <div className="border-b border-border/80 bg-gradient-to-br from-blue-500/8 via-transparent to-cyan-500/8 px-6 py-6">
                                <div className="max-w-xl">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                        {content.whyNow.manifestoTitle}
                                    </div>
                                    <p className="mt-4 text-xl leading-9 text-foreground md:text-2xl">
                                        {content.whyNow.manifestoBody}
                                    </p>
                                </div>
                            </div>
                            <div className="grid gap-3 p-6">
                                {content.whyNow.manifestoPoints.map((point) => (
                                    <div key={point} className="flex items-start gap-3 rounded-2xl border border-border/80 bg-background/70 px-4 py-4">
                                        <ShieldCheck size={18} className="mt-0.5 text-primary" />
                                        <span className="text-sm leading-7 text-muted-foreground">{point}</span>
                                    </div>
                                ))}
                            </div>
                        </LandingPanel>

                        <div className="grid gap-4 md:grid-cols-3">
                            {content.whyNow.pressures.map((item, index) => {
                                const Icon = pressureIcons[index];
                                const accent = surfaceAccents[index];

                                return (
                                    <StoryCard
                                        key={item.title}
                                        icon={Icon}
                                        title={item.title}
                                        description={item.description}
                                        accent={accent}
                                    />
                                );
                            })}
                        </div>
                    </div>
                </LandingSection>

                <LandingSection
                    id="core-system"
                    testId="landing-core-system"
                    eyebrow={content.pillars.eyebrow}
                    title={content.pillars.title}
                    description={content.pillars.description}
                    className="scroll-mt-28 border-t border-border/60 bg-muted/[0.18]"
                >
                    <div className="grid gap-5 xl:grid-cols-3">
                        {content.pillars.items.map((item, index) => {
                            const Icon = pillarIcons[index];
                            const accent = surfaceAccents[index];

                            return (
                                <LandingPanel key={item.title} className="h-full p-6">
                                    <div className="flex h-full flex-col gap-6">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="space-y-3">
                                                <LandingBadge accent={accent}>{item.eyebrow}</LandingBadge>
                                                <h3 className="text-2xl font-semibold tracking-tight text-foreground">{item.title}</h3>
                                            </div>
                                            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border bg-card ${accent === 'blue' ? 'border-blue-500/20 text-blue-600 dark:text-blue-400' : accent === 'amber' ? 'border-amber-500/20 text-amber-600 dark:text-amber-400' : 'border-emerald-500/20 text-emerald-600 dark:text-emerald-400'}`}>
                                                <Icon size={20} />
                                            </div>
                                        </div>

                                        <p className="text-sm leading-7 text-muted-foreground">{item.description}</p>

                                        <div className="rounded-[22px] border border-border/80 bg-background/70 p-5">
                                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.statLabel}</div>
                                            <div className="mt-3 text-3xl font-bold tracking-tight text-foreground">{item.statValue}</div>
                                        </div>

                                        <div className="space-y-3">
                                            {item.bullets.map((bullet) => (
                                                <div key={bullet} className="flex items-start gap-3">
                                                    <span className="mt-2 h-2 w-2 rounded-full bg-primary/80" />
                                                    <span className="text-sm leading-7 text-muted-foreground">{bullet}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </LandingPanel>
                            );
                        })}
                    </div>
                </LandingSection>

                <LandingSection
                    id="product-surfaces"
                    testId="landing-product-surfaces"
                    eyebrow={content.surfaces.eyebrow}
                    title={content.surfaces.title}
                    description={content.surfaces.description}
                    className="scroll-mt-28 border-t border-border/60"
                >
                    <div className="space-y-8">
                        {content.surfaces.items.map((item, index) => {
                            const reverse = index % 2 === 1;
                            const accent = surfaceAccents[index];

                            return (
                                <div key={item.title} className="grid gap-6 rounded-[32px] border border-border/80 bg-card/65 p-6 shadow-sm lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:p-8">
                                    <div className={`space-y-5 ${reverse ? 'lg:order-2' : ''}`}>
                                        <LandingBadge accent={accent}>{item.eyebrow}</LandingBadge>
                                        <div className="space-y-4">
                                            <h3 className="text-3xl font-semibold tracking-tight text-foreground">{item.title}</h3>
                                            <p className="max-w-2xl text-base leading-8 text-muted-foreground">{item.description}</p>
                                        </div>
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            {item.metrics.map((metric) => (
                                                <div key={metric.label} className="rounded-2xl border border-border/80 bg-background/70 p-4">
                                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{metric.label}</div>
                                                    <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{metric.value}</div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="space-y-3">
                                            {item.bullets.map((bullet) => (
                                                <div key={bullet} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/60 px-4 py-4">
                                                    <span className={`mt-2.5 h-2.5 w-2.5 rounded-full ${accent === 'blue' ? 'bg-blue-500' : accent === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                                                    <span className="text-sm leading-7 text-muted-foreground">{bullet}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className={reverse ? 'lg:order-1' : ''}>
                                        <ProductFrame accent={accent} eyebrow={item.railTitle} title={item.title} description={item.railDescription} footer={item.railLines[2]}>
                                            {index === 0 && (
                                                <div className="space-y-4">
                                                    <div className="overflow-hidden rounded-[22px] border border-border/80 bg-muted/20">
                                                        <img src={heroImage} alt={`${item.title} preview`} className="h-[210px] w-full object-cover" />
                                                    </div>
                                                    <div className="grid gap-3">
                                                        {item.railLines.slice(0, 2).map((line) => (
                                                            <div key={line} className="rounded-2xl border border-border/80 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                                                                {line}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {index === 1 && (
                                                <div className="space-y-4">
                                                    {item.railLines.map((line, lineIndex) => (
                                                        <div key={line} className="rounded-2xl border border-border/80 bg-background/70 p-4">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <span className="text-sm text-muted-foreground">{line}</span>
                                                                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">0{lineIndex + 1}</span>
                                                            </div>
                                                            <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                                                                <div className={`h-full rounded-full ${lineIndex === 0 ? 'w-[72%] bg-amber-500' : lineIndex === 1 ? 'w-[89%] bg-blue-500' : 'w-[64%] bg-emerald-500'}`} />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {index === 2 && (
                                                <div className="space-y-3">
                                                    {item.railLines.map((line) => (
                                                        <div key={line} className="flex items-center justify-between rounded-2xl border border-border/80 bg-background/70 px-4 py-3 text-sm">
                                                            <span className="text-muted-foreground">{line}</span>
                                                            <Cpu size={16} className="text-emerald-600 dark:text-emerald-400" />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </ProductFrame>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </LandingSection>

                <LandingSection
                    id="workflow"
                    testId="landing-workflow"
                    eyebrow={content.journey.eyebrow}
                    title={content.journey.title}
                    description={content.journey.description}
                    className="scroll-mt-28 border-t border-border/60 bg-muted/[0.18]"
                >
                    <div className="grid gap-5 xl:grid-cols-4">
                        {content.journey.steps.map((step, index) => (
                            <div key={step.step} className="space-y-3">
                                <JourneyStep step={step.step} title={step.title} description={step.description} />
                                <div className="rounded-[22px] border border-border/70 bg-background/60 px-4 py-4 text-sm leading-7 text-muted-foreground">
                                    {step.detail}
                                </div>
                                {index < content.journey.steps.length - 1 && (
                                    <div className="hidden h-[2px] w-full rounded-full bg-gradient-to-r from-primary/70 to-transparent xl:block" />
                                )}
                            </div>
                        ))}
                    </div>
                </LandingSection>

                <LandingSection
                    id="edge-and-deploy"
                    testId="landing-edge-and-deploy"
                    eyebrow={content.infrastructure.eyebrow}
                    title={content.infrastructure.title}
                    description={content.infrastructure.description}
                    className="scroll-mt-28 border-t border-border/60"
                >
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                        <LandingPanel className="overflow-hidden">
                            <div className="border-b border-border/80 bg-gradient-to-br from-cyan-500/8 via-transparent to-blue-500/8 px-6 py-6">
                                <MetricStrip items={content.infrastructure.stats} />
                            </div>
                            <div className="grid gap-4 p-6">
                                {content.infrastructure.regions.map((region) => (
                                    <div key={region.name} className="rounded-[24px] border border-border/80 bg-background/70 p-5">
                                        <div className="flex items-center justify-between gap-4">
                                            <div>
                                                <div className="text-sm font-semibold text-foreground">{region.name}</div>
                                                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">{region.latency}</div>
                                            </div>
                                            <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">
                                                {region.status}
                                            </div>
                                        </div>
                                        <div className="mt-4 flex items-start gap-3">
                                            <Globe2 size={18} className="mt-0.5 text-primary" />
                                            <div className="text-sm leading-7 text-muted-foreground">{region.role}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </LandingPanel>

                        <ProductFrame
                            accent="emerald"
                            eyebrow={content.infrastructure.deviceEyebrow}
                            title={content.infrastructure.deviceTitle}
                            description={content.infrastructure.deviceDescription}
                        >
                            <div className="space-y-4">
                                <div className="flex flex-wrap gap-2">
                                    {content.infrastructure.deviceBadges.map((badge) => (
                                        <span key={badge} className="rounded-full border border-border/80 bg-background/70 px-3 py-1.5 text-sm text-muted-foreground">
                                            {badge}
                                        </span>
                                    ))}
                                </div>
                                <div className="space-y-3">
                                    {content.infrastructure.deviceRows.map((row) => (
                                        <div key={row.label} className="flex items-center justify-between gap-4 rounded-2xl border border-border/80 bg-background/70 px-4 py-4 text-sm">
                                            <span className="text-muted-foreground">{row.label}</span>
                                            <span className="font-medium text-foreground">{row.value}</span>
                                        </div>
                                    ))}
                                </div>
                                <LandingPanel className="overflow-hidden border-emerald-500/20 bg-emerald-500/5 p-5">
                                    <div className="flex items-start gap-4">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                            <Cpu size={20} />
                                        </div>
                                        <div className="space-y-2">
                                            <div className="text-sm font-semibold text-foreground">{content.infrastructure.calloutTitle}</div>
                                            <p className="text-sm leading-7 text-muted-foreground">
                                                {content.infrastructure.calloutDescription}
                                            </p>
                                        </div>
                                    </div>
                                </LandingPanel>
                            </div>
                        </ProductFrame>
                    </div>
                </LandingSection>

                <LandingSection
                    id="final-cta"
                    testId="landing-final-cta"
                    eyebrow={content.cta.eyebrow}
                    title={content.cta.title}
                    description={content.cta.description}
                    className="border-t border-border/60 bg-muted/[0.16]"
                    actions={
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={() => navigate('/login')}
                                className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                            >
                                {content.cta.primary}
                                <ArrowRight size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/privacy')}
                                className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card px-6 py-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/30"
                            >
                                {content.cta.secondary}
                            </button>
                        </div>
                    }
                >
                    <LandingPanel className="grid gap-4 overflow-hidden border-blue-500/15 bg-gradient-to-br from-blue-500/6 via-card/95 to-cyan-500/6 p-6 md:grid-cols-3">
                        {content.cta.cards.map((card) => (
                            <div key={card.label} className="rounded-[24px] border border-border/80 bg-background/70 p-5">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{card.label}</div>
                                <div className="mt-3 text-lg font-semibold text-foreground">{card.title}</div>
                            </div>
                        ))}
                    </LandingPanel>
                </LandingSection>
            </main>

            <footer className="relative z-10 border-t border-border/70 bg-card/85">
                <div className="mx-auto flex max-w-[1480px] flex-col gap-6 px-6 py-8 md:px-8 lg:flex-row lg:items-center lg:justify-between xl:px-10">
                    <div className="space-y-2">
                        <Logo showText={true} className="origin-left scale-90" />
                        <div className="text-sm text-muted-foreground">{content.footer.tagline}</div>
                        <div className="text-xs text-muted-foreground">{COMPANY_NAME_CN} · {COMPANY_NAME_EN}</div>
                        <div className="text-xs text-muted-foreground">{content.footer.copyright}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
                        <a href="/privacy" className="transition-colors hover:text-foreground">
                            {content.footer.privacy}
                        </a>
                        <a href="/terms" className="transition-colors hover:text-foreground">
                            {content.footer.terms}
                        </a>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Landing;
