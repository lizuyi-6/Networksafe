/**
 * Deployments Routes Tests
 *
 * Tests for deployment configuration generation routes
 */

import request from 'supertest';
import express from 'express';
import deploymentsRouter from '../../api/routes/deployments.routes';

// Mock auth
jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-user', role: 'admin', tenantId: 'tenant-001' };
    next();
  }),
  requireRole: jest.fn(() => (req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
  }
}));

// Mock deployment profile repository
const mockGetProfile = jest.fn();
const mockListProfiles = jest.fn();
const mockSaveProfile = jest.fn();
const mockGetNextVersion = jest.fn();

jest.mock('../../modules/deployments/deployment-profile.repository', () => ({
  getDeploymentProfile: (...args: any[]) => mockGetProfile(...args),
  getNextDeploymentProfileVersion: (...args: any[]) => mockGetNextVersion(...args),
  listDeploymentProfiles: (...args: any[]) => mockListProfiles(...args),
  saveDeploymentProfile: (...args: any[]) => mockSaveProfile(...args)
}));

// Mock audit logger
jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: { log: jest.fn().mockResolvedValue(undefined) }
}));

const defaultProfile = {
  serverName: 'api.example.com',
  port: 8080,
  upstream: 'http://backend:3005',
  rateLimit: '100',
  namespace: 'aetherguard',
  image: 'ghcr.io/aetherguard/agent:latest',
  apiKey: 'test-api-key'
};

