import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { sendError } from '../core/http/api-response';
import type { AuthenticatedRequest } from './auth.middleware';

function configuredSecret(): string {
  return String(
    process.env.SERIAL_HELPER_SHARED_SECRET
    || process.env.DEVICE_COMMAND_SECRET
    || ''
  ).trim();
}

function extractPresentedSecret(req: AuthenticatedRequest): string {
  const bearer = String(req.headers.authorization || '').trim();
  if (bearer.startsWith('Bearer ')) {
    return bearer.slice('Bearer '.length).trim();
  }
  return String(req.headers['x-aetherguard-helper-secret'] || '').trim();
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function authenticateHelperRequest(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const expected = configuredSecret();
  if (!expected) {
    sendError(res, 503, {
      code: 'HELPER_AUTH_NOT_CONFIGURED',
      message: 'backend.helper_auth_not_configured'
    });
    return;
  }

  const presented = extractPresentedSecret(req);
  if (!safeEqual(expected, presented)) {
    sendError(res, 401, {
      code: 'HELPER_AUTH_INVALID',
      message: 'backend.helper_auth_invalid'
    });
    return;
  }

  next();
}
