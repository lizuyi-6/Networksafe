import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { verifyToken } from './auth.middleware';
import { detectionPipelineService } from '../services/detection-pipeline.service';
import { fastpathTrafficShadowService } from '../services/fastpath-traffic-shadow.service';
import { PLATFORM_TENANT_ID } from '../core/tenant/tenant-context';
import logger from '../utils/logger';
import { recordApiRequest } from '../services/api-request-tracker.service';

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

function tokenFromRequest(req: Request): string | null {
  const cookieToken = (req as any).cookies?.accessToken;
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim();
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice('Bearer '.length).trim();
    return bearer || null;
  }

  return null;
}

function resolveTenantId(req: Request): string {
  const token = tokenFromRequest(req);
  if (token) {
    const user = verifyToken(token);
    if (user?.tenantId?.trim()) {
      return user.tenantId.trim();
    }
  }

  return String(
    (req as any).tenantContext?.tenantId ||
    (req as any).user?.tenantId ||
    req.headers['x-tenant-id'] ||
    PLATFORM_TENANT_ID
  ).trim() || PLATFORM_TENANT_ID;
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
  fastpathTrafficShadowService.submitFromRequest(req);

  if (req.method === 'OPTIONS' || req.path === '/health' || req.path === '/api/health') {
    next();
    return;
  }

  try {
    const headers = normalizeHeaders(req.headers as Record<string, unknown>);
    const rawUrl = req.originalUrl || req.url || '/';
    const rawBody = resolveRequestBody(req);
    const urlShape = resolveUrlShape(rawUrl);
    const bodyShape = resolveNormalizedBody(req, headers, rawBody);
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
      tenantId: resolveTenantId(req),
      channel: 'http_api',
      requestId: String(req.headers['x-request-id'] || randomUUID()),
      timestamp: new Date().toISOString(),
      sourceIp: String(req.ip || req.socket?.remoteAddress || '').trim(),
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

    if (decision.verdict === 'block') {
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
    logger.warn('HTTP detection pipeline failed, continuing request', {
      path: req.originalUrl || req.url,
      error: error?.message
    });
    next();
  }
}

export default apiTrafficShadowMiddleware;
