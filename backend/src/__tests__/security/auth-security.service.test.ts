const mockRedisClient = {
  smembers: jest.fn(),
  exists: jest.fn(),
  srem: jest.fn(),
  scard: jest.fn(),
  setex: jest.fn(),
  sadd: jest.fn(),
  expire: jest.fn()
};

const mockRedisService = {
  isAvailable: jest.fn(() => false),
  getClient: jest.fn(() => mockRedisClient),
  get: jest.fn(),
  del: jest.fn()
};

jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: mockRedisService
}));

import { AuthSecurityService } from '../../security/auth-security.service';

describe('AuthSecurityService sessions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisService.isAvailable.mockReturnValue(false);
    mockRedisService.getClient.mockReturnValue(mockRedisClient);
    mockRedisService.get.mockResolvedValue(null);
    mockRedisService.del.mockResolvedValue(undefined);
    mockRedisClient.smembers.mockResolvedValue([]);
    mockRedisClient.exists.mockResolvedValue(0);
    mockRedisClient.srem.mockResolvedValue(0);
    mockRedisClient.scard.mockResolvedValue(0);
    mockRedisClient.setex.mockResolvedValue('OK');
    mockRedisClient.sadd.mockResolvedValue(1);
    mockRedisClient.expire.mockResolvedValue(1);
  });

  it('invalidates all fallback sessions for a user', async () => {
    const service = new AuthSecurityService();

    await service.addSession('user-1', 'session-1', { source: 'test' });
    await service.addSession('user-1', 'session-2', { source: 'test' });

    await expect(service.validateSession('user-1', 'session-1')).resolves.toBe(true);
    await expect(service.validateSession('user-1', 'session-2')).resolves.toBe(true);

    await service.invalidateSession('user-1');

    await expect(service.validateSession('user-1', 'session-1')).resolves.toBe(false);
    await expect(service.validateSession('user-1', 'session-2')).resolves.toBe(false);
  });

  it('prunes stale Redis session IDs before enforcing concurrent-session limits', async () => {
    mockRedisService.isAvailable.mockReturnValue(true);
    mockRedisClient.smembers.mockResolvedValue(['live-session', 'stale-session']);
    mockRedisClient.exists.mockImplementation(async (key: string) => (
      key === 'auth:session:live-session' ? 1 : 0
    ));
    mockRedisClient.scard.mockResolvedValue(1);

    const service = new AuthSecurityService();
    const allowed = await service.checkConcurrentSessions('user-redis', 2);

    expect(mockRedisClient.srem).toHaveBeenCalledWith('auth:concurrent:user-redis', 'stale-session');
    expect(allowed).toBe(true);
  });

  it('validates Redis sessions by sessionId key and stored userId', async () => {
    mockRedisService.isAvailable.mockReturnValue(true);
    mockRedisService.get.mockResolvedValue(JSON.stringify({ userId: 'user-redis' }));

    const service = new AuthSecurityService();
    const valid = await service.validateSession('user-redis', 'session-redis');

    expect(mockRedisService.get).toHaveBeenCalledWith('auth:session:session-redis');
    expect(valid).toBe(true);
  });

  it('invalidates Redis session keys listed in the concurrent-session Set', async () => {
    mockRedisService.isAvailable.mockReturnValue(true);
    mockRedisClient.smembers.mockResolvedValue(['session-a', 'session-b']);

    const service = new AuthSecurityService();
    await service.invalidateSession('user-redis');

    expect(mockRedisService.del).toHaveBeenCalledWith('auth:session:session-a');
    expect(mockRedisService.del).toHaveBeenCalledWith('auth:session:session-b');
    expect(mockRedisService.del).toHaveBeenCalledWith('auth:concurrent:user-redis');
  });
});
