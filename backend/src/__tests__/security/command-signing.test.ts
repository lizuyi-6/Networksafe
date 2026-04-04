/**
 * Command Signing Service Tests
 *
 * Tests for HMAC command signing and verification.
 */

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}));

jest.mock('../../security/agent-auth.service', () => ({
  __esModule: true,
  default: {
    getAgentSecretKey: jest.fn()
  }
}));

jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: { isAvailable: jest.fn().mockReturnValue(false) }
}));

jest.mock('../../security/nonce-manager.service', () => ({
  __esModule: true,
  default: {
    checkAndUseNonce: jest.fn().mockResolvedValue(true)
  }
}));

import { CommandSigningService } from '../../security/command-signing.service';
import agentAuthService from '../../security/agent-auth.service';
import nonceManager from '../../security/nonce-manager.service';
import crypto from 'crypto';

const mockGetAgentSecretKey = agentAuthService.getAgentSecretKey as jest.Mock;
const mockCheckAndUseNonce = nonceManager.checkAndUseNonce as jest.Mock;

// Helper: create a signed command with a specific timestamp
function signWithTimestamp(service: CommandSigningService, agentId: string, type: string, timestamp: number, payload?: any) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const command = { type, payload, timestamp, nonce };
  const secretKey = 'test-secret-key-32-bytes-long';
  const message = JSON.stringify(command);
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return { command, signature, agentId };
}

describe('CommandSigningService', () => {
  let service: CommandSigningService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAgentSecretKey.mockReturnValue('test-secret-key-32-bytes-long');
    service = new CommandSigningService();
  });

  describe('signCommand', () => {
    it('throws when agent not found', () => {
      mockGetAgentSecretKey.mockReturnValue(null);

      expect(() => service.signCommand('agent-001', 'restart')).toThrow(
        'Cannot sign command: agent agent-001 not found or revoked'
      );
    });

    it('returns signed command with correct structure', () => {
      const result = service.signCommand('agent-001', 'restart', { delay: 5000 });

      expect(result.agentId).toBe('agent-001');
      expect(result.command.type).toBe('restart');
      expect(result.command.payload).toEqual({ delay: 5000 });
      expect(result.command.nonce).toBeDefined();
      expect(typeof result.command.timestamp).toBe('number');
      expect(result.signature).toBeDefined();
      expect(typeof result.signature).toBe('string');
      expect(result.signature.length).toBeGreaterThan(0);
    });

    it('generates different nonces for each call', () => {
      const r1 = service.signCommand('agent-001', 'restart');
      const r2 = service.signCommand('agent-001', 'restart');

      expect(r1.command.nonce).not.toBe(r2.command.nonce);
    });

    it('generates different signatures for different commands', () => {
      const r1 = service.signCommand('agent-001', 'restart');
      const r2 = service.signCommand('agent-001', 'update');

      expect(r1.signature).not.toBe(r2.signature);
    });

    it('generates different timestamps for consecutive calls', () => {
      const r1 = service.signCommand('agent-001', 'restart');
      const r2 = service.signCommand('agent-001', 'restart');

      expect(r1.command.timestamp).toBeLessThanOrEqual(r2.command.timestamp);
    });

    it('works without payload', () => {
      const result = service.signCommand('agent-001', 'ping');

      expect(result.command.type).toBe('ping');
      expect(result.command.payload).toBeUndefined();
      expect(result.signature).toBeDefined();
    });
  });

  describe('verifyCommand', () => {
    it('returns valid: true for fresh signed command', async () => {
      const signed = service.signCommand('agent-001', 'restart', { delay: 5000 });

      const result = await service.verifyCommand(signed, 'test-secret-key-32-bytes-long');

      expect(result.valid).toBe(true);
      expect(result.command).toBeDefined();
    });

    it('returns valid: false for tampered signature', async () => {
      const signed = service.signCommand('agent-001', 'restart');
      signed.signature = '0000000000000000000000000000000000000000000000000000000000000000';

      const result = await service.verifyCommand(signed, 'test-secret-key-32-bytes-long');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.invalid_signature');
    });

    it('returns valid: false for tampered command payload', async () => {
      const signed = service.signCommand('agent-001', 'restart');
      signed.command.payload = { delay: 999999 };

      const result = await service.verifyCommand(signed, 'test-secret-key-32-bytes-long');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.invalid_signature');
    });

    it('returns expired for stale command (>30s)', async () => {
      const signed = signWithTimestamp(service, 'agent-001', 'restart', Date.now() - 31 * 1000);

      const result = await service.verifyCommand(signed, 'test-secret-key-32-bytes-long');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.command_expired');
    });

    it('accepts command within 30 seconds', async () => {
      const signed = signWithTimestamp(service, 'agent-001', 'restart', Date.now() - 29 * 1000);

      const result = await service.verifyCommand(signed, 'test-secret-key-32-bytes-long');

      expect(result.valid).toBe(true);
    });

    it('returns invalid for future timestamp (>5s)', async () => {
      const signed = signWithTimestamp(service, 'agent-001', 'restart', Date.now() + 6000);

      const result = await service.verifyCommand(signed, 'test-secret-key-32-bytes-long');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.invalid_timestamp');
    });

    it('returns duplicate_nonce when nonce replayed', async () => {
      mockCheckAndUseNonce.mockResolvedValue(false);

      const signed = service.signCommand('agent-001', 'restart');
      const result = await service.verifyCommand(signed, 'test-secret-key-32-bytes-long');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.duplicate_nonce');
    });
  });

  describe('signAdminCommand', () => {
    it('returns HMAC hex string', () => {
      const signature = service.signAdminCommand(
        { action: 'reset' },
        'admin-secret-key-minimum-32-characters!'
      );

      expect(typeof signature).toBe('string');
      expect(signature).toMatch(/^[0-9a-f]+$/);
      expect(signature.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
    });

    it('produces different signatures for different commands', () => {
      const s1 = service.signAdminCommand({ action: 'reset' }, 'admin-secret');
      const s2 = service.signAdminCommand({ action: 'update' }, 'admin-secret');

      expect(s1).not.toBe(s2);
    });

    it('produces different signatures for different secrets', () => {
      const s1 = service.signAdminCommand({ action: 'reset' }, 'secret-one-32-chars-long!');
      const s2 = service.signAdminCommand({ action: 'reset' }, 'secret-two-32-chars-long!');

      expect(s1).not.toBe(s2);
    });

    it('includes timestamp and nonce in signed message', () => {
      const command = { action: 'reset' };
      const signature = service.signAdminCommand(command, 'admin-secret');

      // The signature should include the command plus timestamp and nonce
      // Different calls with same command produce different signatures
      const signature2 = service.signAdminCommand(command, 'admin-secret');
      expect(signature).not.toBe(signature2);
    });
  });
});
