import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useScroll, useTransform } from 'framer-motion';
import heroImage from '../assets/hero-visualization.png';
import logoImage from '../assets/logo.png';

const Landing = () => {
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({ container: containerRef });

    // Parallax mappings
    const bgY = useTransform(scrollYProgress, [0, 1], ["0%", "50%"]);
    const cardY = useTransform(scrollYProgress, [0, 1], ["0%", "-10%"]);

    const changeLanguage = (lng: string) => {
        i18n.changeLanguage(lng);
    };

    // Simulated terminal logs
    const [terminalLines, setTerminalLines] = useState<string[]>([
        "> SEC_SYS initializing...",
        "> Loading 7-Layer Decision System..."
    ]);

    useEffect(() => {
        const logs = [
            "> Multi-Agent consensus: SECURE.",
            "> Attack Simulator ready (30+ vectors).",
            "> Intercepting traffic on edge nodes.",
            "> [WARN] 3 SQLi attempts blocked.",
            "> [INFO] AI Analyst validating request...",
        ];
        let idx = 0;
        const interval = setInterval(() => {
            if (idx < logs.length) {
                setTerminalLines(prev => [...prev.slice(-3), logs[idx]]);
                idx++;
            } else {
                idx = 0;
            }
        }, 3500);
        return () => clearInterval(interval);
    }, []);

    // Advanced Spring Animations
    const fadeUpSpring = {
        hidden: { opacity: 0, y: 50 },
        visible: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 100, damping: 20 } }
    };

    const staggerContainer = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: { staggerChildren: 0.15 }
        }
    };

    const floating = {
        animate: {
            y: [0, -15, 0],
            transition: {
                duration: 5,
                ease: "easeInOut" as const,
                repeat: Infinity
            }
        }
    };

    return (
        <div ref={containerRef} className="h-screen overflow-y-auto text-gray-800 overflow-x-hidden min-h-screen relative bg-[#F8FAFC] font-sans selection:bg-blue-500/20 selection:text-blue-700">
            {/* Light Mode Override */}
            <style>{`
                :root { color-scheme: light; }
                html { scroll-behavior: smooth; }
            `}</style>

            {/* Parallax Clean Tech Background */}
            <motion.div className="fixed inset-0 z-0 pointer-events-none opacity-40 will-change-transform" style={{ y: bgY }}>
                <div className="absolute inset-0"
                    style={{
                        backgroundImage: 'linear-gradient(rgba(14, 165, 233, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(14, 165, 233, 0.05) 1px, transparent 1px)',
                        backgroundSize: '40px 40px'
                    }}>
                </div>
            </motion.div>

            <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
                <div className="absolute top-0 right-[-10%] w-[800px] h-[800px] bg-sky-200/50 rounded-full blur-[120px] mix-blend-multiply"></div>
                <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] bg-indigo-100/60 rounded-full blur-[150px] mix-blend-multiply"></div>
            </div>

            <header className="fixed top-0 w-full z-50 border-b border-gray-200/50 transition-all duration-300 bg-white/80 backdrop-blur-xl">
                <div className="max-w-[1400px] mx-auto px-6 h-20 flex items-center justify-between relative z-50">
                    <div className="flex items-center gap-3 cursor-pointer group" onClick={() => navigate('/')}>
                        <div className="relative group-hover:scale-105 transition-transform duration-300">
                            <div className="absolute inset-0 bg-blue-500 blur-xl opacity-20 group-hover:opacity-40 transition-opacity"></div>
                            <img src={logoImage} alt="AetherGuard Logo" className="h-11 w-11 object-contain relative z-10 drop-shadow-sm rounded-xl" />
                        </div>
                        <div className="flex flex-col">
                            <span className="font-bold text-xl tracking-tight text-slate-900 leading-none group-hover:text-blue-600 transition-colors">AetherGuard</span>
                            <span className="text-[0.6rem] text-slate-500 font-bold tracking-wide uppercase mt-0.5">{t('footer.powered_by')}</span>
                        </div>
                    </div>

                    <nav className="hidden md:flex items-center gap-2 bg-slate-100/80 px-2 py-1.5 rounded-full border border-gray-200 backdrop-blur-md">
                        <a className="text-sm font-semibold text-slate-600 hover:text-blue-600 hover:bg-white px-5 py-2 rounded-full transition-all shadow-sm" href="#architecture">{t('nav.architecture')}</a>
                        <a className="text-sm font-semibold text-slate-600 hover:text-blue-600 hover:bg-white px-5 py-2 rounded-full transition-all" href="#defense">{t('nav.defense')}</a>
                        <a className="text-sm font-semibold text-slate-600 hover:text-blue-600 hover:bg-white px-5 py-2 rounded-full transition-all" href="#deep-tech">{t('nav.deep_tech')}</a>
                        <a className="text-sm font-semibold text-slate-600 hover:text-blue-600 hover:bg-white px-5 py-2 rounded-full transition-all" href="#pricing">{t('nav.pricing')}</a>
                    </nav>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center border border-gray-200 rounded-full bg-slate-50 px-1 py-1 shadow-inner">
                            <button
                                onClick={() => changeLanguage('en')}
                                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${i18n.language === 'en' ? 'bg-white text-blue-600 shadow-sm border border-gray-100' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                EN
                            </button>
                            <button
                                onClick={() => changeLanguage('zh')}
                                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${i18n.language === 'zh' ? 'bg-white text-blue-600 shadow-sm border border-gray-100' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                中文
                            </button>
                        </div>
                        <button onClick={() => navigate('/login')} className="text-sm font-bold text-slate-600 hover:text-blue-600 transition-colors">{t('nav.login')}</button>
                        <button onClick={() => navigate('/login')} className="bg-slate-900 hover:bg-blue-600 text-white text-sm font-bold px-6 py-2.5 rounded-full transition-all shadow-[0_4px_15px_rgba(0,0,0,0.1)] hover:shadow-[0_8px_25px_rgba(37,99,235,0.3)] hover:-translate-y-0.5">{t('nav.get_started')}</button>
                    </div>
                </div>
            </header>

            <main className="pt-20 relative z-10 flex-col flex">
                {/* Hero Section */}
                <section className="relative min-h-[90vh] flex flex-col justify-center overflow-visible pb-10">
                    <div className="max-w-[1400px] mx-auto w-full px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center relative z-10 pt-20">

                        <motion.div
                            className="space-y-10 pr-8 relative z-20"
                            initial="hidden"
                            animate="visible"
                            variants={staggerContainer}
                        >
                            <motion.div variants={fadeUpSpring} className="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-blue-200/50 bg-blue-50/80 backdrop-blur-xl shadow-sm cursor-pointer group hover:bg-blue-100/80 transition-colors">
                                <span className="relative flex h-2.5 w-2.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]"></span>
                                </span>
                                <span className="text-[11px] font-bold tracking-wide uppercase text-blue-700">{t('hero.multi_agent_online')}</span>
                                <span className="material-symbols-outlined text-[14px] text-blue-500 group-hover:translate-x-1 transition-transform">arrow_forward</span>
                            </motion.div>

                            <motion.h1 variants={fadeUpSpring} className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.05] text-slate-900">
                                {t('hero.title_prefix')} <br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600">
                                    {t('hero.title_highlight')}
                                </span>
                            </motion.h1>

                            <motion.p variants={fadeUpSpring} className="text-xl text-slate-600 max-w-lg font-medium leading-relaxed">
                                {t('hero.description')}
                            </motion.p>

                            <motion.div variants={fadeUpSpring} className="flex flex-wrap items-center gap-4 pt-4">
                                <button onClick={() => navigate('/login')} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-2xl font-bold text-sm transition-all flex items-center gap-3 shadow-[0_8px_20px_rgba(37,99,235,0.25)] hover:shadow-[0_12px_25px_rgba(37,99,235,0.4)] hover:-translate-y-1">
                                    {t('hero.deploy_system')}
                                    <span className="material-symbols-outlined text-sm">rocket_launch</span>
                                </button>
                                <button onClick={() => document.getElementById('defense')?.scrollIntoView()} className="text-slate-700 bg-white hover:bg-slate-50 px-8 py-4 font-semibold text-sm transition-all border border-gray-200 rounded-2xl shadow-sm hover:shadow-md hover:border-gray-300">
                                    {t('hero.view_specs')}
                                </button>
                            </motion.div>
                        </motion.div>

                        <motion.div
                            className="relative h-[650px] w-full lg:w-[115%] perspective-1000 z-10 lg:-mr-[15%]"
                            initial="hidden"
                            animate="visible"
                            variants={fadeUpSpring}
                            style={{ y: cardY }}
                        >
                            <motion.div animate={floating.animate} className="relative w-full h-full transform transition-transform duration-700 hover:rotate-y-[-2deg] hover:rotate-x-[2deg] will-change-transform">
                                {/* Soft Shadow behind the card */}
                                <div className="absolute inset-4 bg-blue-600/15 rounded-[2.5rem] blur-3xl transform translate-y-12 translate-x-4"></div>

                                <div className="absolute inset-0 rounded-[2rem] overflow-hidden border border-white bg-white/60 backdrop-blur-xl z-10 shadow-[0_20px_60px_rgba(0,0,0,0.08)] ring-1 ring-slate-900/5 flex flex-col">
                                    <div className="absolute inset-0 bg-gradient-to-tr from-blue-50 to-white/5 z-20 pointer-events-none mix-blend-overlay"></div>

                                    <div className="relative h-full w-full overflow-hidden bg-slate-50 flex-1">
                                        <div className="absolute inset-0 opacity-10" style={{
                                            backgroundImage: 'linear-gradient(#cbd5e1 1px, transparent 1px), linear-gradient(90deg, #cbd5e1 1px, transparent 1px)',
                                            backgroundSize: '20px 20px'
                                        }}></div>
                                        <div className="w-full h-full flex flex-col pt-12">
                                            {/* Top terminal bar */}
                                            <div className="absolute top-0 left-0 right-0 h-10 bg-white border-b border-gray-100 flex items-center px-4 gap-2 z-30">
                                                <div className="w-3 h-3 rounded-full bg-rose-400"></div>
                                                <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                                                <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                                                <div className="ml-auto px-6 py-1 bg-slate-100 rounded-md flex items-center gap-2 border border-slate-200">
                                                    <span className="material-symbols-outlined text-[12px] text-slate-400">lock</span>
                                                    <span className="text-[10px] font-mono text-slate-500 font-bold tracking-wide">guard.aether.local</span>
                                                </div>
                                            </div>

                                            <img alt="Server Visualization" className="w-full h-full object-cover opacity-90 filter contrast-[1.05]" src={heroImage} />
                                        </div>
                                    </div>

                                    {/* Glassmorphism Status Terminal (Upgraded) */}
                                    <div className="absolute bottom-6 left-6 right-6 bg-white/90 backdrop-blur-md border border-white p-5 rounded-2xl flex items-start gap-4 z-30 shadow-[0_15px_30px_rgba(0,0,0,0.1)] ring-1 ring-slate-200">
                                        <div className="h-10 w-10 mt-1 bg-slate-900 rounded-xl flex items-center justify-center shadow-inner shrink-0">
                                            <span className="material-symbols-outlined text-white text-xl">terminal</span>
                                        </div>
                                        <div className="flex-1 w-full overflow-hidden">
                                            <div className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-2">
                                                {t('hero.live_subsystem')}
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                            </div>
                                            <div className="font-mono text-[11px] text-slate-600 flex flex-col gap-1">
                                                {terminalLines.map((line, idx) => (
                                                    <motion.div
                                                        key={`term-line-${line || 'empty'}-${idx}`}
                                                        initial={{ opacity: 0, x: -10 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        className={line?.includes('[WARN]') ? 'text-amber-600 font-bold' : line?.includes('SECURE') ? 'text-blue-600 font-bold' : ''}
                                                    >
                                                        {line || ''}
                                                    </motion.div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </motion.div>
                    </div>

                    {/* Stats/Trust Bar */}
                    <div className="max-w-[1400px] mx-auto px-6 w-full mt-10 relative z-20">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: 0.3 }}
                            className="bg-white/60 backdrop-blur-md border border-gray-200 rounded-2xl p-6 flex justify-around flex-wrap gap-8 py-8 shadow-sm"
                        >
                            <div className="flex flex-col items-center">
                                <div className="text-3xl font-extrabold text-blue-600">{t('stats.layer')}</div>
                                <div className="text-sm font-bold text-slate-500 uppercase tracking-wider mt-1">{t('stats.multi_agent')}</div>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="text-3xl font-extrabold text-indigo-600">30+</div>
                                <div className="text-sm font-bold text-slate-500 uppercase tracking-wider mt-1">{t('stats.attack_vectors')}</div>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="text-3xl font-extrabold text-violet-600">&lt;5ms</div>
                                <div className="text-sm font-bold text-slate-500 uppercase tracking-wider mt-1">{t('stats.latency')}</div>
                            </div>
                        </motion.div>
                    </div>
                </section>

                {/* Features Section - REAL Features from code */}
                <section id="defense" className="py-32 relative z-10 border-t border-gray-100 bg-white">
                    <div className="absolute inset-0 bg-gradient-to-b from-slate-50/50 to-white transform -skew-y-2 origin-top-left -z-10"></div>
                    <div className="max-w-[1400px] mx-auto px-6 relative z-10">
                        <motion.div
                            className="mb-20 text-center md:text-left"
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                        >
                            <h2 className="text-4xl font-bold tracking-tight mb-6 text-slate-900">{t('features.title')}</h2>
                            <p className="text-slate-500 text-xl font-medium max-w-2xl leading-relaxed">{t('features.description')}</p>
                        </motion.div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                            {[
                                {
                                    icon: 'psychology',
                                    title: t('features.multi_agent.title') || 'Multi-Agent Collaboration',
                                    desc: t('features.multi_agent.desc') || 'Heterogeneous AI models working together.',
                                    color: 'blue'
                                },
                                {
                                    icon: 'swords',
                                    title: t('features.simulator.title') || 'Live Attack Simulator',
                                    desc: t('features.simulator.desc') || 'Built-in red-team simulator.',
                                    color: 'indigo'
                                },
                                {
                                    icon: 'radar',
                                    title: t('features.traffic.title') || 'Traffic Interceptor',
                                    desc: t('features.traffic.desc') || 'Global traffic scrubbing engine.',
                                    color: 'violet'
                                }
                            ].map((feat, idx) => (
                                <motion.div
                                    key={idx}
                                    variants={fadeUpSpring}
                                    initial="hidden"
                                    whileInView="visible"
                                    viewport={{ once: true, margin: "-50px" }}
                                    transition={{ delay: idx * 0.15 }}
                                    className="bg-white p-10 rounded-3xl shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100 hover:shadow-[0_20px_40px_rgba(37,99,235,0.08)] hover:-translate-y-2 hover:border-blue-100 transition-all duration-500 group relative overflow-hidden"
                                >
                                    {/* Hover Glow Effect */}
                                    <div className={`absolute top-0 right-0 w-48 h-48 bg-${feat.color}-500/10 blur-3xl opacity-0 group-hover:opacity-100 rounded-full -mr-10 -mt-10 transition-all duration-500 scale-50 group-hover:scale-100`}></div>

                                    <div className={`w-14 h-14 rounded-2xl bg-${feat.color}-50 flex items-center justify-center mb-8 border border-${feat.color}-100 group-hover:scale-110 transition-transform duration-300 shadow-sm relative z-10`}>
                                        <span className={`material-symbols-outlined text-${feat.color}-600 text-3xl`}>{feat.icon}</span>
                                    </div>
                                    <h3 className="text-2xl font-bold text-slate-900 mb-4 relative z-10">{feat.title}</h3>
                                    <p className="text-base text-slate-600 leading-relaxed font-medium relative z-10">
                                        {feat.desc}
                                    </p>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* School of Athens Section */}
                <section id="athens" className="py-32 relative z-10 border-t border-gray-100 bg-slate-50 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 to-blue-50/50 -z-10"></div>
                    <div className="max-w-[1400px] mx-auto px-6 relative z-10">
                        <motion.div
                            className="text-center mb-20"
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                        >
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-6 rounded-lg border border-blue-200 bg-blue-50/80 shadow-sm">
                                <span className="text-[11px] font-mono text-blue-700 font-bold uppercase tracking-wider">{t('athens.subtitle')}</span>
                            </div>
                            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6 text-slate-900">{t('athens.title')}</h2>
                            <p className="text-slate-600 text-xl font-medium max-w-3xl mx-auto leading-relaxed">{t('athens.description')}</p>
                        </motion.div>

                        <div className="relative">
                            {/* Visual Timeline Bar */}
                            <div className="absolute left-[38px] md:left-1/2 md:-translate-x-1/2 top-10 bottom-10 w-1.5 bg-gradient-to-b from-blue-200 via-indigo-300 to-blue-200 rounded-full opacity-60"></div>

                            <div className="space-y-12">
                                {[1, 2, 3, 4, 5, 6, 7].map((layer, index) => (
                                    <motion.div
                                        key={`layer-${layer}`}
                                        initial={{ opacity: 0, y: 40 }}
                                        whileInView={{ opacity: 1, y: 0 }}
                                        viewport={{ once: true, margin: "-100px" }}
                                        transition={{ type: "spring", stiffness: 100, damping: 20, delay: 0.1 }}
                                        className={`relative flex flex-col md:flex-row items-center gap-8 md:gap-16 group ${index % 2 === 1 ? 'md:flex-row-reverse' : ''}`}
                                    >
                                        <div className={`flex-1 w-full ${index % 2 === 1 ? 'md:text-right' : 'md:text-left'} hidden md:block opacity-0 group-hover:opacity-100 transition-opacity duration-500`}>
                                            <span className="text-9xl font-black text-slate-100 tracking-tighter absolute top-1/2 -translate-y-1/2 [text-shadow:_2px_2px_10px_rgb(0_0_0_/_3%)] pointer-events-none select-none left-0 right-0 z-0">L0{layer}</span>
                                        </div>

                                        <div className="w-[80px] h-[80px] shrink-0 bg-white border-4 border-slate-50 rounded-full flex items-center justify-center shadow-xl group-hover:bg-blue-600 group-hover:border-blue-100 group-hover:scale-110 transition-all duration-500 z-10 relative">
                                            <div className="absolute inset-0 rounded-full bg-blue-400 opacity-0 group-hover:animate-ping transition-opacity duration-300"></div>
                                            <span className="text-3xl font-black text-slate-300 group-hover:text-white transition-colors relative z-20">{layer}</span>
                                        </div>

                                        <div className="bg-white/80 backdrop-blur-md p-8 md:p-10 rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.03)] border border-gray-100 flex-1 hover:shadow-[0_20px_50px_rgba(37,99,235,0.08)] hover:border-blue-200 hover:bg-white transition-all duration-500 transform group-hover:-translate-y-2 relative z-10 w-full overflow-hidden">
                                            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-bl-full -mr-16 -mt-16 transition-transform duration-500 group-hover:scale-150"></div>
                                            <h3 className="text-2xl font-extrabold text-slate-900 mb-4 group-hover:text-blue-600 transition-colors">{t(`athens.layer${layer}_title`)}</h3>
                                            <p className="text-lg text-slate-600 leading-relaxed font-medium group-hover:text-slate-700 transition-colors">{t(`athens.layer${layer}_desc`)}</p>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Deep Tech Section (Hardware ESP32) */}
                <section id="deep-tech" className="py-32 relative z-10 overflow-hidden bg-slate-50">
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>
                    <div className="max-w-[1400px] mx-auto px-6 relative">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">

                            <motion.div
                                className="space-y-8 relative z-10"
                                initial={{ opacity: 0, x: -30 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                transition={{ type: "spring", stiffness: 100, damping: 20 }}
                            >
                                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 shadow-sm">
                                    <span className="text-[11px] font-mono text-indigo-600 font-bold uppercase tracking-wider">{t('hardware.chipset')}</span>
                                </div>
                                <h2 className="text-5xl font-bold tracking-tight text-slate-900">{t('hardware.title')}</h2>
                                <p className="text-slate-600 text-xl leading-relaxed font-medium">
                                    {t('hardware.description')}
                                </p>
                                <ul className="space-y-6 pt-6">
                                    <li className="flex items-center gap-5 text-base font-bold text-slate-800 border-b border-gray-200 pb-4">
                                        <span className="font-mono text-blue-700 w-24 bg-blue-50 py-1 px-2 rounded text-center text-sm border border-blue-100">AES-256</span>
                                        {t('hardware.aes')}
                                    </li>
                                    <li className="flex items-center gap-5 text-base font-bold text-slate-800 border-b border-gray-200 pb-4">
                                        <span className="font-mono text-blue-700 w-24 bg-blue-50 py-1 px-2 rounded text-center text-sm border border-blue-100">RSA-4096</span>
                                        {t('hardware.rsa')}
                                    </li>
                                </ul>
                            </motion.div>

                            <motion.div
                                className="relative group perspective-1000"
                                initial={{ opacity: 0, scale: 0.95 }}
                                whileInView={{ opacity: 1, scale: 1 }}
                                viewport={{ once: true }}
                                transition={{ type: "spring", stiffness: 100, damping: 20 }}
                            >
                                <div className="absolute -inset-4 bg-indigo-100/50 backdrop-blur-md rounded-[2.5rem] opacity-60 group-hover:opacity-100 transition duration-1000"></div>
                                <div className="relative border border-white bg-white/90 backdrop-blur-xl rounded-[2rem] overflow-hidden aspect-[4/3] p-10 flex flex-col justify-between shadow-[0_20px_50px_rgba(0,0,0,0.05)] ring-1 ring-slate-100 group-hover:border-blue-100 hover:shadow-[0_25px_60px_rgba(37,99,235,0.1)] transition-all">

                                    <div className="flex justify-between items-start z-10">
                                        <div className="w-16 h-16 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center shadow-sm">
                                            <span className="material-symbols-outlined text-slate-700 text-3xl">developer_board</span>
                                        </div>
                                        <div className="px-3 py-1.5 text-[10px] font-mono text-indigo-700 bg-indigo-50 border border-indigo-100 shadow-sm rounded flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                                            ESP32-S3 CORE
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-6 my-6 z-10">
                                        <div className="border border-dashed border-gray-300 rounded-lg p-4 bg-slate-50 flex flex-col items-center">
                                            <span className="text-[10px] font-mono uppercase text-slate-500 mb-2 font-bold tracking-wider text-center">{t('hardware.core_load_0')}</span>
                                            <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden mt-1 shadow-inner">
                                                <div className="h-full bg-blue-500 w-[65%] shadow-sm relative overflow-hidden">
                                                    <div className="absolute inset-0 bg-white/20 w-1/2 -skew-x-12 translate-x-[-100%] animate-[shimmer_2s_infinite]"></div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="border border-dashed border-gray-300 rounded-lg p-4 bg-slate-50 flex flex-col items-center">
                                            <span className="text-[10px] font-mono uppercase text-slate-500 mb-2 font-bold tracking-wider text-center">{t('hardware.core_load_1')}</span>
                                            <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden mt-1 shadow-inner">
                                                <div className="h-full bg-violet-500 w-[42%] shadow-sm relative overflow-hidden">
                                                    <div className="absolute inset-0 bg-white/20 w-1/2 -skew-x-12 translate-x-[-100%] animate-[shimmer_2s_infinite_0.5s]"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="border border-blue-100 rounded-xl p-4 flex items-center justify-between bg-blue-50 z-10">
                                        <div className="flex flex-col">
                                            <div className="text-[11px] font-mono font-bold text-blue-700 tracking-wide">{t('hardware.crypto_accel')}</div>
                                            <div className="text-[10px] text-slate-500 mt-0.5 font-medium">SHA-256 • Hardware TRNG</div>
                                        </div>
                                        <div className="w-4 h-4 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)] animate-ping"></div>
                                    </div>
                                </div>
                            </motion.div>
                        </div>
                    </div>
                </section>

                {/* CTA Map / Architecture Section */}
                <section id="architecture" className="py-32 relative z-10 border-t border-gray-200 bg-white">
                    <div className="max-w-[1400px] mx-auto px-6 relative z-10">
                        <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-8">
                            <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
                                <h2 className="text-4xl font-bold tracking-tight text-slate-900 mb-4">{t('infrastructure.title')}</h2>
                                <p className="text-slate-600 text-xl font-medium max-w-xl">{t('infrastructure.description')}</p>
                            </motion.div>
                            <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
                                <button onClick={() => navigate('/login')} className="bg-slate-900 hover:bg-blue-600 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-md flex items-center gap-2">
                                    {t('infrastructure.simulate_btn')} <span className="material-symbols-outlined text-[18px]">bolt</span>
                                </button>
                            </motion.div>
                        </div>

                        <motion.div
                            className="relative w-full aspect-[2.2/1] bg-slate-900 rounded-[2rem] border border-gray-200 overflow-hidden shadow-2xl group"
                            variants={fadeUpSpring}
                            initial="hidden"
                            whileInView="visible"
                            viewport={{ once: true }}
                        >
                            <img
                                src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1200&auto=format&fit=crop"
                                alt="Global Network Infrastructure"
                                className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:scale-105 group-hover:opacity-80 transition-all duration-1000 mix-blend-screen"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/50 to-transparent z-10 mix-blend-multiply"></div>

                            {/* Map Nodes */}
                            <div className="absolute top-[35%] left-[22%] group/node cursor-pointer z-30">
                                <div className="w-3 h-3 bg-blue-400 border-2 border-white rounded-full shadow-[0_0_15px_rgba(59,130,246,0.8)] z-20 relative animate-pulse"></div>
                                <div className="absolute top-8 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-white backdrop-blur-md border border-gray-200 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.15)] text-xs font-mono whitespace-nowrap opacity-0 group-hover/node:opacity-100 transition-opacity">
                                    <span className="font-bold text-slate-900">US-WEST</span> <span className="text-slate-500">(12ms)</span>
                                </div>
                            </div>
                            <div className="absolute top-[28%] left-[48%] group/node cursor-pointer z-30">
                                <div className="w-3 h-3 bg-blue-400 border-2 border-white rounded-full shadow-[0_0_15px_rgba(59,130,246,0.8)] z-20 relative animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                                <div className="absolute top-8 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-white backdrop-blur-md border border-gray-200 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.15)] text-xs font-mono whitespace-nowrap opacity-0 group-hover/node:opacity-100 transition-opacity">
                                    <span className="font-bold text-slate-900">EU-CENTRAL</span> <span className="text-slate-500">(24ms)</span>
                                </div>
                            </div>
                            <div className="absolute top-[40%] right-[22%] group/node cursor-pointer z-30">
                                <div className="w-3 h-3 bg-emerald-400 border-2 border-white rounded-full shadow-[0_0_15px_rgba(16,185,129,0.8)] z-20 relative animate-pulse" style={{ animationDelay: '0.8s' }}></div>
                                <div className="absolute top-8 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-white backdrop-blur-md border border-gray-200 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.15)] text-xs font-mono whitespace-nowrap opacity-0 group-hover/node:opacity-100 transition-opacity">
                                    <span className="font-bold text-slate-900">ASIA-PAC</span> <span className="text-slate-500">(45ms)</span>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </section>

                {/* Final Call To Action */}
                <section className="py-24 bg-white border-t border-gray-200 relative overflow-hidden">
                    <div className="absolute inset-0 bg-blue-50/50"></div>
                    <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
                        <motion.h2
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            className="text-4xl font-extrabold text-slate-900 mb-6"
                        >
                            {t('cta.title')}
                        </motion.h2>
                        <motion.p
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: 0.1 }}
                            className="text-xl text-slate-600 mb-10 font-medium"
                        >
                            {t('cta.desc')}
                        </motion.p>
                        <motion.button
                            initial={{ opacity: 0, scale: 0.95 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            viewport={{ once: true }}
                            transition={{ type: "spring", delay: 0.2 }}
                            onClick={() => navigate('/login')}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-10 py-5 rounded-2xl font-bold text-lg transition-all shadow-[0_10px_25px_rgba(37,99,235,0.3)] hover:shadow-[0_15px_30px_rgba(37,99,235,0.4)] hover:-translate-y-1"
                        >
                            {t('cta.btn')}
                        </motion.button>
                    </div>
                </section>
            </main>

            <footer className="bg-slate-50 border-t border-gray-200 py-12 text-sm relative z-10">
                <div className="max-w-[1400px] mx-auto px-6">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                        <div className="flex items-center gap-3">
                            <img src={logoImage} alt="AetherGuard Logo" className="h-8 w-8 object-contain opacity-90 grayscale hover:grayscale-0 transition-all duration-300 rounded-lg" />
                            <span className="font-extrabold text-slate-900 tracking-wide text-lg">AetherGuard</span>
                        </div>
                        <div className="text-slate-500 text-xs text-center md:text-left font-medium">
                            © 2026 Aether Studio. All rights reserved. Secure Cloud Architecture.
                        </div>
                        <div className="flex gap-6 text-slate-500 text-xs font-semibold">
                            <a href="/privacy" className="hover:text-blue-600 transition-colors">{t('landing.privacy')}</a>
                            <a href="#" className="hover:text-blue-600 transition-colors">{t('landing.terms')}</a>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Landing;
