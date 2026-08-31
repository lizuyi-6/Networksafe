import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequest } from './auth.middleware';
import { detectionPipelineService } from '../services/detection-pipeline.service';
import { fastpathTrafficShadowService } from '../services/fastpath-traffic-shadow.service';
import { securityDetectionShadowService } from '../ai/security-detection/security-detection-shadow.service';
import {
  ANONYMOUS_TENANT_ID,
  normalizeTenantId,
  resolveRequestTenantContext
} from '../core/tenant/tenant-context';
import logger from '../utils/logger';
import { recordApiRequest } from '../services/api-request-tracker.service';
import {
  sanitizeIncomingRequest
} from '../security/detection-secret-boundary';

function normalizeHeaderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '')).join(', ');
  }
  return String(value ?? '');
}

function normalizeHeaders(headers: Record<string, unknown>): Record<string, string> {
  return Object.entries(headers || {}).reduce<Record<string, string>>((acc, [key, value]) => {
    if (!key) {
      return acc;
    }
    acc[key.toLowerCase()] = normalizeHeaderValue(value);
    return acc;
  }, {});
}

function resolveTenantId(req: Request): string {
  const context = resolveRequestTenantContext(req as AuthenticatedRequest, {
    allowAdminPlatformFallback: true
  });
  return normalizeTenantId(context?.tenantId) || ANONYMOUS_TENANT_ID;
}

function normalizedRouteCandidates(req: Request): string[] {
  const candidates = new Set<string>();
  for (const raw of [req.path, req.url, req.originalUrl]) {
    const value = String(raw || '').split('?')[0].trim();
    if (!value) {
      continue;
    }
    candidates.add(value);
    if (value.startsWith('/api/')) {
      candidates.add(value.slice('/api'.length));
    }
  }
  return Array.from(candidates);
}

function isAuthPipelineBypass(req: Request): boolean {
  const authPaths = [
    '/auth/login',
    '/auth/oidc/login',
    '/auth/oidc/callback',
    '/auth/me',
    '/auth/refresh',
    '/auth/logout',
    '/auth/register'
  ];
  return normalizedRouteCandidates(req).some((candidate) => (
    authPaths.some((authPath) => candidate === authPath || candidate.startsWith(`${authPath}/`))
  ));
}

function resolveRequestBody(req: Request): string {
  if (Buffer.isBuffer((req as any).rawBody)) {
    return Buffer.from((req as any).rawBody).toString('utf8');
  }
  if (typeof req.body === 'string') {
    return req.body;
  }
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString('utf8');
  }
  if (req.body && typeof req.body === 'object') {
    return JSON.stringify(req.body);
  }
  return '';
}

function safeDecodeTransportValue(value: string): string {
  let decoded = String(value || '');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const normalized = decoded.replace(/\+/g, '%20');
    try {
      const next = decodeURIComponent(normalized);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch {
      decoded = decoded.replace(/\+/g, ' ');
      break;
    }
  }

  return decoded.replace(/\+/g, ' ');
}

function flattenValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => flattenValue(item)).join(', ');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value ?? '');
}

function resolveUrlShape(rawUrl: string): {
  decodedPath: string;
  query: string;
  decodedQuery: string;
  parsedQuery: string;
} {
  try {
    const parsed = new URL(rawUrl || '/', 'http://detector.local');
    const query = parsed.search.startsWith('?') ? parsed.search.slice(1) : '';
    const parsedQuery = Array.from(parsed.searchParams.entries())
      .flatMap(([key, value]) => [`${key}=${value}`, value])
      .join('\n');

    return {
      decodedPath: safeDecodeTransportValue(rawUrl || '/'),
      query,
      decodedQuery: safeDecodeTransportValue(query),
      parsedQuery
    };
  } catch {
    return {
      decodedPath: safeDecodeTransportValue(rawUrl || '/'),
      query: '',
      decodedQuery: '',
      parsedQuery: ''
    };
  }
}

function resolveStructuredBody(body: unknown): string {
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) {
    return '';
  }

  return Object.entries(body as Record<string, unknown>)
    .flatMap(([key, value]) => {
      const flattened = flattenValue(value);
      return [`${key}=${flattened}`, flattened];
    })
    .join('\n');
}

