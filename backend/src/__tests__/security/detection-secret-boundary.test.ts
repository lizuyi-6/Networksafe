/**
 * Detection Secret Boundary — N5-3 blind-spot regressions.
 *
 * Two credential paths previously bypassed redaction:
 *   1. URL FRAGMENTS were appended verbatim — an OAuth implicit-flow
 *      callback (`#access_token=...&token_type=Bearer`) leaked the token
 *      into every detection snapshot.
 *   2. Opaque-body key redaction required the key to START with a sensitive
 *      word — `client_secret`, `access_token`, `refresh_token` (prefixed
 *      with client/access/refresh) passed through unredacted.
 */

import {
    sanitizeDetectionUrl,
    sanitizeDetectionBody,
    sanitizeDetectionText,
    REDACTED
} from '../../security/detection-secret-boundary';

describe('N5-3: detection secret boundary blind spots', () => {
    it('redacts OAuth implicit-flow credentials carried in the URL fragment', () => {
        const url = 'https://app.example.test/callback#access_token=eyJhbGciOi.example.sig&token_type=Bearer&expires_in=3600';
        const sanitized = sanitizeDetectionUrl(url);

        expect(sanitized).not.toContain('eyJhbGciOi.example.sig');
        expect(sanitized).toContain(`access_token=${REDACTED}`);
        // Non-sensitive fragment parts survive. (token_type contains the
        // word "token" so its value is conservatively redacted too.)
        expect(sanitized).toContain('expires_in=3600');
        expect(sanitized).toContain('token_type=');
    });

    it('redacts prefixed sensitive keys in opaque (non-JSON) bodies', () => {
        const opaque = 'grant_type=authorization_code&client_secret=abc123SUPERSECRET&code=xyz';
        const sanitized = sanitizeDetectionBody(opaque, 'text/plain');

        expect(sanitized).not.toContain('abc123SUPERSECRET');
        expect(sanitized).toContain(`client_secret=${REDACTED}`);
        expect(sanitized).toContain('code=xyz');
    });

    it('redacts access_token / refresh_token / id_token in opaque bodies', () => {
        const opaque = 'access_token=eyJaaa.bbb.ccc&refresh_token=refresh-abc123&id_token=eyJddd.eee.fff&scope=read';
        const sanitized = sanitizeDetectionBody(opaque, 'application/octet-stream');

        expect(sanitized).not.toContain('eyJaaa.bbb.ccc');
        expect(sanitized).not.toContain('refresh-abc123');
        expect(sanitized).not.toContain('eyJddd.eee.fff');
        expect(sanitized).toContain('scope=read');
    });

    it('still redacts JSON Web Tokens and Bearer schemes anywhere in text', () => {
        const text = 'header: Bearer abc.def.ghi and raw jwt eyJra2lkIj.a2V5.c2ln plus agent_AAAAAAAAAAAAAAAAAAAAAAAA';
        const sanitized = sanitizeDetectionText(text);

        expect(sanitized).not.toContain('abc.def.ghi');
        expect(sanitized).not.toContain('eyJra2lkIj');
        expect(sanitized).not.toContain('agent_AAAAAAAAAAAAAAAAAAAAAAAA');
        expect(sanitized).toContain('Bearer ***REDACTED***');
    });

    it('keeps structured JSON field redaction intact (no regression)', () => {
        const body = JSON.stringify({ username: 'alice', password: 'pw-123', nested: { apiKey: 'k-456' } });
        const sanitized = sanitizeDetectionBody(body, 'application/json');

        const parsed = JSON.parse(sanitized);
        expect(parsed.username).toBe('alice');
        expect(parsed.password).toBe(REDACTED);
        expect(parsed.nested.apiKey).toBe(REDACTED);
    });
});
