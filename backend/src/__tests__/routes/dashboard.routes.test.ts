import express from 'express';
import request from 'supertest';
import dashboardRouter from '../../api/routes/dashboard.routes';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'admin', tenantId: 't1' };
    req.tenantContext = { tenantId: 't1' };
    next();
  }),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../core/tenant/tenant-context', () => ({
  PLATFORM_TENANT_ID: 'platform'
}));

jest.mock('../../services/detection-pipeline.service', () => ({
  detectionPipelineService: {
    getSummary: jest.fn()
  }
}));

import { detectionPipelineService } from '../../services/detection-pipeline.service';

const app = express();
app.use(dashboardRouter);

describe('GET /rules/summary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with success=true and data structure', async () => {
    (detectionPipelineService.getSummary as jest.Mock).mockResolvedValue({
      rules: [],
      stats: {}
    });

    const response = await request(app).get('/rules/summary');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('data');
    expect(response.body.data).toHaveProperty('rules');
    expect(response.body.data).toHaveProperty('stats');
  });

  it('includes updatedAt field in response', async () => {
    (detectionPipelineService.getSummary as jest.Mock).mockResolvedValue({
      rules: [],
      stats: {}
    });

    const response = await request(app).get('/rules/summary');

    expect(response.body.data).toHaveProperty('updatedAt');
    expect(typeof response.body.data.updatedAt).toBe('string');
    expect(response.body.data.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns data from detectionPipelineService', async () => {
    const mockSummary = {
      rules: [
        { id: 'r1', name: 'SQL Injection', severity: 'high' }
      ],
      stats: {
        total: 1,
        enabled: 1
      }
    };
    (detectionPipelineService.getSummary as jest.Mock).mockResolvedValue(mockSummary);

    const response = await request(app).get('/rules/summary');

    expect(detectionPipelineService.getSummary).toHaveBeenCalledWith('t1');
    expect(response.body.data.rules).toEqual(mockSummary.rules);
    expect(response.body.data.stats).toEqual(mockSummary.stats);
  });

  it('returns 500 with error code on service failure', async () => {
    (detectionPipelineService.getSummary as jest.Mock).mockRejectedValue(
      new Error('Database connection failed')
    );

    const response = await request(app).get('/rules/summary');

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.error).toHaveProperty('code', 'FG-DASHBOARD-500');
    expect(response.body.error).toHaveProperty('message', 'Database connection failed');
    expect(response.body.error).toHaveProperty('timestamp');
  });
});