function resolveNormalizedBody(req: Request, headers: Record<string, string>, rawBody: string): {
  normalizedBody: string;
  parsedBody: string;
} {
  const contentType = String(headers['content-type'] || '').toLowerCase();
  const normalizedBody = safeDecodeTransportValue(rawBody || '');

  if (contentType.includes('application/x-www-form-urlencoded')) {
    try {
      const parsed = new URLSearchParams(rawBody || '');
      const parsedBody = Array.from(parsed.entries())
        .flatMap(([key, value]) => [`${key}=${value}`, value])
        .join('\n');

      return {
        normalizedBody,
        parsedBody
      };
    } catch {
      return {
        normalizedBody,
        parsedBody: normalizedBody
      };
    }
  }

  if (contentType.includes('application/json') || typeof req.body === 'object') {
    const parsedBody = resolveStructuredBody(req.body) || normalizedBody;
    return {
      normalizedBody,
      parsedBody
    };
  }

  return {
    normalizedBody,
    parsedBody: normalizedBody
  };
}

export async function apiTrafficShadowMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method === 'OPTIONS' || req.path === '/health' || req.path === '/api/health' || isAuthPipelineBypass(req)) {
    next();
    return;
  }

  fastpathTrafficShadowService.submitFromRequest(req);

  try {
    // Build one sanitized request view before any detector, shadow queue, or
    // persisted snapshot can observe request headers/body values.
    const safeRequest = sanitizeIncomingRequest(req);
    const headers = safeRequest.headers;
    const rawUrl = safeRequest.url;
    const rawBody = safeRequest.body;
    const urlShape = resolveUrlShape(rawUrl);
    const bodyShape = resolveNormalizedBody(
      { ...req, body: rawBody } as Request,
      headers,
      rawBody
    );
    const tenantId = resolveTenantId(req);
    const requestId = headers['x-request-id'] || randomUUID();
    const rawPayload = [
      rawUrl,
      urlShape.decodedPath,
      urlShape.query,
      urlShape.decodedQuery,
      urlShape.parsedQuery,
      rawBody,
      bodyShape.normalizedBody,
      bodyShape.parsedBody
    ].filter(Boolean).join('\n');
    const decision = await detectionPipelineService.evaluateRequest({
      tenantId,
      channel: 'http_api',
      requestId,
      timestamp: new Date().toISOString(),
      sourceIp: safeRequest.sourceIp,
      method: req.method,
      path: rawUrl,
      decodedPath: urlShape.decodedPath,
      query: urlShape.query,
      decodedQuery: urlShape.decodedQuery,
      parsedQuery: urlShape.parsedQuery,
      headers,
      body: rawBody,
      normalizedBody: bodyShape.normalizedBody,
      parsedBody: bodyShape.parsedBody,
      userAgent: headers['user-agent'] || '',
      evidence: '',
      protocol: `HTTP/${req.httpVersion || '1.1'}`,
      rawPayload,
      metadata: {
        contentType: headers['content-type'] || '',
        route: req.path
      }
    });

    (req as any).detectionDecision = decision;

    // Shadow-mode AetherArgus invocation. Fire-and-forget: bounded queue,
    // never throws, never mutates the formal decision above.
    try {
      securityDetectionShadowService.submit({
        requestId,
        snapshot: {
          method: req.method,
          path: rawUrl,
          query: urlShape.query,
          headers,
          body: rawBody
        },
        decision: {
          verdict: decision.verdict,
          matchedRuleIds: decision.matchedRuleIds,
          riskScore: decision.riskScore,
          signals: decision.signals,
          decisionSource: decision.decisionSource,
          aiVerdict: decision.aiVerdict
        }
      });
    } catch {
      // Shadow path is strictly read-only; failures are swallowed by design.
    }

    if (decision.verdict === 'block') {
      const settings = await detectionPipelineService.getSettings(tenantId);
      if (!settings.ruleFirstEnabled) {
        logger.debug('Detection pipeline would block, but rule-first blocking is disabled; allowing request', {
          path: rawUrl,
          matchedRuleIds: decision.matchedRuleIds
        });
        next();
        return;
      }

      // Record blocked request for stats
      const sourceIP = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
      recordApiRequest(true, sourceIP);

      res.status(403).json({
        success: false,
        error: {
          code: 'backend.request_blocked_by_detection_pipeline',
          message: 'Request blocked by rule-first detection pipeline',
          decisionSource: decision.decisionSource,
          matchedRuleIds: decision.matchedRuleIds,
          riskScore: decision.riskScore,
          aiVerdict: decision.aiVerdict || null
        }
      });
      return;
    }

    next();
  } catch (error: any) {
    logger.error('HTTP detection pipeline failed, blocking request fail-closed', {
      path: sanitizeIncomingRequest(req).url,
      error: error?.message
    });
    res.status(503).json({
      success: false,
      error: {
        code: 'backend.detection_pipeline_unavailable',
        message: 'Request blocked because the detection pipeline is unavailable',
        failClosed: true
      }
    });
  }
}

export default apiTrafficShadowMiddleware;
