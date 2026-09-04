import type { Request } from 'express';
import { sanitizeString } from '../utils/log-sanitizer';

const REDACTED = '***REDACTED***';

/**
 * Detection is a security sensor, not a credential-processing boundary.
 * Keep this list deliberately broader than the audit-log field list: an
 * unknown header or nested field must not become a covert credential channel.
 */
const SENSITIVE_KEY_PATTERN = /(?:password|passwd|passphrase|secret|token|api[-_]?key|authorization|cookie|set[-_]?cookie|credential|private[-_]?key|client[-_]?secret|access[-_]?token|refresh[-_]?token|id[-_]?token|bearer|jwt|signature|signed[-_]?url|webhook|smtp|dsn|connection[-_]?string|onboarding[-_]?code|enrollment[-_]?token)/i;

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-refresh-token',
  'x-aetherguard-helper-secret',
  'x-aetherguard-helper-key-id',
  'x-device-api-key',
  'x-device-command-secret'
]);

// Only protocol metadata and non-secret browser context are useful to the
// detector. Unknown/custom headers are dropped rather than guessed safe.
const SAFE_HEADER_NAMES = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'content-length',
  'content-type',
  'host',
  'origin',
  'referer',
  'user-agent',
  'x-request-id'
]);

const SENSITIVE_QUERY_KEY_PATTERN = /(?:password|passwd|secret|token|api[-_]?key|auth|credential|signature|sig|jwt|cookie|code|keyid|access[-_]?token|refresh[-_]?token|onboarding[-_]?code|enrollment[-_]?token)/i;

function stripControls(value: string): string {
  return value.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
}

function redactCredentialSyntax(value: string): string {
  let result = stripControls(value);
  // Header-like credentials can occur in opaque bodies or query values.
  result = result.replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, (match) => {
    const scheme = match.slice(0, match.search(/\s/));
    return `${scheme} ${REDACTED}`;
  });
  // Form/query syntax is scrubbed even when it is embedded in an opaque body
  // and therefore cannot be parsed as JSON or URLSearchParams.
  // N5-3: the key token may have a PREFIX — `client_secret`, `access_token`,
  // `refresh_token` start with client/access/refresh, so the sensitive word
  // must be allowed anywhere inside the key, not only at its start.
  result = result.replace(/([?&\s"'][\w.~-]*(?:password|passwd|secret|token|api[-_]?key|authorization|cookie|signature|credential)[\w.~-]*)\s*[:=]\s*([^&\s,;"']+)/gi, `$1=${REDACTED}`);
  // Keep the detector's IP/email/path signals intact. Only credential-shaped
  // tokens are removed here; log-specific PII masking belongs to log-sanitizer.
  result = result.replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, REDACTED);
  result = result.replace(/\b(?:agent|sk|pk)_[a-zA-Z0-9_-]{24,}\b/g, REDACTED);
  return result;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function sanitizeStructured(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (depth > 32) {
    return '[DEPTH_LIMIT]';
  }
  if (typeof value === 'string') {
    return redactCredentialSyntax(value);
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStructured(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key)
      ? REDACTED
      : sanitizeStructured(child, depth + 1);
  }
  return output;
}

function sanitizeQueryPart(rawPart: string): string {
  const equals = rawPart.indexOf('=');
  const rawKey = equals >= 0 ? rawPart.slice(0, equals) : rawPart;
  const rawValue = equals >= 0 ? rawPart.slice(equals + 1) : '';
  let decodedKey = rawKey;
  try {
    decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' '));
  } catch {
    // Keep the raw key and still apply the conservative key pattern.
  }

  if (SENSITIVE_QUERY_KEY_PATTERN.test(decodedKey)) {
    return `${rawKey}=${REDACTED}`;
  }
  return equals >= 0
    ? `${rawKey}=${redactCredentialSyntax(rawValue)}`
    : redactCredentialSyntax(rawPart);
}

/**
 * N5-3: fragments carry OAuth implicit-flow credentials
 * (`#access_token=...&token_type=Bearer`) — sanitize them with the same
 * key-aware rules as the query instead of appending them verbatim.
 */
function sanitizeFragment(rawFragment: string): string {
  if (!rawFragment) {
    return '';
  }
  const body = rawFragment.slice(1); // past '#'
  const sanitized = body.split('&').map(sanitizeQueryPart).join('&');
  return `#${sanitized}`;
}

/** Sanitize a URL without changing safe path bytes or query separators. */
export function sanitizeDetectionUrl(rawUrl: unknown): string {
  const value = String(rawUrl || '/');
  const hashIndex = value.indexOf('#');
  const withoutFragment = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const fragment = hashIndex >= 0 ? sanitizeFragment(value.slice(hashIndex)) : '';
  const queryIndex = withoutFragment.indexOf('?');
  if (queryIndex < 0) {
    return redactCredentialSyntax(withoutFragment) + fragment;
  }
  const path = redactCredentialSyntax(withoutFragment.slice(0, queryIndex));
  const query = withoutFragment.slice(queryIndex + 1)
    .split('&')
    .map(sanitizeQueryPart)
    .join('&');
  return `${path}?${query}${fragment}`;
}

