/**
 * Prototype Pollution Guard Middleware
 *
 * SECURITY FIX (R6 V1.6 — Sprint 5 Wave 3 F6): two-stage prototype-pollution
 * guard mounted on the Express app.
 *
 *  Stage 1 (pre-parse): rejects raw URLs containing `__proto__` or
 *    `constructor.prototype` patterns (e.g. `?__proto__[x]=1`). Mounted
 *    BEFORE `express.json()` so a query-string attack never reaches the
 *    body parser.
 *
 *  Stage 2 (post-parse): walks the parsed `req.body`, `req.query`, and
 *    `req.params` for own `__proto__` / `constructor` / `prototype`
 *    keys. In modern V8, `JSON.parse('{"__proto__":...}')` creates an
 *    OWN `__proto__` data property, so `Object.keys()` surfaces it.
 *
 * Both stages return HTTP 400 with the standard envelope
 * `{ success: false, data: null, error: { code: 'PROTOTYPE_POLLUTION_REJECTED', ... } }`
 * and log a warning at WARN level (no body, just metadata).
 *
 * The contract is unit-tested at
 * `src/__tests__/middleware/prototype-pollution-guard.test.ts`.
 */

import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

const PP_KEY_PATTERN = /__proto__|constructor[\s.[\]]*prototype/i;
const PP_OWN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sendReject(
  res: Response,
  req: Request,
  location: string,
  source: string
): void {
  logger.warn('Rejected prototype-pollution attempt', {
    location,
    source,
    ip: req.ip,
    method: req.method,
    path: req.path,
  });
  res.status(400).json({
    success: false,
    data: null,
    error: {
      code: 'PROTOTYPE_POLLUTION_REJECTED',
      message: 'backend.invalid_input',
    },
  });
}

function walkForPPKeys(obj: unknown, path: string): string | null {
  if (obj === null || typeof obj !== 'object') return null;
  for (const key of Object.keys(obj as object)) {
    if (PP_OWN_KEYS.has(key)) {
      return `${path}.${key}`;
    }
    const value = (obj as Record<string, unknown>)[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const found = walkForPPKeys(value, `${path}.${key}`);
      if (found) return found;
    }
  }
  return null;
}

/** Mount BEFORE the body parsers. Catches `?__proto__[x]=1` URL attacks. */
export function preParsePrototypePollutionGuard(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const rawUrl = req.originalUrl || req.url || '';
  if (PP_KEY_PATTERN.test(rawUrl)) {
    sendReject(res, req, 'url', `url:${rawUrl.slice(0, 200)}`);
    return;
  }
  next();
}

/** Mount AFTER the body parsers. Catches parsed-object pollution attempts. */
export function postParsePrototypePollutionGuard(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  for (const where of ['body', 'query', 'params'] as const) {
    const found = walkForPPKeys(req[where], where);
    if (found) {
      sendReject(res, req, found, 'parsed');
      return;
    }
  }
  next();
}
