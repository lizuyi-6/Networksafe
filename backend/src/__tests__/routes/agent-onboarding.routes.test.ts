/**
 * Agent Onboarding Routes Tests
 *
 * Tests for agent onboarding API routes
 */

import request from 'supertest';
import express from 'express';
import agentOnboardingRouter from '../../api/routes/agent-onboarding.routes';

// Mock auth
jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-user', role: 'admin', tenantId: 'tenant-001', email: 'admin@test.com' };
    next();
  }),
  requireRole: jest.fn(() => (req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

// Mock plan quota
jest.mock('../../middleware/plan.middleware', () => ({
  requirePlanQuota: jest.fn(() => (req: any, _res: any, next: any) => next())
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}));

// Mock repo functions
const mockSaveOnboardingCode = jest.fn();
const mockListOnboardingCodes = jest.fn();
const mockGetOnboardingCodeByHash = jest.fn();
const mockSaveCredentialAudit = jest.fn();

jest.mock('../../modules/agent-onboarding/agent-onboarding.repository', () => ({
  saveAgentOnboardingCode: (...args: any[]) => mockSaveOnboardingCode(...args),
  listAgentOnboardingCodes: (...args: any[]) => mockListOnboardingCodes(...args),
  getAgentOnboardingCodeByHash: (...args: any[]) => mockGetOnboardingCodeByHash(...args),
  saveAgentCredentialAudit: (...args: any[]) => mockSaveCredentialAudit(...args),
  getLatestAgentRegistration: jest.fn()
}));

// Mock agent auth service
const mockRegisterAgent = jest.fn();
const mockListAgents = jest.fn();
const mockRevokeAgent = jest.fn();

jest.mock('../../security/agent-auth.service', () => ({
  __esModule: true,
  default: {
    registerAgent: (...args: any[]) => mockRegisterAgent(...args),
    listAgents: (...args: any[]) => mockListAgents(...args),
    revokeAgent: (...args: any[]) => mockRevokeAgent(...args)
  }
}));

// Mock the onboarding service (the route delegates consumption to it).
const mockExchangeOnboarding = jest.fn();
jest.mock('../../modules/agent-onboarding/agent-onboarding.service', () => ({
  __esModule: true,
  agentOnboardingService: {
    exchangeOnboardingCode: (...args: any[]) => mockExchangeOnboarding(...args)
  }
}));

// Mock audit logger
jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: { log: jest.fn().mockResolvedValue(undefined) }
}));

// Mock postgres-shadow-store.service module (used via require in route)
jest.mock('../../services/postgres-shadow-store.service', () => ({
  postgresShadowStoreService: {
    upsert: jest.fn().mockResolvedValue(undefined)
  }
}));

