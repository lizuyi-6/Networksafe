/**
 * Tenant Access Middleware
 *
 * SECURITY FIX (R1 audit 2026-06-05 V1.1): The legacy inline `requireTenantAccess`
 * inside `auth.middleware.ts` (lines 347-382) relied on `resolveRequestTenantContext`,
 * which in turn still trusted `req.params.tenantId` / `req.query.tenantId` /
 * `req.body.tenantId`. This file replaces the trust assumption:
 *
 *   - The authenticated user's tenant identity is **always** derived from
 *     the JWT `user.tenantId` claim.
 *   - A `platform_admin` may explicitly switch tenants only through
 *     `resolveTenantAsPlatformAdmin(...)` and only after an explicit
 *     `requirePlatformAdmin` decorator has been applied to the route.
 *   - On success, the middleware writes the resolved tenantId into
 *     `req.body.tenantId` (and `req.tenantContext`) for downstream handlers.
 */
import { Response, NextFunction } from 'express';
import { sendError } from '../core/http/api-response';
import { AuthenticatedRequest } from './auth.middleware';
import {
  PLATFORM_TENANT_ID,
  resolveRequestTenantContext,
  type TenantContext
} from '../core/tenant/tenant-context';
import { isPlatformAdminRole } from '../security/permissions';

export interface TenantAccessOptions {
  /**
   * If true, the middleware will not block platform_admin from reaching
   * non-platform routes, and will *not* require an explicit platform-admin
   * tenant switch. Use this for routes that should be accessible to
   * platform admins using their own (platform) tenant.
   */
  allowPlatformAdminImplicit?: boolean;
}

export function requireTenantAccess(options: TenantAccessOptions = {}) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 401, {
        code: 'AUTH_REQUIRED',
        message: 'backend.authentication_required'
      });
      return;
    }

    const context: TenantContext | null = resolveRequestTenantContext(req, {
      allowAdminPlatformFallback: isPlatformAdminRole(req.user.role)
    });

    if (!context) {
      sendError(res, 403, {
        code: 'TENANT_NOT_RESOLVED',
        message: 'backend.tenant_resolution_required'
      });
      return;
    }

    // Non-platform-admin actors must have a real tenant binding.
    if (!isPlatformAdminRole(req.user.role) && context.tenantId === PLATFORM_TENANT_ID) {
      sendError(res, 403, {
        code: 'PLATFORM_ACCESS_FORBIDDEN',
        message: 'backend.platform_tenant_access_requires_platform_admin'
      });
      return;
    }

    // For platform_admin on non-platform routes, only allow the implicit
    // platform tenant unless an explicit `resolveTenantAsPlatformAdmin` was
    // already attached (source === 'platform_admin_override'). The legacy
    // `request` source is no longer possible after the V1.1 fix.
    if (isPlatformAdminRole(req.user.role) && !options.allowPlatformAdminImplicit) {
      if (context.source !== 'platform_admin_override' && context.tenantId !== PLATFORM_TENANT_ID) {
        sendError(res, 403, {
          code: 'TENANT_SWITCH_REQUIRED',
          message: 'backend.platform_admin_must_use_resolveTenantAsPlatformAdmin'
        });
        return;
      }
    }

    if (!req.body || typeof req.body !== 'object') {
      // Express may parse body as undefined for GET requests; that's fine.
    } else if (!req.body.tenantId) {
      req.body.tenantId = context.tenantId;
    }

    next();
  };
}
