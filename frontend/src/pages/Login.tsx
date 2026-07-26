import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowLeft,
    ArrowRight,
    CheckCircle2,
    AlertCircle,
    KeyRound,
    LockKeyhole,
    Mail,
    ShieldCheck,
} from 'lucide-react';
import Logo from '../components/Logo';
import { COMPANY_NAME_CN, COMPANY_NAME_EN } from '../config/branding';
import { useDemo } from '../context/DemoContext';
import { useLanguage } from '../context/LanguageContext';
import { fetchSystemCapabilities, login, loginWithOidc } from '../services/api';

type ToastState = {
    msg: string;
    type: 'success' | 'info' | 'error';
};

const LOCAL_COPY = {
    en: {
        checkingAccess: 'Checking available sign-in methods...',
        continueWithSso: 'Continue with enterprise SSO',
        redirecting: 'Redirecting to your identity provider...',
        breakGlass: 'or use a local break-glass account',
        accessHelp: 'Need help accessing the console?',
        accessHelpTitle: 'Access options',
        accessHelpSso: 'Use enterprise SSO when your organization manages console access.',
        accessHelpLocal: 'Ask your administrator to confirm that local password access is enabled for this runtime.',
        accessHelpAdmin: 'Account recovery and role changes are handled by your platform administrator.',
        ssoRequired: 'Enterprise SSO is required in this runtime. Local password fields are not available.',
        accessUnavailable: 'No interactive sign-in method is currently available. Contact your platform administrator.',
        consolePreview: 'AetherGuard security operations console',
        returnHome: 'Back to home',
        oidcFailure: 'Enterprise SSO could not be started.',
        capabilitiesUnavailable: 'Sign-in methods could not be verified. Access remains closed until the control plane responds.',
    },
    zh: {
        checkingAccess: '正在检查可用的登录方式...',
        continueWithSso: '使用企业 SSO 继续',
        redirecting: '正在跳转到企业身份提供方...',
        breakGlass: '或使用本地紧急账户',
        accessHelp: '无法进入控制台？',
        accessHelpTitle: '访问方式',
        accessHelpSso: '如果企业统一管理控制台访问，请使用企业 SSO。',
        accessHelpLocal: '请联系管理员确认当前运行环境是否允许本地密码登录。',
        accessHelpAdmin: '账户恢复与角色变更由平台管理员处理。',
        ssoRequired: '当前运行环境要求使用企业 SSO，本地密码输入不会开放。',
        accessUnavailable: '当前没有可用的交互式登录方式，请联系平台管理员。',
        consolePreview: 'AetherGuard 安全运维控制台',
        returnHome: '返回首页',
        oidcFailure: '无法启动企业 SSO。',
        capabilitiesUnavailable: '无法确认当前登录方式。控制面恢复响应前，登录入口保持关闭。',
    },
} as const;

