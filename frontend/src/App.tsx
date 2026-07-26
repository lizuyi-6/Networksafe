import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
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
    UserCog,
    HardDriveDownload,
    ScrollText,
    Layers,
    Menu,
    X,
    Home
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
import {
    AdminRoute,
    isAdminRole,
    PermissionRoute,
    PrivateRoute,
    sessionHasFrontendPermission,
} from './components/RouteGuards';
import { COMPANY_NAME_CN } from './config/branding';
import { SHOW_PITCH_ROUTES, STANDALONE_ROUTES } from './config/public-routes';
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
import MultiAgentTopology from './pages/MultiAgentTopology';
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
import LandingWorkshopHub from './pages/landing-workshop/LandingWorkshopHub';
import LandingRemodel from './pages/landing-workshop/LandingRemodel';
import LandingIndustrial from './pages/landing-workshop/LandingIndustrial';
import LandingEnterprise from './pages/landing-workshop/LandingEnterprise';
import LandingTerminal from './pages/landing-workshop/LandingTerminal';
import LandingStory from './pages/landing-workshop/LandingStory';
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
import HardwareGates from './pages/HardwareGates';
import DeploymentRuns from './pages/DeploymentRuns';
import DeploymentEvidence from './pages/DeploymentEvidence';
import XiongcaiFinalDeck from './pages/XiongcaiFinalDeck';

type SidebarProps = {
    mobile?: boolean;
    onNavigate?: () => void;
    onClose?: () => void;
};

