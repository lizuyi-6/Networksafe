import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { useState, useEffect, ReactNode } from 'react';
import {
    LayoutDashboard,
    Activity,
    Settings,
    Key,
    Server,
    Users,
    Bell,
    FileText,
    Rocket,
    Sun,
    Moon,
    Laptop,
    Radio
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Context
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { DemoProvider, useDemo } from './context/DemoContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import Logo from './components/Logo';

// Pages
import Dashboard from './pages/Dashboard';
import Sites from './pages/Sites';
import DeploymentWizard from './pages/DeploymentWizard';
import Scanner from './pages/Scanner';
import FixHistory from './pages/FixHistory';
import SettingsPage from './pages/Settings';
import SuperAdmin from './pages/SuperAdmin';
import Alerts from './pages/Alerts';
import Agents from './pages/Agents';
import Devices from './pages/Devices';
import Landing from './pages/Landing';
import Login from './pages/Login';
import BoardStatus from './pages/BoardStatus';

/**
 * SECURITY FIX CVE-2026-012: Authentication guard for protected routes
 */
const PrivateRoute = ({ children }: { children: ReactNode }) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

    useEffect(() => {
        // Check if user is authenticated by verifying token with backend
        const checkAuth = async () => {
            try {
                const response = await fetch('/api/auth/me', {
                    credentials: 'include'
                });
                setIsAuthenticated(response.ok);
            } catch {
                setIsAuthenticated(false);
            }
        };
        checkAuth();
    }, []);

    // Show loading while checking auth
    if (isAuthenticated === null) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    // Redirect to login if not authenticated
    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
};

/**
 * SECURITY FIX CVE-2026-012: Admin-only route guard
 */
const AdminRoute = ({ children }: { children: ReactNode }) => {
    const [userRole, setUserRole] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const checkRole = async () => {
            try {
                const response = await fetch('/api/auth/me', {
                    credentials: 'include'
                });
                if (response.ok) {
                    const data = await response.json();
                    setUserRole(data.user?.role);
                }
            } catch {
                setUserRole(null);
            }
            setIsLoading(false);
        };
        checkRole();
    }, []);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (userRole !== 'admin') {
        return <Navigate to="/dashboard" replace />;
    }

    return <>{children}</>;
};

