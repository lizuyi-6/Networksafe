
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const Landing = () => {
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();

    const changeLanguage = (lng: string) => {
        i18n.changeLanguage(lng);
    };

    return (
        <div className="text-text-main overflow-x-hidden min-h-screen h-screen overflow-y-auto flex flex-col selection:bg-primary/20 selection:text-primary relative bg-concrete-bg font-sans">
            {/* Force Light Mode Override for this page as it uses specific colors */}
            <style>{`
                :root { color-scheme: light; }
                body { background-color: #E9ECEF !important; color: #212529 !important; }
                html { scroll-behavior: smooth; }
            `}</style>

            <div className="texture-overlay"></div>

            <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-0 overflow-hidden transform-gpu">
                <div className="shape-sphere -top-[10%] -right-[5%] w-[600px] h-[600px] opacity-40 mix-blend-multiply bg-gray-200 will-change-transform"></div>
                <div className="shape-cube bottom-[15%] -left-[5%] floating opacity-30 bg-gray-300 will-change-transform" style={{ animationDelay: '1s' }}></div>
                <div className="shape-cube top-[35%] right-[5%] floating w-[180px] h-[180px] opacity-40 mix-blend-overlay border-gray-400 will-change-transform" style={{ animationDelay: '2s', transform: 'rotateX(40deg) rotateZ(20deg)' }}></div>
            </div>

            <header className="fixed top-0 w-full z-50 border-b border-gray-200 shadow-sm transition-all duration-300 bg-white/95 backdrop-blur-md">
                <div className="max-w-[1400px] mx-auto px-6 h-20 flex items-center justify-between relative z-50">
                    <div className="flex items-center gap-3">
                        <div className="bg-gradient-to-br from-obsidian to-obsidian-light p-2 rounded-xl shadow-lg shadow-obsidian/20 border border-gray-500/20 ring-1 ring-black/5">
                            <span className="material-symbols-outlined text-primary text-xl">shield_lock</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="font-bold text-xl tracking-tight text-obsidian leading-none">FluxGuard</span>
                            <span className="text-[0.6rem] text-text-secondary font-medium tracking-wide uppercase mt-0.5">{t('footer.powered_by')}</span>
                        </div>
                    </div>
                    <nav className="hidden md:flex items-center gap-1 bg-surface-mid/30 px-2 py-1.5 rounded-full border border-white/40 shadow-inner backdrop-blur-md">
                        <a className="text-sm font-semibold text-text-secondary hover:text-obsidian hover:bg-surface-light px-5 py-2 rounded-full transition-all" href="#architecture">{t('nav.architecture')}</a>
                        <a className="text-sm font-semibold text-text-secondary hover:text-obsidian hover:bg-surface-light px-5 py-2 rounded-full transition-all" href="#defense">{t('nav.defense')}</a>
                        <a className="text-sm font-semibold text-text-secondary hover:text-obsidian hover:bg-surface-light px-5 py-2 rounded-full transition-all" href="#deep-tech">{t('nav.deep_tech')}</a>
                        <a className="text-sm font-semibold text-text-secondary hover:text-obsidian hover:bg-surface-light px-5 py-2 rounded-full transition-all" href="#pricing">{t('nav.pricing')}</a>
                    </nav>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center border border-gray-300 rounded-full bg-surface-light px-1 py-1">
                            <button
                                onClick={() => changeLanguage('en')}
                                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${i18n.language === 'en' ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-obsidian'}`}
                            >
                                EN
                            </button>
                            <button
                                onClick={() => changeLanguage('zh')}
                                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${i18n.language === 'zh' ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-obsidian'}`}
                            >
                                中文
                            </button>
                        </div>
                        <button onClick={() => navigate('/login')} className="text-sm font-bold text-text-secondary hover:text-primary transition-colors">{t('nav.login')}</button>
                        <button onClick={() => navigate('/login')} className="bg-obsidian hover:bg-black text-white text-sm font-bold px-6 py-2.5 rounded-full transition-all shadow-lg hover:shadow-2xl hover:-translate-y-0.5 border border-white/10 ring-1 ring-white/10">{t('nav.get_started')}</button>
                    </div>
                </div>
            </header>

            <main className="pt-20 relative z-10">
                <section className="relative min-h-[90vh] flex items-center overflow-visible">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#E9ECEF] via-[#DEE2E6] to-[#CED4DA] z-0 opacity-60"></div>
                    <div className="max-w-[1400px] mx-auto w-full px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center relative z-10 py-24">
                        <div className="space-y-10 pr-8 relative z-20">
                            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-300 bg-surface-light/80 backdrop-blur-xl shadow-sm ring-1 ring-black/5">
                                <span className="relative flex h-2.5 w-2.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary shadow-sm"></span>
                                </span>
                                <span className="text-[11px] font-bold tracking-wide uppercase text-obsidian">{t('hero.system_active')}</span>
                            </div>
                            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] text-obsidian drop-shadow-sm">
                                {t('hero.title_prefix')}<br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-obsidian via-text-secondary to-obsidian" style={{ textShadow: '0px 2px 4px rgba(0,0,0,0.05)' }}>{t('hero.title_highlight')}</span>
                            </h1>
                            <p className="text-xl text-text-secondary max-w-lg font-medium leading-relaxed">
                                {t('hero.description')}
                            </p>
                            <div className="flex flex-wrap items-center gap-4 pt-4">
                                <button onClick={() => navigate('/login')} className="bg-primary hover:bg-primary-dark text-white px-8 py-4 rounded-2xl font-semibold text-sm transition-all flex items-center gap-3 shadow-[0_10px_20px_rgba(67,97,238,0.3)] hover:shadow-[0_15px_30px_rgba(67,97,238,0.4)] hover:-translate-y-1 border-t border-white/20">
                                    {t('hero.deploy_system')}
                                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                                </button>
                                <button className="text-obsidian bg-surface-light hover:bg-white px-8 py-4 font-semibold text-sm transition-all flex items-center gap-2 border border-gray-300 rounded-2xl shadow-sm hover:shadow-lg backdrop-blur-md">
                                    {t('hero.view_specs')}
                                </button>
                            </div>
                        </div>
                        <div className="relative h-[650px] w-full lg:w-[115%] perspective-1000 z-10 lg:-mr-[15%]">
                            <div className="relative w-full h-full transform transition-transform duration-700 hover:rotate-y-[-2deg] hover:rotate-x-[2deg] will-change-transform">
                                <div className="absolute inset-4 bg-black/30 rounded-[2.5rem] get-gpu-layer blur-2xl transform translate-y-8 translate-x-4"></div>
                                <div className="absolute inset-0 rounded-[2rem] overflow-hidden shadow-deep border border-gray-400 bg-gradient-to-br from-[#F8F9FA] to-[#DEE2E6] z-10 ring-1 ring-white/20">
                                    <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent z-20 pointer-events-none mix-blend-overlay"></div>
                                    <div className="relative h-full w-full overflow-hidden bg-gray-100">
                                        <div className="absolute inset-0 bg-gradient-to-tr from-white/10 via-transparent to-transparent z-30 pointer-events-none"></div>
                                        <img alt="Server Hardware" className="w-full h-full object-cover mix-blend-luminosity opacity-90 filter contrast-125 brightness-95 grayscale" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAccNeTJCOVIFy_084_iYgRB4UeIFYahezs73z7Oz1kcXffuKolp-ghctKnhUVwyoOsS3DRhxN5qpSB6oKreCghBqrKv8CVugmIYNvk0LSf-SeaX-k4HxEjsT5cziQ3uR_ckCLFJXGdfe0s5cLGqPWi3YJT6UrXoIjCttgUxbmH79v3NaccnSIMhNokb8lWi8ObhQPHqHZcQAdknjVTW0Ovqnt2HgCID_gB2eEKvN5rI8TCjWxOIuJJ8h_DwVxbJhgEjpSu5MvmoC5g" />
                                    </div>
                                    <div className="absolute bottom-10 left-10 right-10 glass-heavy p-5 rounded-2xl flex items-center gap-5 z-30 border-t border-white/60 shadow-[0_10px_30px_rgba(0,0,0,0.15)] bg-[#F8F9FA]/80">
                                        <div className="h-12 w-12 bg-gradient-to-br from-gray-100 to-white rounded-full flex items-center justify-center border border-gray-200 shadow-inner">
                                            <span className="material-symbols-outlined text-primary text-2xl drop-shadow-sm">verified_user</span>
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-obsidian uppercase tracking-wider mb-0.5">System Status Normal</div>
                                            <div className="flex items-center gap-3 text-xs font-mono text-text-secondary">
                                                <span className="px-1.5 py-0.5 bg-gray-200 rounded border border-gray-300 text-obsidian font-bold">OK</span>
                                                <span>Latency: 0.4ms</span>
                                                <span className="w-1 h-1 rounded-full bg-gray-400"></span>
                                                <span>Uptime: 99.999%</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section id="defense" className="py-32 relative z-10">
                    <div className="absolute inset-0 bg-surface-mid/30 transform -skew-y-3 origin-top-left scale-110 border-t border-b border-white/20 shadow-inner z-0"></div>
                    <div className="max-w-[1400px] mx-auto px-6 relative z-10">
                        <div className="mb-20 text-center md:text-left">
                            <h2 className="text-4xl font-bold tracking-tight mb-6 text-obsidian">{t('features.title')}</h2>
                            <p className="text-text-secondary text-xl font-medium max-w-2xl leading-relaxed">{t('features.description')}</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                            <div className="bg-surface-light p-10 rounded-3xl shadow-soft border border-gray-200 hover:transform hover:-translate-y-3 hover:shadow-deep transition-all duration-500 group relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-primary/10 to-transparent rounded-bl-full -mr-8 -mt-8 transition-all group-hover:scale-110"></div>
                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-white to-[#F0F2F5] flex items-center justify-center mb-8 shadow-[0_4px_10px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] border border-gray-200 group-hover:scale-110 transition-transform duration-300">
                                    <span className="material-symbols-outlined text-primary text-3xl drop-shadow-sm">shield</span>
                                </div>
                                <h3 className="text-2xl font-bold text-obsidian mb-4">{t('features.antibot.title')}</h3>
                                <p className="text-base text-text-secondary leading-relaxed font-medium">
                                    {t('features.antibot.desc')}
                                </p>
                            </div>
                            <div className="bg-surface-light p-10 rounded-3xl shadow-soft border border-gray-200 hover:transform hover:-translate-y-3 hover:shadow-deep transition-all duration-500 group relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-primary/10 to-transparent rounded-bl-full -mr-8 -mt-8 transition-all group-hover:scale-110"></div>
                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-white to-[#F0F2F5] flex items-center justify-center mb-8 shadow-[0_4px_10px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] border border-gray-200 group-hover:scale-110 transition-transform duration-300">
                                    <span className="material-symbols-outlined text-primary text-3xl drop-shadow-sm">memory</span>
                                </div>
                                <h3 className="text-2xl font-bold text-obsidian mb-4">{t('features.neural.title')}</h3>
                                <p className="text-base text-text-secondary leading-relaxed font-medium">
                                    {t('features.neural.desc')}
                                </p>
                            </div>
                            <div className="bg-surface-light p-10 rounded-3xl shadow-soft border border-gray-200 hover:transform hover:-translate-y-3 hover:shadow-deep transition-all duration-500 group relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-primary/10 to-transparent rounded-bl-full -mr-8 -mt-8 transition-all group-hover:scale-110"></div>
                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-white to-[#F0F2F5] flex items-center justify-center mb-8 shadow-[0_4px_10px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] border border-gray-200 group-hover:scale-110 transition-transform duration-300">
                                    <span className="material-symbols-outlined text-primary text-3xl drop-shadow-sm">toggle_on</span>
                                </div>
                                <h3 className="text-2xl font-bold text-obsidian mb-4">{t('features.breaker.title')}</h3>
                                <p className="text-base text-text-secondary leading-relaxed font-medium">
                                    {t('features.breaker.desc')}
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                <section id="deep-tech" className="py-32 relative z-10 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#CED4DA]/20 z-0"></div>
                    <div className="max-w-[1400px] mx-auto px-6 relative">
                        <div className="absolute -right-40 top-0 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[100px] mix-blend-multiply"></div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
                            <div className="space-y-8 relative z-10">
                                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/10 shadow-sm backdrop-blur-sm">
                                    <span className="text-[11px] font-mono text-primary font-bold uppercase tracking-wider">{t('hardware.chipset')}</span>
                                </div>
                                <h2 className="text-5xl font-bold tracking-tight text-obsidian">{t('hardware.title')}</h2>
                                <p className="text-text-secondary text-xl leading-relaxed font-medium">
                                    {t('hardware.description')}
                                </p>
                                <ul className="space-y-6 pt-6">
                                    <li className="flex items-center gap-5 text-base font-semibold text-text-main border-b border-black/10 pb-4">
                                        <span className="font-mono text-primary w-24 bg-primary/10 py-1 px-2 rounded text-center text-sm border border-primary/20">AES-256</span>
                                        {t('hardware.aes')}
                                    </li>
                                    <li className="flex items-center gap-5 text-base font-semibold text-text-main border-b border-black/10 pb-4">
                                        <span className="font-mono text-primary w-24 bg-primary/10 py-1 px-2 rounded text-center text-sm border border-primary/20">RSA-4096</span>
                                        {t('hardware.rsa')}
                                    </li>
                                    <li className="flex items-center gap-5 text-base font-semibold text-text-main border-b border-black/10 pb-4">
                                        <span className="font-mono text-primary w-24 bg-primary/10 py-1 px-2 rounded text-center text-sm border border-primary/20">TRNG</span>
                                        {t('hardware.trng')}
                                    </li>
                                </ul>
                            </div>
                            <div className="relative group perspective-1000">
                                <div className="absolute -inset-4 bg-gradient-to-r from-gray-900/10 to-blue-900/10 rounded-[2.5rem] blur-2xl opacity-60 group-hover:opacity-80 transition duration-1000"></div>
                                <div className="relative glass-heavy rounded-[2rem] overflow-hidden aspect-[4/3] blueprint-grid flex items-center justify-center p-10 transform transition-transform duration-700 hover:scale-[1.02] border border-gray-300 bg-surface-light/50">
                                    <div className="absolute top-6 left-6 w-4 h-4 rounded-full bg-gradient-to-b from-gray-200 to-gray-400 shadow-[0_2px_4px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.8)] border border-gray-400">
                                        <div className="w-full h-[1px] bg-gray-500 absolute top-1/2 left-0 transform -translate-y-1/2 rotate-45 opacity-60"></div>
                                    </div>
                                    <div className="absolute top-6 right-6 w-4 h-4 rounded-full bg-gradient-to-b from-gray-200 to-gray-400 shadow-[0_2px_4px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.8)] border border-gray-400">
                                        <div className="w-full h-[1px] bg-gray-500 absolute top-1/2 left-0 transform -translate-y-1/2 -rotate-45 opacity-60"></div>
                                    </div>
                                    <div className="absolute bottom-6 left-6 w-4 h-4 rounded-full bg-gradient-to-b from-gray-200 to-gray-400 shadow-[0_2px_4px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.8)] border border-gray-400">
                                        <div className="w-full h-[1px] bg-gray-500 absolute top-1/2 left-0 transform -translate-y-1/2 rotate-12 opacity-60"></div>
                                    </div>
                                    <div className="absolute bottom-6 right-6 w-4 h-4 rounded-full bg-gradient-to-b from-gray-200 to-gray-400 shadow-[0_2px_4px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.8)] border border-gray-400">
                                        <div className="w-full h-[1px] bg-gray-500 absolute top-1/2 left-0 transform -translate-y-1/2 -rotate-12 opacity-60"></div>
                                    </div>
                                    <div className="relative w-full h-full border border-gray-300 rounded-2xl bg-surface-light/90 shadow-[0_20px_50px_rgba(0,0,0,0.08)] backdrop-blur-xl p-8 flex flex-col justify-between ring-1 ring-white/60">
                                        <div className="flex justify-between items-start">
                                            <div className="w-16 h-16 bg-gradient-to-br from-gray-100 to-gray-300 rounded-xl flex items-center justify-center shadow-md border border-white">
                                                <span className="material-symbols-outlined text-gray-700 text-3xl">developer_board</span>
                                            </div>
                                            <div className="px-3 py-1.5 text-[10px] font-mono text-primary font-bold bg-primary/10 rounded border border-primary/20 shadow-sm">ESP32-S3-WROOM</div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-6 my-6">
                                            <div className="border border-dashed border-gray-400 rounded-lg p-4 flex flex-col items-center justify-center bg-gray-50/40">
                                                <span className="text-[10px] font-mono uppercase text-gray-600 mb-2 font-bold tracking-wider">{t('hardware.core_load_0')}</span>
                                                <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden shadow-inner">
                                                    <div className="h-full bg-gradient-to-r from-primary to-primary-dark w-[80%] shadow-[0_0_10px_rgba(67,97,238,0.4)]"></div>
                                                </div>
                                            </div>
                                            <div className="border border-dashed border-gray-400 rounded-lg p-4 flex flex-col items-center justify-center bg-gray-50/40">
                                                <span className="text-[10px] font-mono uppercase text-gray-600 mb-2 font-bold tracking-wider">{t('hardware.core_load_1')}</span>
                                                <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden shadow-inner">
                                                    <div className="h-full bg-gradient-to-r from-primary to-primary-dark w-[30%] shadow-[0_0_10px_rgba(67,97,238,0.4)]"></div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="border border-primary/20 rounded-xl p-4 flex items-center justify-between bg-gradient-to-r from-blue-50/20 to-white/40 backdrop-blur-sm shadow-sm">
                                            <div className="flex flex-col">
                                                <div className="text-[11px] font-mono font-bold text-primary tracking-wide">{t('hardware.crypto_accel')}</div>
                                                <div className="text-[10px] text-text-secondary mt-0.5">SHA-256 • AES • RSA</div>
                                            </div>
                                            <div className="w-4 h-4 rounded-full bg-primary shadow-[0_0_15px_rgba(67,97,238,0.8)] animate-pulse ring-4 ring-primary/10"></div>
                                        </div>
                                    </div>
                                    <div className="absolute top-[6%] left-[10%] w-[80%] flex justify-center opacity-70">
                                        <div className="h-px bg-text-secondary w-full relative top-2.5"></div>
                                        <span className="bg-surface-light px-2 text-[10px] font-mono text-text-secondary relative z-10 border border-gray-300 rounded shadow-sm">18.00 mm</span>
                                    </div>
                                    <div className="absolute right-[3%] top-[15%] h-[70%] flex flex-col justify-center items-center opacity-70">
                                        <div className="w-px bg-text-secondary h-full relative left-[0.6rem]"></div>
                                        <span className="bg-surface-light py-1 px-1 text-[10px] font-mono text-text-secondary relative z-10 rotate-90 whitespace-nowrap border border-gray-300 rounded shadow-sm">25.50 mm</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section id="architecture" className="py-32 relative z-10">
                    <div className="absolute inset-x-0 top-10 bottom-0 bg-surface-mid/30 shadow-[0_-20px_60px_rgba(0,0,0,0.03)] backdrop-blur-md z-0 skew-y-1 transform origin-bottom-right border-t border-white/20"></div>
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#CED4DA]/20 z-0 pointer-events-none"></div>
                    <div className="max-w-[1400px] mx-auto px-6 relative z-10">
                        <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-8">
                            <div>
                                <h2 className="text-4xl font-bold tracking-tight text-obsidian mb-4">{t('infrastructure.title')}</h2>
                                <p className="text-text-secondary text-xl font-medium max-w-xl">{t('infrastructure.description')}</p>
                            </div>
                            <div className="flex items-center gap-6 text-sm font-semibold text-text-secondary bg-surface-light px-6 py-3 rounded-xl border border-gray-300 shadow-lg backdrop-blur-sm">
                                <div className="flex items-center gap-2.5">
                                    <span className="relative flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-primary border border-white"></span>
                                    </span>
                                    {t('infrastructure.operational')}
                                </div>
                                <div className="h-4 w-px bg-gray-400"></div>
                                <div className="flex items-center gap-2.5">
                                    <span className="w-3 h-3 rounded-full bg-gray-400 shadow-inner border border-gray-500"></span>
                                    {t('infrastructure.maintenance')}
                                </div>
                            </div>
                        </div>
                        <div className="relative w-full aspect-[2.2/1] bg-black rounded-[2rem] border border-gray-300 overflow-hidden shadow-[inset_0_2px_10px_rgba(0,0,0,0.05),0_20px_40px_-10px_rgba(0,0,0,0.1)] group">
                            <img
                                src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1200&auto=format&fit=crop"
                                alt="Global Network Infrastructure"
                                className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-700"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10"></div>

                            {/* Overlay Nodes */}
                            <div className="absolute top-[35%] left-[22%] group cursor-pointer z-30">
                                <div className="w-4 h-4 bg-primary border-2 border-white rounded-full shadow-[0_0_20px_rgba(67,97,238,0.8)] z-20 relative animate-pulse"></div>
                                <div className="absolute top-10 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/80 backdrop-blur-md border border-white/10 shadow-2xl rounded-lg text-xs font-mono text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0 z-50">
                                    <span className="font-bold text-primary-light block mb-0.5">US-WEST</span><span className="text-gray-300">Latency: 12ms</span>
                                </div>
                            </div>
                            <div className="absolute top-[28%] left-[48%] group cursor-pointer z-30">
                                <div className="w-4 h-4 bg-primary border-2 border-white rounded-full shadow-[0_0_20px_rgba(67,97,238,0.8)] z-20 relative animate-pulse" style={{ animationDelay: '0.5s' }}></div>
                                <div className="absolute top-10 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/80 backdrop-blur-md border border-white/10 shadow-2xl rounded-lg text-xs font-mono text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0 z-50">
                                    <span className="font-bold text-primary-light block mb-0.5">EU-CENTRAL</span><span className="text-gray-300">Latency: 24ms</span>
                                </div>
                            </div>
                            <div className="absolute top-[40%] right-[22%] group cursor-pointer z-30">
                                <div className="w-4 h-4 bg-primary border-2 border-white rounded-full shadow-[0_0_20px_rgba(67,97,238,0.8)] z-20 relative animate-pulse" style={{ animationDelay: '1s' }}></div>
                                <div className="absolute top-10 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/80 backdrop-blur-md border border-white/10 shadow-2xl rounded-lg text-xs font-mono text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0 z-50">
                                    <span className="font-bold text-primary-light block mb-0.5">ASIA-PAC</span><span className="text-gray-300">Latency: 45ms</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="py-32 relative z-10 overflow-visible">
                    <div className="max-w-[1400px] mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
                        <div className="order-2 lg:order-1 relative perspective-1000">
                            <div className="shape-sphere -left-20 top-0 w-80 h-80 opacity-20 mix-blend-multiply blur-xl bg-gray-400"></div>
                            <div className="rounded-[2rem] overflow-hidden shadow-deep border border-gray-300 bg-surface-light transform hover:rotate-y-3 hover:rotate-x-2 transition-transform duration-700 relative z-10 group">
                                <img alt="Interface" className="w-full h-auto object-cover opacity-100 group-hover:scale-105 transition-transform duration-700 grayscale contrast-125" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDjfyfMsNDoTUgVhaj7YvAOQbKYlvvM7OZF6-eOoEuQTuzP7G-ptu-3OVL-GVzrFdmi-vxgTUPfnMBVaq7wSXXUh-3edY8m2tLaFaGY3A78ofSdYP6FjNZA_xam2_KfSZXGyVBRvn0VsNuwc99EBtYBe-iHnVpeo7b_L18edzkev8CbQoQOHg7MTs7q1CCCSnIK2evo2owfNjsh8Mc-M-W_1DAVfkwzzWBrz_6zhL4E0XpkZtQ3yfGVbWM2kOhhDfLUQ5iNemOBKkVl" />
                                <div className="absolute inset-0 bg-gradient-to-tr from-surface-light/20 to-transparent pointer-events-none"></div>
                                <div className="absolute bottom-6 left-6 right-6 glass-panel p-6 rounded-2xl shadow-lg flex justify-between items-center z-20 border-t border-white/60 bg-surface-light/80">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold mb-1.5">{t('dashboard.system_status')}</p>
                                        <p className="text-sm font-mono text-primary font-bold flex items-center gap-2">
                                            <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)] animate-pulse"></span>
                                            {t('dashboard.nominal')}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold mb-1.5">{t('dashboard.throughput')}</p>
                                        <p className="text-sm font-mono text-obsidian font-bold">45.2 TB/s <span className="text-green-600 text-xs ml-1">▲</span></p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="order-1 lg:order-2 space-y-8 relative z-10">
                            <h2 className="text-4xl font-bold tracking-tight text-obsidian">{t('dashboard.precision_control')}</h2>
                            <p className="text-text-secondary text-xl leading-relaxed font-medium">
                                {t('dashboard.description')}
                            </p>
                            <div className="space-y-6 pt-6 border-t border-black/10">
                                <div className="flex items-start gap-5 pt-2 group cursor-default">
                                    <div className="p-3.5 rounded-2xl bg-surface-light shadow-sm border border-gray-300 group-hover:bg-primary/5 transition-colors duration-300">
                                        <span className="material-symbols-outlined text-text-secondary group-hover:text-primary transition-colors text-2xl">analytics</span>
                                    </div>
                                    <div>
                                        <h4 className="text-lg font-bold text-obsidian group-hover:text-primary transition-colors">{t('dashboard.visualization')}</h4>
                                        <p className="text-base text-text-secondary mt-1 font-medium">{t('dashboard.vis_desc')}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-5 pt-2 group cursor-default">
                                    <div className="p-3.5 rounded-2xl bg-surface-light shadow-sm border border-gray-300 group-hover:bg-primary/5 transition-colors duration-300">
                                        <span className="material-symbols-outlined text-text-secondary group-hover:text-primary transition-colors text-2xl">history</span>
                                    </div>
                                    <div>
                                        <h4 className="text-lg font-bold text-obsidian group-hover:text-primary transition-colors">{t('dashboard.history')}</h4>
                                        <p className="text-base text-text-secondary mt-1 font-medium">{t('dashboard.history_desc')}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section id="pricing" className="py-32 bg-gradient-to-t from-surface-light to-concrete-bg relative z-10 border-t border-white/30 shadow-[0_-30px_60px_rgba(0,0,0,0.03)]">
                    <div className="max-w-[1400px] mx-auto px-6">
                        <div className="text-center mb-20">
                            <h2 className="text-4xl font-bold tracking-tight text-obsidian">{t('pricing.title')}</h2>
                            <p className="text-text-secondary mt-4 text-xl font-medium">{t('pricing.description')}</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
                            <div className="border border-gray-300 rounded-3xl p-10 bg-surface-light/60 backdrop-blur-lg shadow-soft flex flex-col justify-between hover:bg-surface-light hover:shadow-deep hover:border-gray-400 transition-all duration-300">
                                <div>
                                    <h3 className="font-bold text-2xl text-obsidian">{t('pricing.sentry')}</h3>
                                    <div className="mt-6 flex items-baseline gap-1">
                                        <span className="text-4xl font-bold text-obsidian tracking-tight">$499</span>
                                        <span className="text-text-secondary text-sm font-medium">{t('pricing.mo')}</span>
                                    </div>
                                    <ul className="mt-8 space-y-4">
                                        <li className="text-sm text-text-secondary flex items-center gap-3 font-medium">
                                            <span className="material-symbols-outlined text-lg text-green-600">check_circle</span> {t('pricing.software_firewall')}
                                        </li>
                                        <li className="text-sm text-text-secondary flex items-center gap-3 font-medium">
                                            <span className="material-symbols-outlined text-lg text-green-600">check_circle</span> {t('pricing.basic_antibot')}
                                        </li>
                                        <li className="text-sm text-text-secondary flex items-center gap-3 font-medium opacity-50">
                                            <span className="material-symbols-outlined text-lg">cancel</span> {t('pricing.hardware_key')}
                                        </li>
                                    </ul>
                                </div>
                                <button onClick={() => navigate('/login')} className="mt-10 w-full py-4 rounded-xl border border-divider text-sm font-bold text-obsidian hover:bg-white hover:shadow-md transition-all">{t('pricing.configure')}</button>
                            </div>
                            <div className="border border-primary/20 rounded-3xl p-10 bg-surface-light shadow-glow relative flex flex-col justify-between transform -translate-y-6 hover:-translate-y-8 transition-all duration-300 ring-1 ring-primary/10 z-10">
                                <div className="absolute top-0 right-0 p-5">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-white bg-primary px-3 py-1.5 rounded-full shadow-lg shadow-primary/30">{t('pricing.recommended')}</span>
                                </div>
                                <div>
                                    <h3 className="font-bold text-2xl text-obsidian flex items-center gap-2">
                                        {t('pricing.guardian')}
                                        <span className="flex h-2.5 w-2.5 relative">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
                                        </span>
                                    </h3>
                                    <div className="mt-6 flex items-baseline gap-1">
                                        <span className="text-5xl font-bold text-obsidian tracking-tight">$999</span>
                                        <span className="text-text-secondary text-sm font-medium">{t('pricing.mo')}</span>
                                    </div>
                                    <ul className="mt-10 space-y-4">
                                        <li className="text-sm text-obsidian flex items-center gap-3 font-bold">
                                            <span className="material-symbols-outlined text-lg text-primary fill-current">verified</span> {t('pricing.hardware_root_trust')}
                                        </li>
                                        <li className="text-sm text-obsidian flex items-center gap-3 font-bold">
                                            <span className="material-symbols-outlined text-lg text-primary fill-current">verified</span> {t('pricing.advanced_ai')}
                                        </li>
                                        <li className="text-sm text-obsidian flex items-center gap-3 font-bold">
                                            <span className="material-symbols-outlined text-lg text-primary fill-current">verified</span> {t('pricing.priority_support')}
                                        </li>
                                    </ul>
                                </div>
                                <button onClick={() => navigate('/login')} className="mt-10 w-full py-4 rounded-xl bg-primary text-sm font-bold text-white hover:bg-primary-dark transition-all shadow-lg shadow-blue-500/30 hover:shadow-blue-500/40">{t('pricing.deploy_now')}</button>
                            </div>
                            <div className="border border-gray-300 rounded-3xl p-10 bg-surface-light/60 backdrop-blur-lg shadow-soft flex flex-col justify-between hover:bg-surface-light hover:shadow-deep hover:border-gray-400 transition-all duration-300">
                                <div>
                                    <h3 className="font-bold text-2xl text-obsidian">{t('pricing.monolith')}</h3>
                                    <div className="mt-6 flex items-baseline gap-1">
                                        <span className="text-4xl font-bold text-obsidian tracking-tight">{t('pricing.custom')}</span>
                                    </div>
                                    <ul className="mt-8 space-y-4">
                                        <li className="text-sm text-text-secondary flex items-center gap-3 font-medium">
                                            <span className="material-symbols-outlined text-lg text-green-600">check_circle</span> {t('pricing.dedicated_cluster')}
                                        </li>
                                        <li className="text-sm text-text-secondary flex items-center gap-3 font-medium">
                                            <span className="material-symbols-outlined text-lg text-green-600">check_circle</span> {t('pricing.physical_breaker')}
                                        </li>
                                        <li className="text-sm text-text-secondary flex items-center gap-3 font-medium">
                                            <span className="material-symbols-outlined text-lg text-green-600">check_circle</span> {t('pricing.on_premise')}
                                        </li>
                                    </ul>
                                </div>
                                <button onClick={() => navigate('/login')} className="mt-10 w-full py-4 rounded-xl border border-divider text-sm font-bold text-obsidian hover:bg-white hover:shadow-md transition-all">{t('pricing.contact_sales')}</button>
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="bg-surface-mid border-t border-white/20 py-20 text-sm relative z-10 shadow-[inset_0_10px_30px_rgba(0,0,0,0.03)]">
                <div className="max-w-[1400px] mx-auto px-6">
                    <div className="flex flex-col md:flex-row justify-between gap-16">
                        <div className="max-w-xs">
                            <div className="flex items-center gap-3 mb-6">
                                <span className="material-symbols-outlined text-primary text-3xl">shield_lock</span>
                                <span className="font-bold text-xl text-obsidian">FluxGuard</span>
                            </div>
                            <p className="text-text-secondary leading-relaxed font-medium">
                                {t('footer.copyright')} <br />
                                {t('footer.engineered')}
                            </p>
                        </div>
                        <div className="flex gap-20 flex-wrap">
                            <div>
                                <h4 className="font-bold text-obsidian mb-6 text-base">{t('footer.product')}</h4>
                                <ul className="space-y-3 text-text-secondary font-medium">
                                    <li><a className="hover:text-primary transition-colors" href="#">{t('footer.features')}</a></li>
                                    <li><a className="hover:text-primary transition-colors" href="#">{t('footer.security')}</a></li>
                                    <li><a className="hover:text-primary transition-colors" href="#">{t('footer.hardware')}</a></li>
                                    <li><a className="hover:text-primary transition-colors" href="#">{t('footer.enterprise')}</a></li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="font-bold text-obsidian mb-6 text-base">{t('footer.company')}</h4>
                                <ul className="space-y-3 text-text-secondary font-medium">
                                    <li><a className="hover:text-primary transition-colors" href="#">{t('footer.about')}</a></li>
                                    <li><a className="hover:text-primary transition-colors" href="#">{t('footer.careers')}</a></li>
                                    <li><a className="hover:text-primary transition-colors" href="#">{t('footer.legal')}</a></li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="font-bold text-obsidian mb-6 text-base">{t('footer.support')}</h4>
                                <ul className="space-y-3 text-text-secondary font-medium">
                                    <li><a className="hover:text-primary transition-colors" href="#">{t('footer.help_center')}</a></li>
                                    <li><a className="hover:text-primary transition-colors" href="#">{t('footer.api_status')}</a></li>
                                    <li><a className="hover:text-primary transition-colors" href="#">{t('footer.contact')}</a></li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <div className="mt-20 pt-8 border-t border-black/10 flex flex-col md:flex-row justify-between items-center text-xs text-text-secondary font-medium">
                        <p>{t('footer.all_rights')}</p>
                        <div className="flex gap-8 mt-4 md:mt-0">
                            <a className="hover:text-obsidian" href="#">{t('footer.privacy')}</a>
                            <a className="hover:text-obsidian" href="#">{t('footer.terms')}</a>
                            <a className="hover:text-obsidian" href="#">{t('footer.sales')}</a>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Landing;
