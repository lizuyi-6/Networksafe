import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    Shield,
    Server,
    Activity,
    History,
    Settings,
    Lock,
    Globe
} from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Context
import { LanguageProvider, useLanguage } from './context/LanguageContext';

// Pages
import Dashboard from './pages/Dashboard';
import Sites from './pages/Sites';
import DeploymentWizard from './pages/DeploymentWizard';
import Scanner from './pages/Scanner';
import FixHistory from './pages/FixHistory';
import SettingsPage from './pages/Settings';
import SuperAdmin from './pages/SuperAdmin';

const Sidebar = ({ isSidebarOpen, setIsSidebarOpen }: { isSidebarOpen: boolean, setIsSidebarOpen: (v: boolean) => void }) => {
    const location = useLocation();
    const { t, toggleLanguage, language } = useLanguage();

    const navItems = [
        { icon: LayoutDashboard, label: t('nav.dashboard'), path: '/' },
        { icon: Shield, label: t('nav.scanner'), path: '/scanner' },
        { icon: Server, label: t('nav.sites'), path: '/sites' },
        { icon: Activity, label: t('nav.deployment'), path: '/deploy' },
        { icon: History, label: t('nav.history'), path: '/history' },
        { icon: Settings, label: t('nav.settings'), path: '/settings' },
        { icon: Lock, label: t('nav.admin'), path: '/admin' },
    ];

    return (
        <motion.aside
            initial={false}
            animate={{ width: isSidebarOpen ? 256 : 80 }}
            className="bg-white/80 backdrop-blur-md border-r border-gray-200 z-50 flex flex-col h-full shadow-sm"
        >
            <div className="h-24 flex items-center px-6 border-b border-gray-100 shrink-0">
                {isSidebarOpen ? (
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center justify-center w-full max-w-[180px]"
                    >
                        <img src="/brand-lockup.png" alt="FluxGuard" className="w-full h-auto object-contain" />
                    </motion.div>
                ) : (
                    <motion.img
                        layoutId="logo-icon"
                        src="/shield-logo.png"
                        alt="Logo"
                        className="h-14 w-14 object-contain mx-auto"
                        whileHover={{ scale: 1.1, rotate: 5 }}
                    />
                )}

                <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="ml-auto p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-blue-600 transition-colors"
                >
                    {isSidebarOpen ? <Shield className="w-5 h-5" /> : null}
                </button>
            </div>

            <nav className="p-4 space-y-2 flex-1 overflow-y-auto">
                {navItems.map((item) => {
                    const isActive = location.pathname === item.path;
                    return (
                        <Link
                            key={item.path}
                            to={item.path}
                            className="block relative"
                        >
                            {isActive && (
                                <motion.div
                                    layoutId="active-nav"
                                    className="absolute inset-0 bg-blue-50 rounded-xl"
                                    initial={false}
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                />
                            )}
                            <div className={`relative flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${isActive ? 'text-blue-700 font-medium' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                }`}>
                                <item.icon
                                    size={22}
                                    className={isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'}
                                />
                                {isSidebarOpen && (
                                    <motion.span
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -10 }}
                                    >
                                        {item.label}
                                    </motion.span>
                                )}
                            </div>
                        </Link>
                    );
                })}
            </nav>

            {/* Language Toggle at Bottom */}
            <div className="p-4 border-t border-gray-100 shrink-0">
                <button
                    onClick={toggleLanguage}
                    className="flex items-center gap-3 px-3 py-3 w-full rounded-xl text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors text-sm font-medium"
                >
                    <Globe size={20} className="text-gray-400" />
                    {isSidebarOpen &&
                        <motion.span
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                        >
                            {language === 'en' ? 'Switch to 中文' : 'Switch to English'}
                        </motion.span>
                    }
                </button>
            </div>
        </motion.aside>
    );
}

const PageWrapper = ({ children }: { children: React.ReactNode }) => (
    <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
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
            </Routes>
        </AnimatePresence>
    );
};

const Layout = ({ children }: { children: React.ReactNode }) => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    return (
        <div className="flex h-screen bg-[#F3F2F1] text-gray-900 font-sans overflow-hidden">
            <Sidebar isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} />
            <main className="flex-1 overflow-auto relative">
                <div className="max-w-7xl mx-auto p-8 space-y-6 min-h-full">
                    {children}
                </div>
            </main>
        </div>
    );
};

function App() {
    return (
        <LanguageProvider>
            <BrowserRouter>
                <Layout>
                    <AnimatedRoutes />
                </Layout>
            </BrowserRouter>
        </LanguageProvider>
    );
}

export default App;
