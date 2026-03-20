import React, { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { useDemo } from '../context/DemoContext';
import { useNavigate } from 'react-router-dom';
import { User, Lock, ArrowRight, ArrowLeft, CheckCircle, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Logo from '../components/Logo';
import { COMPANY_NAME_CN, COMPANY_NAME_EN } from '../config/branding';
import { fetchSystemCapabilities, login } from '../services/api';

type ToastState = {
    msg: string;
    type: 'success' | 'info';
};

type DevLoginPreset = {
    id: string;
    label: string;
    detail: string;
    email: string;
    password: string;
};

const DEV_LOGIN_PRESETS: DevLoginPreset[] = [
    {
        id: 'admin',
        label: 'Admin',
        detail: 'Ultra admin',
        email: 'dev-admin@aetherguard.local',
        password: 'DevAdmin!2026',
    },
    {
        id: 'starter',
        label: 'Starter',
        detail: 'Starter tenant',
        email: 'starter@aetherguard.local',
        password: 'DevStarter!2026',
    },
    {
        id: 'pro',
        label: 'Pro',
        detail: 'Pro tenant',
        email: 'pro@aetherguard.local',
        password: 'DevPro!2026',
    },
    {
        id: 'ultra',
        label: 'Ultra',
        detail: 'Ultra tenant',
        email: 'ultra@aetherguard.local',
        password: 'DevUltra!2026',
    },
];

const Login = () => {
    const navigate = useNavigate();
    const { t } = useLanguage();
    useTheme();
    const { refreshDemoState } = useDemo();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isDevModeOpen, setIsDevModeOpen] = useState(false);
    const [devLoginEnabled, setDevLoginEnabled] = useState(false);
    const [toast, setToast] = useState<ToastState | null>(null);

    useEffect(() => {
        const controller = new AbortController();

        fetchSystemCapabilities(controller.signal)
            .then((mode) => {
                if (!controller.signal.aborted) {
                    setDevLoginEnabled(Boolean(mode.devLoginEnabled));
                }
            })
            .catch(() => {
                if (!controller.signal.aborted) {
                    setDevLoginEnabled(false);
                }
            });

        return () => controller.abort();
    }, []);

    const showToast = (msg: string, type: ToastState['type'] = 'info') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    const handleApplyPreset = (preset: DevLoginPreset) => {
        setEmail(preset.email);
        setPassword(preset.password);
        showToast(`${preset.label} credentials filled`);
    };

    const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            await login({ email, password });
            showToast('Login succeeded. Redirecting...', 'success');

            await refreshDemoState();

            setTimeout(() => {
                navigate('/dashboard');
            }, 800);
        } catch (error: any) {
            let errorMsg = error.message || 'Login failed. Check your network connection.';
            if (errorMsg.includes('invalid_credentials') || errorMsg.includes('401')) {
                errorMsg = 'Incorrect email or password.';
            }
            showToast(errorMsg);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen overflow-x-hidden overflow-y-auto bg-background text-foreground">
            <AnimatePresence>
                {toast && (
                    <motion.div
                        initial={{ opacity: 0, x: 100 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 100 }}
                        className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl border px-5 py-3 shadow-sm ${
                            toast.type === 'success' ? 'border-emerald-500/25 bg-card' : 'border-border bg-card'
                        }`}
                    >
                        {toast.type === 'success' ? <CheckCircle className="h-5 w-5 text-emerald-500" /> : <Info className="h-5 w-5 text-primary" />}
                        <span className="text-sm font-medium text-foreground">{toast.msg}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-8 md:px-8">
                <div className="grid w-full gap-6 lg:grid-cols-[1.25fr_460px]">
                    <motion.section
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="hidden overflow-hidden rounded-3xl border border-border bg-card shadow-sm lg:flex"
                    >
                        <div className="flex flex-1 flex-col justify-between p-8 xl:p-10">
                            <div className="space-y-8">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="space-y-1">
                                        <Logo className="origin-left" />
                                        <div className="text-xs text-muted-foreground">{COMPANY_NAME_CN}</div>
                                    </div>
                                    <span className="rounded-full border border-border bg-muted/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                        Operations Console
                                    </span>
                                </div>
                                <div className="space-y-4">
                                    <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-foreground">
                                        Security operations for gateways, agents, scans, and response workflows.
                                    </h1>
                                    <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                                        Sign in to the same monitoring console used for device health, alert handling, deployment, and incident history.
                                    </p>
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                    <div className="rounded-2xl border border-border bg-muted/20 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Gateways</div>
                                        <div className="mt-2 text-3xl font-bold tracking-tight text-foreground">24</div>
                                        <div className="mt-2 text-xs text-muted-foreground">Field inspection points online</div>
                                    </div>
                                    <div className="rounded-2xl border border-border bg-muted/20 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Agents</div>
                                        <div className="mt-2 text-3xl font-bold tracking-tight text-foreground">7</div>
                                        <div className="mt-2 text-xs text-muted-foreground">Inference and response roles available</div>
                                    </div>
                                    <div className="rounded-2xl border border-border bg-muted/20 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Alerts</div>
                                        <div className="mt-2 text-3xl font-bold tracking-tight text-foreground">3</div>
                                        <div className="mt-2 text-xs text-muted-foreground">Items currently awaiting review</div>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-border bg-muted/15 p-5">
                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Workspace Notes</div>
                                <div className="mt-3 grid gap-3 text-sm text-muted-foreground">
                                    <div className="flex items-start gap-3">
                                        <div className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
                                        <p>Device telemetry and board status use the same console shell after sign-in.</p>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <div className="mt-1 h-2 w-2 rounded-full bg-amber-500" />
                                        <p>Demo mode and development presets remain available without changing the authentication flow.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.section>

                    <motion.div
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="w-full rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8"
                    >
                        <div className="mb-8 space-y-4">
                            <div className="inline-flex items-center gap-2 lg:hidden">
                                <Logo />
                            </div>
                            <div className="space-y-2">
                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Account Access</div>
                                <h2 className="text-2xl font-bold tracking-tight text-foreground">Control console login</h2>
                                <p className="text-sm text-muted-foreground">Sign in with your enterprise account.</p>
                            </div>
                        </div>

                        {devLoginEnabled && (
                            <div className="mb-6 rounded-2xl border border-border bg-muted/15 p-4">
                                <button
                                    type="button"
                                    data-testid="dev-login-toggle"
                                    onClick={() => setIsDevModeOpen((open) => !open)}
                                    className="flex w-full items-center justify-between gap-3 text-left"
                                >
                                    <div>
                                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Dev Access</div>
                                        <div className="mt-1 text-sm text-foreground">Fill local test accounts instantly.</div>
                                    </div>
                                    <span className="text-xs text-muted-foreground">{isDevModeOpen ? 'Hide' : 'Show'}</span>
                                </button>

                                <AnimatePresence initial={false}>
                                    {isDevModeOpen && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="grid grid-cols-2 gap-2 pt-4">
                                                {DEV_LOGIN_PRESETS.map((preset) => (
                                                    <button
                                                        key={preset.id}
                                                        type="button"
                                                        data-testid={`dev-preset-${preset.id}`}
                                                        onClick={() => handleApplyPreset(preset)}
                                                        className="rounded-xl border border-border bg-card px-3 py-3 text-left transition-colors hover:border-primary/25 hover:bg-muted/20"
                                                    >
                                                        <div className="text-sm font-semibold text-foreground">{preset.label}</div>
                                                        <div className="text-xs text-muted-foreground">{preset.detail}</div>
                                                        <div className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{preset.email}</div>
                                                    </button>
                                                ))}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}

                        <form onSubmit={handleLogin} className="space-y-6">
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Email / Username</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                    <input
                                        type="text"
                                        name="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        autoComplete="username"
                                        className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-4 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
                                        placeholder="name@company.com"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('login.password_label')}</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                    <input
                                        type="password"
                                        name="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        autoComplete="current-password"
                                        className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-4 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
                                        placeholder="........"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-between text-xs">
                                <label className="flex cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground">
                                    <input type="checkbox" className="mr-2 rounded text-primary focus:ring-0" /> Remember this device
                                </label>
                                <a
                                    href="#"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        showToast('Contact your administrator to reset the password.');
                                    }}
                                    className="text-primary hover:opacity-80"
                                >
                                    Forgot password?
                                </a>
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className={`group flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 ${
                                    isLoading ? 'cursor-not-allowed opacity-75' : ''
                                }`}
                            >
                                <span>{isLoading ? 'Signing in...' : 'Secure Login'}</span>
                                {!isLoading && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />}
                            </button>
                        </form>

                        <div className="mt-6 text-center">
                            <div className="mb-3 text-xs text-muted-foreground">
                                {COMPANY_NAME_CN} · {COMPANY_NAME_EN}
                            </div>
                            <button onClick={() => navigate('/')} className="mx-auto flex items-center justify-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
                                <ArrowLeft className="h-3 w-3" /> Back to home
                            </button>
                        </div>
                    </motion.div>
                </div>
            </div>
        </div>
    );
};

export default Login;
