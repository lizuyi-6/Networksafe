import express from 'express';
import request from 'supertest';
import rulesRouter from '../../api/routes/rules.routes';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = {
      userId: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
      tenantId: 'tenant-a'
    };
    req.tenantContext = { tenantId: 'tenant-a' };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next()
}));

jest.mock('../../services/detection-pipeline.service', () => ({
  detectionPipelineService: {
    listRules: jest.fn(),
    getSummary: jest.fn(),
    listDetectionEvents: jest.fn(),
    listRuleCandidates: jest.fn(),
    getRuleCandidateById: jest.fn(),
    approveRuleCandidate: jest.fn(),
    rejectRuleCandidate: jest.fn(),
    listDynamicRules: jest.fn(),
    createManualRuleCandidate: jest.fn()
  }
}));

jest.mock('../../services/agent-system.service', () => ({
  getAgentGateway: jest.fn()
}));

jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: {
    log: jest.fn()
  }
}));

import { detectionPipelineService } from '../../services/detection-pipeline.service';
import { getAgentGateway } from '../../services/agent-system.service';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/rules', rulesRouter);
  return app;
}

describe('rules.routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (detectionPipelineService.getSummary as jest.Mock).mockResolvedValue({
      totalRules: 1,
      activeRules: 1,
      pendingCandidates: 1,
      approvedCandidates: 0,
      rejectedCandidates: 0,
      ruleHitRate: 0.5,
      aiEscalationRate: 0.25,
      avgProcessingTimeMs: 12,
      localAICount: 1,
      cloudAICount: 0,
      topRules: []
    });
  });

  it('lists rules with summary', async () => {
    (detectionPipelineService.listRules as jest.Mock).mockResolvedValue([
      {
        ruleId: 'seed-sqli-union',
        name: 'SQLi UNION SELECT',
        scope: 'all',
        action: 'block',
        severity: 'critical',
        source: 'seed',
        enabled: true
      }
    ]);

    const app = buildApp();
    const response = await request(app).get('/api/rules').expect(200);

    expect(response.body?.data?.rules).toHaveLength(1);
    expect(response.body?.data?.summary?.totalRules).toBe(1);
  });

  it('approves candidate and syncs agent rules', async () => {
    (detectionPipelineService.approveRuleCandidate as jest.Mock).mockResolvedValue({
      candidateId: 'candidate-1',
      approvedRuleId: 'rule-1',
      channel: 'agent'
    });
    (getAgentGateway as jest.Mock).mockReturnValue({
      syncTenantDetectionRules: jest.fn().mockResolvedValue({ attempted: 3, succeeded: 3 })
    });

    const app = buildApp();
    const response = await request(app)
      .post('/api/rules/candidates/candidate-1/approve')
      .send({ reason: 'specific enough' })
      .expect(200);

    expect(detectionPipelineService.approveRuleCandidate).toHaveBeenCalledWith(
      'tenant-a',
      'candidate-1',
      'admin-1',
      'specific enough'
    );
    expect(response.body?.data?.sync).toEqual({ attempted: 3, succeeded: 3 });
  });

  it('lists detection events with filters', async () => {
    (detectionPipelineService.listDetectionEvents as jest.Mock).mockResolvedValue([
      {
        detectionEventId: 'event-1',
        channel: 'agent',
        verdict: 'monitor',
        candidateId: 'candidate-1'
      }
    ]);

    const app = buildApp();
    const response = await request(app)
      .get('/api/rules/events?channel=agent&verdict=monitor&escalatedToAI=true&candidateId=candidate-1&limit=25')
      .expect(200);

    expect(detectionPipelineService.listDetectionEvents).toHaveBeenCalledWith('tenant-a', {
      channel: 'agent',
      verdict: 'monitor',
      escalatedToAI: true,
      candidateId: 'candidate-1',
      from: undefined,
      to: undefined,
      limit: 25
    });
    expect(response.body?.data?.events).toHaveLength(1);
  });

  it('rejects candidate', async () => {
    (detectionPipelineService.rejectRuleCandidate as jest.Mock).mockResolvedValue({
      candidateId: 'candidate-2',
      channel: 'http_api',
      reviewReason: 'too broad'
    });

    const app = buildApp();
    const response = await request(app)
      .post('/api/rules/candidates/candidate-2/reject')
      .send({ reason: 'too broad' })
      .expect(200);

    expect(detectionPipelineService.rejectRuleCandidate).toHaveBeenCalledWith(
      'tenant-a',
      'candidate-2',
      'admin-1',
      'too broad'
    );
    expect(response.body?.data?.candidate?.candidateId).toBe('candidate-2');
  });
});
