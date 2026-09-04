/**
 * Log Sanitizer Utility
 *
 * SECURITY FIX for RISK-003: Sensitive Information in Logs
 *
 * Removes sensitive data (passwords, API keys, tokens, etc.) from logs
 */

/**
 * Sensitive field patterns to redact
 */
const SENSITIVE_PATTERNS = [
  // Passwords and secrets
  /"password":\s*"[^"]+"/gi,
  /"secret":\s*"[^"]+"/gi,
  /"secretKey":\s*"[^"]+"/gi,
  /"apiKey":\s*"[^"]+"/gi,
  /"api_key":\s*"[^"]+"/gi,
  /"accessToken":\s*"[^"]+"/gi,
  /"refreshToken":\s*"[^"]+"/gi,
  /"token":\s*"[^"]+"/gi,
  /"authorization":\s*"[^"]+"/gi,
  /"bearer":\s*"[^"]+"/gi,

  // JWT tokens
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,

  // API keys (common formats)
  /agent_[a-zA-Z0-9]{48,}/g,
  /sk_[a-zA-Z0-9]{32,}/g,
  /pk_[a-zA-Z0-9]{32,}/g,

  // Email addresses (partial redaction)
  /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Z|a-z]{2,})\b/g,

  // IP addresses (partial redaction)
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,

  // Credit card numbers
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,

  // SSN (US Social Security)
  /\b\d{3}-\d{2}-\d{4}\b/g,
];

/**
 * Fields to completely remove (redact with asterisks)
 *
 * NOTE: `jwt` is intentionally NOT in this list. JWTs are redacted via
 * the SENSITIVE_PATTERNS regex (`eyJ...`), which preserves a first4…last4
 * partial reveal for operator diagnostics. Putting `jwt` here would fully
 * REDACT it and break that partial-reveal contract.
 *
 * `cookie` is a STRING-VALUE redaction (see isSensitiveField): a raw cookie
 * header string is always fully redacted, while an object under a *cookie*
 * key is walked normally — that carve-out exists for value-free audit
 * diagnostics ({present, cookieNames}) which contain no values by
 * construction (R2-F001). Any string nested inside such an object still goes
 * through sanitizeString, so a raw value smuggled into it cannot survive.
 */
const REDACT_FIELDS = [
  'password',
  'secret',
  'secretKey',
  'apiKey',
  'api_key',
  'accessToken',
  'refreshToken',
  'token',
  'authorization',
  'bearer',
  'cookie',
  'nonce',
  'signature',
  'csrf',
  'ssn',
  'socialSecurity',
  'creditCard',
  'cvv',
  'pin',
];

/**
 * A field is sensitive when its name contains a REDACT_FIELDS entry — with
 * one carve-out: `cookie` only redacts STRING values (raw cookie headers).
 * Structured objects under *cookie* keys are walked instead, so value-free
 * audit diagnostics survive; every string inside them still passes
 * sanitizeString, which pattern-redacts any JWT/credential they contain.
 */
function isSensitiveField(lowerKey: string, value: any): boolean {
  return REDACT_FIELDS.some(sensitive => {
    if (!lowerKey.includes(sensitive.toLowerCase())) {
      return false;
    }
    if (sensitive === 'cookie' && value !== null && typeof value === 'object') {
      return false;
    }
    return true;
  });
}

/**
 * Sanitize an object by removing sensitive fields
 *
 * SECURITY (R7 V7.5 Issue 1 regression): primitive leaf values that are
 * strings are run through `sanitizeString` so JWTs / API keys / IPs that
 * appear inside non-redacted fields (or as raw error messages) are
 * pattern-redacted. Previously only structural field-name redaction ran,
 * which meant a `jwt` field whose key wasn't in REDACT_FIELDS, or any
 * string containing a token, leaked verbatim into operator logs.
 */
export function sanitizeObject(obj: any, maxDepth: number = 10): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Primitive leaf — sanitize strings so embedded secrets are redacted.
  if (typeof obj !== 'object') {
    return typeof obj === 'string' ? sanitizeString(obj) : obj;
  }

  // Arrays
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, maxDepth - 1));
  }

  // Objects
  const sanitized: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Check if this is a sensitive field
    const isSensitive = isSensitiveField(lowerKey, value);

    if (isSensitive) {
      if (lowerKey.includes('apikey') || lowerKey.includes('api_key')) {
        sanitized[key] = partiallyRedactSecret(value);
      } else {
        sanitized[key] = '***REDACTED***';
      }
    } else if (maxDepth > 0 && typeof value === 'object') {
      sanitized[key] = sanitizeObject(value, maxDepth - 1);
    } else {
      sanitized[key] = typeof value === 'string' ? sanitizeString(value) : value;
    }
  }

  return sanitized;
}

/**
 * Sanitize a string by redacting sensitive patterns
 */
export function sanitizeString(str: string): string {
  if (typeof str !== 'string') {
    return str;
  }

  let sanitized = str;

  // Apply all sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      // For tokens/keys, show first 4 and last 4 characters
      if (match.length > 20) {
        const start = match.substring(0, 4);
        const end = match.substring(match.length - 4);
        return `${start}...${end}`;
      }

      // For shorter strings, completely redact
      return '***REDACTED***';
    });
  }

  return sanitized;
}

/**
 * Sanitize error objects
 */
export function sanitizeError(error: any): any {
  if (!error) return error;

  return {
    name: error.name,
    message: sanitizeString(error.message || ''),
    code: error.code,
    status: error.status,
    // Stack traces are useful for debugging but shouldn't be in production logs
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
  };
}

