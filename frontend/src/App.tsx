import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    Activity,
    Settings,
    Key,
    Server,
    Shield,
    Bell,
    FileText,
    Rocket
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Context
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { DemoProvider, useDemo } from './context/DemoContext';

// Pages
import Dashboard from './pages/Dashboard';
import Sites from './pages/Sites';
import DeploymentWizard from './pages/DeploymentWizard';
import Scanner from './pages/Scanner';
import FixHistory from './pages/FixHistory';
import SettingsPage from './pages/Settings';
import SuperAdmin from './pages/SuperAdmin';
import Alerts from './pages/Alerts';

const Sidebar = () => {
    const location = useLocation();
    const { t } = useLanguage();

    const navGroups = [
        {
            title: t('nav.platform'),
            items: [
                { icon: LayoutDashboard, label: t('nav.dashboard'), path: '/' },
                { icon: Server, label: t('nav.sites'), path: '/sites' },
                { icon: Rocket, label: t('nav.deployment'), path: '/deploy' },
                { icon: Activity, label: t('nav.monitoring'), path: '/scanner' },
                { icon: Settings, label: t('nav.settings'), path: '/settings' },
                { icon: Key, label: t('nav.keys'), path: '/admin' },
            ]
        },
        {
            title: t('nav.governance'),
            items: [
                { icon: FileText, label: t('nav.audit'), path: '/history' },
                { icon: Bell, label: t('nav.alerts'), path: '/alerts', badge: 3 },
            ]
        }
    ];

    return (
        <aside className="w-64 border-r border-border flex flex-col justify-between bg-surface/50 backdrop-blur-xl z-20 hidden md:flex">
            <div>
                {/* Logo */}
                <div className="h-16 flex items-center px-6 border-b border-border/50">
                    <div className="flex items-center gap-2 text-zinc-100 font-medium tracking-tight text-sm">
                        <div className="w-6 h-6 rounded bg-gradient-to-br from-zinc-100 to-zinc-500 flex items-center justify-center text-black">
                            <Shield size={14} fill="currentColor" />
                        </div>
                        FLUXGUARD
                    </div>
                </div>

                {/* Nav Links */}
                <nav className="p-3 space-y-4">
                    {navGroups.map((group, idx) => (
                        <div key={idx}>
                            <div className="px-3 py-2 text-xxs font-medium tracking-wider text-zinc-500 uppercase">{group.title}</div>
                            <div className="space-y-0.5">
                                {group.items.map((item: any) => {
                                    const isActive = location.pathname === item.path;
                                    return (
                                        <Link
                                            key={item.path}
                                            to={item.path}
                                            className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors group ${isActive
                                                ? 'text-zinc-100 bg-white/5 border border-white/5 shadow-sm'
                                                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                                                }`}
                                        >
                                            <item.icon
                                                size={18}
                                                strokeWidth={1.5}
                                                className={isActive ? 'text-indigo-400' : 'group-hover:text-zinc-300'}
                                            />
                                            <span className="font-normal">{item.label}</span>
                                            {item.label === 'Monitoring' && (
                                                <span className="ml-auto flex h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
                                            )}
                                            {item.badge && (
                                                <span className="ml-auto text-xxs bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded border border-red-500/20">{item.badge}</span>
                                            )}
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </nav>
            </div>

            <div className="p-4 border-t border-border/50">
                <a href="#" className="flex items-center gap-3 px-2 py-2 text-sm hover:text-zinc-200 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 font-medium text-xs">
                        JD
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-medium text-zinc-200">John Doe</span>
                        <span className="text-xxs text-zinc-500">Admin</span>
                    </div>
                    <Settings size={18} className="ml-auto hover:rotate-90 transition-transform duration-500 text-zinc-500 hover:text-zinc-300" />
                </a>
            </div>
        </aside>
    );
}

const Header = () => {
    const { t, language, toggleLanguage } = useLanguage();
    const { isDemoMode, toggleDemoMode } = useDemo();

    return (
        <header className="h-16 border-b border-border/50 flex items-center justify-between px-6 bg-background/80 backdrop-blur-md z-10 sticky top-0">
            <div className="flex items-center gap-4 text-sm text-zinc-500">
                <span className="hover:text-zinc-300 cursor-pointer transition-colors">{t('header.overview')}</span>
                <span className="text-zinc-700">/</span>
                <span className="text-zinc-200 font-medium">{t('nav.dashboard')}</span>
            </div>

            <div className="flex items-center gap-4">
                {/* Status Indicator */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/5 border border-emerald-500/10">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className="text-xs font-medium text-emerald-500 tracking-tight">{t('header.system_healthy')}</span>
                </div>

                <div className="h-8 w-px bg-border"></div>

                {/* Demo Mode Toggle */}
                <div onClick={toggleDemoMode} className="flex items-center gap-2 cursor-pointer group">
                    <span className={`text-xs font-medium transition-colors ${isDemoMode ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-zinc-300'}`}>Demo</span>
                    <div className={`w-8 h-4 rounded-full relative transition-colors ${isDemoMode ? 'bg-indigo-500/20 border-indigo-500/50' : 'bg-zinc-800 border-zinc-700'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-all ${isDemoMode ? 'right-0.5 bg-indigo-400' : 'left-0.5 bg-zinc-500'}`}></div>
                    </div>
                </div>

                <div className="h-8 w-px bg-border"></div>

                {/* Language Toggle */}
                {/* Language Toggle Switch */}
                <div onClick={toggleLanguage} className="flex items-center gap-2 cursor-pointer group">
                    <span className={`text-xs font-medium transition-colors ${language === 'zh' ? 'text-zinc-500' : 'text-zinc-300'}`}>EN</span>
                    <div className={`w-8 h-4 rounded-full relative transition-colors ${language === 'zh' ? 'bg-indigo-500/20 border-indigo-500/50' : 'bg-zinc-800 border-zinc-700'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-all ${language === 'zh' ? 'right-0.5 bg-indigo-400' : 'left-0.5 bg-zinc-500'}`}></div>
                    </div>
                    <span className={`text-xs font-medium transition-colors ${language === 'zh' ? 'text-indigo-400' : 'text-zinc-500'}`}>中文</span>
                </div>

                <div className="h-8 w-px bg-border"></div>

                {/* Custom Switch (Auto Refresh) */}
                <div className="flex items-center gap-2 group cursor-pointer">
                    <span className="text-xs font-medium group-hover:text-zinc-300 transition-colors text-zinc-500">{t('header.live')}</span>
                    <div className="w-9 h-5 rounded-full bg-zinc-800 border border-zinc-700 relative transition-colors group-hover:border-zinc-600">
                        <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-indigo-500 shadow-sm transition-transform"></div>
                    </div>
                </div>
            </div>
        </header>
    )
}

const PageWrapper = ({ children }: { children: React.ReactNode }) => (
    <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.2 }}
        className="h-full"
    >
        {children}
    </motion.div>
);

const AnimatedRoutes = () => {
    const location = useLocation();

    return (
        <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
                <Route path="/" element={<PageWrapper><Dashboard /></PageWrapper>} />
                <Route path="/sites" element={<PageWrapper><Sites /></PageWrapper>} />
                <Route path="/deploy" element={<PageWrapper><DeploymentWizard /></PageWrapper>} />
                <Route path="/scanner" element={<PageWrapper><Scanner /></PageWrapper>} />
                <Route path="/history" element={<PageWrapper><FixHistory /></PageWrapper>} />
                <Route path="/settings" element={<PageWrapper><SettingsPage /></PageWrapper>} />
                <Route path="/admin" element={<PageWrapper><SuperAdmin /></PageWrapper>} />
                <Route path="/admin" element={<PageWrapper><SuperAdmin /></PageWrapper>} />
                <Route path="/alerts" element={<PageWrapper><Alerts /></PageWrapper>} />
            </Routes>
        </AnimatePresence>
    );
};

const Layout = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className="flex h-screen bg-background text-zinc-400 font-sans overflow-hidden">
            <Sidebar />
            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                <Header />
                <div className="flex-1 overflow-y-auto scrollbar-hide">
                    {children}
                </div>
            </main>
        </div>
    );
};

function App() {
    return (
        <DemoProvider>
            <LanguageProvider>
                <BrowserRouter>
                    <Layout>
                        <AnimatedRoutes />
                    </Layout>
                </BrowserRouter>
            </LanguageProvider>
        </DemoProvider>
    );
}

export default App;
