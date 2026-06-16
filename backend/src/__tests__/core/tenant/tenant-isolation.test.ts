/**
 * Tenant Isolation Tests
 *
 * SECURITY FIX (R1 audit 2026-06-05 V1.1):
 *
 * These tests assert the new invariants of the tenant context system:
 *   1. A tenant_admin user CANNOT switch tenants by passing
 *      `?tenantId=B` in the request — the parameter is ignored.
 *   2. A tenant_admin user's resolved context always has
 *      `tenantId === user.tenantId`.
 *   3. A platform_admin user with no tenantId defaults to the platform
 *      tenant.
 *   4. A platform_admin can call `resolveTenantAsPlatformAdmin('B')`
 *      to switch tenants, which records an audit log entry.
 *   5. A non-platform-admin user is rejected when calling
 *      `resolveTenantAsPlatformAdmin`.
 *   6. The `requireTenantAccess` middleware blocks tenant_admin users
 *      from reaching routes that resolve to the platform tenant.
 *
 * SECURITY FIX (R7 audit 2026-06-06 V7.3): the audit logger is mandatory
 * on `resolveTenantAsPlatformAdmin`, and any failure inside it is
 * fail-closed. The V7.3-specific `it(...)` blocks pin down the new
 * contract so future refactors cannot quietly restore the silent
 * fail-open path.
 */

import {
  resolveRequestTenantContext,
  resolveTenantAsPlatformAdmin,
  resolveUserTenantContext,
  TenantResolutionError,
  PLATFORM_TENANT_ID
} from '../../../core/tenant/tenant-context';
import { requireTenantAccess } from '../../../middleware/tenant-access.middleware';
import type { AuthenticatedRequest, AuthenticatedUser } from '../../../middleware/auth.middleware';

const buildReq = (
  user: Partial<AuthenticatedUser> | undefined,
  extras: Partial<AuthenticatedRequest> = {}
): AuthenticatedRequest => {
  return {
    user: user as AuthenticatedUser | undefined,
    body: {},
    ...extras
  } as AuthenticatedRequest;
};

const buildRes = () => {
  const res: any = {
    statusCode: 200,
    body: undefined
  };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload: any) => {
    res.body = payload;
    return res;
  });
  return res;
};

