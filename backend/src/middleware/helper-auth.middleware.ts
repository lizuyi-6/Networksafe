import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { sendError } from '../core/http/api-response';
import { AuthenticatedRequest } from './auth.middleware';
import logger from '../utils/logger';

/**
 * SECURITY FIX (audit 2026-08, AG-B04): a single shared
 * `SERIAL_HELPER_SHARED_SECRET` grants every holder full final-defense
 * status-report authority with no way to revoke one appliance. The
 * middleware now accepts NAMED per-helper keys (env
 * `SERIAL_HELPER_EXTRA_SECRETS`, comma-separated `keyId:secret` entries)
 * alongside the legacy shared secret:
 *
 * - Client sends `X-Aetherguard-Helper-Key-Id` (or `...-Secret`) plus the
 *   secret; when a key id is presented, ONLY that named key is compared —
 *   unknown id or mismatch fails closed (no silent fallback to the shared
 *   secret, so a revoked appliance key cannot keep authenticating).
 * - Without a key id the legacy path tries every configured secret
 *   (backwards compatibility for existing deployments).
 * - The matched key id is attached as `req.helperKeyId` for audit trails.
 */

interface HelperCredential {
  keyId: string;
  secret: string;
}

function parseNamedSecrets(raw: string | undefined): HelperCredential[] {
  const value = String(raw || '').trim();
  if (!value) {
    return [];
  }
  const entries: HelperCredential[] = [];
  for (const rawEntry of value.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) {
      continue;
    }
    const separator = entry.indexOf(':');
    if (separator <= 0 || separator >= entry.length - 1) {
      logger.warn('Ignoring malformed SERIAL_HELPER_EXTRA_SECRETS entry (expected keyId:secret)');
      continue;
    }
    entries.push({
      keyId: entry.slice(0, separator).trim(),
      secret: entry.slice(separator + 1).trim()
    });
  }
  return entries;
}

function configuredCredentials(): HelperCredential[] {
  const credentials: HelperCredential[] = [];
  const shared = String(
    process.env.SERIAL_HELPER_SHARED_SECRET
    || process.env.DEVICE_COMMAND_SECRET
    || ''
  ).trim();
  if (shared) {
    credentials.push({ keyId: 'shared', secret: shared });
  }
  credentials.push(...parseNamedSecrets(process.env.SERIAL_HELPER_EXTRA_SECRETS));
  return credentials;
}

function extractPresentedSecret(req: AuthenticatedRequest): string {
  const bearer = String(req.headers.authorization || '').trim();
  if (bearer.startsWith('Bearer ')) {
    return bearer.slice('Bearer '.length).trim();
  }
  return String(
    req.headers['x-aetherguard-helper-secret'] || ''
  ).trim();
}

function extractPresentedKeyId(req: AuthenticatedRequest): string {
  return String(
    req.headers['x-aetherguard-helper-key-id'] || ''
  ).trim().slice(0, 128);
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function authenticateHelperRequest(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const credentials = configuredCredentials();
  if (credentials.length === 0) {
    sendError(res, 503, {
      code: 'HELPER_AUTH_NOT_CONFIGURED',
      message: 'backend.helper_auth_not_configured'
    });
    return;
  }

  const presented = extractPresentedSecret(req);
  const presentedKeyId = extractPresentedKeyId(req);

  let matched: HelperCredential | undefined;
  if (presentedKeyId) {
    // Named-key path: only the named credential may match (no fallback).
    const candidate = credentials.find((c) => c.keyId === presentedKeyId);
    if (candidate && safeEqual(candidate.secret, presented)) {
      matched = candidate;
    }
  } else {
    // Legacy anonymous path: any configured secret accepts.
    matched = credentials.find((c) => safeEqual(c.secret, presented));
  }

  if (!matched) {
    logger.warn('Rejected helper authentication', {
      keyId: presentedKeyId || 'anonymous',
      ip: req.ip
    });
    sendError(res, 401, {
      code: 'HELPER_AUTH_INVALID',
      message: 'backend.helper_auth_invalid'
    });
    return;
  }

  (req as AuthenticatedRequest & { helperKeyId?: string }).helperKeyId = matched.keyId;
  next();
}
