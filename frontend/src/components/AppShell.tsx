import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Activity,
    Bell,
    BrainCircuit,
    CheckCircle2,
    ChevronRight,
    FileClock,
    FileText,
    Gauge,
    HardDriveDownload,
    KeyRound,
    Laptop,
    Layers3,
    Menu,
    Moon,
    Network,
    RadioTower,
    Rocket,
    ScanSearch,
    ServerCog,
    Settings,
    Shield,
    ShieldAlert,
    Sun,
    UserCog,
    Users,
    X,
    XCircle,
    Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import AnnouncementBanner from './AnnouncementBanner';
import Logo, { type PlanTier } from './Logo';
import { useAttackStatus } from '../context/AttackStatusContext';
import { useDemo } from '../context/DemoContext';
import { useLanguage } from '../context/LanguageContext';
import { useLiveMode } from '../context/LiveModeContext';
import { useTheme } from '../context/ThemeContext';
import { fetchApiReadiness, fetchCurrentUserSession, fetchSystemBadges, isRequestAbortError } from '../services/api';
import {
    isAdminRole,
    sessionHasFrontendPermission,
} from './RouteGuards';

type NavItem = {
    icon: LucideIcon;
    label: string;
    path: string;
    badge?: number;
};

type Profile = {
    name: string;
    role: string;
    rawRole: string | null;
    permissions?: string[];
    initials: string;
    plan: PlanTier;
};

type SidebarProps = {
    mobile?: boolean;
    onNavigate?: () => void;
    onClose?: () => void;
};