describe('Agent Onboarding Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/agent-onboarding', agentOnboardingRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveOnboardingCode.mockResolvedValue(undefined);
    mockSaveCredentialAudit.mockResolvedValue(undefined);
  });

  describe('POST /codes', () => {
    it('creates onboarding code', async () => {
      const response = await request(app)
        .post('/api/agent-onboarding/codes')
        .send({ ttlMinutes: 30, maxUses: 2, hostname: 'web-server-01' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.onboardingCode).toMatch(/^fgob_/);
      expect(response.body.data.expiresAt).toBeDefined();
      expect(response.body.data.maxUses).toBe(2);
      expect(mockSaveOnboardingCode).toHaveBeenCalled();
      expect(mockSaveCredentialAudit).toHaveBeenCalled();
    });

    it('clamps ttlMinutes to 60*24 max', async () => {
      const response = await request(app)
        .post('/api/agent-onboarding/codes')
        .send({ ttlMinutes: 9999 });

      expect(response.status).toBe(201);
      expect(mockSaveOnboardingCode).toHaveBeenCalledWith(
        expect.objectContaining({ max_uses: 1 })
      );
    });

    it('clamps maxUses to 5', async () => {
      const response = await request(app)
        .post('/api/agent-onboarding/codes')
        .send({ maxUses: 99 });

      expect(response.status).toBe(201);
      expect(mockSaveOnboardingCode).toHaveBeenCalledWith(
        expect.objectContaining({ max_uses: 5 })
      );
    });

    it('returns 500 on save error', async () => {
      mockSaveOnboardingCode.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post('/api/agent-onboarding/codes')
        .send({});

      expect(response.status).toBe(500);
    });
  });

  describe('GET /codes', () => {
    it('returns list of onboarding codes', async () => {
      const now = new Date();
      const future = new Date(now.getTime() + 3600 * 1000).toISOString();
      mockListOnboardingCodes.mockResolvedValue([
        {
          id: 'code-001',
          code_hash: 'hash123',
          tenant_id: 'tenant-001',
          created_by: 'admin-user',
          max_uses: 1,
          used_count: 0,
          status: 'active',
          expected_hostname: 'server-1',
          expected_tags_json: '["web"]',
          expires_at: future,
          created_at: now.toISOString(),
          used_at: null,
          used_by_agent_id: null
        }
      ]);

      const response = await request(app).get('/api/agent-onboarding/codes');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0].status).toBe('active');
      expect(response.body.data[0].expectedTags).toEqual(['web']);
    });

    it('marks expired codes as expired', async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      mockListOnboardingCodes.mockResolvedValue([
        {
          id: 'code-expired',
          code_hash: 'hash456',
          tenant_id: 'tenant-001',
          created_by: 'admin-user',
          max_uses: 1,
          used_count: 0,
          status: 'active',
          expires_at: past,
          created_at: past
        }
      ]);

      const response = await request(app).get('/api/agent-onboarding/codes');

      expect(response.status).toBe(200);
      expect(response.body.data[0].status).toBe('expired');
    });

    it('returns 500 on database error', async () => {
      mockListOnboardingCodes.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/agent-onboarding/codes');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /exchange', () => {
    const mockExchange = mockExchangeOnboarding as jest.Mock;

    it('exchanges valid onboarding code', async () => {
      mockExchange.mockResolvedValue({
        ok: true,
        registration: {
          agentId: 'agent-001',
          apiKey: 'ak_test_agent_001',
          secretKey: 'sk_test_secret'
        },
        codeRow: {
          id: 'code-001',
          tenant_id: 'tenant-001',
          status: 'used',
          used_at: new Date().toISOString()
        }
      });

      const response = await request(app)
        .post('/api/agent-onboarding/exchange')
        .send({ onboardingCode: 'fgob_validcode', hostname: 'web-server', platform: 'linux' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.agentId).toBe('agent-001');
      expect(response.body.data.apiKey).toBeDefined();
      expect(response.body.data.secretKey).toBeDefined();
      // AUD-03-2: the route must delegate consumption to the service.
      expect(mockExchange).toHaveBeenCalledWith(expect.objectContaining({
        hostname: 'web-server',
        platform: 'linux'
      }));
    });

    it('returns 400 when fields missing', async () => {
      const response = await request(app)
        .post('/api/agent-onboarding/exchange')
        .send({ onboardingCode: 'fgob_test' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(mockExchange).not.toHaveBeenCalled();
    });

    it('returns 404 when code not found', async () => {
      mockExchange.mockResolvedValue({ ok: false, reason: 'code_not_found' });

      const response = await request(app)
        .post('/api/agent-onboarding/exchange')
        .send({ onboardingCode: 'fgob_invalid', hostname: 'server', platform: 'linux' });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ONBOARDING_CODE_NOT_FOUND');
    });

    it('returns 409 when code inactive', async () => {
      mockExchange.mockResolvedValue({ ok: false, reason: 'code_inactive' });

      const response = await request(app)
        .post('/api/agent-onboarding/exchange')
        .send({ onboardingCode: 'fgob_test', hostname: 'server', platform: 'linux' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ONBOARDING_CODE_INACTIVE');
    });

    it('returns 410 when code expired', async () => {
      mockExchange.mockResolvedValue({ ok: false, reason: 'code_expired' });

      const response = await request(app)
        .post('/api/agent-onboarding/exchange')
        .send({ onboardingCode: 'fgob_expired', hostname: 'server', platform: 'linux' });

      expect(response.status).toBe(410);
      expect(response.body.code).toBe('ONBOARDING_CODE_EXPIRED');
    });

    it('returns 409 when code already used', async () => {
      mockExchange.mockResolvedValue({ ok: false, reason: 'code_used' });

      const response = await request(app)
        .post('/api/agent-onboarding/exchange')
        .send({ onboardingCode: 'fgob_used', hostname: 'server', platform: 'linux' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ONBOARDING_CODE_USED');
    });

    it('returns 409 when hostname does not match expected', async () => {
      mockExchange.mockResolvedValue({ ok: false, reason: 'hostname_mismatch' });

      const response = await request(app)
        .post('/api/agent-onboarding/exchange')
        .send({ onboardingCode: 'fgob_host', hostname: 'wrong-host', platform: 'linux' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ONBOARDING_POLICY_MISMATCH');
    });

    it('returns 409 when agent tags do not satisfy the code expected tags (AUD-03-2)', async () => {
      mockExchange.mockResolvedValue({ ok: false, reason: 'tags_mismatch' });

      const response = await request(app)
        .post('/api/agent-onboarding/exchange')
        .send({ onboardingCode: 'fgob_tags', hostname: 'server', platform: 'linux', tags: ['wrong'] });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ONBOARDING_POLICY_MISMATCH');
    });
  });

  describe('POST /revoke/:agentId', () => {
    it('revokes an existing agent', async () => {
      mockRevokeAgent.mockReturnValue(true);

      const response = await request(app)
        .post('/api/agent-onboarding/revoke/agent-001')
        .send({ reason: 'compromised' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.revoked).toBe(true);
    });

    it('returns 404 when agent not found', async () => {
      mockRevokeAgent.mockReturnValue(false);

      const response = await request(app)
        .post('/api/agent-onboarding/revoke/nonexistent')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('returns 500 on revoke error', async () => {
      mockRevokeAgent.mockImplementation(() => { throw new Error('DB error'); });

      const response = await request(app)
        .post('/api/agent-onboarding/revoke/agent-001')
        .send({});

      expect(response.status).toBe(500);
    });
  });
});
