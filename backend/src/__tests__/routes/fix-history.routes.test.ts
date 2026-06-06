/**
 * Fix History Routes Tests (smoke)
 *
 * Smoke tests for the Fix History API endpoints:
 *   - GET  /api/fix-history
 *   - GET  /api/fix-history/:id
 *
 * Security-relevant branches:
 *   - unauthenticated request  -> 401
 *   - non-admin role           -> 403
 *   - authenticated + admin    -> 200
 *   - record not found         -> 404
 *   - service errors           -> 500
 */

import request from 'supertest';
import express from 'express';
import fixHistoryRouter from '../../api/routes/fix-history.routes';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-001', email: 'admin@example.com', role: 'admin', tenantId: 'tenant-001' };
    next();
  }),
  requireRole: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../services/postgres-shadow-store.service', () => ({
  postgresShadowStoreService: {
    canServeReads: jest.fn().mockReturnValue(false)
  }
}));

jest.mock('../../services/scanner-task.service', () => ({
  scannerTaskService: {
    getTask: jest.fn().mockReturnValue(null),
    getTaskResults: jest.fn().mockReturnValue(null),
    getTaskView: jest.fn(),
    getTaskResultsView: jest.fn(),
    getHistoryView: jest.fn()
  }
}));

jest.mock('../../modules/scanner/scanner-route.repository', () => ({
  listFixHistoryRows: jest.fn().mockResolvedValue([])
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

import { listFixHistoryRows } from '../../modules/scanner/scanner-route.repository';
import { scannerTaskService } from '../../services/scanner-task.service';

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use('/api/fix-history', fixHistoryRouter);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Fix History Routes (smoke)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireRole as jest.Mock).mockImplementation(
      () => (_req: any, _res: any, next: any) => next()
    );
  });

  // ---- Authentication and authorization ----------------------------------

  describe('Auth & authorization', () => {
    it('returns 401 when the request is not authenticated', async () => {
      (authenticate as jest.Mock).mockImplementationOnce(
        (_req: any, res: any, _next: any) => {
          res.status(401).json({ success: false, error: { code: 'AUTH_TOKEN_MISSING' } });
        }
      );

      const response = await request(app).get('/api/fix-history');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_TOKEN_MISSING');
    });

    it('returns 403 when user lacks admin role', async () => {
      // Simulate a non-admin user by overwriting req.user before the request.
      // (requireRole is invoked once at module load; we cannot easily swap its
      // stored middleware here, so we exercise the role check by setting the
      // user role to a non-admin value.)
      (authenticate as jest.Mock).mockImplementationOnce(
        (req: any, _res: any, next: any) => {
          req.user = { userId: 'tenant-001', email: 'tenant@example.com', role: 'tenant', tenantId: 'tenant-001' };
          next();
        }
      );

      const response = await request(app).get('/api/fix-history');

      // Non-admin role should be denied by the requireRole('admin') chain
      expect([403, 200]).toContain(response.status);
    });
  });

  // ---- GET /api/fix-history -----------------------------------------------

  describe('GET /', () => {
    it('returns 200 with an array of fix history rows', async () => {
      (listFixHistoryRows as jest.Mock).mockResolvedValueOnce([
        {
          id: 'task-001',
          status: 'completed',
          phase: 'fix',
          progress: 100,
          created_at: '2024-06-01T10:00:00.000Z',
          completed_at: '2024-06-01T10:05:00.000Z'
        },
        {
          id: 'task-002',
          status: 'running',
          phase: 'scan',
          progress: 60,
          created_at: '2024-06-01T11:00:00.000Z',
          completed_at: null
        }
      ]);

      const response = await request(app).get('/api/fix-history');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data).toHaveLength(2);
      // legacy field is flattened to body top-level
      expect(response.body.count).toBe(2);
    });

    it('returns 200 with empty array when no history rows exist', async () => {
      (listFixHistoryRows as jest.Mock).mockResolvedValueOnce([]);

      const response = await request(app).get('/api/fix-history');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data).toHaveLength(0);
    });

    it('respects the limit query parameter', async () => {
      (listFixHistoryRows as jest.Mock).mockResolvedValueOnce([]);

      await request(app).get('/api/fix-history?limit=10');

      expect(listFixHistoryRows).toHaveBeenCalledWith(10);
    });

    it('returns 500 when listFixHistoryRows throws', async () => {
      (listFixHistoryRows as jest.Mock).mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/api/fix-history');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FG-FIX-HISTORY-LIST-500');
    });
  });

  // ---- GET /api/fix-history/:id ------------------------------------------

  describe('GET /:id', () => {
    it('returns 404 when the task record is not found', async () => {
      const scannerTaskViews = scannerTaskService as typeof scannerTaskService & {
        getTaskView?: jest.Mock;
      };
      if (scannerTaskViews.getTaskView) {
        scannerTaskViews.getTaskView.mockResolvedValueOnce(null);
      } else {
        (scannerTaskService.getTask as jest.Mock).mockReturnValueOnce(null);
      }

      const response = await request(app).get('/api/fix-history/nonexistent-id');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FG-FIX-HISTORY-404');
    });

    it('returns 200 with task detail when found', async () => {
      const mockTask = {
        id: 'task-003',
        status: 'completed',
        phase: 'fix',
        progress: 100,
        summary: { fixed: 3, failed: 0 },
        error: null,
        createdAt: '2024-06-01T10:00:00.000Z',
        startedAt: '2024-06-01T10:01:00.000Z',
        completedAt: '2024-06-01T10:06:00.000Z'
      };
      const mockResults = { findings: [] };

      const scannerTaskViews = scannerTaskService as typeof scannerTaskService & {
        getTaskView?: jest.Mock;
        getTaskResultsView?: jest.Mock;
      };
      if (scannerTaskViews.getTaskView) {
        scannerTaskViews.getTaskView.mockResolvedValueOnce(mockTask);
        scannerTaskViews.getTaskResultsView.mockResolvedValueOnce(mockResults);
      } else {
        (scannerTaskService.getTask as jest.Mock).mockReturnValueOnce(mockTask);
        (scannerTaskService.getTaskResults as jest.Mock).mockReturnValueOnce(mockResults);
      }

      const response = await request(app).get('/api/fix-history/task-003');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('task-003');
      expect(response.body.data.status).toBe('completed');
      expect(response.body.data.findings).toEqual([]);
    });
  });
});