/** Drop credential-bearing headers; retain only safe detector metadata. */
export function sanitizeDetectionHeaders(headers: Record<string, unknown> = {}): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(headers || {})) {
    const key = rawKey.toLowerCase().trim();
    if (!key || SENSITIVE_HEADER_NAMES.has(key) || !SAFE_HEADER_NAMES.has(key)) {
      continue;
    }
    const value = Array.isArray(rawValue)
      ? rawValue.map((item) => String(item ?? '')).join(', ')
      : String(rawValue ?? '');
    output[key] = key === 'origin' || key === 'referer'
      ? sanitizeDetectionUrl(value)
      : redactCredentialSyntax(value);
  }
  return output;
}

/**
 * Convert a request body to a safe textual representation. Structured JSON
 * and form bodies get field-aware redaction; opaque text gets conservative
 * credential syntax redaction. The returned string is the only body value
 * that may be sent to Fastpath, AI shadow, or detection persistence.
 */
export function sanitizeDetectionBody(
  rawBody: unknown,
  contentType = '',
  parsedBody?: unknown
): string {
  const raw = Buffer.isBuffer(rawBody)
    ? rawBody.toString('utf8')
    : String(rawBody ?? '');
  const normalizedContentType = contentType.toLowerCase();

  if (normalizedContentType.includes('application/x-www-form-urlencoded')) {
    try {
      const params = new URLSearchParams(raw);
      const safe = new URLSearchParams();
      for (const [key, value] of params.entries()) {
        safe.set(key, isSensitiveKey(key) ? REDACTED : redactCredentialSyntax(value));
      }
      return safe.toString();
    } catch {
      // Fall through to opaque handling.
    }
  }

  if (normalizedContentType.includes('application/json') || (parsedBody && typeof parsedBody === 'object' && !Buffer.isBuffer(parsedBody))) {
    let parsed: unknown = parsedBody;
    if (parsed === undefined) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
    }
    if (parsed !== undefined) {
      try {
        return JSON.stringify(sanitizeStructured(parsed));
      } catch {
        return REDACTED;
      }
    }
  }

  return redactCredentialSyntax(raw);
}

export function sanitizeDetectionText(value: unknown): string {
  return redactCredentialSyntax(String(value ?? ''));
}

/** Sanitize an already constructed DetectionRequest before persistence/export. */
export function sanitizeDetectionRequestSnapshot(request: Record<string, any>): Record<string, any> {
  const contentType = String(request.headers?.['content-type'] || request.metadata?.contentType || '');
  const safeUrl = sanitizeDetectionUrl(request.path || '/');
  const safeHeaders = sanitizeDetectionHeaders(request.headers || {});
  const safeBody = sanitizeDetectionBody(request.body || '', contentType);
  const safeNormalizedBody = sanitizeDetectionBody(request.normalizedBody || safeBody, contentType);
  const safeParsedBody = sanitizeDetectionBody(request.parsedBody || safeBody, contentType);

  return {
    tenantId: String(request.tenantId || ''),
    channel: request.channel,
    requestId: String(request.requestId || ''),
    timestamp: String(request.timestamp || ''),
    sourceIp: sanitizeDetectionText(request.sourceIp || ''),
    method: String(request.method || ''),
    path: safeUrl,
    decodedPath: sanitizeDetectionUrl(request.decodedPath || safeUrl),
    query: sanitizeDetectionUrl(`/?${String(request.query || '')}`).slice(2),
    decodedQuery: sanitizeDetectionUrl(`/?${String(request.decodedQuery || '')}`).slice(2),
    parsedQuery: sanitizeDetectionText(request.parsedQuery || ''),
    userAgent: sanitizeDetectionText(request.userAgent || safeHeaders['user-agent'] || ''),
    headers: safeHeaders,
    body: safeBody,
    normalizedBody: safeNormalizedBody,
    parsedBody: safeParsedBody,
    evidence: sanitizeDetectionText(request.evidence || ''),
    rawPayload: sanitizeDetectionText(request.rawPayload || ''),
    protocol: String(request.protocol || ''),
    metadata: sanitizeStructured(request.metadata || {})
  };
}

export interface SafeIncomingRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  sourceIp: string;
  contentType: string;
}

/** Build a safe DetectionRequest for model or shadow analysis while keeping
 * non-sensitive control flags used by the pipeline. */
export function sanitizeDetectionRequestForAnalysis(request: Record<string, any>): Record<string, any> {
  const snapshot = sanitizeDetectionRequestSnapshot(request);
  return {
    ...request,
    ...snapshot,
    analysisPurpose: request.analysisPurpose,
    forceDebate: request.forceDebate,
    existingSignals: Array.isArray(request.existingSignals)
      ? sanitizeStructured(request.existingSignals)
      : request.existingSignals
  };
}

/** Build the safe pieces used by both middleware and Fastpath shadow. */
export function sanitizeIncomingRequest(req: Request): SafeIncomingRequest {
  const headers = sanitizeDetectionHeaders(req.headers as Record<string, unknown>);
  const contentType = String(headers['content-type'] || req.headers['content-type'] || '');
  const rawBody = Buffer.isBuffer((req as any).rawBody)
    ? Buffer.from((req as any).rawBody)
    : typeof req.body === 'string'
      ? req.body
      : Buffer.isBuffer(req.body)
        ? req.body
        : req.body && typeof req.body === 'object'
          ? JSON.stringify(req.body)
          : '';
  const sourceIp = String(req.ip || req.socket?.remoteAddress || '').trim();
  return {
    url: sanitizeDetectionUrl(req.originalUrl || req.url || '/'),
    headers,
    body: sanitizeDetectionBody(rawBody, contentType, req.body),
    sourceIp: redactCredentialSyntax(sourceIp),
    contentType
  };
}

export { REDACTED };
