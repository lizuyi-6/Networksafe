import {
    createContext,
    ReactNode,
    useContext,
    useEffect,
    useState,
} from 'react';
import { Navigate } from 'react-router-dom';
import {
    CurrentUserSession,
    fetchCurrentUserSession,
    SESSION_EXPIRED_EVENT,
} from '../services/api';

export type FrontendPermission =
    | 'gate.read'
    | 'deployment.run.read'
    | 'deployment.evidence.read';

type PermissionSession = {
    role?: string | null;
    permissions?: string[];
};
type SessionGateStatus = 'checking' | 'authenticated' | 'unauthenticated' | 'unavailable';

const ROUTE_SESSION_TIMEOUT_MS = 7_000;
const ADMIN_ROLES = new Set(['admin', 'platform_admin']);
const ROLE_ALIASES: Readonly<Record<string, string>> = {
    admin: 'platform_admin',
    tenant: 'tenant_admin',
    viewer: 'tenant_viewer',
};
const FALLBACK_ROLE_PERMISSIONS: Readonly<Record<string, ReadonlySet<FrontendPermission>>> = {
    platform_admin: new Set([
        'gate.read',
        'deployment.run.read',
        'deployment.evidence.read',
    ]),
    tenant_admin: new Set([
        'gate.read',
        'deployment.run.read',
        'deployment.evidence.read',
    ]),
    tenant_operator: new Set([
        'gate.read',
        'deployment.run.read',
        'deployment.evidence.read',
    ]),
    tenant_viewer: new Set([
        'deployment.run.read',
        'deployment.evidence.read',
    ]),
    auditor: new Set([
        'deployment.run.read',
        'deployment.evidence.read',
    ]),
};

const VerifiedSessionContext = createContext<CurrentUserSession | null>(null);

const normalizeRole = (role?: string | null): string => {
    const normalizedRole = String(role || '').trim().toLowerCase();
    return ROLE_ALIASES[normalizedRole] || normalizedRole;
};

export const isAdminRole = (role?: string | null): boolean => (
    ADMIN_ROLES.has(String(role || '').trim().toLowerCase())
);

export const sessionHasFrontendPermission = (
    session: PermissionSession | null | undefined,
    permission: FrontendPermission,
): boolean => {
    if (!session) {
        return false;
    }

    // The server-provided permission list is authoritative when present.
    if (Array.isArray(session.permissions)) {
        return session.permissions.includes(permission);
    }

    const normalizedRole = normalizeRole(session.role);
    return FALLBACK_ROLE_PERMISSIONS[normalizedRole]?.has(permission) || false;
};

const RouteLoading = () => (
    <div
        className="flex h-screen items-center justify-center bg-background"
        data-testid="route-loading"
        role="status"
        aria-label="Verifying session"
    >
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
    </div>
);

const RouteSessionUnavailable = ({ onRetry }: { onRetry: () => void }) => (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div
            className="w-full max-w-lg rounded-2xl border border-amber-500/30 bg-card p-6 text-center shadow-lg"
            data-testid="session-unavailable"
            role="alert"
        >
            <h1 className="text-lg font-semibold text-foreground">Session verification unavailable</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The control plane could not verify this session. Protected content remains hidden until
                authoritative verification succeeds. / 控制平面暂时无法验证会话，受保护内容保持隐藏。
            </p>
            <button
                type="button"
                data-testid="route-session-retry"
                onClick={onRetry}
                className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
                Retry verification / 重试验证
            </button>
        </div>
    </div>
);

export const PrivateRoute = ({ children }: { children: ReactNode }) => {
    const [status, setStatus] = useState<SessionGateStatus>('checking');
    const [verifiedSession, setVerifiedSession] = useState<CurrentUserSession | null>(null);
    const [verificationAttempt, setVerificationAttempt] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        let disposed = false;
        let sessionExpired = false;
        let timedOut = false;
        const timeout = window.setTimeout(() => {
            timedOut = true;
            controller.abort();
            if (!disposed && !sessionExpired) {
                setVerifiedSession(null);
                setStatus('unavailable');
            }
        }, ROUTE_SESSION_TIMEOUT_MS);

        const handleSessionExpired = () => {
            sessionExpired = true;
            controller.abort();
            setVerifiedSession(null);
            setStatus('unauthenticated');
        };

        window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
        setVerifiedSession(null);
        setStatus('checking');

        void fetchCurrentUserSession(controller.signal)
            .then((session) => {
                if (disposed || sessionExpired || timedOut) {
                    return;
                }

                if (!session) {
                    setStatus('unauthenticated');
                    return;
                }

                setVerifiedSession(session);
                setStatus('authenticated');
            })
            .catch(() => {
                if (!disposed && !sessionExpired && !timedOut) {
                    setVerifiedSession(null);
                    setStatus('unavailable');
                }
            })
            .finally(() => window.clearTimeout(timeout));

        return () => {
            disposed = true;
            window.clearTimeout(timeout);
            controller.abort();
            window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
        };
    }, [verificationAttempt]);

    if (status === 'checking') {
        return <RouteLoading />;
    }

    if (status === 'unavailable') {
        return <RouteSessionUnavailable onRetry={() => setVerificationAttempt((attempt) => attempt + 1)} />;
    }

    if (status !== 'authenticated' || !verifiedSession) {
        return <Navigate to="/login" replace />;
    }

    return (
        <VerifiedSessionContext.Provider value={verifiedSession}>
            {children}
        </VerifiedSessionContext.Provider>
    );
};

export const AdminRoute = ({ children }: { children: ReactNode }) => {
    const verifiedSession = useContext(VerifiedSessionContext);

    if (!verifiedSession) {
        return <Navigate to="/login" replace />;
    }

    if (!isAdminRole(verifiedSession.role)) {
        return <Navigate to="/dashboard" replace />;
    }

    return <>{children}</>;
};

export const PermissionRoute = ({
    children,
    permission,
}: {
    children: ReactNode;
    permission: FrontendPermission;
}) => {
    const verifiedSession = useContext(VerifiedSessionContext);

    if (!verifiedSession) {
        return <Navigate to="/login" replace />;
    }

    if (!sessionHasFrontendPermission(verifiedSession, permission)) {
        return <Navigate to="/dashboard" replace />;
    }

    return <>{children}</>;
};
