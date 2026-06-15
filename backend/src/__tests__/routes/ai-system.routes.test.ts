/**
 * AI System Routes Tests (smoke)
 *
 * Smoke tests for the AI System API endpoints:
 *   - GET  /api/ai-system/agents/health
 *   - GET  /api/ai-system/agents/stats
 *   - POST /api/ai-system/evaluation/owasp
 *
 * These tests focus on the security-relevant branches:
 *   - missing authentication -> 401
 *   - system not initialized -> degraded fallback response
 *   - authenticated request -> 200
 *   - missing required fields -> 400
 */

import request from 'supertest';
import express from 'express';
import aiSystemRouter from '../../api/routes/ai-system.routes';
import { authenticate } from '../../middleware/auth.middleware';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = {
      userId: 'admin-001',
      email: 'admin@example.com',
      role: 'platform_admin',
      tenantId: 'tenant-001'
    };
    next();
  }),
  requirePermission: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../../services/agent-system.service', () => ({
  getAgentSystem: jest.fn(() => null),
  getAgentGateway: jest.fn(() => null)
}));

jest.mock('../../security/agent-auth.service', () => ({
  __esModule: true,
  default: { listAgents: jest.fn(() => []) }
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    getDashboardSummaryView: jest.fn().mockResolvedValue({
      runningScans: 0,
      pendingActions: 0,
      activeAlerts: 0,
      failedValidations: 0,
      assetsAtRisk: 0,
      openCriticalFindings: 0,
      recentValidations: [],
      recentActions: []
    }),
    summarizeThreatsView: jest.fn().mockResolvedValue([])
  }
}));

jest.mock('../../services/detection-pipeline.service', () => ({
  detectionPipelineService: {
    getAsyncReviewStats: jest.fn().mockResolvedValue({ pending: 0, total: 0 }),
    getSummary: jest.fn().mockResolvedValue({
      blockingDiscussionCount: 0,
      blockingDiscussionFailClosed: false,
      avgBlockingDiscussionLatencyMs: null,
      classificationLevel: 'medium'
    }),
    setAiAnalyzer: jest.fn(),
    getAiLayerHealth: jest.fn().mockReturnValue({ available: false, degraded: true, prepared: true, mode: 'fail-closed-degraded', message: 'AI analyzer unavailable.' })
  }
}));

jest.mock('../../services/owasp-web-evaluation.service', () => ({
  owaspWebEvaluationService: {
    evaluate: jest.fn().mockResolvedValue({ overall: 'pass', score: 85 })
  }
}));

