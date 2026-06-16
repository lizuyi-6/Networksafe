import type { AuthenticatedRequest, AuthenticatedUser } from '../../middleware/auth.middleware';
import { isPlatformAdminRole } from '../../security/permissions';

export const PLATFORM_TENANT_ID = 'platform';

export type TenantSource =
  | 'user'
  | 'request'
  | 'agent'
  | 'device'
  | 'platform'
  | 'platform_admin_override';

export interface TenantContext {
  tenantId: string;
  source: TenantSource;
  reason?: string;
}

/**
 * SECURITY FIX (R1 audit 2026-06-05 V1.1 / R7 V7.3):
 * Thrown by `resolveTenantAsPlatformAdmin` when the caller is not allowed
 * to perform a cross-tenant override, or when the mandatory audit log
 * write fails. Carries a `code` and an HTTP `status` so route handlers
 * and middleware can translate it into a typed envelope response without
 * leaking internal details.
 */
export class TenantResolutionError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'TenantResolutionError';
    this.code = code;
    this.status = status;
    // Restore prototype chain for ES2020 transpile targets.
    Object.setPrototypeOf(this, TenantResolutionError.prototype);
  }
}

/**
 * Audit log sink contract used by `resolveTenantAsPlatformAdmin`.
 * Kept structurally minimal so callers can either pass the production
 * `AuditLogger` singleton or a unit-test mock without coupling to the
 * full repository schema.
 */
export interface TenantOverrideAuditLogger {
  log(entry: {
    userId?: string;
    userEmail?: string;
    tenantId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    details: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    success: boolean;
  }): Promise<string | void>;
}

export interface TenantOverrideOptions {
  reason?: string;
  actorContext?: {
    ip?: string;
    userAgent?: string;
    route?: string;
  };
  auditLogger: TenantOverrideAuditLogger;
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

  // SECURITY FIX (R1 V1.1): a `requestedTenantId` from a request parameter
  // (`?tenantId=...`, `req.body.tenantId`, `req.params.tenantId`) used to be
  // accepted blindly. That allowed any authenticated user to switch the
  // tenant scope of subsequent repository queries.
  //
  // The new contract: the user's own `tenantId` claim is authoritative.
  // The only path to a cross-tenant context is the explicit
  // `resolveTenantAsPlatformAdmin` helper below, which is gated on
  // `platform_admin` role and writes a mandatory audit log entry.
  const userTenantId = normalizeTenantId(user.tenantId);
  if (userTenantId) {
    return {
      tenantId: userTenantId,
      source: 'user'
    };
  }

  // platform_admin without an explicit tenantId claim implicitly resolves
  // to the platform tenant.
  if (isPlatformAdminRole(user.role) && options.allowAdminPlatformFallback) {
    return buildPlatformTenantContext('platform-admin-implicit');
  }

  // legacy `admin` role kept for backward compatibility with seed data.
  if (user.role === 'admin' && options.allowAdminPlatformFallback) {
    return buildPlatformTenantContext('admin-platform-fallback');
  }

  // A `requestedTenantId` is intentionally ignored here. Tests
  // (`tenant-isolation.test.ts`) assert this invariant.
  void options.requestedTenantId;

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

/**
 * SECURITY FIX (R1 V1.1 / R7 V7.3): the ONLY path through which a
 * `platform_admin` user may operate inside a different tenant's data
 * scope. Contract:
 *
 *   1. The caller MUST have role === 'platform_admin'.
 *   2. The caller MUST supply an `auditLogger` with a `.log()` method.
 *      No audit logger -> reject with AUDIT_LOGGER_REQUIRED.
 *   3. `auditLogger.log()` must succeed BEFORE the resolved context is
 *      returned. Any throw / rejection -> reject with AUDIT_LOG_FAILED
 *      and never hand back a cross-tenant context (fail-closed).
 *
 * The returned context carries `source: 'platform_admin_override'`,
 * which `requireTenantAccess` middleware looks for when permitting a
 * platform_admin to act on a non-platform tenant.
 */
export async function resolveTenantAsPlatformAdmin(
  user: AuthenticatedUser | undefined,
  targetTenantId: string,
  options: TenantOverrideOptions
): Promise<TenantContext> {
  if (!user || !isPlatformAdminRole(user.role)) {
    throw new TenantResolutionError(
      'PLATFORM_ADMIN_REQUIRED',
      'Only platform_admin users may perform a cross-tenant override.',
      403
    );
  }

  const normalizedTarget = normalizeTenantId(targetTenantId);
  if (!normalizedTarget) {
    throw new TenantResolutionError(
      'TARGET_TENANT_REQUIRED',
      'A non-empty target tenant id is required.',
      400
    );
  }

  if (!options || !options.auditLogger || typeof options.auditLogger.log !== 'function') {
    throw new TenantResolutionError(
      'AUDIT_LOGGER_REQUIRED',
      'An audit logger with a .log() method is required for tenant override.',
      500
    );
  }

  // Fail-closed: write the audit entry BEFORE returning the override.
  // Any throw — synchronous or asynchronous — is translated into a
  // TenantResolutionError; the caller never receives a cross-tenant
  // context when the audit trail cannot be persisted.
  try {
    await options.auditLogger.log({
      userId: user.userId,
      userEmail: user.email,
      tenantId: normalizedTarget,
      action: 'tenant.override.platform_admin',
      resourceType: 'tenant',
      resourceId: normalizedTarget,
      details: {
        targetTenantId: normalizedTarget,
        reason: options.reason || 'unspecified',
        route: options.actorContext?.route
      },
      ipAddress: options.actorContext?.ip,
      userAgent: options.actorContext?.userAgent,
      success: true
    });
  } catch (err) {
    throw new TenantResolutionError(
      'AUDIT_LOG_FAILED',
      `Audit logger refused to record the override: ${(err as Error)?.message || 'unknown error'}`,
      503
    );
  }

  return {
    tenantId: normalizedTarget,
    source: 'platform_admin_override',
    reason: options.reason
  };
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