const Switch = ({ checked }: { checked: boolean }) => (
    <span className={`relative h-5 w-9 rounded-full border transition-colors ${checked ? 'border-primary/50 bg-primary/20' : 'border-border bg-muted'}`}>
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${checked ? 'right-0.5 bg-primary' : 'left-0.5 bg-muted-foreground'}`} />
    </span>
);

const Sidebar = ({ mobile = false, onNavigate, onClose }: SidebarProps) => {
    const location = useLocation();
    const { language, t, toggleLanguage } = useLanguage();
    const { attackSimEnabled, isDemoMode, isSwitchingDemoMode, toggleDemoMode } = useDemo();
    const { liveModeEnabled, toggleLiveMode } = useLiveMode();
    const { status: attackStatus } = useAttackStatus();
    const [badges, setBadges] = useState({ agents: 0, alerts: 0, devices: 0, agentMonitor: 0, traffic: 0, scanner: 0 });
    const [profile, setProfile] = useState<Profile>({
        name: language === 'zh' ? '未知用户' : 'Unknown user',
        role: language === 'zh' ? '未确认角色' : 'Role unavailable',
        rawRole: null,
        permissions: undefined,
        initials: '??',
        plan: 'starter',
    });

    useEffect(() => {
        let disposed = false;
        let activeController: AbortController | null = null;

        const load = async () => {
            activeController?.abort();
            const controller = new AbortController();
            activeController = controller;
            try {
                const data = await fetchSystemBadges(controller.signal);
                if (!disposed && !controller.signal.aborted) {
                    setBadges({
                        agents: data.agents || 0,
                        alerts: data.alerts || 0,
                        devices: data.devices || 0,
                        agentMonitor: data.agentMonitor || 0,
                        traffic: data.traffic || 0,
                        scanner: data.scanner || 0,
                    });
                }
            } catch (error) {
                if (!isRequestAbortError(error, controller.signal)) {
                    // Page-level states expose data failures; navigation badges remain neutral.
                }
            }
        };

        void load();
        const interval = liveModeEnabled ? window.setInterval(() => void load(), 8000) : undefined;
        return () => {
            disposed = true;
            activeController?.abort();
            if (interval !== undefined) window.clearInterval(interval);
        };
    }, [liveModeEnabled]);

    useEffect(() => {
        const controller = new AbortController();
        void fetchCurrentUserSession(controller.signal)
            .then((user) => {
                if (!user || controller.signal.aborted) return;
                const name = user.username || user.email;
                const initials = name.split(/\s+/).map((part) => part[0] || '').join('').slice(0, 2).toUpperCase() || '??';
                setProfile({
                    name,
                    role: user.role || (language === 'zh' ? '未确认角色' : 'Role unavailable'),
                    rawRole: user.role || null,
                    permissions: user.permissions,
                    initials,
                    plan: user.plan === 'pro' ? 'professional' : user.plan === 'ultra' ? 'enterprise' : 'starter',
                });
            })
            .catch(() => undefined);
        return () => controller.abort();
    }, [language]);

    const navigation = useMemo(() => {
        const monitor: NavItem[] = [
            { icon: Gauge, label: t('nav.dashboard'), path: '/dashboard' },
            { icon: Bell, label: t('nav.alerts'), path: '/alerts', badge: badges.alerts },
            { icon: Network, label: t('nav.traffic_interceptor'), path: '/traffic', badge: badges.traffic },
            { icon: BrainCircuit, label: t('nav.agent_monitor'), path: '/agent-monitor', badge: badges.agentMonitor },
        ];
        const protect: NavItem[] = [
            { icon: Users, label: t('nav.agents'), path: '/agents', badge: badges.agents },
            { icon: Layers3, label: language === 'zh' ? '认知拓扑' : 'Cognition', path: '/cognition' },
            { icon: ScanSearch, label: t('nav.monitoring'), path: '/scanner', badge: badges.scanner },
            { icon: RadioTower, label: t('nav.devices'), path: '/devices', badge: badges.devices },
            ...(attackSimEnabled ? [{ icon: ShieldAlert, label: t('nav.attack_simulator'), path: '/attack-sim' }] : []),
        ];
        const infrastructure: NavItem[] = [
            { icon: ServerCog, label: t('nav.sites'), path: '/sites' },
            { icon: Rocket, label: t('nav.deployment'), path: '/deploy' },
            ...(sessionHasFrontendPermission({ role: profile.rawRole, permissions: profile.permissions }, 'gate.read') ? [
                { icon: Shield, label: language === 'zh' ? '硬件闸门' : 'Hardware gates', path: '/hardware-gates' },
            ] : []),
            ...(sessionHasFrontendPermission({ role: profile.rawRole, permissions: profile.permissions }, 'deployment.run.read') ? [
                { icon: HardDriveDownload, label: language === 'zh' ? '部署运行' : 'Deployment runs', path: '/deployment-runs' },
            ] : []),
            ...(sessionHasFrontendPermission({ role: profile.rawRole, permissions: profile.permissions }, 'deployment.evidence.read') ? [
                { icon: FileText, label: language === 'zh' ? '部署证据' : 'Deployment evidence', path: '/deployment-evidence' },
            ] : []),
        ];
        const governance: NavItem[] = [
            { icon: FileClock, label: t('nav.audit'), path: '/history' },
            { icon: Settings, label: t('nav.settings'), path: '/settings' },
            ...(isAdminRole(profile.rawRole) ? [
                { icon: ShieldAlert, label: language === 'zh' ? '检测规则' : 'Detection rules', path: '/rules' },
                { icon: KeyRound, label: t('nav.keys'), path: '/admin' },
                { icon: UserCog, label: t('nav.super_admin'), path: '/super-admin' },
            ] : []),
        ];
        return [
            { title: language === 'zh' ? '态势' : 'MONITOR', items: monitor },
            { title: language === 'zh' ? '防御' : 'DEFEND', items: protect },
            { title: language === 'zh' ? '基础设施' : 'INFRASTRUCTURE', items: infrastructure },
            { title: language === 'zh' ? '治理' : 'GOVERNANCE', items: governance },
        ];
    }, [attackSimEnabled, badges, language, profile.rawRole, t]);

    const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);
    const progress = attackStatus.total > 0 ? Math.round((attackStatus.completed / attackStatus.total) * 100) : 0;

    return (
        <aside
            className={mobile
                ? 'flex h-full w-[min(19rem,calc(100vw-2.5rem))] flex-col border-r border-border bg-card shadow-2xl'
                : 'hidden h-full w-[17rem] shrink-0 flex-col border-r border-border bg-card md:flex'}
            aria-label={language === 'zh' ? '控制台导航' : 'Console navigation'}
        >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
                <Logo tier={profile.plan} />
                {mobile && (
                    <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close navigation" title="Close navigation">
                        <X size={18} aria-hidden="true" />
                    </button>
                )}
            </div>

            <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4">
                {navigation.map((group) => (
                    <section key={group.title}>
                        <h2 className="px-2 pb-1.5 text-[10px] font-semibold text-muted-foreground">{group.title}</h2>
                        <div className="space-y-0.5">
                            {group.items.map((item) => {
                                const active = isActive(item.path);
                                return (
                                    <Link
                                        key={item.path}
                                        to={item.path}
                                        onClick={onNavigate}
                                        className={`group flex min-h-9 items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${active ? 'border-primary/25 bg-primary/10 text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                                    >
                                        <item.icon size={16} className={active ? 'text-primary' : ''} aria-hidden="true" />
                                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                        {Boolean(item.badge) && (
                                            <span className="min-w-5 rounded border border-danger/20 bg-danger/10 px-1 text-center text-[10px] font-medium tabular-nums text-danger">{item.badge}</span>
                                        )}
                                    </Link>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </nav>

            <div className="shrink-0 border-t border-border p-3">
                <AnimatePresence>
                    {attackSimEnabled && attackStatus.isRunning && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-3 overflow-hidden rounded-md border border-warning/25 bg-warning/10 p-3">
                            <div className="flex items-center gap-2 text-xs font-medium text-foreground"><Zap size={14} className="text-warning" />{t('nav.attack_simulation')}</div>
                            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{attackStatus.completed}/{attackStatus.total}</span><span>{progress}%</span></div>
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-warning" style={{ width: `${progress}%` }} /></div>
                            <div className="mt-2 flex gap-4 text-[11px]"><span className="flex items-center gap-1 text-success"><CheckCircle2 size={12} />{attackStatus.blocked}</span><span className="flex items-center gap-1 text-danger"><XCircle size={12} />{attackStatus.allowed}</span></div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {mobile && (
                    <div className="mb-3 space-y-1 border-b border-border pb-3">
                        <button type="button" onClick={toggleLanguage} className="flex min-h-9 w-full items-center justify-between rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><span>{language === 'zh' ? '语言' : 'Language'}</span><span className="text-xs text-foreground">{language === 'zh' ? '中文' : 'English'}</span></button>
                        <button type="button" aria-pressed={isDemoMode} onClick={toggleDemoMode} disabled={isSwitchingDemoMode} className="flex min-h-9 w-full items-center justify-between rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"><span>{t('nav.demo_mode')}</span><Switch checked={isDemoMode} /></button>
                        <button type="button" aria-pressed={liveModeEnabled} onClick={toggleLiveMode} className="flex min-h-9 w-full items-center justify-between rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><span>{t('header.live')}</span><Switch checked={liveModeEnabled} /></button>
                    </div>
                )}

                <Link to="/settings" onClick={onNavigate} className="flex min-h-11 items-center gap-2.5 rounded-md px-2 hover:bg-muted">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-xs font-semibold text-primary">{profile.initials}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{profile.name}</span><span className="block truncate text-[10px] text-muted-foreground">{profile.role}</span></span>
                    <ChevronRight size={14} className="text-muted-foreground" aria-hidden="true" />
                </Link>
            </div>
        </aside>
    );
};

const Header = ({ onOpenNavigation, navigationOpen }: { onOpenNavigation: () => void; navigationOpen: boolean }) => {
    const location = useLocation();
    const { language, t, toggleLanguage } = useLanguage();
    const { isDemoMode, isSwitchingDemoMode, toggleDemoMode } = useDemo();
    const { liveModeEnabled, toggleLiveMode } = useLiveMode();
    const { theme, setTheme } = useTheme();
    const [health, setHealth] = useState<'checking' | 'ready' | 'not_ready'>('checking');

    useEffect(() => {
        let disposed = false;
        let activeController: AbortController | null = null;
        const check = async () => {
            activeController?.abort();
            const controller = new AbortController();
            activeController = controller;
            try {
                const readiness = await fetchApiReadiness(controller.signal);
                if (!disposed && !controller.signal.aborted) setHealth(readiness.status);
            } catch {
                if (!disposed) setHealth('not_ready');
            }
        };
        setHealth('checking');
        void check();
        const interval = liveModeEnabled ? window.setInterval(() => void check(), 10000) : undefined;
        return () => {
            disposed = true;
            activeController?.abort();
            if (interval !== undefined) window.clearInterval(interval);
        };
    }, [liveModeEnabled]);

    const title = useMemo(() => {
        const path = location.pathname;
        const exact: Record<string, string> = {
            '/dashboard': t('nav.dashboard'), '/agents': t('nav.agents'), '/cognition': language === 'zh' ? '认知拓扑' : 'Cognition', '/agent-monitor': t('nav.agent_monitor'), '/traffic': t('nav.traffic_interceptor'), '/attack-sim': t('nav.attack_simulator'), '/devices': t('nav.devices'), '/hardware-gates': language === 'zh' ? '硬件闸门' : 'Hardware gates', '/deployment-runs': language === 'zh' ? '部署运行' : 'Deployment runs', '/deployment-evidence': language === 'zh' ? '部署证据' : 'Deployment evidence', '/sites': t('nav.sites'), '/deploy': t('nav.deployment'), '/scanner': t('nav.monitoring'), '/history': t('nav.audit'), '/alerts': t('nav.alerts'), '/rules': language === 'zh' ? '检测规则' : 'Detection rules', '/settings': t('nav.settings'), '/admin': t('nav.keys'), '/super-admin': t('nav.super_admin'),
        };
        if (exact[path]) return exact[path];
        if (path.startsWith('/agents/')) return t('nav.agents');
        if (path.startsWith('/sites/')) return t('nav.sites');
        if (path.startsWith('/alerts/')) return t('nav.alerts');
        if (path.startsWith('/history/')) return t('nav.audit');
        if (path.startsWith('/scanner/runs/')) return t('nav.monitoring');
        if (path.startsWith('/traffic/sessions/')) return t('nav.traffic_interceptor');
        if (path.startsWith('/attack-sim/runs/')) return t('nav.attack_simulator');
        if (path.startsWith('/devices/board-status/')) return t('nav.devices');
        if (path.startsWith('/super-admin/users/')) return t('nav.super_admin');
        return language === 'zh' ? '页面未找到' : 'Page not found';
    }, [language, location.pathname, t]);

    const healthCopy = health === 'ready'
        ? { label: language === 'zh' ? '系统就绪' : 'System ready', className: 'border-success/25 bg-success/10 text-success', dot: 'bg-success' }
        : health === 'not_ready'
            ? { label: language === 'zh' ? '系统未就绪' : 'System not ready', className: 'border-danger/25 bg-danger/10 text-danger', dot: 'bg-danger' }
            : { label: language === 'zh' ? '状态检查中' : 'Checking status', className: 'border-warning/25 bg-warning/10 text-warning', dot: 'bg-warning' };

    const iconButton = 'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground';

    return (
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/95 px-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
                <button type="button" data-testid="mobile-nav-trigger" aria-label="Open navigation" title="Open navigation" aria-expanded={navigationOpen} aria-controls="mobile-console-navigation" onClick={onOpenNavigation} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"><Menu size={18} /></button>
                <div className="min-w-0"><p className="text-[10px] font-medium text-muted-foreground">AETHERGUARD / OPS</p><h1 className="truncate text-sm font-semibold text-foreground sm:text-base">{title}</h1></div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
                <div data-testid="system-health-indicator" data-status={health} role="status" className={`flex min-h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium ${healthCopy.className}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${healthCopy.dot}`} />
                    <span className="hidden lg:inline">{healthCopy.label}</span>
                </div>

                <div className="hidden items-center rounded-md border border-border bg-muted/40 p-0.5 sm:flex">
                    <button type="button" onClick={() => setTheme('light')} className={`${iconButton} ${theme === 'light' ? 'bg-card text-primary shadow-sm' : ''}`} aria-label="Light theme" title="Light theme"><Sun size={14} /></button>
                    <button type="button" onClick={() => setTheme('system')} className={`${iconButton} ${theme === 'system' ? 'bg-card text-foreground shadow-sm' : ''}`} aria-label="System theme" title="System theme"><Laptop size={14} /></button>
                    <button type="button" onClick={() => setTheme('dark')} className={`${iconButton} ${theme === 'dark' ? 'bg-card text-primary shadow-sm' : ''}`} aria-label="Dark theme" title="Dark theme"><Moon size={14} /></button>
                </div>

                <button type="button" data-testid="demo-mode-toggle" aria-pressed={isDemoMode} onClick={toggleDemoMode} disabled={isSwitchingDemoMode} className="hidden min-h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 md:flex"><span>{t('nav.demo_mode')}</span><Switch checked={isDemoMode} /></button>
                <button type="button" aria-pressed={language === 'zh'} onClick={toggleLanguage} className="hidden min-h-8 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground lg:block" title="Switch language">{language === 'zh' ? '中文' : 'EN'}</button>
                <button type="button" data-testid="live-mode-toggle" aria-pressed={liveModeEnabled} onClick={toggleLiveMode} className="hidden min-h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground lg:flex"><Activity size={14} className={liveModeEnabled ? 'text-success' : ''} /><span>{t('header.live')}</span></button>
            </div>
        </header>
    );
};

export const AppShell = ({ children }: { children: ReactNode }) => {
    const location = useLocation();
    const [navigationOpen, setNavigationOpen] = useState(false);

    useEffect(() => setNavigationOpen(false), [location.pathname]);
    useEffect(() => {
        if (!navigationOpen) return;
        const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setNavigationOpen(false); };
        window.addEventListener('keydown', close);
        return () => window.removeEventListener('keydown', close);
    }, [navigationOpen]);

    return (
        <div className="aether-console flex h-screen overflow-hidden bg-background text-foreground">
            <Sidebar />
            <AnimatePresence>
                {navigationOpen && (
                    <motion.div id="mobile-console-navigation" data-testid="mobile-navigation" role="dialog" aria-modal="true" aria-label="Console navigation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 md:hidden">
                        <button type="button" aria-label="Close navigation" title="Close navigation" onClick={() => setNavigationOpen(false)} className="absolute inset-0 h-full w-full bg-black/60" />
                        <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ duration: 0.18 }} className="relative h-full w-fit"><Sidebar mobile onNavigate={() => setNavigationOpen(false)} onClose={() => setNavigationOpen(false)} /></motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AnnouncementBanner />
                <Header onOpenNavigation={() => setNavigationOpen(true)} navigationOpen={navigationOpen} />
                <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            </main>
        </div>
    );
};
