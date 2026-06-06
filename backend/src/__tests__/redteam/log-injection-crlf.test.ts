/**
 * Redteam test: CRLF / log injection in user-controlled audit fields (D31)
 *
 * Verifies that control characters (\n, \r, \t, \0) in audit log details fields
 * are stripped before storage so they cannot be used for log injection or
 * cosmetic corruption in dashboard views and CSV/HTML exports.
 */

import { recursiveSanitize } from '../../utils/log-sanitizer';

describe('CRLF / log injection in audit details (D31)', () => {
    it('strips \\n (newline) from nested string values', () => {
        const input = { details: { name: 'foo\nbar' } };
        const result = recursiveSanitize(input) as typeof input;
        expect(result.details.name).toBe('foo bar');
        expect(result.details.name).not.toContain('\n');
    });

    it('strips \\r (carriage return) from nested string values', () => {
        const input = { details: { name: 'foo\rbar' } };
        const result = recursiveSanitize(input) as typeof input;
        expect(result.details.name).toBe('foo bar');
        expect(result.details.name).not.toContain('\r');
    });

    it('strips \\t (tab) from nested string values', () => {
        const input = { details: { name: 'foo\tbar' } };
        const result = recursiveSanitize(input) as typeof input;
        expect(result.details.name).toBe('foo bar');
        expect(result.details.name).not.toContain('\t');
    });

    it('strips \\0 (null) from nested string values', () => {
        const input = { details: { name: 'foo\0bar' } };
        const result = recursiveSanitize(input) as typeof input;
        expect(result.details.name).toBe('foo bar');
        expect(result.details.name).not.toContain('\0');
    });

    it('strips multiple control chars in the same string', () => {
        const input = { details: { name: 'a\nb\rc\td\0e' } };
        const result = recursiveSanitize(input) as typeof input;
        expect(result.details.name).toBe('a b c d e');
        expect(result.details.name).not.toMatch(/[\n\r\t\0]/);
    });

    it('handles deeply nested objects', () => {
        const input = { details: { nested: { deep: { name: 'x\ny\rz' } } } };
        const result = recursiveSanitize(input) as typeof input;
        expect(result.details.nested.deep.name).toBe('x y z');
    });

    it('handles arrays of objects', () => {
        const input = { details: { users: [{ name: 'a\nb' }, { name: 'c\rd' }] } };
        const result = recursiveSanitize(input) as typeof input;
        expect(result.details.users[0].name).toBe('a b');
        expect(result.details.users[1].name).toBe('c d');
    });

    it('does not modify non-string values', () => {
        const input = { details: { count: 42, active: true, data: null } };
        const result = recursiveSanitize(input) as typeof input;
        expect(result.details.count).toBe(42);
        expect(result.details.active).toBe(true);
        expect(result.details.data).toBeNull();
    });

    it('still applies sensitive-pattern redaction alongside control-char stripping', () => {
        // Password field should be redacted AND control chars stripped
        const input = { details: { password: 'secret\ntoken' } };
        const result = recursiveSanitize(input) as typeof input;
        expect(result.details.password).toBe('***REDACTED***');
    });
});
