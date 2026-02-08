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
 * Sanitize an object by removing sensitive fields
 */
export function sanitizeObject(obj: any, maxDepth: number = 10): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Primitive types
  if (typeof obj !== 'object') {
    return obj;
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
    const isSensitive = REDACT_FIELDS.some(sensitive =>
      lowerKey.includes(sensitive.toLowerCase())
    );

    if (isSensitive) {
      sanitized[key] = '***REDACTED***';
    } else if (maxDepth > 0 && typeof value === 'object') {
      sanitized[key] = sanitizeObject(value, maxDepth - 1);
    } else {
      sanitized[key] = value;
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

export default {
  sanitize,
  sanitizeObject,
  sanitizeString,
  sanitizeError,
  ...Sanitizers,
};
