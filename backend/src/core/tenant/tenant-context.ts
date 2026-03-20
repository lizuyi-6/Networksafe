import type { AuthenticatedRequest, AuthenticatedUser } from '../../middleware/auth.middleware';

export const PLATFORM_TENANT_ID = 'platform';

export type TenantSource =
  | 'user'
  | 'request'
  | 'agent'
  | 'device'
  | 'platform';

export interface TenantContext {
  tenantId: string;
  source: TenantSource;
  reason?: string;
}

function readRequestedTenantId(req: AuthenticatedRequest): string | undefined {
  const rawValue =
    req.params?.tenantId ||
    req.query?.tenantId ||
    req.body?.tenantId;

  if (typeof rawValue !== 'string') {
    return undefined;
  }

  const normalized = rawValue.trim();
  return normalized || undefined;
}

export function normalizeTenantId(value?: string | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

export function buildPlatformTenantContext(reason: string): TenantContext {
  return {
    tenantId: PLATFORM_TENANT_ID,
    source: 'platform',
    reason
  };
}

export function resolveUserTenantContext(
  user: AuthenticatedUser | undefined,
  options: {
    requestedTenantId?: string;
    allowAdminPlatformFallback?: boolean;
  } = {}
): TenantContext | null {
  if (!user) {
    return null;
  }

  const requestedTenantId = normalizeTenantId(options.requestedTenantId);
  if (requestedTenantId) {
    return {
      tenantId: requestedTenantId,
      source: 'request'
    };
  }

  const userTenantId = normalizeTenantId(user.tenantId);
  if (userTenantId) {
    return {
      tenantId: userTenantId,
      source: 'user'
    };
  }

  if (user.role === 'admin' && options.allowAdminPlatformFallback) {
    return buildPlatformTenantContext('admin-platform-fallback');
  }

  return null;
}

export function resolveRequestTenantContext(
  req: AuthenticatedRequest,
  options: {
    allowAdminPlatformFallback?: boolean;
  } = {}
): TenantContext | null {
  if (req.tenantContext) {
    return req.tenantContext;
  }

  const context = resolveUserTenantContext(req.user, {
    requestedTenantId: readRequestedTenantId(req),
    allowAdminPlatformFallback: options.allowAdminPlatformFallback
  });

  if (context) {
    req.tenantContext = context;
  }

  return context;
}

export function resolveAgentTenantContext(
  tenantId: string | undefined,
  reason = 'agent-connection'
): TenantContext | null {
  const normalized = normalizeTenantId(tenantId);
  if (!normalized) {
    return null;
  }

  return {
    tenantId: normalized,
    source: 'agent',
    reason
  };
}

export function resolveDeviceTenantContext(explicitTenantId?: string): TenantContext {
  const normalized = normalizeTenantId(explicitTenantId);
  if (normalized) {
    return {
      tenantId: normalized,
      source: 'device'
    };
  }

  return buildPlatformTenantContext('device-platform-scope');
}
