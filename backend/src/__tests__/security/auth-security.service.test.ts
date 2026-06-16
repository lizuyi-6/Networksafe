jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn(() => false)
  }
}));

import { AuthSecurityService } from '../../security/auth-security.service';

describe('AuthSecurityService sessions', () => {
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
});
