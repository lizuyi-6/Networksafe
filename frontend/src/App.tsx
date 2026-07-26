import { type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Home, LayoutDashboard } from 'lucide-react';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { DemoProvider, useDemo } from './context/DemoContext';
import { ThemeProvider } from './context/ThemeContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { AttackStatusProvider } from './context/AttackStatusContext';
import { LiveModeProvider } from './context/LiveModeContext';
import { AppShell } from './components/AppShell';
import { AdminRoute, PermissionRoute, PrivateRoute } from './components/RouteGuards';
import { SHOW_PITCH_ROUTES, STANDALONE_ROUTES } from './config/public-routes';
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
import HardwareGates from './pages/HardwareGates';
import DeploymentRuns from './pages/DeploymentRuns';
import DeploymentEvidence from './pages/DeploymentEvidence';
import XiongcaiFinalDeck from './pages/XiongcaiFinalDeck';

const PageWrapper = ({ children }: { children: ReactNode }) => (
    <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        className="min-h-full"
    >
        {children}
    </motion.div>
);

const NotFound = () => {
    const location = useLocation();
    const { language } = useLanguage();
    const copy = language === 'zh'
        ? { eyebrow: '路由错误', title: '页面未找到', description: '该控制台地址不存在，或已从当前版本移除。', dashboard: '返回控制台', home: '访问官网' }
        : { eyebrow: 'ROUTE ERROR', title: 'Page not found', description: 'This console address does not exist or was removed from this version.', dashboard: 'Back to dashboard', home: 'Public site' };

    return (
        <section data-testid="not-found-page" className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-10" aria-labelledby="not-found-title">
            <div className="w-full max-w-2xl border-l-2 border-primary bg-card px-6 py-8 shadow-panel sm:px-9">
                <p className="text-xs font-semibold text-primary">{copy.eyebrow} / 404</p>
                <h1 id="not-found-title" className="mt-2 text-2xl font-semibold text-foreground">{copy.title}</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.description}</p>
                <code className="mt-5 block overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground">{location.pathname}</code>
                <div className="mt-6 flex flex-wrap gap-2">
                    <Link to="/dashboard" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"><LayoutDashboard size={16} />{copy.dashboard}</Link>
                    <Link to="/" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"><Home size={16} />{copy.home}</Link>
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
                <Route path="/" element={<PageWrapper><Landing /></PageWrapper>} />
                <Route path="/landing-workshop" element={<PageWrapper><Landing /></PageWrapper>} />
                <Route path="/landing-workshop/remodel" element={<PageWrapper><Landing /></PageWrapper>} />
                <Route path="/landing-workshop/industrial" element={<PageWrapper><Landing /></PageWrapper>} />
                <Route path="/landing-workshop/enterprise" element={<PageWrapper><Landing /></PageWrapper>} />
                <Route path="/landing-workshop/terminal" element={<PageWrapper><Landing /></PageWrapper>} />
                <Route path="/landing-workshop/story" element={<PageWrapper><Landing /></PageWrapper>} />
                <Route path="/promo" element={<Promo />} />
                <Route path="/promo-film" element={<PromoFilm />} />
                <Route path="/aetherguard-deck" element={SHOW_PITCH_ROUTES ? <XiongcaiFinalDeck /> : <Navigate to="/dashboard" replace />} />
                <Route path="/xiongcai-final" element={<Navigate to={SHOW_PITCH_ROUTES ? '/aetherguard-deck' : '/dashboard'} replace />} />
                <Route path="/login" element={<PageWrapper><Login /></PageWrapper>} />
                <Route path="/privacy" element={<PageWrapper><PrivacyPolicy /></PageWrapper>} />
                <Route path="/terms" element={<PageWrapper><TermsOfService /></PageWrapper>} />

                <Route path="/dashboard" element={<PrivateRoute><PageWrapper><Dashboard /></PageWrapper></PrivateRoute>} />
                <Route path="/agents" element={<PrivateRoute><PageWrapper><Agents /></PageWrapper></PrivateRoute>} />
                <Route path="/cognition" element={<PrivateRoute><PageWrapper><MultiAgentTopology /></PageWrapper></PrivateRoute>} />
                <Route path="/agent-monitor" element={<PrivateRoute><PageWrapper><AgentMonitor /></PageWrapper></PrivateRoute>} />
                <Route path="/traffic" element={<PrivateRoute><PageWrapper><TrafficInterceptor /></PageWrapper></PrivateRoute>} />
                <Route
                    path="/attack-sim"
                    element={!modeResolved
                        ? <PrivateRoute><div className="p-8 text-sm text-muted-foreground">Resolving runtime capabilities...</div></PrivateRoute>
                        : attackSimEnabled
                            ? <PrivateRoute><PageWrapper><AttackSimulator /></PageWrapper></PrivateRoute>
                            : <Navigate to="/dashboard" replace />}
                />
                <Route path="/devices" element={<PrivateRoute><PageWrapper><Devices /></PageWrapper></PrivateRoute>} />
                <Route path="/hardware-gates" element={<PermissionRoute permission="gate.read"><PageWrapper><HardwareGates /></PageWrapper></PermissionRoute>} />
                <Route path="/deployment-runs" element={<PermissionRoute permission="deployment.run.read"><PageWrapper><DeploymentRuns /></PageWrapper></PermissionRoute>} />
                <Route path="/deployment-evidence" element={<PermissionRoute permission="deployment.evidence.read"><PageWrapper><DeploymentEvidence /></PageWrapper></PermissionRoute>} />
                <Route path="/sites" element={<PrivateRoute><PageWrapper><Sites /></PageWrapper></PrivateRoute>} />
                <Route path="/deploy" element={<PrivateRoute><PageWrapper><DeploymentWizard /></PageWrapper></PrivateRoute>} />
                <Route path="/scanner" element={<PrivateRoute><PageWrapper><Scanner /></PageWrapper></PrivateRoute>} />
                <Route path="/scanner/runs/:id" element={<PrivateRoute><PageWrapper><ScannerRunDetail /></PageWrapper></PrivateRoute>} />
                <Route path="/history" element={<PrivateRoute><PageWrapper><FixHistory /></PageWrapper></PrivateRoute>} />
                <Route path="/history/:id" element={<PrivateRoute><PageWrapper><FixHistoryDetail /></PageWrapper></PrivateRoute>} />
                <Route path="/settings" element={<PrivateRoute><PageWrapper><SettingsPage /></PageWrapper></PrivateRoute>} />
                <Route path="/alerts" element={<PrivateRoute><PageWrapper><Alerts /></PageWrapper></PrivateRoute>} />
                <Route path="/alerts/:id" element={<PrivateRoute><PageWrapper><AlertDetail /></PageWrapper></PrivateRoute>} />
                <Route path="/rules" element={<AdminRoute><PageWrapper><Rules /></PageWrapper></AdminRoute>} />
                <Route path="/agents/:id" element={<PrivateRoute><PageWrapper><AgentDetail /></PageWrapper></PrivateRoute>} />
                <Route path="/devices/board-status/:id" element={<PrivateRoute><PageWrapper><BoardStatus /></PageWrapper></PrivateRoute>} />
                <Route path="/sites/:id" element={<PrivateRoute><PageWrapper><SiteDetail /></PageWrapper></PrivateRoute>} />
                <Route path="/traffic/sessions/:id" element={<PrivateRoute><PageWrapper><TrafficSessionDetail /></PageWrapper></PrivateRoute>} />
                <Route path="/attack-sim/runs/:id" element={<PrivateRoute><PageWrapper><AttackRunDetail /></PageWrapper></PrivateRoute>} />

                <Route path="/admin" element={<AdminRoute><PageWrapper><SuperAdmin /></PageWrapper></AdminRoute>} />
                <Route path="/super-admin" element={<AdminRoute><PageWrapper><AdminUsers /></PageWrapper></AdminRoute>} />
                <Route path="/super-admin/users/:id" element={<AdminRoute><PageWrapper><UserDetail /></PageWrapper></AdminRoute>} />
                <Route path="*" element={<PrivateRoute><PageWrapper><NotFound /></PageWrapper></PrivateRoute>} />
            </Routes>
        </AnimatePresence>
    );
};

const Layout = ({ children }: { children: ReactNode }) => {
    const location = useLocation();
    return STANDALONE_ROUTES.has(location.pathname) ? <>{children}</> : <AppShell>{children}</AppShell>;
};

const App = () => (
    <ThemeProvider defaultTheme="system" storageKey="aetherguard-theme-v3">
        <LiveModeProvider>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <DemoProvider>
                    <LanguageProvider>
                        <WebSocketProvider>
                            <AttackStatusProvider>
                                <Layout><AnimatedRoutes /></Layout>
                            </AttackStatusProvider>
                        </WebSocketProvider>
                    </LanguageProvider>
                </DemoProvider>
            </BrowserRouter>
        </LiveModeProvider>
    </ThemeProvider>
);

export default App;
