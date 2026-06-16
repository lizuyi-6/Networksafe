/**
 * Tests for EnvValidator — startup environment validation and sanitization.
 * Uses unique keys per test to avoid the static "validated once" cache, and
 * restores process.env between tests.
 */

import EnvValidator from '../../security/env-validator.service';

const originalEnv = { ...process.env };

function uniqueKey(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

describe('EnvValidator', () => {
    afterEach(() => {
        // Restore env and forget validated keys.
        for (const k of Object.keys(process.env)) {
            if (!(k in originalEnv)) delete process.env[k];
        }
        for (const k of Object.keys(originalEnv)) {
            process.env[k] = originalEnv[k];
        }
        // Reset the static cache by reaching into the class.
        (EnvValidator as any).validated = new Set();
    });

    describe('require', () => {
        it('returns the value when the variable is set and valid', () => {
            const key = uniqueKey('REQ_OK');
            process.env[key] = 'a-sufficiently-long-value';
            expect(EnvValidator.require(key, { minLength: 5 })).toBe('a-sufficiently-long-value');
        });

        it('throws when the required variable is missing', () => {
            const key = uniqueKey('REQ_MISSING');
            expect(() => EnvValidator.require(key)).toThrow(/not set/);
        });

        it('throws when shorter than minLength', () => {
            const key = uniqueKey('REQ_SHORT');
            process.env[key] = 'short';
            expect(() => EnvValidator.require(key, { minLength: 32 })).toThrow(/at least 32 characters/);
        });

        it('throws when longer than maxLength', () => {
            const key = uniqueKey('REQ_LONG');
            process.env[key] = 'x'.repeat(200);
            expect(() => EnvValidator.require(key, { maxLength: 100 })).toThrow(/at most 100 characters/);
        });

        it('throws when the pattern does not match', () => {
            const key = uniqueKey('REQ_PAT');
            process.env[key] = 'not-an-email';
            expect(() => EnvValidator.require(key, { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ })).toThrow(/pattern/);
        });
    });

    describe('optional', () => {
        it('returns the env value when present and valid', () => {
            const key = uniqueKey('OPT_OK');
            process.env[key] = 'production';
            expect(EnvValidator.optional(key, 'development', { allowedValues: ['development', 'production', 'test'] })).toBe('production');
        });

        it('falls back to the default when the variable is absent', () => {
            const key = uniqueKey('OPT_DEFAULT');
            expect(EnvValidator.optional(key, 'fallback')).toBe('fallback');
        });

        it('falls back to default when the value is not in allowedValues', () => {
            const key = uniqueKey('OPT_ALLOWED');
            process.env[key] = 'bogus';
            expect(EnvValidator.optional(key, 'dev', { allowedValues: ['dev', 'prod'] })).toBe('dev');
        });

        it('falls back to default when the pattern fails', () => {
            const key = uniqueKey('OPT_PAT');
            process.env[key] = 'abc';
            expect(EnvValidator.optional(key, '8080', { pattern: /^\d+$/ })).toBe('8080');
        });

        it('truncates when the value exceeds maxLength', () => {
            const key = uniqueKey('OPT_TRUNC');
            process.env[key] = 'x'.repeat(50);
            expect(EnvValidator.optional(key, '', { maxLength: 5 })).toBe('xxxxx');
        });
    });

    describe('validateAll', () => {
        it('passes when all critical variables are present and valid', () => {
            process.env.JWT_SECRET = 'x'.repeat(40);
            process.env.AUDIT_LOG_SECRET = 'y'.repeat(40);
            process.env.ADMIN_EMAIL = 'admin@example.com';
            process.env.ADMIN_PASSWORD = 'a-very-strong-pw-12345';
            // Use unique-flagged variants so the static cache (shared key names)
            // doesn't short-circuit; reset cache first.
            (EnvValidator as any).validated = new Set();
            expect(() => EnvValidator.validateAll()).not.toThrow();
            const report = EnvValidator.getReport();
            expect(report.validated).toContain('JWT_SECRET');
            expect(report.validated).toContain('ADMIN_EMAIL');
        });

        it('throws when JWT_SECRET is too short', () => {
            process.env.JWT_SECRET = 'short';
            process.env.AUDIT_LOG_SECRET = 'y'.repeat(40);
            process.env.ADMIN_EMAIL = 'admin@example.com';
            process.env.ADMIN_PASSWORD = 'a-very-strong-pw-12345';
            (EnvValidator as any).validated = new Set();
            expect(() => EnvValidator.validateAll()).toThrow(/JWT_SECRET/);
        });

        it('throws when ADMIN_EMAIL is malformed', () => {
            process.env.JWT_SECRET = 'x'.repeat(40);
            process.env.AUDIT_LOG_SECRET = 'y'.repeat(40);
            process.env.ADMIN_EMAIL = 'not-an-email';
            process.env.ADMIN_PASSWORD = 'a-very-strong-pw-12345';
            (EnvValidator as any).validated = new Set();
            expect(() => EnvValidator.validateAll()).toThrow(/ADMIN_EMAIL|pattern/);
        });
    });
});
