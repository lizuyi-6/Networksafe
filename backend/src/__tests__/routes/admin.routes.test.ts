/**
 * Admin Routes Tests
 *
 * Tests for admin management API endpoints
 */

import request from 'supertest';
import express from 'express';
import adminRouter from '../../api/routes/admin.routes';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// Mock dependencies
jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = {
      userId: 'admin-user',
      email: 'admin@example.com',
      role: 'admin',
      tenantId: 'tenant-001'
    };
    next();
  }),
  requireRole: jest.fn(() => (req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../api/routes/ai-system.routes', () => ({
  getAgentSystem: jest.fn(() => null)
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  }
}));

const mockDb = {
  exec: jest.fn(),
  prepare: jest.fn(() => ({
    all: jest.fn(() => [
      { id: 'key-001', name: 'Test Key', created_at: '2024-01-01', last_used: '2024-01-02' }
    ]),
    get: jest.fn((id: string) => {
      if (id === 'user-001') {
        return { id: 'user-001' };
      }
      return null;
    }),
    run: jest.fn(() => ({ changes: 1 }))
  }))
};

jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(() => mockDb)
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$hashedkey')
}));

jest.mock('../../utils/uuid', () => ({
  uuidv4: jest.fn(() => 'test-uuid-001')
}));

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: jest.fn(() => Buffer.from('randombyteshexstring12345678', 'utf8'))
}));

describe('Admin Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/admin/errors', () => {
    it('should return error list', async () => {
      const response = await request(app).get('/api/admin/errors');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /api/admin/performance', () => {
    it('should return performance metrics', async () => {
      const response = await request(app).get('/api/admin/performance');

      expect(response.status).toBe(200);
      expect(response.body.server).toBeDefined();
      expect(response.body.clients).toBeDefined();
      expect(response.body.server.cpu).toBeDefined();
      expect(response.body.server.memory).toBeDefined();
      expect(response.body.server.uptime).toBeDefined();
    });
  });

  describe('POST /api/admin/logs', () => {
    it('should accept logs', async () => {
      const response = await request(app)
        .post('/api/admin/logs')
        .send({ data: { message: 'Test log' } });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 400 if data is missing', async () => {
      const response = await request(app)
        .post('/api/admin/logs')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('backend.missing_data');
    });
  });

  describe('GET /api/admin/api-keys', () => {
    it('should return API keys list', async () => {
      const response = await request(app).get('/api/admin/api-keys');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.keys)).toBe(true);
    });
  });

  describe('POST /api/admin/api-keys', () => {
    it('should create new API key', async () => {
      const response = await request(app)
        .post('/api/admin/api-keys')
        .send({ name: 'New API Key' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.apiKey).toBeDefined();
    });

    it('should return 401 if user not authenticated', async () => {
      // Override mock for this test
      (authenticate as jest.Mock).mockImplementationOnce((req: any, _res: any, next: any) => {
        req.user = undefined;
        next();
      });

      const response = await request(app)
        .post('/api/admin/api-keys')
        .send({ name: 'New Key' });

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /api/admin/api-keys/:id', () => {
    it('should delete API key', async () => {
      const response = await request(app).delete('/api/admin/api-keys/key-001');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/admin/users', () => {
    it('should return users list', async () => {
      const response = await request(app).get('/api/admin/users');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.users)).toBe(true);
    });
  });

  describe('PUT /api/admin/users/:id/plan', () => {
    it('should update user plan', async () => {
      const response = await request(app)
        .put('/api/admin/users/user-001/plan')
        .send({ plan: 'pro' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 400 for invalid plan', async () => {
      const response = await request(app)
        .put('/api/admin/users/user-001/plan')
        .send({ plan: 'invalid-plan' });

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent user', async () => {
      mockDb.prepare().get.mockReturnValueOnce(null);

      const response = await request(app)
        .put('/api/admin/users/non-existent/plan')
        .send({ plan: 'pro' });

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/admin/users/:id/role', () => {
    it('should update user role', async () => {
      const response = await request(app)
        .put('/api/admin/users/user-001/role')
        .send({ role: 'admin' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 400 for invalid role', async () => {
      const response = await request(app)
        .put('/api/admin/users/user-001/role')
        .send({ role: 'superadmin' });

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/admin/users/:id/status', () => {
    it('should update user status', async () => {
      const response = await request(app)
        .put('/api/admin/users/user-001/status')
        .send({ status: 'suspended' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 400 for invalid status', async () => {
      const response = await request(app)
        .put('/api/admin/users/user-001/status')
        .send({ status: 'banned' });

      expect(response.status).toBe(400);
    });
  });
});
