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
    Radio,
    Brain,
    Network,
    Shield,
    Zap,
    CheckCircle,
    XCircle,
    UserCog
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Context
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { DemoProvider, useDemo } from './context/DemoContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { AttackStatusProvider, useAttackStatus } from './context/AttackStatusContext';
import { LiveModeProvider, useLiveMode } from './context/LiveModeContext';
import Logo from './components/Logo';
import { COMPANY_NAME_CN } from './config/branding';
import {
    fetchApiReadiness,
    fetchCurrentUserSession,
    fetchSystemBadges,
    isRequestAbortError
} from './services/api';

// Pages
import Dashboard from './pages/Dashboard';
import Sites from './pages/Sites';
import DeploymentWizard from './pages/DeploymentWizard';
import Scanner from './pages/Scanner';
import FixHistory from './pages/FixHistory';
import SettingsPage from './pages/Settings';
import SuperAdmin from './pages/SuperAdmin';
import AdminUsers from './pages/AdminUsers';
import UserDetail from './pages/UserDetail';
import AnnouncementBanner from './components/AnnouncementBanner';
import Alerts from './pages/Alerts';
import Rules from './pages/Rules';
import Agents from './pages/Agents';
import Devices from './pages/Devices';
import AlertDetail from './pages/AlertDetail';
import AgentDetail from './pages/AgentDetail';
import AttackRunDetail from './pages/AttackRunDetail';
import Landing from './pages/Landing';
import Login from './pages/Login';
import BoardStatus from './pages/BoardStatus';
import AgentMonitor from './pages/AgentMonitor';
import FixHistoryDetail from './pages/FixHistoryDetail';
import ScannerRunDetail from './pages/ScannerRunDetail';
import SiteDetail from './pages/SiteDetail';
import TrafficInterceptor from './pages/TrafficInterceptor';
import TrafficSessionDetail from './pages/TrafficSessionDetail';
import AttackSimulator from './pages/AttackSimulator';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import Promo from './pages/Promo';
import PromoFilm from './pages/PromoFilm';

/**
 * SECURITY FIX CVE-2026-012: Authentication guard for protected routes
 * Improved cold start handling
 */
