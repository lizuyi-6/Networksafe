/**
 * Nonce Manager Service Tests
 *
 * Tests for nonce replay protection with Redis + memory fallback.
 */

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}));

jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn().mockReturnValue(true),
    exists: jest.fn().mockResolvedValue(0),
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null)
  }
}));

import { NonceManager } from '../../security/nonce-manager.service';
import redisService from '../../security/redis.service';

const mockRedisExists = redisService.exists as jest.Mock;
const mockRedisSet = redisService.set as jest.Mock;
const mockRedisIsAvailable = redisService.isAvailable as jest.Mock;

describe('NonceManager', () => {
  let manager: NonceManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockRedisExists.mockResolvedValue(0);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisIsAvailable.mockReturnValue(true);
    manager = new NonceManager();
    jest.runOnlyPendingTimers(); // flush the constructor setInterval
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('checkAndUseNonce', () => {
    it('returns true for new nonce', async () => {
      const result = await manager.checkAndUseNonce('unique-nonce-001');

      expect(result).toBe(true);
      expect(mockRedisExists).toHaveBeenCalledWith('nonce:unique-nonce-001');
      expect(mockRedisSet).toHaveBeenCalledWith('nonce:unique-nonce-001', '1', 600);
    });

    it('returns false for duplicate nonce (Redis path)', async () => {
      mockRedisExists.mockResolvedValue(1);

      const result = await manager.checkAndUseNonce('duplicate-nonce');

      expect(result).toBe(false);
    });

    it('returns false for duplicate nonce (memory path after Redis failure)', async () => {
      mockRedisExists.mockRejectedValue(new Error('Redis down'));
      // First call stores in memory
      await manager.checkAndUseNonce('memory-nonce');
      // Second call should detect duplicate
      const result = await manager.checkAndUseNonce('memory-nonce');

      expect(result).toBe(false);
    });

    it('falls back to memory when Redis fails', async () => {
      mockRedisExists.mockRejectedValue(new Error('Redis down'));

      const result = await manager.checkAndUseNonce('fallback-nonce');

      expect(result).toBe(true);
    });

    it('returns false for duplicate nonce in same instance (memory)', async () => {
      mockRedisExists.mockResolvedValue(0);
      await manager.checkAndUseNonce('dup-test');
      // Second call with same nonce - memory store has it
      const result = await manager.checkAndUseNonce('dup-test');

      expect(result).toBe(false);
    });

    it('uses custom TTL', async () => {
      await manager.checkAndUseNonce('ttl-nonce', 300);

      expect(mockRedisSet).toHaveBeenCalledWith('nonce:ttl-nonce', '1', 300);
    });
  });

  describe('hasNonce', () => {
    it('returns false for unknown nonce', async () => {
      mockRedisExists.mockResolvedValue(0);

      const result = await manager.hasNonce('unknown');

      expect(result).toBe(false);
    });

    it('returns true when Redis reports nonce exists', async () => {
      mockRedisExists.mockResolvedValue(1);

      const result = await manager.hasNonce('existing');

      expect(result).toBe(true);
    });

    it('falls back to memory when Redis fails', async () => {
      mockRedisExists.mockRejectedValue(new Error('no redis'));

      const result = await manager.hasNonce('check-memory');

      expect(result).toBe(false);
    });
  });

  describe('clearAll', () => {
    it('clears memory store', async () => {
      await manager.checkAndUseNonce('to-clear');
      expect(manager.getStats().memoryCount).toBeGreaterThan(0);

      await manager.clearAll();
      expect(manager.getStats().memoryCount).toBe(0);
    });
  });

  describe('getStats', () => {
    it('returns memoryCount and redisAvailable', () => {
      const stats = manager.getStats();

      expect(stats).toHaveProperty('memoryCount');
      expect(stats).toHaveProperty('redisAvailable');
      expect(typeof stats.memoryCount).toBe('number');
      expect(typeof stats.redisAvailable).toBe('boolean');
    });

    it('reflects Redis availability', () => {
      mockRedisIsAvailable.mockReturnValue(false);
      expect(manager.getStats().redisAvailable).toBe(false);

      mockRedisIsAvailable.mockReturnValue(true);
      expect(manager.getStats().redisAvailable).toBe(true);
    });
  });
});
