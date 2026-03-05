/**
 * Scanner Routes Tests
 *
 * Tests for scanner task API endpoints
 */

import request from 'supertest';
import express from 'express';
import scannerRouter from '../../api/routes/scanner.routes';
import { scannerTaskService } from '../../services/scanner-task.service';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// Mock dependencies
jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = {
      userId: 'test-user',
      email: 'test@example.com',
      role: 'admin',
      tenantId: 'tenant-001'
    };
    next();
  }),
  requireRole: jest.fn(() => (req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../services/scanner-task.service', () => ({
  scannerTaskService: {
    createTask: jest.fn().mockResolvedValue({
      id: 'task-001',
      tenantId: 'tenant-001',
      status: 'pending',
      phase: 'queued',
      progress: 0,
      createdAt: new Date().toISOString()
    }),
    getTask: jest.fn(),
    getTaskResults: jest.fn(),
    getHistory: jest.fn(),
    cancelTask: jest.fn()
  }
}));

jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(() => ({
    prepare: jest.fn(() => ({
      get: jest.fn(() => null)
    }))
  }))
}));

jest.mock('../../utils/logger', () => ({
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  }
}));

describe('Scanner Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/scanner', scannerRouter);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/scanner/tasks', () => {
    it('should create a new scan task', async () => {
      const response = await request(app)
        .post('/api/scanner/tasks')
        .send({
          targets: {
            urls: ['https://example.com'],
            host: {
              mode: 'local',
              includeSystem: true,
              includeWeb: true,
              includePorts: false
            }
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.taskId).toBeDefined();
    });

    it('should return 409 if task already running', async () => {
      (scannerTaskService.createTask as jest.Mock).mockRejectedValueOnce({
        code: 'TENANT_TASK_RUNNING',
        message: 'A scan task is already running for this tenant'
      });

      const response = await request(app)
        .post('/api/scanner/tasks')
        .send({
          targets: {
            urls: ['https://example.com'],
            host: { mode: 'local', includeSystem: true, includeWeb: true, includePorts: false }
          }
        });

      expect(response.status).toBe(409);
    });
  });

  describe('GET /api/scanner/tasks/history', () => {
    it('should return task history', async () => {
      (scannerTaskService.getHistory as jest.Mock).mockReturnValue([
        { id: 'task-001', status: 'completed', createdAt: new Date().toISOString() }
      ]);

      const response = await request(app).get('/api/scanner/tasks/history');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      (scannerTaskService.getHistory as jest.Mock).mockReturnValue([]);

      const response = await request(app).get('/api/scanner/tasks/history?limit=5');

      expect(response.status).toBe(200);
      expect(scannerTaskService.getHistory).toHaveBeenCalledWith('tenant-001', 5);
    });
  });

  describe('GET /api/scanner/tasks/:taskId', () => {
    it('should return task status', async () => {
      (scannerTaskService.getTask as jest.Mock).mockReturnValue({
        id: 'task-001',
        tenantId: 'tenant-001',
        status: 'completed',
        phase: 'done',
        progress: 100
      });

      const response = await request(app).get('/api/scanner/tasks/task-001');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.taskId).toBe('task-001');
    });

    it('should return 404 for non-existent task', async () => {
      (scannerTaskService.getTask as jest.Mock).mockReturnValue(null);

      const response = await request(app).get('/api/scanner/tasks/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should return 404 for task of different tenant', async () => {
      (scannerTaskService.getTask as jest.Mock).mockReturnValue({
        id: 'task-001',
        tenantId: 'other-tenant'
      });

      const response = await request(app).get('/api/scanner/tasks/task-001');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/scanner/tasks/:taskId/results', () => {
    it('should return task results', async () => {
      (scannerTaskService.getTask as jest.Mock).mockReturnValue({
        id: 'task-001',
        tenantId: 'tenant-001'
      });
      (scannerTaskService.getTaskResults as jest.Mock).mockReturnValue({
        taskId: 'task-001',
        timeline: [],
        urlFindings: [],
        hostFindings: [],
        nucleiFindings: []
      });

      const response = await request(app).get('/api/scanner/tasks/task-001/results');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.taskId).toBe('task-001');
    });

    it('should return 404 for non-existent task', async () => {
      (scannerTaskService.getTask as jest.Mock).mockReturnValue(null);

      const response = await request(app).get('/api/scanner/tasks/non-existent/results');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/scanner/tasks/:taskId/cancel', () => {
    it('should cancel task', async () => {
      (scannerTaskService.getTask as jest.Mock).mockReturnValue({
        id: 'task-001',
        tenantId: 'tenant-001'
      });
      (scannerTaskService.cancelTask as jest.Mock).mockReturnValue(true);

      const response = await request(app).post('/api/scanner/tasks/task-001/cancel');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent task', async () => {
      (scannerTaskService.getTask as jest.Mock).mockReturnValue(null);

      const response = await request(app).post('/api/scanner/tasks/non-existent/cancel');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/scanner', () => {
    it('should return backward compatible scan results', async () => {
      (scannerTaskService.getHistory as jest.Mock).mockReturnValue([
        { id: 'task-001' }
      ]);
      (scannerTaskService.getTaskResults as jest.Mock).mockReturnValue({
        summary: {},
        urlFindings: [{ title: 'Test Finding', severity: 'high' }],
        hostFindings: [],
        nucleiFindings: []
      });

      const response = await request(app).get('/api/scanner');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return empty array if no tasks', async () => {
      (scannerTaskService.getHistory as jest.Mock).mockReturnValue([]);

      const response = await request(app).get('/api/scanner');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('POST /api/scanner/run', () => {
    it('should create task (backward compatibility)', async () => {
      const response = await request(app)
        .post('/api/scanner/run')
        .send({ urls: ['https://example.com'] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/scanner/apply', () => {
    it('should return 501 not implemented', async () => {
      const response = await request(app).post('/api/scanner/apply');

      expect(response.status).toBe(501);
    });
  });

  describe('GET /api/scanner/report/:id', () => {
    it('should return scan report', async () => {
      (scannerTaskService.getTask as jest.Mock).mockReturnValue({
        id: 'task-001',
        tenantId: 'tenant-001',
        status: 'completed'
      });
      (scannerTaskService.getTaskResults as jest.Mock).mockReturnValue({
        summary: {},
        urlFindings: [],
        hostFindings: [],
        nucleiFindings: []
      });

      const response = await request(app).get('/api/scanner/report/task-001');

      expect(response.status).toBe(200);
      expect(response.body.taskId).toBe('task-001');
    });

    it('should return 404 for non-existent task', async () => {
      (scannerTaskService.getTask as jest.Mock).mockReturnValue(null);

      const response = await request(app).get('/api/scanner/report/non-existent');

      expect(response.status).toBe(404);
    });
  });
});