const PrivateRoute = ({ children }: { children: ReactNode }) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
    const [backendReady, setBackendReady] = useState(false);

    useEffect(() => {
        // Check backend readiness first (lightweight health check)
        const checkBackend = async () => {
            try {
                const readiness = await fetchApiReadiness(AbortSignal.timeout(3000));
                if (readiness.ok) {
                    setBackendReady(true);
                    const user = await fetchCurrentUserSession(AbortSignal.timeout(5000));
                    setIsAuthenticated(Boolean(user));
                } else {
                    setBackendReady(true);
                    setIsAuthenticated(false);
                }
            } catch {
                // Backend not ready - don't block UI, show login
                setBackendReady(true); // Allow access to check auth
                setIsAuthenticated(false);
            }
        };
        checkBackend();
    }, []);

    // Show loading while checking backend and auth
    if (!backendReady || isAuthenticated === null) {
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
 * Improved cold start handling
 */
const AdminRoute = ({ children }: { children: ReactNode }) => {
    const [userRole, setUserRole] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const checkRole = async () => {
            try {
                const user = await fetchCurrentUserSession(AbortSignal.timeout(5000));
                setUserRole(user?.role || null);
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
    const { status: attackStatus } = useAttackStatus();
    const { attackSimEnabled } = useDemo();
    const { liveModeEnabled } = useLiveMode();
    const [badges, setBadges] = useState({ agents: 0, alerts: 0, devices: 0, agentMonitor: 0, traffic: 0, scanner: 0 });
    const [profile, setProfile] = useState<{ name: string; role: string; initials: string; plan: string }>({
        name: 'Unknown User',
        role: 'N/A',
        initials: '??',
        plan: 'starter'
    });

    // Don't show sidebar on standalone public pages
    if (location.pathname === '/' || location.pathname === '/login' || location.pathname === '/privacy' || location.pathname === '/terms' || location.pathname === '/promo' || location.pathname === '/promo-film') return null;

    const platformItems = [
        { icon: LayoutDashboard, label: t('nav.dashboard'), path: '/dashboard' },
        { icon: Users, label: t('nav.agents'), path: '/agents', badge: badges.agents > 0 ? badges.agents : undefined },
        { icon: Brain, label: t('nav.agent_monitor'), path: '/agent-monitor', badge: badges.agentMonitor > 0 ? badges.agentMonitor : undefined },
        { icon: Network, label: t('nav.traffic_interceptor'), path: '/traffic', badge: badges.traffic > 0 ? badges.traffic : undefined },
        ...(attackSimEnabled ? [{ icon: Shield, label: t('nav.attack_simulator'), path: '/attack-sim' }] : []),
        { icon: Radio, label: t('nav.devices'), path: '/devices', badge: badges.devices > 0 ? badges.devices : undefined },
        { icon: Server, label: t('nav.sites'), path: '/sites' },
        { icon: Rocket, label: t('nav.deployment'), path: '/deploy' },
        { icon: Activity, label: t('nav.monitoring'), path: '/scanner', badge: badges.scanner > 0 ? badges.scanner : undefined },
        { icon: Settings, label: t('nav.settings'), path: '/settings' },
        { icon: Key, label: t('nav.keys'), path: '/admin' },
        ...(profile.role === 'admin' ? [{ icon: UserCog, label: t('nav.super_admin'), path: '/super-admin' }] : []),
    ];

    const navGroups = [
        {
            title: t('nav.platform'),
            items: platformItems
        },
        {
            title: t('nav.governance'),
            items: [
                { icon: FileText, label: t('nav.audit'), path: '/history' },
                ...(profile.role === 'admin' ? [{ icon: Shield, label: 'Rules', path: '/rules' }] : []),
                { icon: Bell, label: t('nav.alerts'), path: '/alerts', badge: badges.alerts > 0 ? badges.alerts : undefined },
            ]
        }
    ];

    const progressPercent = attackStatus.total > 0
        ? Math.round((attackStatus.completed / attackStatus.total) * 100)
        : 0;

    useEffect(() => {
        let disposed = false;
        let activeController: AbortController | null = null;

        const loadBadges = async () => {
            const controller = new AbortController();
            activeController?.abort();
            activeController = controller;

            try {
                const data = await fetchSystemBadges(controller.signal);
                if (disposed || controller.signal.aborted) {
                    return;
                }
                setBadges({
                    agents: data.agents || 0,
                    alerts: data.alerts || 0,
                    devices: data.devices || 0,
                    agentMonitor: data.agentMonitor || 0,
                    traffic: data.traffic || 0,
                    scanner: data.scanner || 0,
                });
            } catch (e) {
                if (!isRequestAbortError(e, controller.signal)) {
                    // ignore badge polling failures here; page-level fallbacks already handle empty badges
                }
            }
        };

        void loadBadges();
        if (!liveModeEnabled) {
            return () => {
                disposed = true;
                activeController?.abort();
            };
        }

        const badgeInterval = setInterval(() => {
            void loadBadges();
        }, 4000);

        return () => {
            disposed = true;
            activeController?.abort();
            clearInterval(badgeInterval);
        };
    }, [liveModeEnabled]);

    useEffect(() => {
        const controller = new AbortController();

        fetchCurrentUserSession(controller.signal)
            .then((user) => {
                if (controller.signal.aborted) {
                    return;
                }
                if (!user) {
                    throw new Error('FG-AUTH-ME-401');
                }
                const name = user.username || user.email || '未命名用户';
                const initials = String(name).split(/\s+/).map((x: string) => x[0] || '').join('').slice(0, 2).toUpperCase() || '??';
                // Translate role to display name
                const roleMap: Record<string, string> = {
                    'admin': t('admin_users.role_admin'),
                    'tenant': t('admin_users.role_tenant'),
                    'viewer': t('admin_users.role_viewer')
                };
                setProfile({
                    name,
                    role: roleMap[user.role] || user.role || t('app.role_not_set'),
                    initials,
                    plan: user.plan || 'starter'
                });
            })
            .catch((error) => {
                if (isRequestAbortError(error, controller.signal)) {
                    return;
                }
                setProfile({ name: t('app.unnamed_user'), role: t('app.role_not_set'), initials: '??', plan: 'starter' });
            });

        return () => controller.abort();
    }, []);

    return (
        <aside className="z-20 hidden w-64 flex-col justify-between border-r border-border bg-card md:flex">
            <div>
                {/* Logo */}
                <div className="border-b border-border/50 px-6 py-3">
                    <div className="space-y-1">
                        <Logo
                            tier={
                                profile.plan === 'pro' ? 'professional' :
                                    profile.plan === 'ultra' ? 'enterprise' :
                                        (profile.plan as any || 'starter')
                            }
                            showText={true}
                            className="origin-left scale-90"
                        />
                        <div className="pl-1 text-[11px] text-muted-foreground">{COMPANY_NAME_CN}</div>
                    </div>
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
                                            {item.path === '/scanner' && (
                                                <span className="ml-auto flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
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

            <div className="p-4 border-t border-border/50 space-y-3">
                {/* Attack Status */}
                <AnimatePresence>
                    {attackSimEnabled && attackStatus.isRunning && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                        >
                            <div className="rounded-lg border border-border bg-muted/20 p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <Zap className="h-4 w-4 text-amber-500" />
                                    <span className="text-xs font-medium text-foreground">{t('nav.attack_simulation')}</span>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-muted-foreground">{t('nav.attack_sim_progress')}</span>
                                        <span className="font-medium text-foreground">{attackStatus.completed}/{attackStatus.total}</span>
                                    </div>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${progressPercent}%` }}
                                            className="h-full rounded-full bg-amber-500"
                                        />
                                    </div>

                                    <div className="flex items-center justify-between pt-1">
                                        <div className="flex items-center gap-1">
                                            <CheckCircle className="h-3 w-3 text-emerald-500" />
                                            <span className="text-xs text-emerald-600 dark:text-emerald-400">{attackStatus.blocked}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <XCircle className="h-3 w-3 text-rose-500" />
                                            <span className="text-xs text-rose-600 dark:text-rose-400">{attackStatus.allowed}</span>
                                        </div>
                                    </div>

                                    {attackStatus.currentAttack && (
                                        <div className="truncate border-t border-border/60 pt-1 text-xs text-muted-foreground">
                                            {attackStatus.currentAttack}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* User Profile */}
                <Link to="/settings" className="flex items-center gap-3 px-2 py-2 text-sm hover:text-foreground transition-colors">
                    <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-medium text-xs">
                        {profile.initials}
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-medium text-foreground">{profile.name}</span>
                        <span className="text-xxs text-muted-foreground">{profile.role}</span>
                    </div>
                    <Settings size={18} className="ml-auto hover:rotate-90 transition-transform duration-500 text-muted-foreground hover:text-foreground" />
                </Link>
            </div>
        </aside>
    );
}

const Header = () => {
    const { t, language, toggleLanguage } = useLanguage();
    const { isDemoMode, toggleDemoMode, isSwitchingDemoMode } = useDemo();
    const { theme, setTheme } = useTheme();
    const { liveModeEnabled, toggleLiveMode } = useLiveMode();
    const location = useLocation();

    // Map paths to nav keys for breadcrumb
    const pathToNavKey: Record<string, string> = {
        '/dashboard': 'nav.dashboard',
        '/agents': 'nav.agents',
        '/agent-monitor': 'nav.agent_monitor',
        '/traffic': 'nav.traffic_interceptor',
        '/attack-sim': 'nav.attack_simulator',
        '/devices': 'nav.devices',
        '/sites': 'nav.sites',
        '/deploy': 'nav.deployment',
        '/scanner': 'nav.monitoring',
        '/settings': 'nav.settings',
        '/admin': 'nav.keys',
        '/super-admin': 'nav.super_admin',
        '/history': 'nav.audit',
        '/alerts': 'nav.alerts',
        '/rules': 'nav.platform',
    };

    const getCurrentPageTitle = () => {
        const path = location.pathname;
        // Check for exact match first
        if (pathToNavKey[path]) {
            return t(pathToNavKey[path]);
        }
        // Check for dynamic routes
        if (path.startsWith('/agents/')) return t('nav.agents');
        if (path.startsWith('/sites/')) return t('nav.sites');
        if (path.startsWith('/alerts/')) return t('nav.alerts');
        if (path.startsWith('/history/')) return t('nav.audit');
        if (path.startsWith('/scanner/runs/')) return t('nav.monitoring');
        if (path.startsWith('/traffic/sessions/')) return t('nav.traffic_interceptor');
        if (path.startsWith('/attack-sim/runs/')) return t('nav.attack_simulator');
        if (path.startsWith('/devices/board-status/')) return t('nav.devices');
        if (path.startsWith('/super-admin/users/')) return t('adminUsers.user_detail');
        return t('nav.dashboard');
    };

    // Don't show header on standalone public pages
    if (location.pathname === '/' || location.pathname === '/login' || location.pathname === '/privacy' || location.pathname === '/terms' || location.pathname === '/promo' || location.pathname === '/promo-film') return null;

    return (
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b border-border/50 bg-background px-3 md:px-6">
            <div className="min-w-0 flex items-center gap-3 text-sm text-muted-foreground overflow-hidden">
                <span className="hover:text-foreground cursor-pointer transition-colors truncate">{t('header.overview')}</span>
                <span className="text-muted-foreground/50 shrink-0">/</span>
                <span className="text-foreground font-medium truncate">{getCurrentPageTitle()}</span>
            </div>

            <div className="flex items-center gap-2 md:gap-4 shrink-0">
                {/* Status Indicator */}
                <div className="flex items-center gap-2 rounded-full border border-emerald-500/10 bg-emerald-500/5 px-3 py-1.5">
                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                    <span className="hidden lg:inline text-xs font-medium text-emerald-500 tracking-tight">{t('header.system_healthy')}</span>
                </div>

                <div className="hidden sm:block h-8 w-px bg-border"></div>

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

                <div className="hidden sm:block h-8 w-px bg-border"></div>

                <button
                    type="button"
                    data-testid="demo-mode-toggle"
                    aria-pressed={isDemoMode}
                    onClick={toggleDemoMode}
                    disabled={isSwitchingDemoMode}
                    className={`flex items-center gap-2 group shrink-0 whitespace-nowrap ${isSwitchingDemoMode ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                    <span className={`text-xs font-medium transition-colors ${isDemoMode ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}>{t('nav.demo_mode')}</span>
                    <div className={`w-8 h-4 rounded-full relative transition-colors border ${isDemoMode ? 'bg-primary/20 border-primary/50' : 'bg-muted border-border'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-all ${isDemoMode ? 'right-0.5 bg-primary' : 'left-0.5 bg-muted-foreground'}`}></div>
                    </div>
                </button>

                <div className="hidden sm:block h-8 w-px bg-border"></div>

                {/* Language Toggle */}
                <div onClick={toggleLanguage} className="flex items-center gap-2 cursor-pointer group">
                    <span className={`text-xs font-medium transition-colors ${language === 'zh' ? 'text-muted-foreground' : 'text-foreground'}`}>EN</span>
                    <div className={`w-8 h-4 rounded-full relative transition-colors ${language === 'zh' ? 'bg-primary/20 border-primary/50' : 'bg-muted border-border'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-all ${language === 'zh' ? 'right-0.5 bg-primary' : 'left-0.5 bg-muted-foreground'}`}></div>
                    </div>
                    <span className={`text-xs font-medium transition-colors ${language === 'zh' ? 'text-primary' : 'text-muted-foreground'}`}>{t('app.chinese')}</span>
                </div>

                <div className="h-8 w-px bg-border"></div>

                {/* Custom Switch (Auto Refresh) */}
                <button type="button" onClick={toggleLiveMode} className="flex items-center gap-2 group cursor-pointer">
                    <span className="text-xs font-medium group-hover:text-foreground transition-colors text-muted-foreground">{t('header.live')}</span>
                    <div className={`w-9 h-5 rounded-full border relative transition-colors ${liveModeEnabled ? 'bg-primary/20 border-primary/50' : 'bg-muted border-border group-hover:border-primary/50'}`}>
                        <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full shadow-sm transition-all ${liveModeEnabled ? 'right-0.5 bg-primary' : 'left-0.5 bg-muted-foreground'}`}></div>
                    </div>
                </button>
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
    const { attackSimEnabled, modeResolved } = useDemo();

    return (
        <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
                {/* Public routes */}
                <Route path="/" element={<PageWrapper><Landing /></PageWrapper>} />
                <Route path="/promo" element={<Promo />} />
                <Route path="/promo-film" element={<PromoFilm />} />
                <Route path="/login" element={<PageWrapper><Login /></PageWrapper>} />
                <Route path="/privacy" element={<PageWrapper><PrivacyPolicy /></PageWrapper>} />
                <Route path="/terms" element={<PageWrapper><TermsOfService /></PageWrapper>} />

                {/* SECURITY FIX CVE-2026-012: Protected routes require authentication */}
                <Route path="/dashboard" element={<PrivateRoute><PageWrapper><Dashboard /></PageWrapper></PrivateRoute>} />
                <Route path="/agents" element={<PrivateRoute><PageWrapper><Agents /></PageWrapper></PrivateRoute>} />
                <Route path="/agent-monitor" element={<PrivateRoute><PageWrapper><AgentMonitor /></PageWrapper></PrivateRoute>} />
                <Route path="/traffic" element={<PrivateRoute><PageWrapper><TrafficInterceptor /></PageWrapper></PrivateRoute>} />
                <Route
                    path="/attack-sim"
                    element={
                        !modeResolved
                            ? <PrivateRoute><PageWrapper><div className="p-8 text-muted-foreground">Loading mode...</div></PageWrapper></PrivateRoute>
                            : attackSimEnabled
                                ? <PrivateRoute><PageWrapper><AttackSimulator /></PageWrapper></PrivateRoute>
                                : <Navigate to="/dashboard" replace />
                    }
                />
                <Route path="/devices" element={<PrivateRoute><PageWrapper><Devices /></PageWrapper></PrivateRoute>} />
                <Route path="/sites" element={<PrivateRoute><PageWrapper><Sites /></PageWrapper></PrivateRoute>} />
                <Route path="/deploy" element={<PrivateRoute><PageWrapper><DeploymentWizard /></PageWrapper></PrivateRoute>} />
                <Route path="/scanner" element={<PrivateRoute><PageWrapper><Scanner /></PageWrapper></PrivateRoute>} />
                <Route path="/scanner/runs/:id" element={<PrivateRoute><PageWrapper><ScannerRunDetail /></PageWrapper></PrivateRoute>} />
                <Route path="/history" element={<PrivateRoute><PageWrapper><FixHistory /></PageWrapper></PrivateRoute>} />
                <Route path="/history/:id" element={<PrivateRoute><PageWrapper><FixHistoryDetail /></PageWrapper></PrivateRoute>} />
                <Route path="/settings" element={<PrivateRoute><PageWrapper><SettingsPage /></PageWrapper></PrivateRoute>} />
                <Route path="/alerts" element={<PrivateRoute><PageWrapper><Alerts /></PageWrapper></PrivateRoute>} />
                <Route path="/alerts/:id" element={<PrivateRoute><PageWrapper><AlertDetail /></PageWrapper></PrivateRoute>} />
                <Route path="/rules" element={<PrivateRoute><AdminRoute><PageWrapper><Rules /></PageWrapper></AdminRoute></PrivateRoute>} />
                <Route path="/agents/:id" element={<PrivateRoute><PageWrapper><AgentDetail /></PageWrapper></PrivateRoute>} />
                <Route path="/devices/board-status/:id" element={<PrivateRoute><PageWrapper><BoardStatus /></PageWrapper></PrivateRoute>} />
                <Route path="/sites/:id" element={<PrivateRoute><PageWrapper><SiteDetail /></PageWrapper></PrivateRoute>} />
                <Route path="/traffic/sessions/:id" element={<PrivateRoute><PageWrapper><TrafficSessionDetail /></PageWrapper></PrivateRoute>} />
                <Route path="/attack-sim/runs/:id" element={<PrivateRoute><PageWrapper><AttackRunDetail /></PageWrapper></PrivateRoute>} />

                {/* Admin-only routes */}
                <Route path="/admin" element={<PrivateRoute><AdminRoute><PageWrapper><SuperAdmin /></PageWrapper></AdminRoute></PrivateRoute>} />
                <Route path="/super-admin" element={<PrivateRoute><AdminRoute><PageWrapper><AdminUsers /></PageWrapper></AdminRoute></PrivateRoute>} />
                <Route path="/super-admin/users/:id" element={<PrivateRoute><AdminRoute><PageWrapper><UserDetail /></PageWrapper></AdminRoute></PrivateRoute>} />
            </Routes>
        </AnimatePresence>
    );
};

const Layout = ({ children }: { children: React.ReactNode }) => {
    const location = useLocation();

    // Standalone pages that manage their own layout/theme
    const isStandalone =
        location.pathname === '/' ||
        location.pathname === '/login' ||
        location.pathname === '/privacy' ||
        location.pathname === '/terms' ||
        location.pathname === '/promo' ||
        location.pathname === '/promo-film';

    if (isStandalone) {
        return <>{children}</>;
    }

    return (
        <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
            <Sidebar />
            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                <AnnouncementBanner />
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
        <ThemeProvider defaultTheme="light" storageKey="aetherguard-theme-v2">
            <LiveModeProvider>
                <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                    <DemoProvider>
                        <LanguageProvider>
                            <WebSocketProvider>
                                <AttackStatusProvider>
                                    <Layout>
                                        <AnimatedRoutes />
                                    </Layout>
                                </AttackStatusProvider>
                            </WebSocketProvider>
                        </LanguageProvider>
                    </DemoProvider>
                </BrowserRouter>
            </LiveModeProvider>
        </ThemeProvider>
    );
};

export default App;
