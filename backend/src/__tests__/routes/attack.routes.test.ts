import express from 'express';
import request from 'supertest';
import attackRouter from '../../api/routes/attack.routes';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'admin', tenantId: 't1' };
    next();
  }),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../config/app-mode', () => ({
  isAttackSimulatorEnabled: jest.fn().mockReturnValue(false),
}));

jest.mock('../../api/routes/ai-system.routes', () => ({
  getAgentGateway: jest.fn().mockReturnValue(null),
  getTrafficStats: jest.fn().mockReturnValue({
    activeFlows: [],
    packetsProcessed: 0,
    packetsBlocked: 0,
    packetsAllowed: 0,
    packetsInspected: 0,
    bytesProcessed: 0,
    threats: new Map(),
  }),
  getAgentSystem: jest.fn().mockReturnValue(null),
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    upsertAsset: jest.fn().mockReturnValue({ assetId: 'asset-1' }),
    upsertTrafficSession: jest.fn().mockReturnValue({}),
    recordValidationRun: jest.fn().mockReturnValue({}),
    ingestFinding: jest.fn().mockReturnValue({}),
  }
}));

const app = express();
app.use(express.json());
app.use(attackRouter);

describe('attack.routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /types', () => {
    it('returns 404 when simulator disabled', async () => {
      const { isAttackSimulatorEnabled } = require('../../config/app-mode');
      isAttackSimulatorEnabled.mockReturnValue(false);

      const res = await request(app).get('/types');

      expect(res.status).toBe(404);
    });

    it('returns 200 with attack array when simulator enabled', async () => {
      const { isAttackSimulatorEnabled } = require('../../config/app-mode');
      isAttackSimulatorEnabled.mockReturnValue(true);

      const res = await request(app).get('/types');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('returns 8 attack type objects with id, name, category, severity, description', async () => {
      const { isAttackSimulatorEnabled } = require('../../config/app-mode');
      isAttackSimulatorEnabled.mockReturnValue(true);

      const res = await request(app).get('/types');

      expect(res.body.length).toBe(8);
      for (const attack of res.body) {
        expect(attack).toHaveProperty('id');
        expect(attack).toHaveProperty('name');
        expect(attack).toHaveProperty('category');
        expect(attack).toHaveProperty('severity');
        expect(attack).toHaveProperty('description');
      }
    });
  });

  describe('POST /simulate', () => {
    it('returns 404 when simulator disabled', async () => {
      const { isAttackSimulatorEnabled } = require('../../config/app-mode');
      isAttackSimulatorEnabled.mockReturnValue(false);

      const res = await request(app).post('/simulate').send({});

      expect(res.status).toBe(404);
    });

    it('returns 503 when multiAgentSystem not initialized', async () => {
      const { isAttackSimulatorEnabled } = require('../../config/app-mode');
      isAttackSimulatorEnabled.mockReturnValue(true);

      const res = await request(app).post('/simulate').send({});

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('backend.attack_simulator_backend_is_not_initialized');
    });

    // These tests intercept setTimeout to fire callbacks in the next microtask
    // This allows the async route handler to complete without real-time delays
    it('returns 200 with results when multiAgentSystem initialized', async () => {
      jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
        queueMicrotask(cb);
        return 0 as any;
      });

      try {
        const { isAttackSimulatorEnabled } = require('../../config/app-mode');
        const { getAgentSystem, getTrafficStats } = require('../../api/routes/ai-system.routes');
        isAttackSimulatorEnabled.mockReturnValue(true);
        getTrafficStats.mockReturnValue({
          activeFlows: [],
          packetsProcessed: 0,
          packetsBlocked: 0,
          packetsAllowed: 0,
          packetsInspected: 0,
          bytesProcessed: 0,
          threats: new Map(),
        });
        getAgentSystem.mockReturnValue({
          isInitialized: () => true,
          getStats: () => ({ modelRouter: { total: 0, local: 0, cloud: 0 } }),
          getConfig: () => ({ models: { local: { model: 'llama3' }, cloud: { model: 'glm-4' } } }),
          analyze: jest.fn().mockResolvedValue({ verdict: 'block', confidence: 0.9, reasoning: 'test', evidence: [], processingTime: 50 })
        });

        const res = await request(app).post('/simulate').send({});

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('total');
        expect(res.body).toHaveProperty('results');
      } finally {
        (global.setTimeout as jest.Mock).mockRestore();
      }
    });

    it('uses attackIds filter when provided', async () => {
      jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
        queueMicrotask(cb);
        return 0 as any;
      });

      try {
        const { isAttackSimulatorEnabled } = require('../../config/app-mode');
        const { getAgentSystem, getTrafficStats } = require('../../api/routes/ai-system.routes');
        isAttackSimulatorEnabled.mockReturnValue(true);
        getTrafficStats.mockReturnValue({
          activeFlows: [],
          packetsProcessed: 0,
          packetsBlocked: 0,
          packetsAllowed: 0,
          packetsInspected: 0,
          bytesProcessed: 0,
          threats: new Map(),
        });
        getAgentSystem.mockReturnValue({
          isInitialized: () => true,
          getStats: () => ({ modelRouter: { total: 0, local: 0, cloud: 0 } }),
          getConfig: () => ({ models: { local: { model: 'llama3' }, cloud: { model: 'glm-4' } } }),
          analyze: jest.fn().mockResolvedValue({ verdict: 'block', confidence: 0.9, reasoning: 'test', evidence: [], processingTime: 50 })
        });

        const res = await request(app).post('/simulate').send({ attackIds: ['sql-1', 'xss-1'] });

        expect(res.status).toBe(200);
        expect(res.body.results.length).toBe(2);
        const ids = res.body.results.map((r: any) => r.attackId);
        expect(ids).toContain('sql-1');
        expect(ids).toContain('xss-1');
      } finally {
        (global.setTimeout as jest.Mock).mockRestore();
      }
    });

    it('uses all attacks when no attackIds provided', async () => {
      jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
        queueMicrotask(cb);
        return 0 as any;
      });

      try {
        const { isAttackSimulatorEnabled } = require('../../config/app-mode');
        const { getAgentSystem, getTrafficStats } = require('../../api/routes/ai-system.routes');
        isAttackSimulatorEnabled.mockReturnValue(true);
        getTrafficStats.mockReturnValue({
          activeFlows: [],
          packetsProcessed: 0,
          packetsBlocked: 0,
          packetsAllowed: 0,
          packetsInspected: 0,
          bytesProcessed: 0,
          threats: new Map(),
        });
        getAgentSystem.mockReturnValue({
          isInitialized: () => true,
          getStats: () => ({ modelRouter: { total: 0, local: 0, cloud: 0 } }),
          getConfig: () => ({ models: { local: { model: 'llama3' }, cloud: { model: 'glm-4' } } }),
          analyze: jest.fn().mockResolvedValue({ verdict: 'block', confidence: 0.9, reasoning: 'test', evidence: [], processingTime: 50 })
        });

        const res = await request(app).post('/simulate').send({});

        expect(res.status).toBe(200);
        expect(res.body.results.length).toBe(8);
      } finally {
        (global.setTimeout as jest.Mock).mockRestore();
      }
    });
  });
});
