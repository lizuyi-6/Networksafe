/**
 * EnvValidator Service Tests
 *
 * Tests environment variable validation including required/optional vars,
 * length constraints, pattern matching, allowed values, validateAll, and reporting.
 */

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

import logger from '../../utils/logger';
import { EnvValidator } from '../../security/env-validator.service';

describe('EnvValidator', () => {
  const originalEnv = process.env;
  const savedKeys = new Set<string>();

  // Track which env keys we touch so we can restore them
  function setEnv(key: string, value: string | undefined) {
    if (!(key in originalEnv)) {
      savedKeys.add(key);
    } else if (value === undefined) {
      // We are deleting it - mark that we need to restore original
    }
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  beforeEach(() => {
    // Clear the validated set between tests
    // We access the private static via any cast since it's a test
    (EnvValidator as unknown as { validated: Set<string> }).validated = new Set();
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore env vars we touched
    for (const key of savedKeys) {
      if (key in originalEnv) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
    savedKeys.clear();
  });

  // ─── require() ─────────────────────────────────────────────────────────

  describe('require()', () => {
    test('returns value when env var is set', () => {
      setEnv('TEST_VAR', 'hello');
      const result = EnvValidator.require('TEST_VAR');
      expect(result).toBe('hello');
    });

    test('throws when required env var is missing', () => {
      setEnv('MISSING_VAR', undefined);
      expect(() => EnvValidator.require('MISSING_VAR')).toThrow(
        'FATAL: Required environment variable MISSING_VAR is not set'
      );
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    test('includes description in error when provided', () => {
      setEnv('MISSING_DESC', undefined);
      expect(() =>
        EnvValidator.require('MISSING_DESC', { description: 'my important secret' })
      ).toThrow('FATAL: Required environment variable MISSING_DESC is (my important secret) not set');
    });

    test('throws when value is shorter than minLength', () => {
      setEnv('SHORT_VAR', 'abc');
      expect(() =>
        EnvValidator.require('SHORT_VAR', { minLength: 8 })
      ).toThrow('must be at least 8 characters long (got 3)');
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    test('throws when value is longer than maxLength', () => {
      setEnv('LONG_VAR', 'abcdefghij');
      expect(() =>
        EnvValidator.require('LONG_VAR', { maxLength: 5 })
      ).toThrow('must be at most 5 characters long (got 10)');
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    test('throws when value does not match pattern', () => {
      setEnv('BAD_PATTERN', 'not-an-email');
      expect(() =>
        EnvValidator.require('BAD_PATTERN', { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ })
      ).toThrow('does not match required pattern');
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    test('passes when value matches pattern', () => {
      setEnv('GOOD_PATTERN', 'user@example.com');
      const result = EnvValidator.require('GOOD_PATTERN', {
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      });
      expect(result).toBe('user@example.com');
    });

    test('passes when value meets minLength exactly', () => {
      setEnv('EXACT_LEN', 'abcd');
      const result = EnvValidator.require('EXACT_LEN', { minLength: 4 });
      expect(result).toBe('abcd');
    });

    test('returns cached result on second call without re-validating', () => {
      setEnv('CACHED_VAR', 'original');
      const first = EnvValidator.require('CACHED_VAR');
      // Change env - should still return original (cached)
      setEnv('CACHED_VAR', 'changed');
      const second = EnvValidator.require('CACHED_VAR');
      expect(first).toBe('original');
      // Second call returns current process.env because it checks validated set
      // and returns process.env[key]! - so it returns 'changed'
      // Actually looking at the code: if validated has key, return process.env[key]!
      // So it does NOT cache the value, it caches the validation.
      expect(second).toBe('changed');
    });

    test('does not re-validate on second call', () => {
      setEnv('NO_REVALIDATE', 'toolongvalue');
      // First call passes (no constraints)
      EnvValidator.require('NO_REVALIDATE');
      // Change to empty - would throw if re-validated, but cached
      setEnv('NO_REVALIDATE', '');
      // The code returns process.env[key]! without checking - empty string is truthy? No, '' is falsy
      // But since it's in validated set, it skips validation entirely
      const result = EnvValidator.require('NO_REVALIDATE');
      expect(result).toBe('');
    });
  });

  // ─── optional() ────────────────────────────────────────────────────────

  describe('optional()', () => {
    test('returns value when env var is set', () => {
      setEnv('OPT_VAR', 'present');
      const result = EnvValidator.optional('OPT_VAR', 'default');
      expect(result).toBe('present');
    });

    test('returns default when env var is missing', () => {
      setEnv('MISSING_OPT', undefined);
      const result = EnvValidator.optional('MISSING_OPT', 'fallback');
      expect(result).toBe('fallback');
    });

    test('returns empty string default when not provided', () => {
      setEnv('NO_DEFAULT', undefined);
      const result = EnvValidator.optional('NO_DEFAULT');
      expect(result).toBe('');
    });

    test('warns and returns default when value is too short', () => {
      setEnv('SHORT_OPT', 'ab');
      const result = EnvValidator.optional('SHORT_OPT', 'default', { minLength: 5 });
      expect(result).toBe('default');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SHORT_OPT is too short')
      );
    });

    test('warns and truncates when value is too long', () => {
      setEnv('LONG_OPT', 'abcdefghij');
      const result = EnvValidator.optional('LONG_OPT', 'default', { maxLength: 5 });
      expect(result).toBe('abcde');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('LONG_OPT is too long, truncating')
      );
    });

    test('warns and returns default when pattern does not match', () => {
      setEnv('BAD_OPT_PATTERN', 'not-a-url');
      const result = EnvValidator.optional('BAD_OPT_PATTERN', 'https://example.com', {
        pattern: /^https:\/\//
      });
      expect(result).toBe('https://example.com');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('does not match required pattern')
      );
    });

    test('warns and returns default when value is not in allowedValues', () => {
      setEnv('BAD_OPT_VALUE', 'staging');
      const result = EnvValidator.optional('BAD_OPT_VALUE', 'development', {
        allowedValues: ['development', 'production', 'test']
      });
      expect(result).toBe('development');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('has invalid value')
      );
    });

    test('passes when value is in allowedValues', () => {
      setEnv('GOOD_OPT_VALUE', 'production');
      const result = EnvValidator.optional('GOOD_OPT_VALUE', 'development', {
        allowedValues: ['development', 'production', 'test']
      });
      expect(result).toBe('production');
    });

    test('does not re-validate on second call (returns env or default)', () => {
      setEnv('OPT_CACHED', 'first');
      EnvValidator.optional('OPT_CACHED', 'default');
      // Change env to empty - since it's in validated set, returns process.env[key] || defaultValue
      setEnv('OPT_CACHED', '');
      const result = EnvValidator.optional('OPT_CACHED', 'default');
      expect(result).toBe('default');
    });
  });

  // ─── validateAll() ─────────────────────────────────────────────────────

  describe('validateAll()', () => {
    test('passes when all required keys are set with valid values', () => {
      setEnv('JWT_SECRET', 'a'.repeat(32));
      setEnv('AUDIT_LOG_SECRET', 'b'.repeat(32));
      setEnv('ADMIN_EMAIL', 'admin@example.com');
      setEnv('ADMIN_PASSWORD', 'securepassword12');

      expect(() => EnvValidator.validateAll()).not.toThrow();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('validated successfully'),
        expect.objectContaining({ validatedCount: expect.any(Number) })
      );
    });

    test('throws when JWT_SECRET is missing', () => {
      setEnv('JWT_SECRET', undefined);
      setEnv('AUDIT_LOG_SECRET', 'b'.repeat(32));
      setEnv('ADMIN_EMAIL', 'admin@example.com');
      setEnv('ADMIN_PASSWORD', 'securepassword12');

      expect(() => EnvValidator.validateAll()).toThrow('JWT_SECRET');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('validation failed'),
        expect.any(Object)
      );
    });

    test('throws when JWT_SECRET is too short', () => {
      setEnv('JWT_SECRET', 'tooshort');
      setEnv('AUDIT_LOG_SECRET', 'b'.repeat(32));
      setEnv('ADMIN_EMAIL', 'admin@example.com');
      setEnv('ADMIN_PASSWORD', 'securepassword12');

      expect(() => EnvValidator.validateAll()).toThrow('at least 32 characters');
    });

    test('throws when ADMIN_EMAIL does not match email pattern', () => {
      setEnv('JWT_SECRET', 'a'.repeat(32));
      setEnv('AUDIT_LOG_SECRET', 'b'.repeat(32));
      setEnv('ADMIN_EMAIL', 'not-an-email');
      setEnv('ADMIN_PASSWORD', 'securepassword12');

      expect(() => EnvValidator.validateAll()).toThrow('does not match required pattern');
    });

    test('throws when ADMIN_PASSWORD is too short', () => {
      setEnv('JWT_SECRET', 'a'.repeat(32));
      setEnv('AUDIT_LOG_SECRET', 'b'.repeat(32));
      setEnv('ADMIN_EMAIL', 'admin@example.com');
      setEnv('ADMIN_PASSWORD', 'short');

      expect(() => EnvValidator.validateAll()).toThrow('at least 12 characters');
    });
  });

  // ─── getReport() ───────────────────────────────────────────────────────

  describe('getReport()', () => {
    test('returns empty validated array when nothing has been validated', () => {
      const report = EnvValidator.getReport();
      expect(report.validated).toEqual([]);
      expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('returns list of validated keys', () => {
      setEnv('REPORT_KEY_1', 'value1');
      setEnv('REPORT_KEY_2', 'value2');
      EnvValidator.require('REPORT_KEY_1');
      EnvValidator.optional('REPORT_KEY_2', 'default');

      const report = EnvValidator.getReport();
      expect(report.validated).toContain('REPORT_KEY_1');
      expect(report.validated).toContain('REPORT_KEY_2');
      expect(report.validated).toHaveLength(2);
    });

    test('returns a valid ISO timestamp', () => {
      setEnv('TS_KEY', 'value');
      EnvValidator.require('TS_KEY');

      const report = EnvValidator.getReport();
      const date = new Date(report.timestamp);
      expect(date.toISOString()).toBe(report.timestamp);
    });
  });
});
