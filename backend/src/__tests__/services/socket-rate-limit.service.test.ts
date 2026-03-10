const mockRedisClient = {
  get: jest.fn(),
  setex: jest.fn(),
  incr: jest.fn()
};

jest.mock('../../services/fastpath-client.service', () => ({
  fastpathClientService: {
    checkSocket: jest.fn()
  }
}));

jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn(),
    getClient: jest.fn(() => mockRedisClient)
  }
}));

import { socketRateLimitService } from '../../services/socket-rate-limit.service';
import { fastpathClientService } from '../../services/fastpath-client.service';
import redisService from '../../security/redis.service';

describe('socketRateLimitService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fastpathClientService.checkSocket as jest.Mock).mockResolvedValue(null);
    (redisService.isAvailable as jest.Mock).mockReturnValue(true);
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.setex.mockResolvedValue('OK');
    mockRedisClient.incr.mockResolvedValue(2);
  });

  it('uses fastpath when available', async () => {
    (fastpathClientService.checkSocket as jest.Mock).mockResolvedValueOnce({
      allowed: true,
      remaining: 9,
      resetAt: new Date(Date.now() + 60000).toISOString(),
      resetAtMs: Date.now() + 60000,
      decisionSource: 'rust-fastpath',
      riskFlags: []
    });

    const result = await socketRateLimitService.check({
      key: 'socket:test-fastpath',
      limit: 10,
      windowMs: 60000,
      protocol: 'ws-agent'
    });

    expect(result.usedFallback).toBe(false);
    expect(result.decisionSource).toBe('rust-fastpath');
    expect(redisService.getClient).not.toHaveBeenCalled();
  });

  it('uses redis fallback when fastpath is unavailable', async () => {
    const result = await socketRateLimitService.check({
      key: 'socket:test-redis',
      limit: 10,
      windowMs: 60000,
      protocol: 'ws-agent'
    });

    expect(result.usedFallback).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.decisionSource).toBe('redis-fallback');
    expect(mockRedisClient.setex).toHaveBeenCalledTimes(2);
  });

  it('uses memory fallback when redis is unavailable', async () => {
    (redisService.isAvailable as jest.Mock).mockReturnValue(false);
    const key = `socket:test-memory:${Date.now()}`;

    const first = await socketRateLimitService.check({
      key,
      limit: 1,
      windowMs: 60000,
      protocol: 'ws-agent'
    });
    const second = await socketRateLimitService.check({
      key,
      limit: 1,
      windowMs: 60000,
      protocol: 'ws-agent'
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(first.decisionSource).toBe('memory-fallback');
    expect(second.decisionSource).toBe('memory-fallback');
  });

  it('can force local baseline without calling fastpath', async () => {
    await socketRateLimitService.check({
      key: `socket:test-baseline:${Date.now()}`,
      limit: 10,
      windowMs: 60000,
      protocol: 'ws-agent',
      preferFastpath: false
    });

    expect(fastpathClientService.checkSocket).not.toHaveBeenCalled();
    expect(redisService.getClient).toHaveBeenCalled();
  });
});
