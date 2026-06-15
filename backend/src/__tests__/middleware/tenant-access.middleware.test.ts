/**
 * Tests for the tenant-access middleware — the gate that resolves and enforces
 * the authenticated user's tenant scope. Mocks res/next and presets
 * req.tenantContext to exercise each branch of the decision logic without
 * pulling in the full tenant-context resolver.
 */

import type { Request, Response, NextFunction } from 'express';
import { requireTenantAccess } from '../../middleware/tenant-access.middleware';
import { PLATFORM_TENANT_ID, type TenantContext } from '../../core/tenant/tenant-context';

type Role = 'platform_admin' | 'tenant_admin' | 'tenant_operator' | 'tenant_viewer';

function makeReq(overrides: Partial<any> = {}): any {
    return {
        user: { id: 'u1', role: 'tenant_admin' as Role, tenantId: 'tenant-a' },
        body: {},
        ...overrides
    };
}

function makeRes(): { res: any; status: jest.Mock; json: jest.Mock } {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn().mockReturnThis();
    return { res: { status, json }, status, json };
}

function ctx(tenantId: string, source: TenantContext['source'] = 'user_claim'): TenantContext {
    return { tenantId, source } as TenantContext;
}

describe('requireTenantAccess middleware', () => {
    it('rejects with 401 when there is no authenticated user', () => {
        const middleware = requireTenantAccess();
        const { res, status } = makeRes();
        const next = jest.fn();
        // Force resolveRequestTenantContext to see no user -> null context path is
        // short-circuited by the explicit !req.user check first.
        middleware({ body: {} } as any, res as unknown as Response, next as NextFunction);
        expect(status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('allows a tenant user and writes the resolved tenantId into req.body', () => {
        const middleware = requireTenantAccess();
        const req = makeReq({ tenantContext: ctx('tenant-a') });
        const { res } = makeRes();
        const next = jest.fn();
        middleware(req, res as unknown as Response, next as NextFunction);
        expect(next).toHaveBeenCalled();
        expect(req.body.tenantId).toBe('tenant-a');
    });

    it('does not overwrite an explicitly provided req.body.tenantId', () => {
        const middleware = requireTenantAccess();
        const req = makeReq({ tenantContext: ctx('tenant-a'), body: { tenantId: 'tenant-explicit' } });
        const { res } = makeRes();
        const next = jest.fn();
        middleware(req, res as unknown as Response, next as NextFunction);
        expect(next).toHaveBeenCalled();
        expect(req.body.tenantId).toBe('tenant-explicit');
    });

    it('forbids a non-platform-admin from resolving to the platform tenant (403)', () => {
        const middleware = requireTenantAccess();
        const req = makeReq({
            user: { id: 'u2', role: 'tenant_admin' as Role, tenantId: PLATFORM_TENANT_ID },
            tenantContext: ctx(PLATFORM_TENANT_ID)
        });
        const { res, status } = makeRes();
        const next = jest.fn();
        middleware(req, res as unknown as Response, next as NextFunction);
        expect(status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('allows a platform_admin using the platform tenant implicitly (allowPlatformAdminImplicit)', () => {
        const middleware = requireTenantAccess({ allowPlatformAdminImplicit: true });
        const req = makeReq({
            user: { id: 'u3', role: 'platform_admin' as Role, tenantId: PLATFORM_TENANT_ID },
            tenantContext: ctx(PLATFORM_TENANT_ID)
        });
        const { res } = makeRes();
        const next = jest.fn();
        middleware(req, res as unknown as Response, next as NextFunction);
        expect(next).toHaveBeenCalled();
    });

    it('allows a platform_admin that performed an explicit tenant switch (override source)', () => {
        const middleware = requireTenantAccess();
        const req = makeReq({
            user: { id: 'u4', role: 'platform_admin' as Role, tenantId: PLATFORM_TENANT_ID },
            tenantContext: ctx('tenant-b', 'platform_admin_override')
        });
        const { res } = makeRes();
        const next = jest.fn();
        middleware(req, res as unknown as Response, next as NextFunction);
        expect(next).toHaveBeenCalled();
    });

    it('forbids a platform_admin reaching a non-platform tenant without an override (403 TENANT_SWITCH_REQUIRED)', () => {
        const middleware = requireTenantAccess();
        // A platform_admin whose context resolves to tenant-b via a legacy/source
        // path other than platform_admin_override must be rejected.
        const req = makeReq({
            user: { id: 'u5', role: 'platform_admin' as Role, tenantId: PLATFORM_TENANT_ID },
            tenantContext: ctx('tenant-b', 'user_claim')
        });
        const { res, status } = makeRes();
        const next = jest.fn();
        middleware(req, res as unknown as Response, next as NextFunction);
        expect(status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
});
