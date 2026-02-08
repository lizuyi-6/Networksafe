/**
 * Security Fixes Validation Test
 */

import { EnhancedRateLimiter } from '../security/enhanced-rate-limiter.service';
import nonceManager from '../security/nonce-manager.service';
import { sanitize, Sanitizers } from '../utils/log-sanitizer';

describe('Security Fixes Validation', () => {
  describe('FIX-001: Enhanced Rate Limiting', () => {
    test('should enforce rate limits', async () => {
      const rateLimiter = new EnhancedRateLimiter();
      let allowed = 0;
      let blocked = 0;

      for (let i = 0; i < 105; i++) {
        const result = await rateLimiter.checkRateLimit({
          identifier: 'test-user',
          ip: '192.168.1.1',
          config: { maxRequests: 100, windowMs: 60000 },
        });
        if (result.allowed) allowed++;
        else blocked++;
      }

      expect(allowed).toBe(100);
      expect(blocked).toBe(5);
    });
  });

  describe('FIX-002: Nonce Manager', () => {
    test('should reject duplicate nonce', async () => {
      const nonce = 'test-nonce-' + Date.now();
      const result1 = await nonceManager.checkAndUseNonce(nonce);
      const result2 = await nonceManager.checkAndUseNonce(nonce);

      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });
  });

  describe('FIX-004: Log Sanitization', () => {
    test('should redact passwords', () => {
      const input = { password: 'Secret123!' };
      const output = sanitize(input);
      expect(output.password).toBe('***REDACTED***');
    });

    test('should redact API keys', () => {
      const input = { apiKey: 'agent_abc123def456789' };
      const output = sanitize(input);
      expect(output.apiKey).toContain('...');
    });
  });
});
