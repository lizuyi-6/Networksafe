import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest, requireTenantAccess } from '../../middleware/auth.middleware';
import { requirePlanQuota } from '../../middleware/plan.middleware';
import { sendError, sendSuccess } from '../../core/http/api-response';
import { PLATFORM_TENANT_ID } from '../../core/tenant/tenant-context';
import logger from '../../utils/logger';
import dns from 'dns';
import { promisify } from 'util';
import { securityOperationsService } from '../../services/security-operations.service';
import auditLogger from '../../security/audit-logger.service';
import {
  createSite,
  deleteSiteForUser,
  getSiteForUser,
  listSitesForUser,
  setSiteRepositoryDatabase,
  updateSite
} from '../../modules/sites/site.repository';

const router = Router();
const dnsLookup = promisify(dns.lookup);

export function setDatabase(db: any | null): void {
  setSiteRepositoryDatabase(db);
}

function safeAuditLog(payload: any): void {
  Promise.resolve(auditLogger.log(payload)).catch((error: any) => {
    logger.warn('Audit log unavailable for site route', { error: error?.message });
  });
}

function getSiteExternalRefs(site: any): string[] {
  const refs = new Set<string>();
  if (site?.id !== undefined && site?.id !== null) {
    refs.add(String(site.id));
  }
  if (site?.domain) {
    const domain = String(site.domain);
    refs.add(domain);
    refs.add(`https://${domain}`);
    refs.add(`http://${domain}`);
  }
  if (site?.target) {
    refs.add(String(site.target));
    try {
      refs.add(new URL(String(site.target)).hostname);
    } catch {
      // ignore invalid URLs here; validation already happens on writes
    }
  }
  return Array.from(refs);
}

function hydrateSiteSecurity(tenantId: string, site: any) {
  try {
    const refs = getSiteExternalRefs(site);
    const host = (() => {
      try {
        return site?.target ? new URL(String(site.target)).hostname : undefined;
      } catch {
        return undefined;
      }
    })();

    securityOperationsService.upsertAsset({
      tenantId,
      assetType: 'site',
      externalRef: String(site.id),
      displayName: site.domain || `site-${site.id}`,
      primaryAddress: host,
      status: 'protected',
      metadata: {
        domain: site.domain,
        target: site.target,
        sslEnabled: Boolean(site.sslEnabled)
      }
    });

    if (site?.domain) {
      securityOperationsService.upsertAsset({
        tenantId,
        assetType: 'domain',
        externalRef: String(site.domain),
        displayName: String(site.domain),
        primaryAddress: host,
        status: 'observed',
        metadata: { siteId: site.id, target: site.target }
      });
    }

    if (host) {
      securityOperationsService.upsertAsset({
        tenantId,
        assetType: 'host',
        externalRef: host,
        displayName: host,
        primaryAddress: host,
        status: 'observed',
        metadata: { siteId: site.id, domain: site.domain }
      });
    }

    const context = securityOperationsService.getOperationalContextForExternalRefs(
      tenantId,
      refs,
      ['site', 'domain', 'url', 'host']
    );

    return {
      refs,
      context,
      primaryAsset:
        context.assets.find((asset) => asset.assetType === 'site' && asset.externalRef === String(site.id)) ||
        context.assets.find((asset) => asset.assetType === 'domain' && asset.externalRef === String(site.domain || '')) ||
        context.assets[0] ||
        null
    };
  } catch {
    return {
      refs: getSiteExternalRefs(site),
      context: {
        assets: [],
        findings: [],
        alerts: [],
        actions: [],
        trafficSessions: [],
        serviceExposure: [],
        scanRuns: []
      },
      primaryAsset: null
    };
  }
}

// SECURITY FIX: Apply authentication to all routes
router.use(authenticate);

// SECURITY FIX (R1 V1.1): Apply the new tenant-access middleware AFTER
// authenticate so every site-scoped route resolves its tenant from the
// JWT claim, never from a request-supplied tenantId.
router.use(requireTenantAccess());

/**
 * SECURITY FIX CVE-2026-006: Enhanced SSRF protection
 * Validates URL and resolved IP against private ranges
 */
async function validateTargetUrl(target: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const targetUrl = new URL(target);

    // Block non-HTTP(S) protocols
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return { valid: false, error: 'backend.only_http_and_https_protocols_are_allowed' };
    }

    const hostname = targetUrl.hostname;

    // Block obvious internal hostnames
    const blockedHosts = [
      'localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]',
      'metadata.google.internal', 'metadata.google',
      '169.254.169.254', 'metadata', 'metadata.internal'
    ];
    if (blockedHosts.includes(hostname.toLowerCase())) {
      return { valid: false, error: 'backend.internal_addresses_not_allowed' };
    }

    // SECURITY FIX: Resolve hostname and check resolved IP
    try {
      const { address } = await dnsLookup(hostname);
      if (isPrivateIP(address)) {
        logger.warn('SSRF attempt blocked: DNS resolved to private IP', { hostname, resolvedIP: address });
        return { valid: false, error: 'backend.target_resolves_to_private_ip_address' };
      }
    } catch (dnsError) {
      // If DNS resolution fails, block the request
      return { valid: false, error: 'backend.unable_to_resolve_target_hostname' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'backend.invalid_url_format' };
  }
}

