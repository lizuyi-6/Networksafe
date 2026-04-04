import express from 'express';
import request from 'supertest';
import agentManagementRouter from '../../api/routes/agent-management.routes';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'admin', tenantId: 't1' };
    next();
  }),
  requireRole: jest.fn(() => (req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../security/agent-auth.service', () => ({
  __esModule: true,
  default: {
    listAgents: jest.fn().mockReturnValue([
      { agentId: 'a1', hostname: 'server-1', platform: 'linux', status: 'active' },
      { agentId: 'a2', hostname: 'server-2', platform: 'linux', status: 'active' }
    ]),
    registerAgent: jest.fn().mockReturnValue({
      agentId: 'new-agent-id',
      apiKey: 'agent_test_key_xxx',
      secretKey: 'agent_secret_xxx',
      hostname: 'new-server',
      platform: 'linux',
      status: 'active',
      createdAt: new Date().toISOString()
    }),
    revokeAgent: jest.fn().mockReturnValue(true),
  }
}));

jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: {
    log: jest.fn().mockResolvedValue(undefined),
    getLogs: jest.fn().mockResolvedValue([]),
    verifyIntegrity: jest.fn().mockResolvedValue(true),
  }
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}));

import agentAuthService from '../../security/agent-auth.service';

const app = express();
app.use(express.json());
app.use(agentManagementRouter);

describe('Agent Management Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns 200 with agents array', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.agents)).toBe(true);
    });

    it('calls listAgents from agentAuthService', async () => {
      await request(app).get('/');
      expect(agentAuthService.listAgents).toHaveBeenCalled();
    });
  });

  describe('POST /register', () => {
    it('returns 201 with agent info on success', async () => {
      const response = await request(app)
        .post('/register')
        .send({ hostname: 'new-server', platform: 'linux', mac: 'AA:BB:CC:DD:EE:FF', tenantId: 't1' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.agent.agentId).toBeDefined();
      expect(response.body.credentials.apiKey).toBeDefined();
    });

    it('returns 400 when hostname is missing', async () => {
      const response = await request(app)
        .post('/register')
        .send({ platform: 'linux' });

      expect(response.status).toBe(400);
    });

    it('returns 400 when platform is missing', async () => {
      const response = await request(app)
        .post('/register')
        .send({ hostname: 'new-server' });

      expect(response.status).toBe(400);
    });

    it('calls registerAgent with the provided details', async () => {
      await request(app)
        .post('/register')
        .send({ hostname: 'new-server', platform: 'linux' });

      expect(agentAuthService.registerAgent).toHaveBeenCalledWith(
        expect.objectContaining({ hostname: 'new-server', platform: 'linux' })
      );
    });
  });

  describe('DELETE /:agentId', () => {
    it('returns 200 on successful revocation', async () => {
      const response = await request(app).delete('/agent-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('returns 404 when agent not found', async () => {
      agentAuthService.revokeAgent.mockReturnValueOnce(false);

      const response = await request(app).delete('/nonexistent-agent');

      expect(response.status).toBe(404);
    });

    it('calls revokeAgent with the correct agentId', async () => {
      await request(app).delete('/my-agent-id');

      expect(agentAuthService.revokeAgent).toHaveBeenCalledWith('my-agent-id');
    });
  });

  describe('GET /audit/logs', () => {
    it('returns 200 with logs array', async () => {
      const response = await request(app).get('/audit/logs');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /audit/verify/:logId', () => {
    it('returns 200 with valid=true', async () => {
      const response = await request(app).get('/audit/verify/log-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.valid).toBe(true);
    });
  });
});