const Sidebar = ({ mobile = false, onNavigate, onClose }: SidebarProps) => {
    const location = useLocation();
    const { t, language, toggleLanguage } = useLanguage();
    const { status: attackStatus } = useAttackStatus();
    const { attackSimEnabled, isDemoMode, toggleDemoMode, isSwitchingDemoMode } = useDemo();
    const { liveModeEnabled, toggleLiveMode } = useLiveMode();
    const [badges, setBadges] = useState({ agents: 0, alerts: 0, devices: 0, agentMonitor: 0, traffic: 0, scanner: 0 });
    const [profile, setProfile] = useState<{
        name: string;
        role: string;
        rawRole: string | null;
        initials: string;
        plan: string;
        permissions?: string[];
    }>({
        name: 'Unknown User',
        role: 'N/A',
        rawRole: null,
        initials: '??',
        plan: 'starter',
        permissions: undefined,
    });

    // Don't show sidebar on standalone public pages
    if (STANDALONE_ROUTES.has(location.pathname)) return null;

    const platformItems = [
        { icon: LayoutDashboard, label: t('nav.dashboard'), path: '/dashboard' },
        { icon: Users, label: t('nav.agents'), path: '/agents', badge: badges.agents > 0 ? badges.agents : undefined },
    { icon: Layers, label: 'Cognition', path: '/cognition' },
        { icon: Brain, label: t('nav.agent_monitor'), path: '/agent-monitor', badge: badges.agentMonitor > 0 ? badges.agentMonitor : undefined },
        { icon: Network, label: t('nav.traffic_interceptor'), path: '/traffic', badge: badges.traffic > 0 ? badges.traffic : undefined },
        ...(attackSimEnabled ? [{ icon: Shield, label: t('nav.attack_simulator'), path: '/attack-sim' }] : []),
        { icon: Radio, label: t('nav.devices'), path: '/devices', badge: badges.devices > 0 ? badges.devices : undefined },
        ...(sessionHasFrontendPermission({ role: profile.rawRole, permissions: profile.permissions }, 'gate.read')
            ? [{ icon: Shield, label: 'Gate Management', path: '/hardware-gates' }]
            : []),
        ...(sessionHasFrontendPermission({ role: profile.rawRole, permissions: profile.permissions }, 'deployment.run.read')
            ? [{ icon: HardDriveDownload, label: 'Deployment Runs', path: '/deployment-runs' }]
            : []),
        ...(sessionHasFrontendPermission({ role: profile.rawRole, permissions: profile.permissions }, 'deployment.evidence.read')
            ? [{ icon: ScrollText, label: 'Evidence', path: '/deployment-evidence' }]
            : []),
        { icon: Server, label: t('nav.sites'), path: '/sites' },
        { icon: Rocket, label: t('nav.deployment'), path: '/deploy' },
        { icon: Activity, label: t('nav.monitoring'), path: '/scanner', badge: badges.scanner > 0 ? badges.scanner : undefined },
        { icon: Settings, label: t('nav.settings'), path: '/settings' },
        ...(isAdminRole(profile.rawRole) ? [
            { icon: Key, label: t('nav.keys'), path: '/admin' },
            { icon: UserCog, label: t('nav.super_admin'), path: '/super-admin' }
        ] : []),
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
                ...(isAdminRole(profile.rawRole) ? [{ icon: Shield, label: 'Rules', path: '/rules' }] : []),
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
                const name = user.username || user.email || t('app.unnamed_user');
                const initials = String(name).split(/\s+/).map((x: string) => x[0] || '').join('').slice(0, 2).toUpperCase() || '??';
                const roleMap: Record<string, string> = {
                    'admin': t('admin_users.role_admin'),
                    'tenant': t('admin_users.role_tenant'),
                    'viewer': t('admin_users.role_viewer'),
                    'platform_admin': 'Platform Admin',
                    'tenant_admin': 'Tenant Admin',
                    'tenant_operator': 'Tenant Operator',
                    'tenant_viewer': 'Tenant Viewer',
                    'auditor': 'Auditor'
                };
                setProfile({
                    name,
                    role: roleMap[user.role] || user.role || t('app.role_not_set'),
                    rawRole: user.role || null,
                    initials,
                    plan: user.plan || 'starter',
                    permissions: user.permissions,
                });
            })
            .catch((error) => {
                if (isRequestAbortError(error, controller.signal)) {
                    return;
                }
                setProfile({
                    name: t('app.unnamed_user'),
                    role: t('app.role_not_set'),
                    rawRole: null,
                    initials: '??',
                    plan: 'starter',
                    permissions: undefined,
                });
            });

        return () => controller.abort();
    }, []);

    return (
        <aside
            className={mobile
                ? 'flex h-full w-[min(20rem,calc(100vw-3rem))] flex-col justify-between border-r border-border bg-card shadow-2xl'
                : 'z-20 hidden w-64 flex-col justify-between border-r border-border bg-card md:flex'}
            aria-label={language === 'zh' ? '控制台导航' : 'Console navigation'}
        >
            <div className="min-h-0 flex-1 overflow-y-auto">
                {/* Logo */}
                <div className="flex items-start justify-between gap-3 border-b border-border/50 px-4 py-3 sm:px-6">
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
                    {mobile && (
                        <button
                            type="button"
                            autoFocus
                            data-testid="mobile-nav-close"
                            aria-label={language === 'zh' ? '关闭导航' : 'Close navigation'}
                            title={language === 'zh' ? '关闭导航' : 'Close navigation'}
                            onClick={onClose}
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            <X size={20} aria-hidden="true" />
                        </button>
                    )}
                </div>

                {/* Nav Links */}
                <nav className="p-3 space-y-4">
                    {navGroups.map((group, idx) => (
                        <div key={idx}>
                            <div className="px-3 py-2 text-xxs font-medium tracking-wider text-muted-foreground uppercase">{group.title}</div>
                            <div className="space-y-0.5">
                                {group.items.map((item: any) => {
                                    const isActive = location.pathname === item.path
                                        || location.pathname.startsWith(`${item.path}/`);
                                    return (
                                        <Link
                                            key={item.path}
                                            to={item.path}
                                            onClick={onNavigate}
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
                {mobile && (
                    <div className="space-y-1 border-b border-border/50 pb-3">
                        <button
                            type="button"
                            onClick={toggleLanguage}
                            className="flex min-h-10 w-full items-center justify-between rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            <span>{language === 'zh' ? '语言' : 'Language'}</span>
                            <span className="text-xs font-medium text-foreground">{language === 'zh' ? '中文' : 'English'}</span>
                        </button>
                        <button
                            type="button"
                            aria-pressed={isDemoMode}
                            onClick={toggleDemoMode}
                            disabled={isSwitchingDemoMode}
                            className="flex min-h-10 w-full items-center justify-between rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <span>{t('nav.demo_mode')}</span>
                            <span className={`relative h-5 w-9 rounded-full border transition-colors ${isDemoMode ? 'border-primary/50 bg-primary/20' : 'border-border bg-muted'}`}>
                                <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full shadow-sm transition-all ${isDemoMode ? 'right-0.5 bg-primary' : 'left-0.5 bg-muted-foreground'}`} />
                            </span>
                        </button>
                        <button
                            type="button"
                            aria-pressed={liveModeEnabled}
                            onClick={toggleLiveMode}
                            className="flex min-h-10 w-full items-center justify-between rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            <span>{t('header.live')}</span>
                            <span className={`relative h-5 w-9 rounded-full border transition-colors ${liveModeEnabled ? 'border-primary/50 bg-primary/20' : 'border-border bg-muted'}`}>
                                <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full shadow-sm transition-all ${liveModeEnabled ? 'right-0.5 bg-primary' : 'left-0.5 bg-muted-foreground'}`} />
                            </span>
                        </button>
                    </div>
                )}

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
                <Link to="/settings" onClick={onNavigate} className="flex items-center gap-3 px-2 py-2 text-sm hover:text-foreground transition-colors">
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

type HeaderProps = {
    isMobileNavigationOpen: boolean;
    onOpenMobileNavigation: () => void;
};

const Header = ({ isMobileNavigationOpen, onOpenMobileNavigation }: HeaderProps) => {
    const { t, language, toggleLanguage } = useLanguage();
    const { isDemoMode, toggleDemoMode, isSwitchingDemoMode } = useDemo();
    const { theme, setTheme } = useTheme();
    const { liveModeEnabled, toggleLiveMode } = useLiveMode();
    const location = useLocation();
    const isStandaloneRoute = STANDALONE_ROUTES.has(location.pathname);
    const [systemHealth, setSystemHealth] = useState<'checking' | 'ready' | 'not_ready'>('checking');

    useEffect(() => {
        if (isStandaloneRoute) {
            setSystemHealth('checking');
            return;
        }

        let disposed = false;
        let activeController: AbortController | null = null;

        const checkReadiness = async () => {
            activeController?.abort();
            const controller = new AbortController();
            activeController = controller;
            const timeout = window.setTimeout(() => controller.abort(), 5000);

            try {
                const readiness = await fetchApiReadiness(controller.signal);
                if (!disposed && !controller.signal.aborted) {
                    setSystemHealth(readiness.status === 'ready' ? 'ready' : 'not_ready');
                }
            } catch {
                if (!disposed) {
                    setSystemHealth('not_ready');
                }
            } finally {
                window.clearTimeout(timeout);
            }
        };

        setSystemHealth('checking');
        void checkReadiness();
        const interval = liveModeEnabled
            ? window.setInterval(() => void checkReadiness(), 10000)
            : undefined;

        return () => {
            disposed = true;
            activeController?.abort();
            if (interval !== undefined) window.clearInterval(interval);
        };
    }, [isStandaloneRoute, liveModeEnabled]);

    // Map paths to nav keys for breadcrumb
    const pathToNavKey: Record<string, string> = {
        '/dashboard': 'nav.dashboard',
        '/agents': 'nav.agents',
        '/cognition': 'Cognition',
        '/agent-monitor': 'nav.agent_monitor',
        '/traffic': 'nav.traffic_interceptor',
        '/attack-sim': 'nav.attack_simulator',
        '/devices': 'nav.devices',
        '/hardware-gates': 'Gate Management',
        '/deployment-runs': 'Deployment Runs',
        '/deployment-evidence': 'Evidence',
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
            const title = pathToNavKey[path];
            return title.startsWith('nav.') ? t(title) : title;
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
        return language === 'zh' ? '页面未找到' : 'Page not found';
    };

    // Don't show header on standalone public pages
    if (isStandaloneRoute) return null;

    const healthPresentation = systemHealth === 'ready'
        ? {
            label: t('header.system_healthy'),
            container: 'border-emerald-500/20 bg-emerald-500/10',
            dot: 'bg-emerald-500',
            text: 'text-emerald-600 dark:text-emerald-400'
        }
        : systemHealth === 'not_ready'
            ? {
                label: t('header.system_degraded'),
                container: 'border-rose-500/20 bg-rose-500/10',
                dot: 'bg-rose-500',
                text: 'text-rose-600 dark:text-rose-400'
            }
            : {
                label: t('header.system_checking'),
                container: 'border-amber-500/20 bg-amber-500/10',
                dot: 'bg-amber-500',
                text: 'text-amber-600 dark:text-amber-400'
            };

    return (
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b border-border/50 bg-background px-3 md:px-6">
            <div className="min-w-0 flex items-center gap-3 text-sm text-muted-foreground overflow-hidden">
                <button
                    type="button"
                    data-testid="mobile-nav-trigger"
                    aria-label={language === 'zh' ? '打开导航' : 'Open navigation'}
                    title={language === 'zh' ? '打开导航' : 'Open navigation'}
                    aria-controls="mobile-console-navigation"
                    aria-expanded={isMobileNavigationOpen}
                    onClick={onOpenMobileNavigation}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
                >
                    <Menu size={20} aria-hidden="true" />
                </button>
                <span className="hover:text-foreground cursor-pointer transition-colors truncate">{t('header.overview')}</span>
                <span className="text-muted-foreground/50 shrink-0">/</span>
                <span className="text-foreground font-medium truncate">{getCurrentPageTitle()}</span>
            </div>

            <div className="flex items-center gap-2 md:gap-4 shrink-0">
                {/* Status Indicator */}
                <div
                    data-testid="system-health-indicator"
                    data-status={systemHealth}
                    role="status"
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${healthPresentation.container}`}
                >
                    <span className={`inline-flex h-2 w-2 rounded-full ${healthPresentation.dot}`}></span>
                    <span className={`hidden text-xs font-medium tracking-tight lg:inline ${healthPresentation.text}`}>{healthPresentation.label}</span>
                </div>

                <div className="hidden sm:block h-8 w-px bg-border"></div>

                {/* Theme Toggle */}
                <div
                    className="flex items-center gap-1 bg-muted border border-border rounded-full p-0.5"
                    role="group"
                    aria-label="Theme preference"
                >
                    <button
                        type="button"
                        onClick={() => setTheme('light')}
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-all ${theme === 'light' ? 'bg-background shadow text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        data-testid="theme-light"
                        aria-label="Use light theme"
                        aria-pressed={theme === 'light'}
                        title="Light Mode"
                    >
                        <Sun size={14} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setTheme('system')}
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-all ${theme === 'system' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
                        data-testid="theme-system"
                        aria-label="Use system theme"
                        aria-pressed={theme === 'system'}
                        title="System"
                    >
                        <Laptop size={14} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setTheme('dark')}
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-all ${theme === 'dark' ? 'bg-background text-primary shadow' : 'text-muted-foreground hover:text-foreground'}`}
                        data-testid="theme-dark"
                        aria-label="Use dark theme"
                        aria-pressed={theme === 'dark'}
                        title="Dark Mode"
                    >
                        <Moon size={14} aria-hidden="true" />
                    </button>
                </div>

                <div className="hidden sm:block h-8 w-px bg-border"></div>

                <button
                    type="button"
                    data-testid="demo-mode-toggle"
                    aria-pressed={isDemoMode}
                    onClick={toggleDemoMode}
                    disabled={isSwitchingDemoMode}
                    className={`hidden min-h-6 items-center gap-2 group shrink-0 whitespace-nowrap md:flex ${isSwitchingDemoMode ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                    <span className={`text-xs font-medium transition-colors ${isDemoMode ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}>{t('nav.demo_mode')}</span>
                    <div className={`w-8 h-4 rounded-full relative transition-colors border ${isDemoMode ? 'bg-primary/20 border-primary/50' : 'bg-muted border-border'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-all ${isDemoMode ? 'right-0.5 bg-primary' : 'left-0.5 bg-muted-foreground'}`}></div>
                    </div>
                </button>

                <div className="hidden sm:block h-8 w-px bg-border"></div>

                {/* Language Toggle */}
                <button
                    type="button"
                    aria-label={language === 'zh' ? 'Switch language to English' : '切换语言为中文'}
                    aria-pressed={language === 'zh'}
                    onClick={toggleLanguage}
                    className="hidden min-h-6 items-center gap-2 cursor-pointer group md:flex"
                >
                    <span className={`text-xs font-medium transition-colors ${language === 'zh' ? 'text-muted-foreground' : 'text-foreground'}`}>EN</span>
                    <div className={`w-8 h-4 rounded-full relative transition-colors ${language === 'zh' ? 'bg-primary/20 border-primary/50' : 'bg-muted border-border'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-all ${language === 'zh' ? 'right-0.5 bg-primary' : 'left-0.5 bg-muted-foreground'}`}></div>
                    </div>
                    <span className={`text-xs font-medium transition-colors ${language === 'zh' ? 'text-primary' : 'text-muted-foreground'}`}>{t('app.chinese')}</span>
                </button>

                <div className="hidden h-8 w-px bg-border md:block"></div>

                {/* Custom Switch (Auto Refresh) */}
                <button
                    type="button"
                    data-testid="live-mode-toggle"
                    aria-pressed={liveModeEnabled}
                    onClick={toggleLiveMode}
                    className="hidden min-h-6 items-center gap-2 group cursor-pointer md:flex"
                >
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

const NotFound = () => {
    const location = useLocation();
    const { language } = useLanguage();
    const copy = language === 'zh'
        ? {
            title: '页面未找到',
            description: '该控制台地址不存在，或已从当前版本移除。',
            dashboard: '返回控制台',
            home: '访问官网'
        }
        : {
            title: 'Page not found',
            description: 'This console address does not exist or was removed from this version.',
            dashboard: 'Back to dashboard',
            home: 'Visit public site'
        };

    return (
        <section
            data-testid="not-found-page"
            className="flex min-h-full items-center justify-center px-4 py-12 sm:px-8"
            aria-labelledby="not-found-title"
        >
            <div className="w-full max-w-xl border-l-4 border-primary bg-card px-5 py-7 shadow-sm sm:px-8 sm:py-9">
                <div className="text-sm font-semibold text-primary">404</div>
                <h1 id="not-found-title" className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">
                    {copy.title}
                </h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.description}</p>
                <code className="mt-4 block max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded border border-border bg-muted px-3 py-2 text-xs text-foreground">
                    {location.pathname}
                </code>
                <div className="mt-6 flex flex-wrap gap-3">
                    <Link
                        to="/dashboard"
                        className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                        <LayoutDashboard size={17} aria-hidden="true" />
                        {copy.dashboard}
                    </Link>
                    <Link
                        to="/"
                        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                        <Home size={17} aria-hidden="true" />
                        {copy.home}
                    </Link>
                </div>
            </div>
        </section>
    );
};

const AnimatedRoutes = () => {
    const location = useLocation();
    const { attackSimEnabled, modeResolved } = useDemo();

    return (
        <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
                {/* Public routes */}
                <Route path="/" element={<PageWrapper><Landing /></PageWrapper>} />
                {/* Landing workshop — official-site landing candidates; production "/" stays on Landing */}
                <Route path="/landing-workshop" element={<PageWrapper><LandingWorkshopHub /></PageWrapper>} />
                <Route path="/landing-workshop/remodel" element={<PageWrapper><LandingRemodel /></PageWrapper>} />
                <Route path="/landing-workshop/industrial" element={<PageWrapper><LandingIndustrial /></PageWrapper>} />
                <Route path="/landing-workshop/enterprise" element={<PageWrapper><LandingEnterprise /></PageWrapper>} />
                <Route path="/landing-workshop/terminal" element={<PageWrapper><LandingTerminal /></PageWrapper>} />
                <Route path="/landing-workshop/story" element={<PageWrapper><LandingStory /></PageWrapper>} />
                <Route path="/promo" element={<Promo />} />
                <Route path="/promo-film" element={<PromoFilm />} />
                <Route path="/aetherguard-deck" element={SHOW_PITCH_ROUTES ? <XiongcaiFinalDeck /> : <Navigate to="/dashboard" replace />} />
                <Route path="/xiongcai-final" element={<Navigate to={SHOW_PITCH_ROUTES ? '/aetherguard-deck' : '/dashboard'} replace />} />
                <Route path="/login" element={<PageWrapper><Login /></PageWrapper>} />
                <Route path="/privacy" element={<PageWrapper><PrivacyPolicy /></PageWrapper>} />
                <Route path="/terms" element={<PageWrapper><TermsOfService /></PageWrapper>} />

                {/* SECURITY FIX CVE-2026-012: Protected routes require authentication */}
                <Route path="/dashboard" element={<PrivateRoute><PageWrapper><Dashboard /></PageWrapper></PrivateRoute>} />
                <Route path="/agents" element={<PrivateRoute><PageWrapper><Agents /></PageWrapper></PrivateRoute>} />
                <Route path="/cognition" element={<PrivateRoute><PageWrapper><MultiAgentTopology /></PageWrapper></PrivateRoute>} />
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
                <Route path="/hardware-gates" element={<PrivateRoute><PermissionRoute permission="gate.read"><PageWrapper><HardwareGates /></PageWrapper></PermissionRoute></PrivateRoute>} />
                <Route path="/deployment-runs" element={<PrivateRoute><PermissionRoute permission="deployment.run.read"><PageWrapper><DeploymentRuns /></PageWrapper></PermissionRoute></PrivateRoute>} />
                <Route path="/deployment-evidence" element={<PrivateRoute><PermissionRoute permission="deployment.evidence.read"><PageWrapper><DeploymentEvidence /></PageWrapper></PermissionRoute></PrivateRoute>} />
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

                {/* Unknown routes are private by default: unauthenticated users return to login. */}
                <Route path="*" element={<PrivateRoute><PageWrapper><NotFound /></PageWrapper></PrivateRoute>} />
            </Routes>
        </AnimatePresence>
    );
};

const Layout = ({ children }: { children: React.ReactNode }) => {
    const location = useLocation();
    const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
    const [isDesktopViewport, setIsDesktopViewport] = useState(() => (
        typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches
    ));

    useEffect(() => {
        const mediaQuery = window.matchMedia('(min-width: 768px)');
        const handleViewportChange = (event: MediaQueryListEvent | MediaQueryList) => {
            setIsDesktopViewport(event.matches);
            if (event.matches) setIsMobileNavigationOpen(false);
        };

        handleViewportChange(mediaQuery);
        mediaQuery.addEventListener('change', handleViewportChange);
        return () => mediaQuery.removeEventListener('change', handleViewportChange);
    }, []);

    useEffect(() => {
        setIsMobileNavigationOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        if (!isMobileNavigationOpen) return;

        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsMobileNavigationOpen(false);
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [isMobileNavigationOpen]);

    // Standalone pages that manage their own layout/theme
    const isStandalone = STANDALONE_ROUTES.has(location.pathname);

    if (isStandalone) {
        return <>{children}</>;
    }

    return (
        <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
            {isDesktopViewport && <Sidebar />}
            <AnimatePresence>
                {isMobileNavigationOpen && (
                    <motion.div
                        id="mobile-console-navigation"
                        data-testid="mobile-navigation"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Console navigation"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.16 }}
                        className="fixed inset-0 z-50 md:hidden"
                    >
                        <button
                            type="button"
                            aria-label="Close navigation"
                            onClick={() => setIsMobileNavigationOpen(false)}
                            className="absolute inset-0 h-full w-full bg-black/55"
                        />
                        <motion.div
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="relative h-full w-fit"
                        >
                            <Sidebar
                                mobile
                                onNavigate={() => setIsMobileNavigationOpen(false)}
                                onClose={() => setIsMobileNavigationOpen(false)}
                            />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                <AnnouncementBanner />
                <Header
                    isMobileNavigationOpen={isMobileNavigationOpen}
                    onOpenMobileNavigation={() => setIsMobileNavigationOpen(true)}
                />
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