const Login = () => {
    const navigate = useNavigate();
    const { language, t } = useLanguage();
    const { refreshDemoState } = useDemo();
    const copy = String(language).toLowerCase().startsWith('zh') ? LOCAL_COPY.zh : LOCAL_COPY.en;
    const toastTimerRef = useRef<number | null>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isAccessHelpOpen, setIsAccessHelpOpen] = useState(false);
    const [capabilitiesResolved, setCapabilitiesResolved] = useState(false);
    const [capabilitiesUnavailable, setCapabilitiesUnavailable] = useState(false);
    const [oidcEnabled, setOidcEnabled] = useState(false);
    const [passwordLoginEnabled, setPasswordLoginEnabled] = useState(false);
    const [isOidcLoading, setIsOidcLoading] = useState(false);
    const [toast, setToast] = useState<ToastState | null>(null);

    useEffect(() => {
        const controller = new AbortController();

        fetchSystemCapabilities(controller.signal)
            .then((mode) => {
                if (controller.signal.aborted) return;
                setOidcEnabled(Boolean(mode.oidcEnabled));
                setPasswordLoginEnabled(mode.passwordLoginEnabled === true);
                setCapabilitiesUnavailable(false);
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                setOidcEnabled(false);
                setPasswordLoginEnabled(false);
                setCapabilitiesUnavailable(true);
            })
            .finally(() => {
                if (!controller.signal.aborted) setCapabilitiesResolved(true);
            });

        return () => controller.abort();
    }, []);

    useEffect(() => () => {
        if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    }, []);

    const showToast = (msg: string, type: ToastState['type'] = 'info') => {
        if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
        setToast({ msg, type });
        toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
    };

    const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!email.trim() || !password.trim()) {
            showToast(t('backend.email_and_password_are_required'), 'error');
            return;
        }

        setIsLoading(true);
        try {
            await login({ email, password });
            showToast(t('login.login_success'), 'success');
            await Promise.race([
                refreshDemoState().catch(() => undefined),
                new Promise<void>((resolve) => window.setTimeout(resolve, 2000)),
            ]);
            navigate('/dashboard');
        } catch (error: any) {
            let errorMsg = error?.message || t('login.login_failed');
            if (errorMsg.includes('invalid_credentials') || errorMsg.includes('401')) {
                errorMsg = t('login.incorrect_credentials');
            }
            showToast(errorMsg, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleOidcLogin = async () => {
        setIsOidcLoading(true);
        try {
            const { authorizationUrl } = await loginWithOidc();
            window.location.assign(authorizationUrl);
        } catch (error: any) {
            showToast(error?.message || copy.oidcFailure, 'error');
        } finally {
            setIsOidcLoading(false);
        }
    };

    const toastIcon = toast?.type === 'success'
        ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
        : <AlertCircle className={`h-4 w-4 ${toast?.type === 'error' ? 'text-danger' : 'text-primary'}`} aria-hidden="true" />;

    return (
        <div className="min-h-screen bg-background text-foreground lg:h-screen lg:overflow-hidden">
            <AnimatePresence>
                {toast && (
                    <motion.div
                        role={toast.type === 'error' ? 'alert' : 'status'}
                        aria-live="polite"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        className="fixed bottom-4 left-4 right-4 z-50 flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2.5 shadow-lg sm:left-auto sm:right-5 sm:max-w-sm"
                    >
                        <span className="mt-0.5">{toastIcon}</span>
                        <span className="text-sm leading-5 text-foreground">{toast.msg}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            <main className="relative min-h-screen lg:grid lg:grid-cols-[minmax(0,1fr)_430px]">
                <section className="relative h-48 overflow-hidden border-b border-border bg-[#eef2ef] sm:h-64 lg:h-screen lg:border-b-0 lg:border-r" aria-label={copy.consolePreview}>
                    <img
                        src="/pitch/02-dashboard.png"
                        alt={copy.consolePreview}
                        className="h-full w-full object-cover object-left-top lg:object-cover"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-white/5" />
                    <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md border border-white/20 bg-[#14241d]/90 px-3 py-2 text-xs font-medium text-white shadow-sm sm:bottom-4 sm:left-4">
                        <ShieldCheck className="h-4 w-4 text-[#76d2ad]" aria-hidden="true" />
                        <span>{copy.consolePreview}</span>
                    </div>
                </section>

                <section className="relative flex min-h-[calc(100vh-12rem)] items-center justify-center bg-background p-4 sm:min-h-[calc(100vh-16rem)] sm:p-6 lg:min-h-screen lg:bg-background/95 lg:p-5">
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.22 }}
                        className="w-full max-w-[400px] rounded-lg border border-border bg-card p-5 shadow-xl sm:p-6"
                    >
                        <div className="flex items-center justify-between gap-4">
                            <Logo />
                            <button
                                type="button"
                                onClick={() => navigate('/')}
                                aria-label={copy.returnHome}
                                title={copy.returnHome}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </div>

                        <div className="mt-6">
                            <p className="text-xs font-semibold text-primary">{t('login.account_access')}</p>
                            <h1 className="mt-2 text-2xl font-semibold text-foreground">{t('login.control_login')}</h1>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('login.sign_in_enterprise')}</p>
                        </div>

                        {!capabilitiesResolved ? (
                            <div role="status" className="mt-6 flex min-h-24 items-center justify-center gap-3 border-y border-border text-sm text-muted-foreground">
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" aria-hidden="true" />
                                <span>{copy.checkingAccess}</span>
                            </div>
                        ) : (
                            <div className="mt-6 space-y-4">
                                {oidcEnabled && (
                                    <button
                                        type="button"
                                        data-testid="login-sso"
                                        onClick={handleOidcLogin}
                                        disabled={isOidcLoading}
                                        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#1f6f52] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#195d45] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                    >
                                        <KeyRound className="h-4 w-4" aria-hidden="true" />
                                        <span>{isOidcLoading ? copy.redirecting : copy.continueWithSso}</span>
                                    </button>
                                )}

                                {oidcEnabled && passwordLoginEnabled && (
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
                                        <span className="h-px flex-1 bg-border" />
                                        <span>{copy.breakGlass}</span>
                                        <span className="h-px flex-1 bg-border" />
                                    </div>
                                )}

                                {capabilitiesUnavailable ? (
                                    <div role="alert" className="border-l-2 border-danger bg-danger/5 px-4 py-3 text-sm leading-6 text-danger">
                                        {copy.capabilitiesUnavailable}
                                    </div>
                                ) : passwordLoginEnabled ? (
                                    <form onSubmit={handleLogin} className="space-y-4">
                                        <div>
                                            <label htmlFor="login-email" className="mb-1.5 block text-xs font-medium text-foreground">{t('login.email_label')}</label>
                                            <div className="relative">
                                                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                                <input
                                                    id="login-email"
                                                    type="text"
                                                    name="email"
                                                    required
                                                    value={email}
                                                    onChange={(event) => setEmail(event.target.value)}
                                                    autoComplete="username"
                                                    className="min-h-11 w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15"
                                                    placeholder={t('login.email_placeholder')}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label htmlFor="login-password" className="mb-1.5 block text-xs font-medium text-foreground">{t('login.password_label')}</label>
                                            <div className="relative">
                                                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                                <input
                                                    id="login-password"
                                                    type="password"
                                                    name="password"
                                                    required
                                                    value={password}
                                                    onChange={(event) => setPassword(event.target.value)}
                                                    autoComplete="current-password"
                                                    className="min-h-11 w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15"
                                                    placeholder={t('login.password_placeholder')}
                                                />
                                            </div>
                                        </div>

                                        <div className="text-xs">
                                            <button
                                                type="button"
                                                data-testid="login-access-help-toggle"
                                                aria-expanded={isAccessHelpOpen}
                                                aria-controls="login-access-help-panel"
                                                onClick={() => setIsAccessHelpOpen((open) => !open)}
                                                className="min-h-7 text-left font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                            >
                                                {copy.accessHelp}
                                            </button>

                                            <AnimatePresence initial={false}>
                                                {isAccessHelpOpen && (
                                                    <motion.div
                                                        id="login-access-help-panel"
                                                        data-testid="login-access-help-panel"
                                                        role="region"
                                                        aria-live="polite"
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: 'auto' }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        className="overflow-hidden"
                                                    >
                                                        <div className="mt-2 space-y-2 border-l-2 border-primary/30 pl-3 text-xs leading-5 text-muted-foreground">
                                                            <p className="font-semibold text-foreground">{copy.accessHelpTitle}</p>
                                                            <p>{oidcEnabled ? copy.accessHelpSso : copy.accessHelpLocal}</p>
                                                            <p>{copy.accessHelpAdmin}</p>
                                                            {oidcEnabled && (
                                                                <button
                                                                    type="button"
                                                                    data-testid="login-access-help-sso"
                                                                    onClick={handleOidcLogin}
                                                                    disabled={isOidcLoading}
                                                                    className="inline-flex min-h-7 items-center gap-1.5 font-semibold text-primary hover:text-primary/80 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                                                >
                                                                    <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                                                                    <span>{isOidcLoading ? copy.redirecting : copy.continueWithSso}</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>

                                        <button
                                            type="submit"
                                            disabled={isLoading}
                                            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                        >
                                            <span>{isLoading ? t('login.signing_in') : t('login.secure_login')}</span>
                                            {!isLoading && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                                        </button>
                                    </form>
                                ) : (
                                    <div role="status" className="border-l-4 border-warning bg-warning/10 px-3 py-3 text-sm leading-6 text-foreground">
                                        {oidcEnabled ? copy.ssoRequired : copy.accessUnavailable}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="mt-6 border-t border-border pt-4 text-center text-[11px] leading-5 text-muted-foreground">
                            <div>{COMPANY_NAME_CN}</div>
                            <div>{COMPANY_NAME_EN}</div>
                        </div>
                    </motion.div>
                </section>
            </main>
        </div>
    );
};

export default Login;
