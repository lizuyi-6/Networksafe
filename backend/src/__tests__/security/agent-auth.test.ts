/**
 * Tests for agent-auth.service.ts pure crypto functions
 *
 * Covers: encryptSecretKey, decryptSecretKey, generateApiKey,
 *         generateSecretKey, createFingerprint, getEncryptionKey
 */

// Module-level mocks must appear before any imports that trigger module loading
jest.mock('../../utils/logger');
jest.mock('../../security/redis.service', () => ({
  default: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

// Set env vars BEFORE the source module reads them at import time.
// process.env assignments run before hoisted static imports are evaluated.
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-ok!';
process.env.ENCRYPTION_SALT = 'test-salt-16-char!';

import {
  encryptSecretKey,
  decryptSecretKey,
  generateApiKey,
  generateSecretKey,
  createFingerprint,
  getEncryptionKey,
} from '../../security/agent-auth.service';

describe('agent-auth.service pure functions', () => {
  // ----------------------------------------------------------------
  // getEncryptionKey
  // ----------------------------------------------------------------
  describe('getEncryptionKey', () => {
    it('should return a 32-byte Buffer derived from ENCRYPTION_KEY + ENCRYPTION_SALT', () => {
      const key = getEncryptionKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should return the same key on repeated calls (deterministic derivation)', () => {
      const key1 = getEncryptionKey();
      const key2 = getEncryptionKey();
      expect(key1.equals(key2)).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // encryptSecretKey / decryptSecretKey round-trip
  // ----------------------------------------------------------------
  describe('encryptSecretKey / decryptSecretKey', () => {
    it('should round-trip a plaintext string correctly', () => {
      const plaintext = 'my-super-secret-key-12345';
      const encrypted = encryptSecretKey(plaintext);
      const decrypted = decryptSecretKey(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should round-trip an empty string', () => {
      const encrypted = encryptSecretKey('');
      expect(decryptSecretKey(encrypted)).toBe('');
    });

    it('should round-trip a long string (256 chars)', () => {
      const plaintext = 'a'.repeat(256);
      const encrypted = encryptSecretKey(plaintext);
      expect(decryptSecretKey(encrypted)).toBe(plaintext);
    });

    it('should round-trip a string with special characters', () => {
      const plaintext = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`\n\t';
      const encrypted = encryptSecretKey(plaintext);
      expect(decryptSecretKey(encrypted)).toBe(plaintext);
    });

    it('should produce different ciphertext on successive calls (random IV)', () => {
      const plaintext = 'deterministic-plaintext';
      const enc1 = encryptSecretKey(plaintext);
      const enc2 = encryptSecretKey(plaintext);
      // The IV is random so the encrypted strings should differ
      expect(enc1).not.toBe(enc2);
      // But both should decrypt to the same value
      expect(decryptSecretKey(enc1)).toBe(plaintext);
      expect(decryptSecretKey(enc2)).toBe(plaintext);
    });

    it('encrypted output should be in IV:authTag:ciphertext format', () => {
      const encrypted = encryptSecretKey('test');
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);
      // IV: 12 bytes -> 24 hex chars
      expect(parts[0]).toHaveLength(24);
      // Auth tag: 16 bytes -> 32 hex chars
      expect(parts[1]).toHaveLength(32);
      // Ciphertext: non-empty hex string
      expect(parts[2].length).toBeGreaterThan(0);
      expect(parts[2]).toMatch(/^[0-9a-f]+$/);
    });
  });

  // ----------------------------------------------------------------
  // decryptSecretKey error handling
  // ----------------------------------------------------------------
  describe('decryptSecretKey error handling', () => {
    it('should throw on garbage string input', () => {
      expect(() => decryptSecretKey('not-valid-encrypted-data')).toThrow(
        'Invalid encrypted data format',
      );
    });

    it('should throw on empty string input', () => {
      expect(() => decryptSecretKey('')).toThrow('Invalid encrypted data format');
    });

    it('should throw when IV is invalid hex', () => {
      // Correct number of colons but non-hex IV
      const malformed = 'zz:abcdef0123456789abcdef0123456789:somedata';
      expect(() => decryptSecretKey(malformed)).toThrow();
    });

    it('should throw when auth tag is tampered (GCM authentication failure)', () => {
      const plaintext = 'sensitive-data';
      const encrypted = encryptSecretKey(plaintext);
      // Flip one hex char in the auth tag (second segment)
      const parts = encrypted.split(':');
      // Ensure we modify the tag by flipping the first hex char
      const firstChar = parts[1][0];
      const flippedChar = firstChar === '0' ? '1' : '0';
      const tamperedTag = flippedChar + parts[1].slice(1);
      const tampered = `${parts[0]}:${tamperedTag}:${parts[2]}`;
      expect(() => decryptSecretKey(tampered)).toThrow();
    });
  });

  // ----------------------------------------------------------------
  // generateApiKey
  // ----------------------------------------------------------------
  describe('generateApiKey', () => {
    it('should start with "agent_"', () => {
      expect(generateApiKey().startsWith('agent_')).toBe(true);
    });

    it('should be exactly 54 characters long (6 prefix + 48 hex)', () => {
      expect(generateApiKey()).toHaveLength(54);
    });

    it('should contain only lowercase hex after the prefix', () => {
      const key = generateApiKey();
      const suffix = key.slice(6); // "agent_" is 6 characters
      expect(suffix).toMatch(/^[0-9a-f]{48}$/);
    });

    it('should produce unique values on successive calls', () => {
      const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()));
      expect(keys.size).toBe(50);
    });
  });

  // ----------------------------------------------------------------
  // generateSecretKey
  // ----------------------------------------------------------------
  describe('generateSecretKey', () => {
    it('should be 64 hex characters', () => {
      const key = generateSecretKey();
      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce unique values on successive calls', () => {
      const keys = new Set(Array.from({ length: 50 }, () => generateSecretKey()));
      expect(keys.size).toBe(50);
    });
  });

  // ----------------------------------------------------------------
  // createFingerprint
  // ----------------------------------------------------------------
  describe('createFingerprint', () => {
    it('should return a 64-char hex string (SHA-256)', () => {
      const fp = createFingerprint({ hostname: 'host1', platform: 'linux' });
      expect(fp).toHaveLength(64);
      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should be consistent for the same inputs', () => {
      const info = { hostname: 'my-host', platform: 'darwin' };
      const fp1 = createFingerprint(info);
      const fp2 = createFingerprint({ ...info });
      expect(fp1).toBe(fp2);
    });

    it('should differ when hostname changes', () => {
      const fp1 = createFingerprint({ hostname: 'host-a', platform: 'linux' });
      const fp2 = createFingerprint({ hostname: 'host-b', platform: 'linux' });
      expect(fp1).not.toBe(fp2);
    });

    it('should differ when platform changes', () => {
      const fp1 = createFingerprint({ hostname: 'host1', platform: 'linux' });
      const fp2 = createFingerprint({ hostname: 'host1', platform: 'win32' });
      expect(fp1).not.toBe(fp2);
    });

    it('should differ when mac address changes', () => {
      const fp1 = createFingerprint({ hostname: 'host1', platform: 'linux', mac: 'aa:bb:cc:dd:ee:ff' });
      const fp2 = createFingerprint({ hostname: 'host1', platform: 'linux', mac: '11:22:33:44:55:66' });
      expect(fp1).not.toBe(fp2);
    });

    it('should use "unknown" when mac is omitted', () => {
      const fpWithMac = createFingerprint({ hostname: 'h', platform: 'p', mac: 'mac' });
      const fpWithout = createFingerprint({ hostname: 'h', platform: 'p' });
      expect(fpWithMac).not.toBe(fpWithout);
    });
  });
});
