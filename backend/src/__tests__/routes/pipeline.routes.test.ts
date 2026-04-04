/**
 * Pipeline Routes Tests
 *
 * Tests for data pipeline health check and verification routes
 */

import request from 'supertest';
import express from 'express';
import pipelineRouter from '../../api/routes/pipeline.routes';

// Mock auth
jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-001', role: 'admin', tenantId: 'tenant-001' };
    next();
  }),
  AuthenticatedRequest: jest.fn()
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn() }
}));

// Mock pipeline diagnostics service
const mockGetHealthStatus = jest.fn();
const mockVerifyDataPipeline = jest.fn();
jest.mock('../../modules/pipeline/pipeline-diagnostics.service', () => ({
  pipelineDiagnosticsService: {
    getHealthStatus: (...args: any[]) => mockGetHealthStatus(...args),
    verifyDataPipeline: (...args: any[]) => mockVerifyDataPipeline(...args)
  }
}));

describe('Pipeline Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/pipeline', pipelineRouter);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    it('returns health status', async () => {
      mockGetHealthStatus.mockReturnValue({
        websocket: { status: 'healthy', message: 'OK', timestamp: new Date().toISOString() },
        database: { status: 'healthy', message: 'OK', timestamp: new Date().toISOString() },
        redis: { status: 'healthy', message: 'OK', timestamp: new Date().toISOString() },
        agents: { status: 'healthy', message: 'OK', timestamp: new Date().toISOString() },
        overall: 'healthy',
        timestamp: new Date().toISOString()
      });

      const response = await request(app).get('/api/pipeline/health');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.overall).toBe('healthy');
      expect(response.body.data.websocket).toBeDefined();
    });

    it('returns degraded status', async () => {
      mockGetHealthStatus.mockReturnValue({
        websocket: { status: 'healthy', message: 'OK', timestamp: new Date().toISOString() },
        database: { status: 'healthy', message: 'OK', timestamp: new Date().toISOString() },
        redis: { status: 'degraded', message: 'Slow responses', timestamp: new Date().toISOString() },
        agents: { status: 'healthy', message: 'OK', timestamp: new Date().toISOString() },
        overall: 'degraded',
        timestamp: new Date().toISOString()
      });

      const response = await request(app).get('/api/pipeline/health');

      expect(response.status).toBe(200);
      expect(response.body.data.overall).toBe('degraded');
    });

    it('returns 500 on getHealthStatus error', async () => {
      mockGetHealthStatus.mockImplementation(() => {
        throw new Error('DB error');
      });

      const response = await request(app).get('/api/pipeline/health');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /verify', () => {
    it('returns overall pass when all verifications pass', async () => {
      mockVerifyDataPipeline.mockReturnValue([
        { component: 'database', status: 'pass', message: 'Database OK' },
        { component: 'redis', status: 'pass', message: 'Redis OK' }
      ]);

      const response = await request(app).get('/api/pipeline/verify');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.overall).toBe('pass');
      expect(response.body.data.verifications).toHaveLength(2);
      expect(response.body.data.timestamp).toBeDefined();
    });

    it('returns overall fail when any verification fails', async () => {
      mockVerifyDataPipeline.mockReturnValue([
        { component: 'database', status: 'pass', message: 'Database OK' },
        { component: 'redis', status: 'fail', message: 'Redis unavailable' }
      ]);

      const response = await request(app).get('/api/pipeline/verify');

      expect(response.status).toBe(200);
      expect(response.body.data.overall).toBe('fail');
    });

    it('returns overall skip when all verifications skipped', async () => {
      mockVerifyDataPipeline.mockReturnValue([
        { component: 'packet_capture', status: 'skip', message: 'Not enabled' }
      ]);

      const response = await request(app).get('/api/pipeline/verify');

      expect(response.status).toBe(200);
      expect(response.body.data.overall).toBe('skip');
    });

    it('returns 500 on verifyDataPipeline error', async () => {
      mockVerifyDataPipeline.mockImplementation(() => {
        throw new Error('Internal error');
      });

      const response = await request(app).get('/api/pipeline/verify');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
});
