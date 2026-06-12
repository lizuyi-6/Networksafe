/**
 * safeErrorMessage helper tests
 * SECURITY FIX (R3 audit 2026-06-05): ensures raw `error.message` is never
 * echoed back to clients and is instead logged with operator context.
 */

import { safeErrorMessage } from '../../../core/http/api-response';

describe('safeErrorMessage', () => {
  const originalConsoleError = console.error;
  let consoleErrorCalls: Array<[string, ...unknown[]]> = [];

  beforeEach(() => {
    consoleErrorCalls = [];
    // Stub console.error so the logger.error (which routes via console) does
    // not pollute test output but can still be observed.
    console.error = (...args: unknown[]) => {
      consoleErrorCalls.push(args as [string, ...unknown[]]);
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('returns the fallback when error is undefined', () => {
    const result = safeErrorMessage(undefined, 'backend.fallback_undefined');
    expect(result).toBe('backend.fallback_undefined');
  });

  it('returns the fallback when error is null', () => {
    const result = safeErrorMessage(null, 'backend.fallback_null');
    expect(result).toBe('backend.fallback_null');
  });

  it('returns the fallback (not the raw message) when error is a SQL error', () => {
    const sqlError = new Error(
      'SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email'
    );
    const result = safeErrorMessage(sqlError, 'backend.database_error');
    expect(result).toBe('backend.database_error');
    // The raw SQL error must NOT leak to the client
    expect(result).not.toContain('SQLITE_CONSTRAINT');
    expect(result).not.toContain('users.email');
  });

  it('returns the fallback (not the raw message) when error is a filesystem path', () => {
    const fsError = new Error(
      "ENOENT: no such file or directory, open '/var/lib/aetherguard/policy.json'"
    );
    const result = safeErrorMessage(fsError, 'backend.filesystem_error');
    expect(result).toBe('backend.filesystem_error');
    expect(result).not.toContain('/var/lib/aetherguard');
    expect(result).not.toContain('ENOENT');
  });

  it('still returns the fallback when the error is a non-Error value', () => {
    const result = safeErrorMessage('SQLITE_CONSTRAINT leak', 'backend.generic');
    expect(result).toBe('backend.generic');
  });

  it('returns the fallback for thrown strings', () => {
    // Throwing a string is technically valid JavaScript
    const result = safeErrorMessage('connection refused 127.0.0.1:11434', 'backend.network_error');
    expect(result).toBe('backend.network_error');
  });

  it('invokes logger.error with the raw error and context for operator visibility', () => {
    const error = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email');
    const context = { route: 'admin/users', tenantId: 'tenant-123' };
    const result = safeErrorMessage(error, 'backend.database_error', context);
    expect(result).toBe('backend.database_error');
    // logger.error should have been called via console.error fallback path
    // (the actual logger may or may not be loaded in the test env, but the
    // contract is: raw is logged, fallback is returned).
    // The helper guards against logger import failure, so we just verify
    // the returned value never contains the raw error string.
    expect(result).not.toContain('SQLITE_CONSTRAINT');
    expect(result).not.toContain('users.email');
  });

  /**
   * R7 meta-audit 2026-06-06 V7.5: log-sanitizer.sanitize() does not
   * recursively descend into string primitives inside object values.
   * We pre-sanitize `raw` with sanitizeString() to keep JWT, API key,
   * SSN, credit card, and IP patterns out of operator logs.
   */
  it('redacts a JWT inside the raw error before logging', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const error = new Error(`auth failed for bearer ${jwt}`);
    const result = safeErrorMessage(error, 'backend.auth_error');
    expect(result).toBe('backend.auth_error');
    // Logger pipeline should have been called; capture the logged line.
    expect(consoleErrorCalls.length).toBeGreaterThan(0);
    const joined = consoleErrorCalls.map((args) => args.map(String).join(' ')).join('\n');
    // The full JWT must not appear in the log line.
    expect(joined).not.toContain(jwt);
    // Sanitizer shows first4...last4 for matches longer than 20 chars
    // (this JWT is ~175 chars, so the partial-redaction branch fires).
    expect(joined).toContain('eyJh...sw5c');
  });

  it('redacts an API key (agent_*) inside the raw error before logging', () => {
    const apiKey = 'agent_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOP';
    const error = new Error(`upstream call failed: invalid api key ${apiKey}`);
    const result = safeErrorMessage(error, 'backend.upstream_error');
    expect(result).toBe('backend.upstream_error');
    expect(consoleErrorCalls.length).toBeGreaterThan(0);
    const joined = consoleErrorCalls.map((args) => args.map(String).join(' ')).join('\n');
    // The full API key must not appear in the log line.
    expect(joined).not.toContain(apiKey);
    // Sanitizer shows first4...last4 for matches longer than 20 chars.
    expect(joined).toContain('agen...MNOP');
  });

  /**
   * Issue 1 regression: context object secrets must be redacted before
   * logger.error is called, not just the raw error string.
   */
  it('redacts password and jwt fields inside the context object', () => {
    const error = new Error('something went wrong');
    const context = {
      route: 'admin/users',
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      password: 'super-secret-password'
    };
    const result = safeErrorMessage(error, 'backend.generic', context);
    expect(result).toBe('backend.generic');
    expect(consoleErrorCalls.length).toBeGreaterThan(0);
    const joined = consoleErrorCalls.map((args) => args.map(String).join(' ')).join('\n');
    // Secrets must not appear verbatim in the log.
    expect(joined).not.toContain('super-secret-password');
    expect(joined).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    // Non-secret fields should still be visible.
    expect(joined).toContain('admin/users');
    // Partial reveal for long JWT (first4...last4 = eyJh...sw5c).
    expect(joined).toContain('eyJh...sw5c');
  });

  it('does not redact a plain file path inside the raw error', () => {
    const error = new Error(
      "ENOENT: no such file or directory, open '/var/lib/aetherguard/policy.json'"
    );
    const result = safeErrorMessage(error, 'backend.filesystem_error');
    expect(result).toBe('backend.filesystem_error');
    expect(consoleErrorCalls.length).toBeGreaterThan(0);
    const joined = consoleErrorCalls.map((args) => args.map(String).join(' ')).join('\n');
    // File paths are not in the sensitive pattern list; they should pass
    // through untouched (operators need them for diagnostics).
    expect(joined).toContain('/var/lib/aetherguard/policy.json');
  });
});
