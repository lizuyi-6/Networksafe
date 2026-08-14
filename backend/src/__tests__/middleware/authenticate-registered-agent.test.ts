/**
 * AG-A06 (audit 2026-08): agent-only routes must authenticate against the
 * per-agent registry (approved status + API key hash + revocation), not the
 * static shared VALID_API_KEYS list; and the attached identity must be
 * least-privilege (viewer scope, NO plan), never role=tenant/plan=ultra.
 */
import express from 'express';
import request from 'supertest';

const verifyAgent = jest.fn();

jest.mock('../../security/agent-auth.service', () => ({
  __esModule: true,
  default: { verifyAgent: (...args: any[]) => verifyAgent(...args) }
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

describe('authenticateRegisteredAgent (AG-A06)', () => {
  let app: express.Express;

  const buildApp = async (): Promise<void> => {
    // Fresh router per test so the (unmocked) real middleware is wired.
    jest.resetModules();
    const { authenticateRegisteredAgent } = require('../../middleware/auth.middleware');
    app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => next());
    app.use('/probe', authenticateRegisteredAgent, (req: any, res: any) => {
      res.status(200).json({
        userId: req.user?.userId,
        role: req.user?.role,
        plan: req.user?.plan ?? null,
        tenantId: req.user?.tenantId ?? null,
        agentId: req.agent?.agentId ?? null
      });
    });
  };

  beforeEach(() => {
    verifyAgent.mockReset();
  });

  it('rejects requests without X-Agent-Id / X-Api-Key (no VALID_API_KEYS fallback)', async () => {
    await buildApp();
    const res = await request(app).post('/probe');
    expect(res.status).toBe(401);
    expect(verifyAgent).not.toHaveBeenCalled();
  });

  it('rejects credentials the agent registry does not verify (revoked / unknown / bad key)', async () => {
    await buildApp();
    verifyAgent.mockResolvedValue(null);

    const res = await request(app)
      .post('/probe')
      .set('x-agent-id', 'agent-revoked-1')
      .set('x-api-key', 'AetherGuard_test_key_whatever');

    expect(res.status).toBe(401);
    expect(verifyAgent).toHaveBeenCalledWith('agent-revoked-1', 'AetherGuard_test_key_whatever');
  });

  it('attaches a least-privilege identity (viewer scope, NO plan) for a verified agent', async () => {
    await buildApp();
    verifyAgent.mockResolvedValue({
      agentId: 'agent-7',
      hostname: 'lab-host',
      platform: 'linux',
      tenantId: 'tenant-42'
    });

    const res = await request(app)
      .post('/probe')
      .set('x-agent-id', 'agent-7')
      .set('x-api-key', 'agent_valid_key');

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('agent-7');
    expect(res.body.agentId).toBe('agent-7');
    expect(res.body.tenantId).toBe('tenant-42');
    // The forged-identity property from the finding must NOT hold:
    expect(res.body.role).not.toBe('tenant');
    expect(res.body.plan).toBeNull();
  });

  it('fails closed when the agent auth backend throws', async () => {
    await buildApp();
    verifyAgent.mockRejectedValue(new Error('db down'));

    const res = await request(app)
      .post('/probe')
      .set('x-agent-id', 'agent-7')
      .set('x-api-key', 'agent_valid_key');

    expect(res.status).toBe(401);
  });
});
