/**
 * Stats Routes Tests
 */

import express from 'express';
import request from 'supertest';
import statsRouter from '../../api/routes/stats.routes';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'admin', tenantId: 't1' };
    next();
  }),
  requireRole: jest.fn(() => (req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../api/routes/ai-system.routes', () => ({
  getTrafficStats: jest.fn().mockReturnValue({
    packetsProcessed: 100,
    packetsBlocked: 10,
    packetsAllowed: 90,
    activeFlows: [],
    bytesProcessed: 5000,
    threats: new Map(),
  }),
  getAgentGateway: jest.fn().mockReturnValue(null),
  getAgentSystem: jest.fn().mockReturnValue(null),
  getAlerts: jest.fn().mockResolvedValue([]),
  getDeviceList: jest.fn().mockReturnValue([]),
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    getDashboardSummaryView: jest.fn().mockResolvedValue({
      openCriticalFindings: 0,
      highRiskFindings: 0,
      activeAlerts: 0,
      runningScans: 0,
      pendingActions: 0,
      failedValidations: 0,
      assetsAtRisk: 0,
      observedSessions: 0,
      trafficAnomalies: 0,
      recentActions: [],
      recentValidations: [],
      queuedScans: 0,
    }),
    summarizeThreatsView: jest.fn().mockResolvedValue([]),
    listTrafficSessionsView: jest.fn().mockResolvedValue([]),
  }
}));

jest.mock('../../utils/system-stats', () => ({
  SystemStats: {
    getInstance: jest.fn().mockReturnValue({
      cpuUsage: 10,
      memoryUsage: 20,
      diskUsage: 30,
      networkUsageMb: 1,
    }),
  }
}));

const app = express();
app.use(statsRouter);

describe('GET /', () => {
  it('returns 200 with required fields', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalRequests');
    expect(res.body).toHaveProperty('blockedRequests');
    expect(res.body).toHaveProperty('successRate');
  });

  it('returns history array', async () => {
    const res = await request(app).get('/');
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  it('returns attackOrigins array', async () => {
    const res = await request(app).get('/');
    expect(Array.isArray(res.body.attackOrigins)).toBe(true);
  });

  it('returns cpuUsage, memoryUsage, diskUsage, networkUsage fields', async () => {
    const res = await request(app).get('/');
    expect(res.body).toHaveProperty('cpuUsage');
    expect(res.body).toHaveProperty('memoryUsage');
    expect(res.body).toHaveProperty('diskUsage');
    expect(res.body).toHaveProperty('networkUsage');
  });

  it('returns threats array', async () => {
    const res = await request(app).get('/');
    expect(Array.isArray(res.body.threats)).toBe(true);
  });

  it('returns p99Latency field', async () => {
    const res = await request(app).get('/');
    expect(res.body).toHaveProperty('p99Latency');
  });

  it('returns securityOperations from opsSummary', async () => {
    const res = await request(app).get('/');
    expect(res.body).toHaveProperty('securityOperations');
  });
});

describe('GET /badges', () => {
  it('returns 200 with badge counts', async () => {
    const res = await request(app).get('/badges');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('alerts');
    expect(res.body).toHaveProperty('devices');
    expect(res.body).toHaveProperty('agents');
    expect(res.body).toHaveProperty('traffic');
    expect(res.body).toHaveProperty('agentMonitor');
    expect(res.body).toHaveProperty('scanner');
  });

  it('returns zeros on error (error is caught, returns zeros)', async () => {
    const { securityOperationsService } = require('../../services/security-operations.service');
    securityOperationsService.getDashboardSummaryView.mockRejectedValueOnce(new Error('db error'));

    const res = await request(app).get('/badges');

    expect(res.status).toBe(200);
    expect(res.body.alerts).toBe(0);
    expect(res.body.devices).toBe(0);
  });
});
