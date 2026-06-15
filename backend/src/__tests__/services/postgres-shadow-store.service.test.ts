/**
 * Tests for the pure serialization helpers in postgres-shadow-store.service.
 * maskConnectionString is security-relevant: it must never leak the password.
 */

import {
    maskConnectionString,
    toSqlValue,
    toQueryValue
} from '../../services/postgres-shadow-store.service';

describe('postgres-shadow-store pure helpers', () => {
    describe('maskConnectionString', () => {
        it('masks the password in a full connection string (security-critical)', () => {
            const masked = maskConnectionString('postgres://admin:s3cret-pw@10.0.0.5:5432/aetherguard');
            expect(masked).not.toContain('s3cret-pw');
            expect(masked).toContain('admin:***@');
            expect(masked).toContain('10.0.0.5:5432');
            expect(masked).toContain('/aetherguard');
        });

        it('handles a connection string without credentials', () => {
            const masked = maskConnectionString('postgres://10.0.0.5:5432/aetherguard');
            expect(masked).not.toContain('***@');
            expect(masked).toContain('10.0.0.5:5432');
        });

        it('returns a safe fallback for non-URL input (no leak)', () => {
            const masked = maskConnectionString('not a url at all');
            expect(masked).toBe('postgres://***');
            // Even a password-looking string in garbage input must not leak.
            const masked2 = maskConnectionString('random garbage with password=hunter2');
            expect(masked2).toBe('postgres://***');
        });

        it('handles empty input safely', () => {
            expect(maskConnectionString('')).toBe('postgres://***');
        });

        it('does not leak the password via the hostname or pathname', () => {
            const masked = maskConnectionString('postgres://u:p@host/db');
            expect(masked).toBe('postgres://u:***@host/db');
        });
    });

    describe('toSqlValue', () => {
        it('maps undefined to null', () => {
            expect(toSqlValue(undefined)).toBeNull();
        });
        it('maps booleans to 1/0 (SQLite-style)', () => {
            expect(toSqlValue(true)).toBe(1);
            expect(toSqlValue(false)).toBe(0);
        });
        it('serializes objects to JSON strings', () => {
            expect(toSqlValue({ a: 1 })).toBe('{"a":1}');
            expect(toSqlValue([1, 2])).toBe('[1,2]');
        });
        it('passes through primitives', () => {
            expect(toSqlValue(42)).toBe(42);
            expect(toSqlValue('hi')).toBe('hi');
        });
        it('maps null to null', () => {
            expect(toSqlValue(null)).toBeNull();
        });
    });

    describe('toQueryValue', () => {
        it('maps undefined to null', () => {
            expect(toQueryValue(undefined)).toBeNull();
        });
        it('serializes Date to ISO string', () => {
            const d = new Date('2026-01-15T10:00:00Z');
            expect(toQueryValue(d)).toBe('2026-01-15T10:00:00.000Z');
        });
        it('passes arrays through (pg array params)', () => {
            expect(toQueryValue([1, 2, 3])).toEqual([1, 2, 3]);
        });
        it('serializes plain objects to JSON strings', () => {
            expect(toQueryValue({ k: 'v' })).toBe('{"k":"v"}');
        });
        it('passes primitives through', () => {
            expect(toQueryValue('s')).toBe('s');
            expect(toQueryValue(7)).toBe(7);
        });
    });
});
