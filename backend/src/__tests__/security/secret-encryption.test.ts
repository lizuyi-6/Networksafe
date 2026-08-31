/**
 * SECURITY tests (audit 2026-08, AUD-07-5): at-rest envelope encryption for
 * service secrets + end-to-end seal/open through the AI endpoint store.
 */

import crypto from 'crypto';
import { encryptSecret, decryptSecret, isSealedSecret } from '../../security/secret-encryption';

describe('secret-encryption (AUD-07-5)', () => {
    const KEY = 'test-encryption-key-32-chars-ok!';
    const SALT = 'test-salt-16-char!';

    const ORIGINAL = { key: process.env.ENCRYPTION_KEY, salt: process.env.ENCRYPTION_SALT };
    beforeAll(() => {
        process.env.ENCRYPTION_KEY = KEY;
        process.env.ENCRYPTION_SALT = SALT;
    });
    afterAll(() => {
        process.env.ENCRYPTION_KEY = ORIGINAL.key;
        process.env.ENCRYPTION_SALT = ORIGINAL.salt;
    });

    it('round-trips encryptSecret/decryptSecret', () => {
        const secret = 'sk-live-CANARY-VALUE';
        const sealed = encryptSecret(secret);
        expect(isSealedSecret(sealed)).toBe(true);
        expect(sealed).not.toContain(secret);
        expect(decryptSecret(sealed)).toBe(secret);
    });

    it('uses a fresh IV per seal (same plaintext, different envelopes)', () => {
        const a = encryptSecret('same-secret');
        const b = encryptSecret('same-secret');
        expect(a).not.toBe(b);
        expect(decryptSecret(a)).toBe('same-secret');
        expect(decryptSecret(b)).toBe('same-secret');
    });

    it('fails closed (null) on tampered ciphertext', () => {
        const sealed = encryptSecret('secret');
        const parts = sealed.split(':');
        parts[3] = parts[0] + 'tampered'; // corrupt ciphertext part
        const tampered = parts.join(':');
        expect(decryptSecret(tampered)).toBeNull();
    });

    it('non-sealed values pass through decryptSecret as null (legacy path)', () => {
        expect(decryptSecret('legacy-plaintext-key')).toBeNull();
        expect(isSealedSecret('legacy-plaintext-key')).toBe(false);
    });

    it('AI endpoint store seals api_key at rest (end-to-end)', async () => {
        process.env.ENCRYPTION_KEY = KEY;
        process.env.ENCRYPTION_SALT = SALT;
        const { aiEndpointStoreService } = await import('../../services/ai-endpoint-store.service');
        const { getDatabase } = await import('../../config/database');
        const { initDatabase } = await import('../../config/database');
        await initDatabase();

        const created = await aiEndpointStoreService.createEndpoint('tenant-seal-test', 'tester', {
            name: 'sealed-endpoint',
            url: 'https://api.example.com/v1',
            modelName: 'm',
            apiKey: 'sk-live-PLAINTEXT-CANARY',
            enabled: true
        });

        const row = getDatabase().prepare(
            'SELECT api_key FROM ai_endpoints WHERE id = ?'
        ).get(created.id) as { api_key: string };

        // At rest: sealed, never the plaintext.
        expect(isSealedSecret(row.api_key)).toBe(true);
        expect(row.api_key).not.toContain('PLAINTEXT-CANARY');
        // Through the service: plaintext round-trips for authorized use.
        const record = await aiEndpointStoreService.getEndpoint('tenant-seal-test', created.id);
        expect(record?.apiKey).toBe('sk-live-PLAINTEXT-CANARY');
    });
});
