/**
 * Tests for the agent-auth pure cryptographic primitives — encryption round-trip,
 * key/secret generation, and agent fingerprinting. The class methods (register /
 * verifyAgent / listAgents) are DB-backed and covered elsewhere; these primitives
 * are the security foundation and have no DB dependency.
 */

import crypto from 'crypto';
import {
    getEncryptionKey,
    encryptSecretKey,
    decryptSecretKey,
    generateApiKey,
    generateSecretKey,
    createFingerprint
} from '../../security/agent-auth.service';

// The encryption primitives derive a key from ENCRYPTION_KEY/SALT env vars.
// Set deterministic values so tests are reproducible.
beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'aetherguard-agent-auth-test-encryption-key';
    process.env.ENCRYPTION_SALT = 'aetherguard-agent-auth-test-salt-value';
});

describe('agent-auth cryptographic primitives', () => {
    describe('getEncryptionKey', () => {
        it('derives a deterministic 32-byte AES-256 key from the env passphrase', () => {
            const key = getEncryptionKey();
            expect(key.length).toBe(32);
            expect(getEncryptionKey()).toEqual(key); // deterministic for same env
        });
    });

    describe('encryptSecretKey / decryptSecretKey', () => {
        it('round-trips: decrypt(encrypt(x)) === x', () => {
            const plaintext = 'super-secret-agent-key-value';
            const encrypted = encryptSecretKey(plaintext);
            expect(encrypted).not.toBe(plaintext);
            expect(decryptSecretKey(encrypted)).toBe(plaintext);
        });

        it('uses a fresh random IV each call (same plaintext encrypts differently)', () => {
            const a = encryptSecretKey('same-value');
            const b = encryptSecretKey('same-value');
            expect(a).not.toBe(b);
            // ...but both still decrypt to the same plaintext.
            expect(decryptSecretKey(a)).toBe('same-value');
            expect(decryptSecretKey(b)).toBe('same-value');
        });

        it('produces the iv:authTag:ciphertext format', () => {
            const encrypted = encryptSecretKey('x');
            const parts = encrypted.split(':');
            expect(parts).toHaveLength(3);
            // iv is IV_LENGTH (12) bytes hex => 24 chars; authTag is 16 bytes hex => 32 chars
            expect(parts[0].length).toBe(24);
            expect(parts[1].length).toBe(32);
        });

        it('decrypt returns garbled output (not throw) for tampered ciphertext', () => {
            const encrypted = encryptSecretKey('secret');
            const parts = encrypted.split(':');
            const tampered = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -2)}XX`;
            // GCM auth tag verification throws on tampered ciphertext — that's the
            // security property (integrity). We assert it throws, not silently decrypts.
            expect(() => decryptSecretKey(tampered)).toThrow();
        });
    });

    describe('generateApiKey / generateSecretKey', () => {
        it('generateApiKey produces a unique agent_-prefixed hex key', () => {
            const k1 = generateApiKey();
            const k2 = generateApiKey();
            expect(k1).toMatch(/^agent_[0-9a-f]{48}$/); // 24 bytes hex
            expect(k2).toMatch(/^agent_[0-9a-f]{48}$/);
            expect(k1).not.toBe(k2); // unique
        });

        it('generateSecretKey produces a unique 64-char hex string (32 bytes)', () => {
            const s1 = generateSecretKey();
            const s2 = generateSecretKey();
            expect(s1).toMatch(/^[0-9a-f]{64}$/);
            expect(s2).toMatch(/^[0-9a-f]{64}$/);
            expect(s1).not.toBe(s2);
        });
    });

    describe('createFingerprint', () => {
        it('is deterministic for the same input', () => {
            const fp1 = createFingerprint({ hostname: 'host-1', platform: 'linux', mac: 'aa:bb' });
            const fp2 = createFingerprint({ hostname: 'host-1', platform: 'linux', mac: 'aa:bb' });
            expect(fp2).toBe(fp1);
            expect(fp1).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
        });

        it('changes when any identifying field changes', () => {
            const base = createFingerprint({ hostname: 'host-1', platform: 'linux', mac: 'aa:bb' });
            expect(createFingerprint({ hostname: 'host-2', platform: 'linux', mac: 'aa:bb' })).not.toBe(base);
            expect(createFingerprint({ hostname: 'host-1', platform: 'darwin', mac: 'aa:bb' })).not.toBe(base);
            expect(createFingerprint({ hostname: 'host-1', platform: 'linux', mac: 'cc:dd' })).not.toBe(base);
        });

        it('substitutes "unknown" for a missing mac but stays deterministic', () => {
            const a = createFingerprint({ hostname: 'h', platform: 'p' });
            const b = createFingerprint({ hostname: 'h', platform: 'p', mac: undefined });
            expect(b).toBe(a);
            // And differs from one that does have a mac.
            expect(createFingerprint({ hostname: 'h', platform: 'p', mac: 'aa' })).not.toBe(a);
        });
    });
});
