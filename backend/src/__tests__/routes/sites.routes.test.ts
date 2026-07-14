/**
 * Sites Routes Tests
 *
 * Tests for site management API endpoints with SSRF protection
 */

import request from 'supertest';
import express from 'express';
import sitesRouter from '../../api/routes/sites.routes';
import { authenticate } from '../../middleware/auth.middleware';
import dns from 'dns';

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
  requireTenantAccess: jest.fn(() => (req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../middleware/plan.middleware', () => ({
  requirePlanQuota: jest.fn(() => (req: any, _res: any, next: any) => next())
}));

jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(() => ({
    prepare: jest.fn(() => ({
      all: jest.fn(() => [
        {
          id: 1,
          domain: 'example.com',
          target: 'https://backend.example.com',
          sslEnabled: 1,
          tenant_id: 'tenant-001'
        }
      ]),
      get: jest.fn((id: string | number) => {
        if (id === '1' || id === 1) {
          return {
            id: 1,
            domain: 'example.com',
            target: 'https://backend.example.com',
            sslEnabled: 1,
            tenant_id: 'tenant-001'
          };
        }
        return null;
      }),
      run: jest.fn((id: string | number) => {
        if (String(id) === '999') {
          return { changes: 0 };
        }
        return { changes: 1 };
      })
    }))
  }))
}));

jest.mock('../../config/platform-runtime', () => ({
  getDatabaseMode: jest.fn(() => 'sqlite'),
  isSqliteFallbackEnabled: jest.fn(() => true)
}));

jest.mock('dns', () => ({
  lookup: jest.fn((hostname: string, callback: any) => {
    if (hostname === 'example.com') {
      callback(null, { address: '93.184.216.34' });
    } else if (hostname === 'localhost') {
      callback(null, { address: '127.0.0.1' });
    } else if (hostname === 'private.local') {
      callback(null, { address: '192.168.1.1' });
    } else if (hostname === 'backend.newsite.com') {
      callback(null, { address: '104.16.132.229' });
    } else if (hostname === 'backend.updated.com') {
      callback(null, { address: '104.16.133.229' });
    } else {
      callback(new Error('DNS lookup failed'), null);
    }
  })
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  }
}));

describe('Sites Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/sites', sitesRouter);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/sites', () => {
    it('should return list of sites', async () => {
      const response = await request(app).get('/api/sites');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('GET /api/sites/:id', () => {
    it('should return site by ID', async () => {
      const response = await request(app).get('/api/sites/1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should return 404 for non-existent site', async () => {
      const response = await request(app).get('/api/sites/999');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/sites', () => {
    it('should create a new site', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'newsite.com',
          target: 'https://backend.newsite.com',
          sslEnabled: true
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should return 400 if domain is missing', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          target: 'https://backend.example.com'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 if target is missing', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'example.com'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject localhost target (SSRF protection)', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'evil.com',
          target: 'http://localhost:8080'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject 127.0.0.1 target (SSRF protection)', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'evil.com',
          target: 'http://127.0.0.1:8080'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject metadata endpoint (SSRF protection)', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'evil.com',
          target: 'http://metadata.google.internal'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject private IP range targets (SSRF protection)', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'evil.com',
          target: 'https://private.local'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject non-HTTP protocols', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'evil.com',
          target: 'ftp://internal.server.com'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/sites/:id', () => {
    it('should update site', async () => {
      const response = await request(app)
        .put('/api/sites/1')
        .send({
          domain: 'updated.com',
          target: 'https://backend.updated.com'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent site', async () => {
      const response = await request(app)
        .put('/api/sites/999')
        .send({
          domain: 'updated.com'
        });

      expect(response.status).toBe(404);
    });

    it('should validate new target URL for SSRF', async () => {
      const response = await request(app)
        .put('/api/sites/1')
        .send({
          target: 'http://localhost:8080'
        });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/sites/:id', () => {
    it('should delete site', async () => {
      const response = await request(app).delete('/api/sites/1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent site', async () => {
      const response = await request(app).delete('/api/sites/999');

      expect(response.status).toBe(404);
    });
  });
});
