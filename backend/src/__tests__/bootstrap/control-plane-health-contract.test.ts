import request from 'supertest';

jest.mock('../../core/health/runtime-health', () => ({
  buildRuntimeHealthSnapshot: jest.fn().mockResolvedValue({
    status: 'healthy',
    liveness: { status: 'alive', timestamp: '2026-07-10T00:00:00.000Z' },
    readiness: { status: 'ready', blockers: [] },
    dependencies: {
      redis: { status: 'healthy', message: 'connected', details: { latencyMs: 2 } }
    },
    runtime: { profile: 'prod', dbMode: 'postgres' },
    queueBackend: 'redis',
    agents: 3,
    emulator: { enabled: false }
  })
}));

import { createControlPlaneApp } from '../../bootstrap/control-plane-app';
import { buildRuntimeHealthSnapshot } from '../../core/health/runtime-health';

describe('control-plane public and protected health contracts', () => {
  const app = createControlPlaneApp({
    runtime: {
      profile: 'prod',
      dbMode: 'postgres',
      sqliteFallbackEnabled: false,
      apiEnabled: true
    },
    getAgentCount: () => 3
  });

  it('exposes only the liveness status on the public probe', async () => {
    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'alive' });
  });

  it('exposes only the readiness status on the public probe', async () => {
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(response.body).not.toHaveProperty('blockers');
    expect(response.body).not.toHaveProperty('dependencies');
  });

  it('returns a minimal 503 response when Redis blocks production readiness', async () => {
    (buildRuntimeHealthSnapshot as jest.Mock).mockResolvedValueOnce({
      readiness: { status: 'not_ready', blockers: ['redis'] },
      dependencies: {
        redis: {
          status: 'unhealthy',
          message: 'Connection refused',
          details: { reason: 'authentication_session_store_unavailable' }
        }
      }
    });

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready' });
    expect(response.body).not.toHaveProperty('blockers');
  });

  it.each([
    '/api/health',
    '/api/health/live',
    '/api/health/ready',
    '/api/health/dependencies',
    '/api/stats',
    '/api/stats/badges'
  ])('rejects an anonymous request to %s', async (path) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('AUTH_TOKEN_MISSING');
  });
});
