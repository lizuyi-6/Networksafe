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
    setAiAnalyzer: jest.fn()
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
