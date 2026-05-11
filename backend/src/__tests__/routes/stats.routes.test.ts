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
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('totalRequests');
    expect(res.body.data).toHaveProperty('blockedRequests');
    expect(res.body.data).toHaveProperty('successRate');
  });

  it('returns history array', async () => {
    const res = await request(app).get('/');
    expect(Array.isArray(res.body.data.history)).toBe(true);
  });

  it('returns attackOrigins array', async () => {
    const res = await request(app).get('/');
    expect(Array.isArray(res.body.data.attackOrigins)).toBe(true);
  });

  it('returns cpuUsage, memoryUsage, diskUsage, networkUsage fields', async () => {
    const res = await request(app).get('/');
    expect(res.body.data).toHaveProperty('cpuUsage');
    expect(res.body.data).toHaveProperty('memoryUsage');
    expect(res.body.data).toHaveProperty('diskUsage');
    expect(res.body.data).toHaveProperty('networkUsage');
  });

  it('returns threats array', async () => {
    const res = await request(app).get('/');
    expect(Array.isArray(res.body.data.threats)).toBe(true);
  });

  it('returns p99Latency field', async () => {
    const res = await request(app).get('/');
    expect(res.body.data).toHaveProperty('p99Latency');
  });

  it('returns securityOperations from opsSummary', async () => {
    const res = await request(app).get('/');
    expect(res.body.data).toHaveProperty('securityOperations');
  });
});

describe('GET /badges', () => {
  it('returns 200 with badge counts', async () => {
    const res = await request(app).get('/badges');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('alerts');
    expect(res.body.data).toHaveProperty('devices');
    expect(res.body.data).toHaveProperty('agents');
    expect(res.body.data).toHaveProperty('traffic');
    expect(res.body.data).toHaveProperty('agentMonitor');
    expect(res.body.data).toHaveProperty('scanner');
  });

  it('returns error envelope on error', async () => {
    const deviceRegistry = require('../../services/device-registry.service');
    jest.spyOn(deviceRegistry, 'getDeviceList').mockImplementationOnce(() => { throw new Error('device error'); });

    const res = await request(app).get('/badges');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toHaveProperty('code', 'BADGES_ERROR');
  });
});