/**
 * SECURITY FIX CVE-2026-006/022: Complete private IP range detection
 */
function isPrivateIP(ip: string): boolean {
  // IPv4 private ranges
  const ipv4PrivatePatterns = [
    /^127\./,                    // Loopback
    /^10\./,                     // Class A private
    /^192\.168\./,               // Class C private
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Class B private (172.16.0.0 - 172.31.255.255)
    /^169\.254\./,               // Link-local
    /^0\./,                      // Current network
    /^224\./,                    // Multicast
    /^240\./,                    // Reserved
    /^255\./,                    // Broadcast
  ];

  for (const pattern of ipv4PrivatePatterns) {
    if (pattern.test(ip)) {
      return true;
    }
  }

  // IPv6 private ranges
  if (ip.includes(':')) {
    const ipv6Lower = ip.toLowerCase();
    if (
      ipv6Lower === '::1' ||           // Loopback
      ipv6Lower.startsWith('fe80:') || // Link-local
      ipv6Lower.startsWith('fc') ||    // Unique local
      ipv6Lower.startsWith('fd') ||    // Unique local
      ipv6Lower.startsWith('::ffff:')  // IPv4-mapped IPv6
    ) {
      return true;
    }
  }

  return false;
}

/**
 * GET /api/sites
 * Get all sites
 * SECURITY FIX CVE-2026-002: Added tenant isolation
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const sites = await listSitesForUser(user.role, user.tenantId);

    // Convert integer booleans
    const formattedSites = sites.map((site: any) => {
      const normalized = {
        ...site,
        sslEnabled: Boolean(site.sslEnabled),
        antiBotEnabled: Boolean(site.antiBotEnabled),
        rateLimitEnabled: Boolean(site.rateLimitEnabled),
        concurrencyEnabled: Boolean(site.concurrencyEnabled)
      };
      const security = hydrateSiteSecurity(
        user.role === 'admin'
          ? (site.tenant_id || user.tenantId || PLATFORM_TENANT_ID)
          : (user.tenantId || PLATFORM_TENANT_ID),
        normalized
      );

      return {
        ...normalized,
        securitySummary: {
          asset: security.primaryAsset,
          alerts: security.context.alerts.slice(0, 3),
          findings: security.context.findings.slice(0, 3),
          actions: security.context.actions.slice(0, 3),
          recentScans: security.context.scanRuns.slice(0, 3),
          serviceExposure: security.context.serviceExposure.slice(0, 5)
        }
      };
    });

    return sendSuccess(res, formattedSites);
  } catch (error: any) {
    logger.error('Failed to get sites', { error });
    return sendError(res, 500, {
      code: 'INTERNAL_ERROR',
      message: 'backend.internal_server_error'
    });
  }
});

/**
 * GET /api/sites/:id
 * Get site by ID
 * SECURITY FIX CVE-2026-002: Added tenant isolation
 */
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const site = await getSiteForUser(req.params.id, user.role, user.tenantId);

    if (!site) {
      return sendError(res, 404, {
        code: 'SITE_NOT_FOUND',
        message: 'backend.site_not_found'
      });
    }

    const tenantId = user.role === 'admin'
      ? (site.tenant_id || user.tenantId || PLATFORM_TENANT_ID)
      : (user.tenantId || PLATFORM_TENANT_ID);
    const security = hydrateSiteSecurity(tenantId, site);

    return sendSuccess(res, {
      ...site,
      securityOverview: {
        asset: security.primaryAsset,
        assets: security.context.assets,
        findings: security.context.findings,
        alerts: security.context.alerts,
        actions: security.context.actions,
        scans: security.context.scanRuns,
        trafficSessions: security.context.trafficSessions,
        serviceExposure: security.context.serviceExposure
      },
      relatedAlerts: security.context.alerts,
      relatedFindings: security.context.findings,
      relatedActions: security.context.actions,
      relatedScans: security.context.scanRuns,
      relatedFlows: security.context.trafficSessions,
      serviceExposure: security.context.serviceExposure
    });
  } catch (error: any) {
    logger.error('Failed to get site', { error });
    return sendError(res, 500, {
      code: 'INTERNAL_ERROR',
      message: 'backend.internal_server_error'
    });
  }
});

/**
 * POST /api/sites
 * Create new site
 * SECURITY FIX CVE-2026-002/006: Added tenant isolation and enhanced SSRF protection
 */