const Sidebar = () => {
    const location = useLocation();
    const { t } = useLanguage();

    // Don't show sidebar on Landing or Login pages
    if (location.pathname === '/' || location.pathname === '/login') return null;

    const navGroups = [
        {
            title: t('nav.platform'),
            items: [
                { icon: LayoutDashboard, label: t('nav.dashboard'), path: '/dashboard' },
                { icon: Users, label: 'Agents', path: '/agents', badge: 3 },
                { icon: Radio, label: 'Devices', path: '/devices', badge: 2 },
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
                    <Logo tier="professional" showText={true} className="scale-90 origin-left" />
                </div>

                {/* Nav Links */}
                <nav className="p-3 space-y-4">
                    {navGroups.map((group, idx) => (
                        <div key={idx}>
                            <div className="px-3 py-2 text-xxs font-medium tracking-wider text-muted-foreground uppercase">{group.title}</div>
                            <div className="space-y-0.5">
                                {group.items.map((item: any) => {
                                    const isActive = location.pathname === item.path;
                                    return (
                                        <Link
                                            key={item.path}
                                            to={item.path}
                                            className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors group ${isActive
                                                ? 'text-foreground bg-primary/10 border border-primary/20 shadow-sm'
                                                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                                }`}
                                        >
                                            <item.icon
                                                size={18}
                                                strokeWidth={1.5}
                                                className={isActive ? 'text-primary' : 'group-hover:text-foreground'}
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
                <a href="#" className="flex items-center gap-3 px-2 py-2 text-sm hover:text-foreground transition-colors">
                    <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-medium text-xs">
                        JD
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-medium text-foreground">John Doe</span>
                        <span className="text-xxs text-muted-foreground">Admin</span>
                    </div>
                    <Settings size={18} className="ml-auto hover:rotate-90 transition-transform duration-500 text-muted-foreground hover:text-foreground" />
                </a>
            </div>
        </aside>
    );
}

const Header = () => {
    const { t, language, toggleLanguage } = useLanguage();
    const { isDemoMode, toggleDemoMode } = useDemo();
    const { theme, setTheme } = useTheme();
    const location = useLocation();

    // Don't show header on Landing or Login pages
    if (location.pathname === '/' || location.pathname === '/login') return null;

    return (
        <header className="h-16 border-b border-border/50 flex items-center justify-between px-6 bg-background/80 backdrop-blur-md z-10 sticky top-0">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="hover:text-foreground cursor-pointer transition-colors">{t('header.overview')}</span>
                <span className="text-muted-foreground/50">/</span>
                <span className="text-foreground font-medium">{t('nav.dashboard')}</span>
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

                {/* Theme Toggle */}
                <div className="flex items-center gap-1 bg-muted border border-border rounded-full p-0.5">
                    <button
                        onClick={() => setTheme('light')}
                        className={`p-1 rounded-full transition-all ${theme === 'light' ? 'bg-background shadow text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        title="Light Mode"
                    >
                        <Sun size={14} />
                    </button>
                    <button
                        onClick={() => setTheme('system')}
                        className={`p-1 rounded-full transition-all ${theme === 'system' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
                        title="System"
                    >
                        <Laptop size={14} />
                    </button>
                    <button
                        onClick={() => setTheme('dark')}
                        className={`p-1 rounded-full transition-all ${theme === 'dark' ? 'bg-background text-primary shadow' : 'text-muted-foreground hover:text-foreground'}`}
                        title="Dark Mode"
                    >
                        <Moon size={14} />
                    </button>
                </div>

                <div className="h-8 w-px bg-border"></div>

                {/* Demo Mode Toggle */}
                <div onClick={toggleDemoMode} className="flex items-center gap-2 cursor-pointer group">
                    <span className={`text-xs font-medium transition-colors ${isDemoMode ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}>Demo</span>
                    <div className={`w-8 h-4 rounded-full relative transition-colors ${isDemoMode ? 'bg-primary/20 border-primary/50' : 'bg-muted border-border'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-all ${isDemoMode ? 'right-0.5 bg-primary' : 'left-0.5 bg-muted-foreground'}`}></div>
                    </div>
                </div>

                <div className="h-8 w-px bg-border"></div>

                {/* Language Toggle */}
                <div onClick={toggleLanguage} className="flex items-center gap-2 cursor-pointer group">
                    <span className={`text-xs font-medium transition-colors ${language === 'zh' ? 'text-muted-foreground' : 'text-foreground'}`}>EN</span>
                    <div className={`w-8 h-4 rounded-full relative transition-colors ${language === 'zh' ? 'bg-primary/20 border-primary/50' : 'bg-muted border-border'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-all ${language === 'zh' ? 'right-0.5 bg-primary' : 'left-0.5 bg-muted-foreground'}`}></div>
                    </div>
                    <span className={`text-xs font-medium transition-colors ${language === 'zh' ? 'text-primary' : 'text-muted-foreground'}`}>中文</span>
                </div>

                <div className="h-8 w-px bg-border"></div>

                {/* Custom Switch (Auto Refresh) */}
                <div className="flex items-center gap-2 group cursor-pointer">
                    <span className="text-xs font-medium group-hover:text-foreground transition-colors text-muted-foreground">{t('header.live')}</span>
                    <div className="w-9 h-5 rounded-full bg-muted border border-border relative transition-colors group-hover:border-primary/50">
                        <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-primary shadow-sm transition-transform"></div>
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
                {/* Public routes */}
                <Route path="/" element={<PageWrapper><Landing /></PageWrapper>} />
                <Route path="/login" element={<PageWrapper><Login /></PageWrapper>} />

                {/* SECURITY FIX CVE-2026-012: Protected routes require authentication */}
                <Route path="/dashboard" element={<PrivateRoute><PageWrapper><Dashboard /></PageWrapper></PrivateRoute>} />
                <Route path="/agents" element={<PrivateRoute><PageWrapper><Agents /></PageWrapper></PrivateRoute>} />
                <Route path="/devices" element={<PrivateRoute><PageWrapper><Devices /></PageWrapper></PrivateRoute>} />
                <Route path="/sites" element={<PrivateRoute><PageWrapper><Sites /></PageWrapper></PrivateRoute>} />
                <Route path="/deploy" element={<PrivateRoute><PageWrapper><DeploymentWizard /></PageWrapper></PrivateRoute>} />
                <Route path="/scanner" element={<PrivateRoute><PageWrapper><Scanner /></PageWrapper></PrivateRoute>} />
                <Route path="/history" element={<PrivateRoute><PageWrapper><FixHistory /></PageWrapper></PrivateRoute>} />
                <Route path="/settings" element={<PrivateRoute><PageWrapper><SettingsPage /></PageWrapper></PrivateRoute>} />
                <Route path="/alerts" element={<PrivateRoute><PageWrapper><Alerts /></PageWrapper></PrivateRoute>} />
                <Route path="/devices/board-status/:id" element={<PrivateRoute><PageWrapper><BoardStatus /></PageWrapper></PrivateRoute>} />

                {/* Admin-only routes */}
                <Route path="/admin" element={<PrivateRoute><AdminRoute><PageWrapper><SuperAdmin /></PageWrapper></AdminRoute></PrivateRoute>} />
            </Routes>
        </AnimatePresence>
    );
};

const Layout = ({ children }: { children: React.ReactNode }) => {
    const location = useLocation();

    // Standalone pages that manage their own layout/theme
    const isStandalone = location.pathname === '/' || location.pathname === '/login';

    if (isStandalone) {
        return <>{children}</>;
    }

    return (
        <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
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

const App = () => {
    return (
        <ThemeProvider defaultTheme="dark" storageKey="fluxguard-theme">
            <DemoProvider>
                <LanguageProvider>
                    <BrowserRouter>
                        <Layout>
                            <AnimatedRoutes />
                        </Layout>
                    </BrowserRouter>
                </LanguageProvider>
            </DemoProvider>
        </ThemeProvider>
    );
};

export default App;