describe('Deployments Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/deployments', deploymentsRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    mockListProfiles.mockReset();
    mockGetProfile.mockReset();
    mockSaveProfile.mockReset();
    mockGetNextVersion.mockReset();
  });

  describe('POST /generate', () => {
    it('generates nginx config', async () => {
      const response = await request(app)
        .post('/api/deployments/generate')
        .send({ serverType: 'nginx', profile: defaultProfile });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.configText).toContain('limit_req_zone');
      expect(response.body.data.configText).toContain('proxy_pass');
    });

    it('generates apache config', async () => {
      const response = await request(app)
        .post('/api/deployments/generate')
        .send({ serverType: 'apache', profile: defaultProfile });

      expect(response.status).toBe(200);
      expect(response.body.data.configText).toContain('<VirtualHost');
      expect(response.body.data.configText).toContain('ProxyPass');
    });

    it('generates caddy config', async () => {
      const response = await request(app)
        .post('/api/deployments/generate')
        .send({ serverType: 'caddy', profile: defaultProfile });

      expect(response.status).toBe(200);
      expect(response.body.data.configText).toContain('reverse_proxy');
    });

    it('generates docker-compose config', async () => {
      const response = await request(app)
        .post('/api/deployments/generate')
        .send({ serverType: 'docker_compose', profile: defaultProfile });

      expect(response.status).toBe(200);
      expect(response.body.data.configText).toContain('aetherguard-agent');
      expect(response.body.data.configText).toContain('ghcr.io/aetherguard/agent:latest');
    });

    it('generates k8s daemonset config', async () => {
      const response = await request(app)
        .post('/api/deployments/generate')
        .send({ serverType: 'k8s_daemonset', profile: defaultProfile });

      expect(response.status).toBe(200);
      expect(response.body.data.configText).toContain('DaemonSet');
      expect(response.body.data.configText).toContain('aetherguard-agent');
    });

    it('returns 400 for unsupported server type', async () => {
      const response = await request(app)
        .post('/api/deployments/generate')
        .send({ serverType: 'unknown_type', profile: defaultProfile });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('returns 400 for invalid profile (bad port)', async () => {
      const response = await request(app)
        .post('/api/deployments/generate')
        .send({ serverType: 'nginx', profile: { ...defaultProfile, port: 99999 } });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('returns 400 for invalid profile (bad rateLimit)', async () => {
      const response = await request(app)
        .post('/api/deployments/generate')
        .send({ serverType: 'nginx', profile: { ...defaultProfile, rateLimit: -1 } });

      expect(response.status).toBe(400);
    });

    it('returns 400 for missing serverName', async () => {
      const badProfile = { ...defaultProfile, serverName: undefined };
      const response = await request(app)
        .post('/api/deployments/generate')
        .send({ serverType: 'nginx', profile: badProfile });

      expect(response.status).toBe(400);
    });

    it('includes checksum in response', async () => {
      const response = await request(app)
        .post('/api/deployments/generate')
        .send({ serverType: 'nginx', profile: defaultProfile });

      expect(response.body.data.checksum).toBeDefined();
      expect(typeof response.body.data.checksum).toBe('string');
    });

    it('includes envSnippet in response', async () => {
      const response = await request(app)
        .post('/api/deployments/generate')
        .send({ serverType: 'nginx', profile: defaultProfile });

      expect(response.body.data.envSnippet).toContain('ALLOWED_ORIGINS');
      expect(response.body.data.envSnippet).toContain('RATE_LIMIT_REQUESTS');
    });
  });

  describe('POST /save', () => {
    it('saves deployment profile and returns id', async () => {
      mockGetNextVersion.mockResolvedValue(1);
      mockSaveProfile.mockResolvedValue({ id: 'new-profile-id' });

      const response = await request(app)
        .post('/api/deployments/save')
        .send({ serverType: 'nginx', profile: defaultProfile, name: 'My Deployment' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.deploymentId).toBeDefined();
      expect(mockSaveProfile).toHaveBeenCalled();
    });

    it('returns 400 for unsupported server type', async () => {
      const response = await request(app)
        .post('/api/deployments/save')
        .send({ serverType: 'unsupported', profile: defaultProfile });

      expect(response.status).toBe(400);
    });

    it('returns 500 on repository error', async () => {
      mockGetNextVersion.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post('/api/deployments/save')
        .send({ serverType: 'nginx', profile: defaultProfile });

      expect(response.status).toBe(500);
    });
  });

  describe('GET /history/list', () => {
    it('returns list of deployments', async () => {
      mockListProfiles.mockResolvedValue([
        { id: 'h-001', name: 'Old Deployment', server_type: 'nginx', tenant_id: 'tenant-001' }
      ]);

      const response = await request(app).get('/api/deployments/history/list');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('returns empty list when no history', async () => {
      mockListProfiles.mockResolvedValue([]);

      const response = await request(app).get('/api/deployments/history/list');

      expect(response.status).toBe(200);
    });

    it('returns 500 on database error', async () => {
      mockListProfiles.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/deployments/history/list');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /:id/download', () => {
    it('downloads bundle for existing profile', async () => {
      mockGetProfile.mockResolvedValue({
        id: 'profile-001',
        name: 'Test',
        server_type: 'nginx',
        config_text: 'server { listen 8080; }',
        env_snippet: 'PORT=8080',
        profile_json: JSON.stringify(defaultProfile),
        site_id: null,
        tenant_id: 'tenant-001'
      });

      const response = await request(app).get('/api/deployments/profile-001/download');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/x-shellscript');
    });

    it('returns 404 when profile not found', async () => {
      mockGetProfile.mockResolvedValue(null);

      const response = await request(app).get('/api/deployments/nonexistent/download');

      expect(response.status).toBe(404);
    });

    it('returns raw config when format=conf', async () => {
      mockGetProfile.mockResolvedValue({
        id: 'profile-001',
        name: 'Test',
        server_type: 'nginx',
        config_text: 'server { listen 8080; }',
        env_snippet: 'PORT=8080',
        profile_json: '{}',
        site_id: null,
        tenant_id: 'tenant-001'
      });

      const response = await request(app)
        .get('/api/deployments/profile-001/download')
        .query({ format: 'conf' });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.text).toContain('listen 8080');
    });

    it('returns 500 on error', async () => {
      mockGetProfile.mockRejectedValue(new Error('Error'));

      const response = await request(app).get('/api/deployments/bad/download');

      expect(response.status).toBe(500);
    });
  });
});