describe('Tenant Isolation: resolveUserTenantContext', () => {
  it('tenant_admin cannot switch tenants via the resolved context (V1.1 fix)', () => {
    // Even though our new signature no longer accepts `requestedTenantId`,
    // legacy callers may still pass it. The runtime must ignore it.
    const user: Partial<AuthenticatedUser> = {
      userId: 'u1',
      email: 'u1@example.com',
      username: 'u1',
      role: 'tenant_admin',
      tenantId: 'tenant-A'
    };
    const ctx = resolveUserTenantContext(user as AuthenticatedUser, {
      ...({ requestedTenantId: 'tenant-B' } as any)
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe('tenant-A');
    expect(ctx!.source).toBe('user');
  });

  it('tenant_admin defaults to user.tenantId from the JWT', () => {
    const user: Partial<AuthenticatedUser> = {
      userId: 'u1',
      email: 'u1@example.com',
      username: 'u1',
      role: 'tenant_admin',
      tenantId: 'tenant-A'
    };
    const ctx = resolveUserTenantContext(user as AuthenticatedUser);
    expect(ctx!.tenantId).toBe('tenant-A');
    expect(ctx!.source).toBe('user');
  });

  it('platform_admin without tenantId defaults to PLATFORM_TENANT_ID', () => {
    const user: Partial<AuthenticatedUser> = {
      userId: 'admin1',
      email: 'admin@example.com',
      username: 'admin',
      role: 'platform_admin'
    };
    const ctx = resolveUserTenantContext(user as AuthenticatedUser, {
      allowAdminPlatformFallback: true
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe(PLATFORM_TENANT_ID);
    expect(ctx!.source).toBe('platform');
  });
});

describe('Tenant Isolation: resolveRequestTenantContext', () => {
  it('does not switch tenants when ?tenantId=B is supplied (V1.1 fix)', () => {
    const user: Partial<AuthenticatedUser> = {
      userId: 'u1',
      email: 'u1@example.com',
      username: 'u1',
      role: 'tenant_admin',
      tenantId: 'tenant-A'
    };
    const req = buildReq(user, {
      query: { tenantId: 'tenant-B' } as any,
      params: { tenantId: 'tenant-B' } as any,
      body: { tenantId: 'tenant-B' }
    });
    const ctx = resolveRequestTenantContext(req);
    expect(ctx!.tenantId).toBe('tenant-A');
  });
});

describe('Tenant Isolation: resolveTenantAsPlatformAdmin', () => {
  it('platform_admin can switch to tenant-B (audited)', async () => {
    const user: Partial<AuthenticatedUser> = {
      userId: 'admin1',
      email: 'admin@example.com',
      username: 'admin',
      role: 'platform_admin'
    };
    const logMock = jest.fn().mockResolvedValue('log-1');
    const ctx = await resolveTenantAsPlatformAdmin(
      user as AuthenticatedUser,
      'tenant-B',
      {
        reason: 'incident-response',
        actorContext: { ip: '10.0.0.1', route: '/api/admin/audit/logs' },
        auditLogger: { log: logMock } as any
      }
    );
    expect(ctx.tenantId).toBe('tenant-B');
    expect(ctx.source).toBe('platform_admin_override');
    expect(logMock).toHaveBeenCalledTimes(1);
    const audit = logMock.mock.calls[0][0];
    expect(audit.tenantId).toBe('tenant-B');
    expect(audit.details.targetTenantId).toBe('tenant-B');
  });

  it('non-platform-admin callers are rejected', async () => {
    const user: Partial<AuthenticatedUser> = {
      userId: 'u1',
      email: 'u1@example.com',
      username: 'u1',
      role: 'tenant_admin',
      tenantId: 'tenant-A'
    };
    await expect(
      resolveTenantAsPlatformAdmin(user as AuthenticatedUser, 'tenant-B', {
        auditLogger: { log: jest.fn().mockResolvedValue('log-1') }
      })
    ).rejects.toBeInstanceOf(TenantResolutionError);
  });
});

/**
 * SECURITY FIX (R7 audit 2026-06-06 V7.3): the audit logger is now
 * mandatory, and any failure inside it is fail-closed. These tests pin
 * down the new fail-closed behavior so future refactors cannot quietly
 * restore the silent fail-open path.
 */
describe('Tenant Isolation: resolveTenantAsPlatformAdmin (R7 V7.3 fail-closed audit)', () => {
  const platformAdmin: Partial<AuthenticatedUser> = {
    userId: 'admin1',
    email: 'admin@example.com',
    username: 'admin',
    role: 'platform_admin'
  };

  it('refuses to resolve a cross-tenant context when no audit logger is supplied', async () => {
    // The TS compiler will reject this at build time, but we also pin
    // down the runtime contract so a `as any` caller cannot get away
    // with it.
    await expect(
      resolveTenantAsPlatformAdmin(
        platformAdmin as AuthenticatedUser,
        'tenant-B',
        undefined as any
      )
    ).rejects.toBeInstanceOf(TenantResolutionError);

    try {
      await resolveTenantAsPlatformAdmin(
        platformAdmin as AuthenticatedUser,
        'tenant-B',
        undefined as any
      );
      fail('expected resolveTenantAsPlatformAdmin to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(TenantResolutionError);
      expect(err.code).toBe('AUDIT_LOGGER_REQUIRED');
      expect(err.status).toBe(500);
    }
  });

  it('refuses to resolve a cross-tenant context when auditLogger has no .log()', async () => {
    await expect(
      resolveTenantAsPlatformAdmin(
        platformAdmin as AuthenticatedUser,
        'tenant-B',
        { auditLogger: {} as any }
      )
    ).rejects.toBeInstanceOf(TenantResolutionError);

    try {
      await resolveTenantAsPlatformAdmin(
        platformAdmin as AuthenticatedUser,
        'tenant-B',
        { auditLogger: {} as any }
      );
      fail('expected resolveTenantAsPlatformAdmin to throw');
    } catch (err: any) {
      expect(err.code).toBe('AUDIT_LOGGER_REQUIRED');
    }
  });

  it('throws TenantResolutionError when auditLogger.log() throws', async () => {
    const logMock = jest.fn().mockRejectedValue(new Error('audit sink offline'));
    await expect(
      resolveTenantAsPlatformAdmin(
        platformAdmin as AuthenticatedUser,
        'tenant-B',
        {
          reason: 'incident-response',
          auditLogger: { log: logMock } as any
        }
      )
    ).rejects.toBeInstanceOf(TenantResolutionError);

    try {
      await resolveTenantAsPlatformAdmin(
        platformAdmin as AuthenticatedUser,
        'tenant-B',
        {
          reason: 'incident-response',
          auditLogger: { log: logMock } as any
        }
      );
      fail('expected resolveTenantAsPlatformAdmin to throw on audit failure');
    } catch (err: any) {
      expect(err).toBeInstanceOf(TenantResolutionError);
      expect(err.code).toBe('AUDIT_LOG_FAILED');
      expect(err.status).toBe(503);
    }
    expect(logMock).toHaveBeenCalled();
  });

  it('does NOT return a cross-tenant context when audit logging fails (fail-closed)', async () => {
    const logMock = jest.fn().mockRejectedValue(new Error('disk full'));
    const result = await resolveTenantAsPlatformAdmin(
      platformAdmin as AuthenticatedUser,
      'tenant-B',
      {
        reason: 'incident-response',
        auditLogger: { log: logMock } as any
      }
    ).then(
      (ctx) => ({ ok: true as const, ctx }),
      (err) => ({ ok: false as const, err })
    );

    // The promise must reject — the caller must never receive a
    // TenantContext when the audit trail cannot be written.
    expect(result.ok).toBe(false);
    if (result.ok) {
      fail('expected the call to throw');
    } else {
      expect(result.err).toBeInstanceOf(TenantResolutionError);
      expect((result.err as TenantResolutionError).code).toBe('AUDIT_LOG_FAILED');
    }
  });

  it('returns the cross-tenant context only after a successful audit log', async () => {
    const logMock = jest.fn().mockResolvedValue('log-1');
    const ctx = await resolveTenantAsPlatformAdmin(
      platformAdmin as AuthenticatedUser,
      'tenant-B',
      {
        reason: 'incident-response',
        actorContext: { ip: '10.0.0.1', route: '/api/admin/audit/logs' },
        auditLogger: { log: logMock } as any
      }
    );
    expect(ctx.tenantId).toBe('tenant-B');
    expect(ctx.source).toBe('platform_admin_override');
    expect(ctx.reason).toBe('incident-response');
    expect(logMock).toHaveBeenCalledTimes(1);
  });

  it('synchronous audit logger throw is also fail-closed', async () => {
    const logMock = jest.fn().mockImplementation(() => {
      throw new Error('synchronous audit failure');
    });
    await expect(
      resolveTenantAsPlatformAdmin(
        platformAdmin as AuthenticatedUser,
        'tenant-B',
        {
          reason: 'incident-response',
          auditLogger: { log: logMock } as any
        }
      )
    ).rejects.toBeInstanceOf(TenantResolutionError);
  });
});

describe('Tenant Isolation: requireTenantAccess middleware', () => {
  it('returns 401 when no user is attached', () => {
    const req = buildReq(undefined);
    const res = buildRes();
    const next = jest.fn();
    requireTenantAccess()(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('returns 403 when a tenant_admin lands on the platform tenant', () => {
    // Force the resolved context to platform to simulate a misconfigured caller.
    const user: Partial<AuthenticatedUser> = {
      userId: 'u1',
      email: 'u1@example.com',
      username: 'u1',
      role: 'tenant_admin',
      tenantId: 'tenant-A'
    };
    const req = buildReq(user);
    // Pre-poison the request with a platform-tenant context.
    req.tenantContext = {
      tenantId: PLATFORM_TENANT_ID,
      source: 'platform',
      reason: 'malicious-pre-poison'
    };
    const res = buildRes();
    const next = jest.fn();
    requireTenantAccess()(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('PLATFORM_ACCESS_FORBIDDEN');
  });

  it('passes through and writes tenantId into body for a normal tenant user', () => {
    const user: Partial<AuthenticatedUser> = {
      userId: 'u1',
      email: 'u1@example.com',
      username: 'u1',
      role: 'tenant_admin',
      tenantId: 'tenant-A'
    };
    const req = buildReq(user);
    const res = buildRes();
    const next = jest.fn();
    requireTenantAccess()(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.tenantContext).toBeDefined();
    expect(req.tenantContext!.tenantId).toBe('tenant-A');
    expect(req.body.tenantId).toBe('tenant-A');
    expect(res.statusCode).toBe(200);
  });

  it('blocks platform_admin from using an unverified tenant context (no override)', () => {
    const user: Partial<AuthenticatedUser> = {
      userId: 'admin1',
      email: 'admin@example.com',
      username: 'admin',
      role: 'platform_admin'
    };
    const req = buildReq(user, {
      body: { tenantId: 'tenant-B' }
    });
    // Force a non-platform, non-override context to simulate a buggy caller.
    req.tenantContext = {
      tenantId: 'tenant-B',
      source: 'user',
      reason: 'malicious-pre-poison'
    };
    const res = buildRes();
    const next = jest.fn();
    requireTenantAccess({ allowPlatformAdminImplicit: false })(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('TENANT_SWITCH_REQUIRED');
  });

  it('allows platform_admin implicit platform access on opt-in routes', () => {
    const user: Partial<AuthenticatedUser> = {
      userId: 'admin1',
      email: 'admin@example.com',
      username: 'admin',
      role: 'platform_admin'
    };
    const req = buildReq(user);
    const res = buildRes();
    const next = jest.fn();
    requireTenantAccess({ allowPlatformAdminImplicit: true })(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.tenantContext!.tenantId).toBe(PLATFORM_TENANT_ID);
  });
});