router.post('/', requirePlanQuota('site'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { domain, target, sslEnabled = true, security } = req.body;
    const user = req.user!;

    if (!domain || !target) {
      return res.status(400).json({ success: false, error: 'backend.domain_and_target_are_required' });
    }

    // SECURITY FIX CVE-2026-006: Enhanced SSRF validation with DNS resolution check
    const validation = await validateTargetUrl(target);
    if (!validation.valid) {
      return sendError(res, 400, {
        code: 'INVALID_TARGET',
        message: String(validation.error || 'backend.invalid_url_format')
      });
    }

    const siteId = await createSite({
      domain,
      target,
      sslEnabled: sslEnabled ? 1 : 0,
      tenant_id: user.tenantId,
      antiBotEnabled: security?.antiBot ? 1 : 0,
      rateLimitEnabled: security?.rateLimit?.enabled ? 1 : 0,
      concurrencyEnabled: security?.concurrency?.enabled ? 1 : 0,
      rateLimitRequests: security?.rateLimit?.requestsPerMinute || 60,
      concurrencyMax: security?.concurrency?.maxConcurrent || 5
    });

    logger.info(`Site created: ${domain} -> ${target}`, { userId: user.userId, tenantId: user.tenantId });
    safeAuditLog({
      tenantId: user.tenantId,
      eventType: 'site_created',
      category: 'system',
      severity: 'warning',
      actor: { type: 'user', id: user.userId, email: user.email, ip: req.ip },
      target: { type: 'server', id: domain },
      action: 'create_site',
      details: { domain, target, sslEnabled },
      status: 'success'
    });

    return sendSuccess(res, { id: siteId, domain, target }, undefined, 201);
  } catch (error: any) {
    logger.error('Failed to create site', { error });
    return sendError(res, 500, {
      code: 'INTERNAL_ERROR',
      message: 'backend.internal_server_error'
    });
  }
});

/**
 * PUT /api/sites/:id
 * Update site
 * SECURITY FIX CVE-2026-002/006: Added tenant isolation and SSRF protection
 */
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { domain, target, sslEnabled, security } = req.body;
    const user = req.user!;
    const existingSite = await getSiteForUser(req.params.id, user.role, user.tenantId);

    if (!existingSite) {
      return sendError(res, 404, {
        code: 'SITE_NOT_FOUND',
        message: 'backend.site_not_found'
      });
    }

    // SECURITY FIX CVE-2026-006: Validate target URL if being updated
    if (target) {
      const validation = await validateTargetUrl(target);
      if (!validation.valid) {
        return sendError(res, 400, {
          code: 'INVALID_TARGET',
          message: String(validation.error || 'backend.invalid_url_format')
        });
      }
    }

    await updateSite(req.params.id, {
      domain,
      target,
      sslEnabled: typeof sslEnabled === 'boolean' ? sslEnabled : undefined,
      antiBotEnabled: security?.antiBot,
      rateLimitEnabled: security?.rateLimit?.enabled,
      concurrencyEnabled: security?.concurrency?.enabled,
      rateLimitRequests: security?.rateLimit?.requestsPerMinute,
      concurrencyMax: security?.concurrency?.maxConcurrent
    });

    logger.info(`Site updated: ${req.params.id}`, { userId: user.userId });
    safeAuditLog({
      tenantId: user.tenantId,
      eventType: 'site_updated',
      category: 'system',
      severity: 'warning',
      actor: { type: 'user', id: user.userId, email: user.email, ip: req.ip },
      target: { type: 'server', id: String(req.params.id) },
      action: 'update_site',
      details: {
        siteId: req.params.id,
        domain: domain || existingSite.domain,
        target: target || existingSite.target,
        sslEnabled: typeof sslEnabled === 'boolean' ? sslEnabled : existingSite.sslEnabled
      },
      status: 'success'
    });

    return sendSuccess(res, { updated: true }, {
      legacy: { status: 'ok' }
    });
  } catch (error: any) {
    logger.error('Failed to update site', { error });
    return sendError(res, 500, {
      code: 'INTERNAL_ERROR',
      message: 'backend.internal_server_error'
    });
  }
});

/**
 * DELETE /api/sites/:id
 * Delete site
 * SECURITY FIX CVE-2026-002: Added tenant isolation
 */
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const changes = await deleteSiteForUser(req.params.id, user.role, user.tenantId);

    if (changes === 0) {
      return sendError(res, 404, {
        code: 'SITE_NOT_FOUND',
        message: 'backend.site_not_found'
      });
    }

    logger.info(`Site deleted: ${req.params.id}`, { userId: user.userId });
    safeAuditLog({
      tenantId: user.tenantId,
      eventType: 'site_deleted',
      category: 'system',
      severity: 'critical',
      actor: { type: 'user', id: user.userId, email: user.email, ip: req.ip },
      target: { type: 'server', id: String(req.params.id) },
      action: 'delete_site',
      details: { siteId: req.params.id },
      status: 'success'
    });

    return sendSuccess(res, { deleted: true }, {
      legacy: { status: 'ok' }
    });
  } catch (error: any) {
    logger.error('Failed to delete site', { error });
    return sendError(res, 500, {
      code: 'INTERNAL_ERROR',
      message: 'backend.internal_server_error'
    });
  }
});

export default router;