jest.mock('../../ai-agents', () => ({
  createMultiAgentSystem: jest.fn(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    isInitialized: jest.fn(() => false),
    getHealthStatus: jest.fn(() => ({ status: 'initializing' })),
    getStats: jest.fn(() => ({ orchestrator: {}, messageBus: {}, synthesis: {} })),
    getProbeReport: jest.fn(() => ({ agents: [], alerts: [] })),
    onProbeReport: jest.fn()
  }))
}));

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use('/api/ai-system', aiSystemRouter);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AI System Routes (smoke)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---- GET /api/ai-system/agents/health -----------------------------------

  describe('GET /agents/health', () => {
    it('returns 401 when the request is not authenticated', async () => {
      (authenticate as jest.Mock).mockImplementationOnce(
        (_req: any, res: any, _next: any) => {
          res.status(401).json({
            success: false,
            data: null,
            error: { code: 'AUTH_TOKEN_MISSING', message: 'backend.authentication_required' }
          });
        }
      );

      const response = await request(app).get('/api/ai-system/agents/health');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_TOKEN_MISSING');
    });

    it('returns health status when the request is authenticated', async () => {
      const response = await request(app).get('/api/ai-system/agents/health');

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(response.body).toHaveProperty('status');
    });
  });

  // ---- GET /api/ai-system/agents/stats ------------------------------------

  describe('GET /agents/stats', () => {
    it('returns 200 with stats payload when the system is not initialized (degraded fallback)', async () => {
      const response = await request(app).get('/api/ai-system/agents/stats');

      expect(response.status).toBe(200);
      // When system is not initialized the route returns a degraded fallback payload
      expect(response.body).toHaveProperty('orchestrator');
      expect(response.body).toHaveProperty('messageBus');
      expect(response.body).toHaveProperty('synthesis');
      expect(response.body).toHaveProperty('operations');
      expect(response.body).toHaveProperty('detectionPipeline');
      expect(response.body).toHaveProperty('health');
      expect(response.body).toHaveProperty('agents');
    });
  });

  // ---- GET /api/ai-system/agents/topology ---------------------------------

  describe('GET /agents/topology', () => {
    it('returns 200 with the topology shape when the system is offline (roles always present)', async () => {
      const response = await request(app).get('/api/ai-system/agents/topology');

      expect(response.status).toBe(200);
      expect(response.body.initialized).toBe(false);
      expect(Array.isArray(response.body.layers)).toBe(true);
      expect(response.body.roles).toHaveLength(4);
      expect(response.body.telemetry).toBeDefined();
      expect(response.body.telemetry).toHaveProperty('asyncReview');
    });

    it('returns the 7 differentiated layers with thinking depth + activation when the system is online', async () => {
      const { getAgentSystem } = require('../../services/agent-system.service');
      getAgentSystem.mockReturnValue({
        isInitialized: () => true,
        getConfig: () => ({
          experimentMode: 'multi_agent_with_debate',
          primarySingleAgentRole: 'aristotle',
          thresholds: { debateTrigger: 0.3, debateDivergence: 0.3, debateConfidenceRange: 0.3, cloudEscalation: 0.6, autoBlock: 0.85 },
          models: { local: { model: 'llama3:8b' }, cloud: { model: 'glm-4' } },
          layers: {
            l1_collaboration: { enabled: true, priority: 1, timeout: 5000, maxConcurrency: 10, thinkingDepth: 'shallow', modelTier: 'local', activation: { always: true } },
            l2_rolePlaying: { enabled: true, priority: 2, timeout: 10000, maxConcurrency: 3, thinkingDepth: 'standard', modelTier: 'local', activation: { requiresLayers: [1] } },
            l3_sceneTraversal: { enabled: true, priority: 3, timeout: 5000, maxConcurrency: 5, thinkingDepth: 'standard', activation: { requiresLayers: [2], minRiskScore: 0.4 } },
            l4_capability: { enabled: true, priority: 4, timeout: 30000, maxConcurrency: 5, thinkingDepth: 'standard', activation: { requiresLayers: [2], minRiskScore: 0.6 } },
            l5_debate: { enabled: true, priority: 5, timeout: 60000, maxConcurrency: 3, thinkingDepth: 'deep', modelTier: 'cloud', activation: { requiresLayers: [2], requiresDebateTrigger: true } },
            l6_heterogeneous: { enabled: true, priority: 6, timeout: 30000, maxConcurrency: 10, thinkingDepth: 'deliberative', modelTier: 'cloud', activation: { requiresLayers: [2], requiresEscalation: true } },
            l7_synthesis: { enabled: true, priority: 7, timeout: 5000, maxConcurrency: 5, thinkingDepth: 'standard', activation: { always: true } }
          }
        }),
        getStats: () => ({
          orchestrator: { activeTasks: 2, registeredAgents: 3 },
          messageBus: { queueSize: 1 },
          modelRouter: { total: 8, local: 3, cloud: 5, localRatio: 0.375 },
          synthesis: { totalCaseFiles: 4, totalLessons: 7, totalPolicyUpdates: 1, topPatterns: [] }
        }),
        getHealthStatus: () => ({ status: 'healthy', details: {} })
      });

      const response = await request(app).get('/api/ai-system/agents/topology');

      expect(response.status).toBe(200);
      expect(response.body.initialized).toBe(true);
      expect(response.body.layers).toHaveLength(7);
      expect(response.body.layers[0]).toMatchObject({ num: 1, thinkingDepth: 'shallow', modelTier: 'local' });
      expect(response.body.layers[4]).toMatchObject({ num: 5, thinkingDepth: 'deep', modelTier: 'cloud' });
      expect(response.body.layers[5]).toMatchObject({ num: 6, thinkingDepth: 'deliberative' });
      expect(response.body.layers[4].activation).toMatchObject({ requiresDebateTrigger: true });
      expect(response.body.models).toEqual({ local: 'llama3:8b', cloud: 'glm-4' });
      expect(response.body.telemetry.modelRouter.cloud).toBe(5);
      expect(Array.isArray(response.body.recentCascadeTraces)).toBe(true);
    });
  });

  // ---- POST /api/ai-system/evaluation/owasp --------------------------------

  describe('POST /evaluation/owasp', () => {
    it('returns 200 with evaluation report on success', async () => {
      const response = await request(app)
        .post('/api/ai-system/evaluation/owasp')
        .send({ datasetRoot: '/tmp/owasp-dataset' });

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(response.body.overall).toBe('pass');
    });

    it('returns 500 when the evaluation service throws', async () => {
      const { owaspWebEvaluationService } = require('../../services/owasp-web-evaluation.service');
      (owaspWebEvaluationService.evaluate as jest.Mock).mockRejectedValueOnce(
        new Error('Evaluation failed')
      );

      const response = await request(app)
        .post('/api/ai-system/evaluation/owasp')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('evaluation_failed');
    });
  });
});