/**
 * Main sanitization function - handles any input type
 */
export function sanitize(input: any): any {
  if (input === null || input === undefined) {
    return input;
  }

  // Strings
  if (typeof input === 'string') {
    return sanitizeString(input);
  }

  // Objects (including arrays)
  if (typeof input === 'object') {
    return sanitizeObject(input);
  }

  // Primitives
  return input;
}

/**
 * Specialized sanitizers for specific use cases
 */

export const Sanitizers = {
  /**
   * Sanitize user data for logs
   */
  user(user: any): any {
    return sanitizeObject({
      userId: user.userId,
      email: user.email ? partiallyRedactEmail(user.email) : undefined,
      username: user.username,
      role: user.role,
      // Exclude sensitive fields
    });
  },

  /**
   * Sanitize agent data for logs
   */
  agent(agent: any): any {
    return sanitizeObject({
      agentId: agent.agentId,
      hostname: agent.hostname,
      platform: agent.platform,
      status: agent.status,
      // Exclude API keys and secrets
    });
  },

  /**
   * Sanitize request data for logs
   */
  request(req: any): any {
    return {
      method: req.method,
      path: req.path,
      query: sanitizeObject(req.query),
      body: sanitizeObject(req.body),
      headers: sanitizeObject({
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type'],
        // Exclude authorization headers
      }),
    };
  },

  /**
   * Sanitize audit log data
   */
  auditLog(log: any): any {
    return sanitizeObject({
      eventType: log.eventType,
      category: log.category,
      severity: log.severity,
      actor: log.actor ? {
        type: log.actor.type,
        id: log.actor.id,
        // Exclude sensitive actor details
      } : undefined,
      action: log.action,
      target: log.target,
      // Sanitize details to remove secrets
      details: log.details ? sanitizeObject(log.details) : undefined,
      status: log.status,
      timestamp: log.timestamp,
    });
  },
};

/**
 * Partially redact email address
 * Example: john.doe@example.com -> j***@example.com
 */
function partiallyRedactEmail(email: string): string {
  if (typeof email !== 'string') return email;

  const parts = email.split('@');
  if (parts.length !== 2) return '***REDACTED***';

  const [username, domain] = parts;
  const redactedUsername = username.charAt(0) + '***';

  return `${redactedUsername}@${domain}`;
}

/**
 * Partially redact IP address
 * Example: 192.168.1.100 -> 192.168.*.*
 */
function partiallyRedactIP(ip: string): string {
  if (typeof ip !== 'string') return ip;

  const parts = ip.split('.');
  if (parts.length !== 4) return '***REDACTED***';

  return `${parts[0]}.${parts[1]}.*.*`;
}

function partiallyRedactSecret(value: unknown): string {
  if (typeof value !== 'string' || value.length <= 8) {
    return '***REDACTED***';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

// =====================================================================
// D31: strip log-injection control characters (\n \r \t \0) from any
// string value, recursing into objects and arrays. Used by the
// audit logger to sanitize user-supplied `details` before persistence.
// =====================================================================

const CONTROL_CHAR_PATTERN = /[\n\r\t\0]/g;

/**
 * Strip control characters from a single string. Returns the original
 * value untouched if it is not a string.
 */
export function stripControlChars(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(CONTROL_CHAR_PATTERN, ' ');
}

/**
 * Recursively walk an object/array and strip control characters from
 * every string value. Combines control-char stripping with
 * sensitive-pattern redaction (the audit-log details redteam test
 * expects `password: 'secret\ntoken'` to become `***REDACTED***`).
 */
export function recursiveSanitize(value: any, depth: number = 10): any {
  if (value === null || value === undefined) return value;
  // SECURITY (audit 2026-08, AUD-01-3): depth exhaustion must NOT return the
  // raw value — a deeply nested attacker-controlled structure used to walk
  // past the limit and land in logs completely unredacted. Strings still get
  // pattern-redacted; container objects collapse to a placeholder.
  if (depth <= 0) {
    if (typeof value === 'string') {
      return stripControlChars(sanitizeString(value));
    }
    if (Array.isArray(value) || typeof value === 'object') {
      return '[depth-limited]';
    }
    return value;
  }
  if (Array.isArray(value)) {
    const out: any[] = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      out[i] = recursiveSanitize(value[i], depth - 1);
    }
    return out;
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      const lowerKey = key.toLowerCase();
      // Sensitive field → redact (full redaction for non-API keys,
      // partial for api_key/apiKey so support staff can still tell
      // which key was leaked).
      const isApiKey = lowerKey.includes('apikey') || lowerKey.includes('api_key');
      const isSensitive = isSensitiveField(lowerKey, value[key]);
      if (isSensitive) {
        out[key] = isApiKey
          ? partiallyRedactSecret(value[key])
          : '***REDACTED***';
      } else {
        out[key] = recursiveSanitize(value[key], depth - 1);
      }
    }
    return out;
  }
  if (typeof value === 'string') {
    // SECURITY (R2-F001 follow-up): pattern-redact string leaves, not just
    // strip control chars. The `cookie` carve-out walks structured objects,
    // so any string nested inside them (e.g. a JWT smuggled into a
    // diagnostics array) must still hit the SENSITIVE_PATTERNS redaction —
    // stripControlChars alone let it persist verbatim.
    return stripControlChars(sanitizeString(value));
  }
  // numbers, booleans, bigints, symbols — pass through
  return value;
}

export default {
  sanitize,
  sanitizeObject,
  sanitizeString,
  sanitizeError,
  recursiveSanitize,
  stripControlChars,
  ...Sanitizers,
};
