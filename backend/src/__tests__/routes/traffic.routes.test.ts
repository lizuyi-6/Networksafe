/**
 * Traffic Routes Tests (smoke)
 *
 * Smoke tests for the Traffic API endpoints:
 *   - GET  /api/traffic/stats
 *   - GET  /api/traffic/flows
 *   - GET  /api/traffic/flows/:id
 *   - GET  /api/traffic/protocols
 *   - GET  /api/traffic/threats
 *
 * Security-relevant branches:
 *   - unauthenticated request  -> 401
 *   - authenticated request      -> 200
 *   - missing/invalid session   -> 404 (flows/:id)
 *   - service errors            -> fallthrough (empty arrays / zeroed stats)
 */

import request from 'supertest';
import express from 'express';
import trafficRouter from '../../api/routes/traffic.routes';
import { authenticate } from '../../middleware/auth.middleware';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-001', email: 'admin@example.com', role: 'platform_admin', tenantId: 'tenant-001' };
    next();
  }),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../services/traffic-stats.service', () => ({
  getTrafficStats: jest.fn().mockReturnValue({
    packetsProcessed: 0,
    packetsBlocked: 0,
    packetsAllowed: 0,
    packetsInspected: 0,
    bytesProcessed: 0,
    activeFlows: [],
    threats: new Map(),
    startTime: new Date('2024-01-01')
  })
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    listTrafficSessionsView: jest.fn().mockResolvedValue([]),
    getTrafficSessionByIdView: jest.fn().mockResolvedValue(null),
    summarizeThreatsView: jest.fn().mockResolvedValue([]),
    getAssetByIdView: jest.fn().mockResolvedValue(null),
    listValidationRunsByAttackIdView: jest.fn().mockResolvedValue([]),
    getOperationalContextForAssetIdsView: jest.fn().mockResolvedValue({
      findings: [],
      alerts: [],
      actions: [],
      scanRuns: [],
      serviceExposure: []
    })
  }
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../utils/system-stats', () => ({
  SystemStats: {
    getInstance: jest.fn().mockReturnValue({
      cpuUsage: 5,
      memoryUsage: 30,
      diskUsage: 45,
      networkUsageMb: 1.2
    })
  }
}));

import { securityOperationsService } from '../../services/security-operations.service';

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use('/api/traffic', trafficRouter);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Traffic Routes (smoke)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---- Authentication gate -----------------------------------------------

  describe('Authentication', () => {
    it('returns 401 when the request is not authenticated', async () => {
      (authenticate as jest.Mock).mockImplementationOnce(
        (_req: any, res: any, _next: any) => {
          res.status(401).json({ success: false, error: { code: 'AUTH_TOKEN_MISSING' } });
        }
      );

      const response = await request(app).get('/api/traffic/stats');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_TOKEN_MISSING');
    });
  });

  // ---- GET /api/traffic/stats ---------------------------------------------

  describe('GET /stats', () => {
    it('returns 200 with traffic and system stats', async () => {
      const response = await request(app).get('/api/traffic/stats');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('packetsProcessed');
      expect(response.body).toHaveProperty('packetsBlocked');
      expect(response.body).toHaveProperty('packetsAllowed');
      expect(response.body).toHaveProperty('packetsInspected');
      expect(response.body).toHaveProperty('bytesProcessed');
      expect(response.body).toHaveProperty('currentFlows');
      expect(response.body).toHaveProperty('activeConnections');
      expect(response.body).toHaveProperty('cpuUsage');
      expect(response.body).toHaveProperty('memoryUsage');
      expect(response.body).toHaveProperty('diskUsage');
      expect(response.body).toHaveProperty('networkUsage');
      expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    });

    it('merges live stats with stored session data', async () => {
      (securityOperationsService.listTrafficSessionsView as jest.Mock).mockResolvedValueOnce([
        {
          session_id: 'sess-001',
          source_ip: '10.0.0.1',
          dest_ip: '10.0.0.2',
          source_port: 443,
          dest_port: 54321,
          protocol: 'tcp',
          state: 'ESTABLISHED',
          packet_count: 100,
          byte_count: 4096,
          metadata_json: '{}'
        }
      ]);

      const response = await request(app).get('/api/traffic/stats');

      expect(response.status).toBe(200);
      // Stored packets should be merged into the live count
      expect(response.body.packetsProcessed).toBeGreaterThanOrEqual(100);
    });
  });

  // ---- GET /api/traffic/flows --------------------------------------------

  describe('GET /flows', () => {
    it('returns 200 with empty array when no flows exist', async () => {
      const response = await request(app).get('/api/traffic/flows');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('returns flows from stored sessions when available', async () => {
      (securityOperationsService.listTrafficSessionsView as jest.Mock).mockResolvedValueOnce([
        {
          session_id: 'sess-002',
          source_ip: '192.168.1.10',
          dest_ip: '8.8.8.8',
          source_port: 54000,
          dest_port: 53,
          protocol: 'udp',
          state: 'ESTABLISHED',
          packet_count: 5,
          byte_count: 512,
          metadata_json: '{"dns_query":"example.com"}'
        }
      ]);

      const response = await request(app).get('/api/traffic/flows');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      const flow = response.body.find((f: any) => f.id === 'sess-002');
      expect(flow).toBeDefined();
      expect(flow.sourceIP).toBe('192.168.1.10');
      expect(flow.destPort).toBe(53);
    });
  });

  // ---- GET /api/traffic/flows/:id -----------------------------------------

  describe('GET /flows/:id', () => {
    it('returns 404 when session is not found', async () => {
      (securityOperationsService.getTrafficSessionByIdView as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app).get('/api/traffic/flows/nonexistent-id');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('returns 200 with session detail when found', async () => {
      (securityOperationsService.getTrafficSessionByIdView as jest.Mock).mockResolvedValueOnce({
        sessionId: 'sess-003',
        sourceIP: '10.0.0.5',
        destIP: '10.0.0.1',
        sourcePort: 12345,
        destPort: 80,
        protocol: 'tcp',
        state: 'ESTABLISHED',
        packetCount: 50,
        byteCount: 8192,
        startTime: '2024-06-01T12:00:00.000Z',
        lastActivity: '2024-06-01T12:05:00.000Z',
        metadata: { attackId: null }
      });

      const response = await request(app).get('/api/traffic/flows/sess-003');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Route maps session.sessionId -> summary.id (not sessionId)
      expect(response.body.data.summary.id).toBe('sess-003');
      expect(response.body.data.summary.sourceIP).toBe('10.0.0.5');
    });
  });

  // ---- GET /api/traffic/protocols ----------------------------------------

  describe('GET /protocols', () => {
    it('returns 200 with protocol distribution counts', async () => {
      (securityOperationsService.listTrafficSessionsView as jest.Mock).mockResolvedValueOnce([]);

      const response = await request(app).get('/api/traffic/protocols');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('http');
      expect(response.body).toHaveProperty('https');
      expect(response.body).toHaveProperty('dns');
      expect(response.body).toHaveProperty('other');
    });
  });

  // ---- GET /api/traffic/threats ------------------------------------------

  describe('GET /threats', () => {
    it('returns 200 with array (empty when no threats)', async () => {
      const response = await request(app).get('/api/traffic/threats');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('returns persisted threats when available', async () => {
      const persistedThreats = [
        { id: 'threat-001', type: 'sql_injection', severity: 'high', sourceIP: '1.2.3.4' }
      ];
      (securityOperationsService.summarizeThreatsView as jest.Mock).mockResolvedValueOnce(persistedThreats);

      const response = await request(app).get('/api/traffic/threats');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toEqual(persistedThreats);
    });
  });
});
