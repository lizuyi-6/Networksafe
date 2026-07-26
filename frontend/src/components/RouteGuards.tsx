import { type ReactNode, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { fetchApiReadiness, fetchCurrentUserSession } from '../services/api';

export type FrontendPermission =
    | 'gate.read'
    | 'gate.enroll'
    | 'deployment.run.read'
    | 'deployment.run.create'
    | 'deployment.run.approve'
    | 'deployment.evidence.read'
    | 'deployment.evidence.export';

const ROLE_ALIASES: Record<string, string> = {
    admin: 'platform_admin',
    tenant: 'tenant_admin',
    viewer: 'tenant_viewer',
};

const ROLE_PERMISSIONS: Record<string, ReadonlySet<FrontendPermission>> = {
    platform_admin: new Set(['gate.read', 'gate.enroll', 'deployment.run.read', 'deployment.run.create', 'deployment.run.approve', 'deployment.evidence.read', 'deployment.evidence.export']),
    tenant_admin: new Set(['gate.read', 'gate.enroll', 'deployment.run.read', 'deployment.run.create', 'deployment.run.approve', 'deployment.evidence.read', 'deployment.evidence.export']),
    tenant_operator: new Set(['gate.read', 'deployment.run.read', 'deployment.run.create', 'deployment.evidence.read']),
    tenant_viewer: new Set(['deployment.run.read', 'deployment.evidence.read']),
    auditor: new Set(['deployment.run.read', 'deployment.evidence.read', 'deployment.evidence.export']),
};
const SESSION_EXPIRED_EVENT = 'aetherguard:session-expired';

const LoadingScreen = () => (
    <div data-testid="route-loading" className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" />
    </div>
);

export const PrivateRoute = ({ children }: { children: ReactNode }) => {
    const [authenticated, setAuthenticated] = useState<boolean | null>(null);

    useEffect(() => {
        let disposed = false;

        const expireSession = () => {
            setAuthenticated(false);
        };

        const resolveSession = async () => {
            try {
                const readiness = await fetchApiReadiness(AbortSignal.timeout(3000));
                if (disposed) return;
                if (!readiness.ok || readiness.status !== 'ready') {
                    setAuthenticated(false);
                    return;
                }
                const user = await fetchCurrentUserSession(AbortSignal.timeout(5000), { allowCachedFallback: false });
                if (disposed) return;
                setAuthenticated(Boolean(user));
            } catch {
                if (disposed) return;
                setAuthenticated(false);
            }
        };

        window.addEventListener(SESSION_EXPIRED_EVENT, expireSession);
        void resolveSession();

        return () => {
            disposed = true;
            window.removeEventListener(SESSION_EXPIRED_EVENT, expireSession);
        };
    }, []);

    if (authenticated === null) return <LoadingScreen />;
    if (!authenticated) return <Navigate to="/login" replace />;

    return <>{children}</>;
};

const normalizeRole = (role?: string | null) => {
    const normalized = String(role || '').trim().toLowerCase();
    return ROLE_ALIASES[normalized] || normalized;
};

export const hasFrontendPermission = (role: string | null | undefined, permission: FrontendPermission) => (
    ROLE_PERMISSIONS[normalizeRole(role)]?.has(permission) === true
);

export const sessionHasFrontendPermission = (
    user: { role?: string | null; permissions?: string[] } | null | undefined,
    permission: FrontendPermission,
) => (
    Array.isArray(user?.permissions)
        ? user.permissions.includes(permission)
        : hasFrontendPermission(user?.role, permission)
);

const SessionRoute = ({
    children,
    allowed,
}: {
    children: ReactNode;
    allowed: (user: { role?: string | null; permissions?: string[] }) => boolean;
}) => {
    const [allowedForSession, setAllowedForSession] = useState<boolean | undefined>(undefined);

    useEffect(() => {
        const controller = new AbortController();
        let disposed = false;

        void fetchApiReadiness(controller.signal)
            .then((readiness) => {
                if (!readiness.ok || readiness.status !== 'ready') return null;
                return fetchCurrentUserSession(controller.signal, { allowCachedFallback: false });
            })
            .then((user) => {
                if (!disposed) setAllowedForSession(user ? allowed(user) : false);
            })
            .catch(() => {
                if (!disposed) setAllowedForSession(false);
            });

        return () => {
            disposed = true;
            controller.abort();
        };
    }, []);

    if (allowedForSession === undefined) return <LoadingScreen />;
    if (!allowedForSession) return <Navigate to="/dashboard" replace />;
    return <>{children}</>;
};

export const AdminRoute = ({ children }: { children: ReactNode }) => (
    <SessionRoute allowed={(user) => isAdminRole(user.role)}>{children}</SessionRoute>
);

export const PermissionRoute = ({
    children,
    permission,
}: {
    children: ReactNode;
    permission: FrontendPermission;
}) => (
    <SessionRoute allowed={(user) => sessionHasFrontendPermission(user, permission)}>{children}</SessionRoute>
);

export const isAdminRole = (role?: string | null) => normalizeRole(role) === 'platform_admin';
export const canReadHardwareGates = (role?: string | null) => hasFrontendPermission(role, 'gate.read');
export const canManageHardwareGates = (role?: string | null) => hasFrontendPermission(role, 'gate.enroll');
export const canReadDeploymentRuns = (role?: string | null) => hasFrontendPermission(role, 'deployment.run.read');
export const canCreateDeploymentRuns = (role?: string | null) => hasFrontendPermission(role, 'deployment.run.create');
export const canApproveDeploymentRuns = (role?: string | null) => hasFrontendPermission(role, 'deployment.run.approve');
export const canReadDeploymentEvidence = (role?: string | null) => hasFrontendPermission(role, 'deployment.evidence.read');
export const canExportDeploymentEvidence = (role?: string | null) => hasFrontendPermission(role, 'deployment.evidence.export');
