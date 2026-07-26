/**
 * Stats Routes Tests
 */

import express from 'express';
import request from 'supertest';
import statsRouter from '../../api/routes/stats.routes';
import metrics from '../../observability/metrics';
import { metricsMiddleware } from '../../middleware/metrics.middleware';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'platform_admin' };
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
app.use(metricsMiddleware);
app.use('/api/stats', statsRouter);
app.get('/injected-failure', (_req, res) => {
  res.status(500).json({ error: 'injected' });
});
app.get('/health/ready', (_req, res) => {
  res.status(200).json({ status: 'ready' });
});

beforeEach(() => {
  metrics.reset();
});

describe('GET /', () => {
  it('returns 200 with required fields', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('totalRequests');
    expect(res.body.data).toHaveProperty('blockedRequests');
    expect(res.body.data).toHaveProperty('successRate');
  });

  it('returns history array', async () => {
    const res = await request(app).get('/api/stats');
    expect(Array.isArray(res.body.data.history)).toBe(true);
  });

  it('returns attackOrigins array', async () => {
    const res = await request(app).get('/api/stats');
    expect(Array.isArray(res.body.data.attackOrigins)).toBe(true);
  });

  it('returns cpuUsage, memoryUsage, diskUsage, networkUsage fields', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.body.data).toHaveProperty('cpuUsage');
    expect(res.body.data).toHaveProperty('memoryUsage');
    expect(res.body.data).toHaveProperty('diskUsage');
    expect(res.body.data).toHaveProperty('networkUsage');
  });

  it('returns threats array', async () => {
    const res = await request(app).get('/api/stats');
    expect(Array.isArray(res.body.data.threats)).toBe(true);
  });

  it('derives deterministic p99 latency from recorded histogram buckets', async () => {
    const labels = { method: 'GET', route: '/work', scope: 'business', status: '200' };
    metrics.incCounter('http_requests_total', labels, 3);
    metrics.observeHistogram('http_request_duration_ms', 12, labels);
    metrics.observeHistogram('http_request_duration_ms', 80, labels);
    metrics.observeHistogram('http_request_duration_ms', 600, labels);

    const res = await request(app).get('/api/stats');

    expect(res.body.data.avgProcessingTime).toBe(231);
    expect(res.body.data.p99Latency).toBe(1000);
  });

  it('uses the observed maximum when p99 exceeds the largest finite bucket', async () => {
    const labels = { method: 'GET', route: '/slow-work', scope: 'business', status: '200' };
    metrics.incCounter('http_requests_total', labels);
    metrics.observeHistogram('http_request_duration_ms', 12_345, labels);

    const res = await request(app).get('/api/stats');

    expect(res.body.data.p99Latency).toBe(12_345);
  });

  it('returns securityOperations from opsSummary', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.body.data).toHaveProperty('securityOperations');
  });

  it('does not count dashboard or health polling as business traffic', async () => {
    const first = await request(app).get('/api/stats');
    await request(app).get('/health/ready').expect(200);
    const second = await request(app).get('/api/stats');

    expect(first.body.data.totalRequests).toBe(0);
    expect(second.body.data.totalRequests).toBe(0);
  });

  it('uses the final 500 status to reduce the success rate', async () => {
    await request(app).get('/injected-failure').expect(500);

    const res = await request(app).get('/api/stats');

    expect(res.body.data.totalRequests).toBe(1);
    expect(res.body.data.successRate).toBe(0);
  });
});

describe('GET /badges', () => {
  it('returns 200 with badge counts', async () => {
    const res = await request(app).get('/api/stats/badges');
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

    const res = await request(app).get('/api/stats/badges');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toHaveProperty('code', 'BADGES_ERROR');
  });
});
