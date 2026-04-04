import {
  sanitizeString,
  sanitizeObject,
  sanitizeError,
  sanitize,
  Sanitizers,
} from '../../utils/log-sanitizer';

// The source does not import logger; this mock is a safety net for transitive imports
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('log-sanitizer', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ---------------------------------------------------------------------------
  // sanitizeString
  // ---------------------------------------------------------------------------
  describe('sanitizeString', () => {
    it('redacts password fields in JSON-like strings', () => {
      const input = '{"password": "s3cret!"}';
      // The full match `"password": "s3cret!"` is 24 chars (> 20) => partial reveal
      const result = sanitizeString(input);
      expect(result).not.toContain('s3cret');
      expect(result).toContain('...');
    });

    it('redacts secret and secretKey fields', () => {
      const input = '{"secret": "abc", "secretKey": "def"}';
      const result = sanitizeString(input);
      expect(result).not.toContain('abc');
      expect(result).not.toContain('def');
    });

    it('redacts apiKey and api_key fields', () => {
      const input = '{"apiKey": "value1", "api_key": "value2"}';
      const result = sanitizeString(input);
      expect(result).not.toContain('value1');
      expect(result).not.toContain('value2');
    });

    it('redacts JWT tokens by showing first/last 4 chars', () => {
      // JWT: eyJ header.payload.signature  (each part >= 10 chars so total > 20)
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const result = sanitizeString(jwt);
      expect(result).toMatch(/^eyJh\.\.\..*w5c$/);
      expect(result).not.toContain('SflKx');
    });

    it('redacts long API keys (agent_*, sk_*, pk_) with partial reveal', () => {
      // Use a key with distinct characters at start and end for easier assertion
      const agentKey = 'agent_' + 'a'.repeat(44) + 'Zz9X';
      const result = sanitizeString(agentKey);
      // match length > 20 => show first 4 and last 4
      expect(result).toBe('agen...Zz9X');
      expect(result).not.toContain('a'.repeat(40));
    });

    it('redacts email addresses', () => {
      const result = sanitizeString('user@example.com');
      // Email regex matches the full address; length is 16 < 20 => full redact
      expect(result).not.toContain('user@example.com');
    });

    it('redacts IP addresses', () => {
      const result = sanitizeString('Server at 192.168.1.100 responded');
      // IP "192.168.1.100" length is 13 < 20 => full redact
      expect(result).not.toContain('192.168.1.100');
    });

    it('redacts credit card numbers (16 digits)', () => {
      const result = sanitizeString('Card: 4111111111111111');
      // 16 digits, length 16 < 20 => full redact
      expect(result).not.toContain('4111111111111111');
    });

    it('returns non-string input unchanged', () => {
      expect(sanitizeString(42 as any)).toBe(42);
      expect(sanitizeString(null as any)).toBe(null);
    });
  });

  // ---------------------------------------------------------------------------
  // sanitizeObject
  // ---------------------------------------------------------------------------
  describe('sanitizeObject', () => {
    it('returns null and undefined as-is', () => {
      expect(sanitizeObject(null)).toBeNull();
      expect(sanitizeObject(undefined)).toBeUndefined();
    });

    it('returns primitives as-is', () => {
      expect(sanitizeObject(42)).toBe(42);
      expect(sanitizeObject('hello')).toBe('hello');
      expect(sanitizeObject(true)).toBe(true);
    });

    it('recursively sanitizes nested objects', () => {
      const input = {
        user: 'admin',
        credentials: {
          password: 's3cret',
          token: 'abc123',
        },
      };
      const result = sanitizeObject(input);
      expect(result.user).toBe('admin');
      expect(result.credentials.password).toBe('***REDACTED***');
      expect(result.credentials.token).toBe('***REDACTED***');
    });

    it('partially redacts apiKey / api_key fields', () => {
      const input = { apiKey: 'sk-abc123456789xyz' };
      const result = sanitizeObject(input);
      // apiKey includes 'apikey' => partiallyRedactSecret
      // value length > 8 => first 4 ... last 4
      expect(result.apiKey).toBe('sk-a...9xyz');
    });

    it('sanitizes arrays element-by-element', () => {
      const input = [{ password: 'hidden' }, { safe: 'visible' }];
      const result = sanitizeObject(input) as any[];
      expect(result[0].password).toBe('***REDACTED***');
      expect(result[1].safe).toBe('visible');
    });

    it('preserves safe fields unchanged', () => {
      const input = { name: 'Alice', role: 'admin', active: true };
      expect(sanitizeObject(input)).toEqual(input);
    });

    it('redacts fields containing sensitive substrings (case-insensitive)', () => {
      const input = { user_password: 'pw', csrf_token: 'tok' };
      const result = sanitizeObject(input);
      // 'user_password' includes 'password' => redacted
      // 'csrf_token' includes 'token' => redacted
      expect(result.user_password).toBe('***REDACTED***');
      expect(result.csrf_token).toBe('***REDACTED***');
    });
  });

  // ---------------------------------------------------------------------------
  // sanitizeError
  // ---------------------------------------------------------------------------
  describe('sanitizeError', () => {
    it('returns falsy input as-is', () => {
      expect(sanitizeError(null)).toBeNull();
      expect(sanitizeError(undefined)).toBeUndefined();
    });

    it('includes name, message, code, status', () => {
      const err = new Error('something went wrong') as any;
      err.code = 'ERR_CODE';
      err.status = 500;
      const result = sanitizeError(err);
      expect(result.name).toBe('Error');
      expect(result.message).toBe('something went wrong');
      expect(result.code).toBe('ERR_CODE');
      expect(result.status).toBe(500);
    });

    it('hides stack trace in production', () => {
      process.env.NODE_ENV = 'production';
      const err = new Error('fail');
      const result = sanitizeError(err);
      expect(result.stack).toBeUndefined();
    });

    it('includes stack trace in non-production', () => {
      process.env.NODE_ENV = 'development';
      const err = new Error('fail');
      const result = sanitizeError(err);
      expect(result.stack).toBeDefined();
      expect(result.stack).toContain('Error: fail');
    });
  });

  // ---------------------------------------------------------------------------
  // Sanitizers.user
  // ---------------------------------------------------------------------------
  describe('Sanitizers.user', () => {
    it('partially redacts email and preserves safe fields', () => {
      const user = {
        userId: 'u1',
        email: 'john.doe@example.com',
        username: 'john',
        role: 'admin',
        password: 'must-be-excluded',
      };
      const result = Sanitizers.user(user);
      expect(result.userId).toBe('u1');
      expect(result.email).toBe('j***@example.com');
      expect(result.username).toBe('john');
      expect(result.role).toBe('admin');
      // password is NOT in the output at all (not just redacted)
      expect('password' in result).toBe(false);
    });

    it('sets email to undefined when absent', () => {
      const result = Sanitizers.user({ userId: 'u1' });
      expect(result.email).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Sanitizers.agent
  // ---------------------------------------------------------------------------
  describe('Sanitizers.agent', () => {
    it('preserves agentId, hostname, platform, status', () => {
      const agent = {
        agentId: 'agent-1',
        hostname: 'srv-01',
        platform: 'linux',
        status: 'online',
        apiKey: 'should-be-excluded',
      };
      const result = Sanitizers.agent(agent);
      expect(result.agentId).toBe('agent-1');
      expect(result.hostname).toBe('srv-01');
      expect(result.platform).toBe('linux');
      expect(result.status).toBe('online');
      expect('apiKey' in result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // sanitize (main entry point)
  // ---------------------------------------------------------------------------
  describe('sanitize', () => {
    it('delegates strings to sanitizeString', () => {
      const input = '{"password": "secret"}';
      const result = sanitize(input);
      expect(result).toContain('***REDACTED***');
    });

    it('delegates objects to sanitizeObject', () => {
      const result = sanitize({ password: 'pw' });
      expect(result).toEqual({ password: '***REDACTED***' });
    });

    it('returns primitives unchanged', () => {
      expect(sanitize(123)).toBe(123);
      expect(sanitize(true)).toBe(true);
    });

    it('returns null/undefined as-is', () => {
      expect(sanitize(null)).toBeNull();
      expect(sanitize(undefined)).toBeUndefined();
    });
  });
});
